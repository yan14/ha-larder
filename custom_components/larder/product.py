"""Barcode gekaufter Ware (EAN/UPC) → Produktname über Open Food Facts.

Im Befüllen-Dialog scannt die App den Strichcode; der Name kommt in das Feld "Inhalt". Gefragt wird
nur die Produktdatenbank von Open Food Facts (frei, ohne Konto), mit Zwischenspeicher pro Lauf.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN
from .shelf_life import category_for

_LOGGER = logging.getLogger(__name__)

DATA_WS = "product_ws_registered"
DATA_CACHE = "product_cache"
API = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = (
    "product_name,product_name_de,product_name_en,generic_name,generic_name_de,brands,quantity,"
    "nutriments,nutriscore_grade,allergens_tags,serving_size"
)
TIMEOUT = 8
USER_AGENT = "HomeAssistant-Larder/1 (https://github.com/yan14/ha-larder)"
_CODE_RE = re.compile(r"^\d{8,14}$")


# Nährwerte für den Freitext: Schlüssel bei Open Food Facts → (Deutsch, Englisch)
_NUTRIENTS = (
    ("fat", "Fett", "Fat"),
    ("saturated-fat", "davon gesättigte Fettsäuren", "of which saturates"),
    ("carbohydrates", "Kohlenhydrate", "Carbohydrates"),
    ("sugars", "davon Zucker", "of which sugars"),
    ("fiber", "Ballaststoffe", "Fibre"),
    ("proteins", "Eiweiß", "Protein"),
    ("salt", "Salz", "Salt"),
)
_ALLERGENS = {
    "gluten": ("Gluten", "Gluten"),
    "milk": ("Milch", "Milk"),
    "eggs": ("Eier", "Eggs"),
    "nuts": ("Schalenfrüchte", "Nuts"),
    "peanuts": ("Erdnüsse", "Peanuts"),
    "soybeans": ("Soja", "Soy"),
    "fish": ("Fisch", "Fish"),
    "crustaceans": ("Krebstiere", "Crustaceans"),
    "molluscs": ("Weichtiere", "Molluscs"),
    "celery": ("Sellerie", "Celery"),
    "mustard": ("Senf", "Mustard"),
    "sesame-seeds": ("Sesam", "Sesame"),
    "sulphur-dioxide-and-sulphites": ("Schwefeldioxid/Sulfite", "Sulphites"),
    "lupin": ("Lupinen", "Lupin"),
}


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _fmt(number: float, de: bool) -> str:
    digits = 2 if number < 1 else 1 if number < 10 else 0
    text = f"{number:.{digits}f}"
    if digits:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", ",") if de else text


def nutrition(product: dict[str, Any], language: str) -> dict[str, Any]:
    """kcal pro 100 g / Portion, Nährwerte als Text, Nutri-Score und Allergene aus Open Food Facts."""
    de = language.lower().startswith("de")
    n = product.get("nutriments") or {}
    out: dict[str, Any] = {}
    kcal = _number(n.get("energy-kcal_100g"))
    if kcal is None and (kj := _number(n.get("energy-kj_100g") or n.get("energy_100g"))) is not None:
        kcal = kj / 4.184
    if kcal is not None:
        out["kcal_100g"] = round(kcal)
    kcal_serving = _number(n.get("energy-kcal_serving"))
    if kcal_serving is None and (kj := _number(n.get("energy-kj_serving"))) is not None:
        kcal_serving = kj / 4.184
    if kcal_serving is not None:
        out["kcal_portion"] = round(kcal_serving)
    parts = [
        f"{label_de if de else label_en} {_fmt(value, de)} g"
        for key, label_de, label_en in _NUTRIENTS
        if (value := _number(n.get(f"{key}_100g"))) is not None
    ]
    if parts:
        out["nutrients"] = ", ".join(parts) + (" (pro 100 g)" if de else " (per 100 g)")
    grade = str(product.get("nutriscore_grade") or "").strip().upper()
    if grade in ("A", "B", "C", "D", "E"):
        out["nutri_score"] = grade
    allergens = []
    for tag in product.get("allergens_tags") or []:
        key = str(tag).split(":", 1)[-1]
        names = _ALLERGENS.get(key)
        allergens.append(names[0 if de else 1] if names else key.replace("-", " ").capitalize())
    if allergens:
        out["allergens"] = ", ".join(dict.fromkeys(allergens))
    return out


def _name(product: dict[str, Any], language: str) -> str:
    lang = "de" if language.lower().startswith("de") else "en"
    for key in (f"product_name_{lang}", "product_name", f"generic_name_{lang}", "generic_name"):
        if value := str(product.get(key) or "").strip():
            return value
    return ""


async def async_lookup(hass: HomeAssistant, code: str) -> dict[str, Any]:
    """{"found": bool, "code", "name", "brand", "quantity", "category"}; Fehler gelten als nicht gefunden."""
    code = re.sub(r"\D", "", code or "")
    if not _CODE_RE.match(code):
        return {"found": False, "code": code, "error": "invalid_code"}
    cache: dict[str, dict[str, Any]] = hass.data.setdefault(DOMAIN, {}).setdefault(DATA_CACHE, {})
    if code in cache:
        return cache[code]
    session = async_get_clientsession(hass)
    try:
        async with asyncio.timeout(TIMEOUT):
            resp = await session.get(
                API.format(code=code), params={"fields": FIELDS}, headers={"User-Agent": USER_AGENT}
            )
            data = await resp.json(content_type=None) if resp.status in (200, 404) else None
    except (aiohttp.ClientError, TimeoutError, ValueError):
        _LOGGER.debug("Open Food Facts nicht erreichbar für %s", code, exc_info=True)
        return {"found": False, "code": code, "error": "unavailable"}
    product = (data or {}).get("product") if (data or {}).get("status") in (1, "success_with_warnings", "success") else None
    name = _name(product or {}, hass.config.language or "en")
    if not name:
        result: dict[str, Any] = {"found": False, "code": code}
    else:
        brand = str((product or {}).get("brands") or "").split(",")[0].strip()
        package = str((product or {}).get("quantity") or "").strip()
        details: dict[str, Any] = {"ean": code, "source": "openfoodfacts"}
        if brand:
            details["brand"] = brand
        if package:
            details["package"] = package
        details.update(nutrition(product or {}, hass.config.language or "en"))
        result = {
            "found": True,
            "code": code,
            "name": name,
            "brand": brand,
            "quantity": package,
            "category": category_for(name),
            "product": details,
        }
    cache[code] = result
    return result


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/product", vol.Required("code"): str})
@websocket_api.async_response
async def ws_product(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_lookup(hass, msg["code"]))


def _content_entity(hass: HomeAssistant, device_id: str):
    """Entität "Inhalt" der Dose zu einer Geräte-ID (oder None)."""
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return None
    for entry_id in device.config_entries:
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is not None and entry.domain == DOMAIN and getattr(entry, "runtime_data", None) is not None:
            return entry.runtime_data.resettable.get("content")
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/product_set",
        vol.Required("device_id"): str,
        vol.Required("product"): dict,
        vol.Optional("replace", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_product_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Produktdaten und Nährwerte einer Dose setzen (Befüllen nach dem Scan) oder einzelne Felder ändern (Karte)."""
    entity = _content_entity(hass, msg["device_id"])
    if entity is None:
        connection.send_error(msg["id"], "not_found", "container not found")
        return
    await entity.async_set_product(msg["product"], replace=msg["replace"])
    connection.send_result(msg["id"], {"product": entity.product})


def async_setup_product_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_product)
    websocket_api.async_register_command(hass, ws_product_set)
    domain_data[DATA_WS] = True
