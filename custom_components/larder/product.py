"""Barcode of bought goods (EAN/UPC) → product name from Open Food Facts.

In the fill dialog the app scans the barcode; the name goes into the "Content" field. Only the
product database of Open Food Facts is asked (free, no account), with a cache per run.
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

from .const import DOMAIN, larder_id
from .household import household_category
from .shelf_life import category_for

_LOGGER = logging.getLogger(__name__)

DATA_WS = "product_ws_registered"
DATA_CACHE = "product_cache"
API = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = (
    "product_name,product_name_de,product_name_en,generic_name,generic_name_de,brands,quantity,"
    "nutriments,nutriscore_grade,allergens_tags,serving_size"
)
# sibling databases of Open Food Facts (same API): cosmetics, other consumer products, pet food
SIBLINGS = (
    ("beauty", "https://world.openbeautyfacts.org/api/v2/product/{code}.json"),
    ("product", "https://world.openproductsfacts.org/api/v2/product/{code}.json"),
    ("petfood", "https://world.openpetfoodfacts.org/api/v2/product/{code}.json"),
)
SIBLING_FIELDS = "product_name,product_name_de,product_name_en,generic_name,generic_name_de,brands,quantity"
TIMEOUT = 8
USER_AGENT = "HomeAssistant-Larder/1 (https://github.com/yan14/ha-larder)"
_CODE_RE = re.compile(r"^\d{8,14}$")


# nutrients for the free text: key at Open Food Facts → (German, English)
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
    """kcal per 100 g / portion, nutrients as text, Nutri-Score and allergens from Open Food Facts."""
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


def _product_of(data: Any) -> dict[str, Any] | None:
    ok = isinstance(data, dict) and data.get("status") in (1, "success_with_warnings", "success")
    return data.get("product") if ok else None


def _name(product: dict[str, Any], language: str) -> str:
    lang = "de" if language.lower().startswith("de") else "en"
    for key in (f"product_name_{lang}", "product_name", f"generic_name_{lang}", "generic_name"):
        if value := str(product.get(key) or "").strip():
            return value
    return ""


async def async_lookup(hass: HomeAssistant, code: str) -> dict[str, Any]:
    """{"found": bool, "code", "name", "brand", "quantity", "category"}; errors count as not found."""
    code = re.sub(r"\D", "", code or "")
    if not _CODE_RE.match(code):
        return {"found": False, "code": code, "error": "invalid_code"}
    cache: dict[str, dict[str, Any]] = hass.data.setdefault(DOMAIN, {}).setdefault(DATA_CACHE, {})
    if code in cache:
        return cache[code]
    session = async_get_clientsession(hass)
    language = hass.config.language or "en"
    try:
        async with asyncio.timeout(TIMEOUT):
            resp = await session.get(
                API.format(code=code), params={"fields": FIELDS}, headers={"User-Agent": USER_AGENT}
            )
            data = await resp.json(content_type=None) if resp.status in (200, 404) else None
    except (aiohttp.ClientError, TimeoutError, ValueError):
        _LOGGER.debug("Open Food Facts nicht erreichbar für %s", code, exc_info=True)
        return {"found": False, "code": code, "error": "unavailable"}
    product = _product_of(data)
    product_type = "food"
    if not _name(product or {}, language):
        # not a food product: ask the sibling databases (cosmetics, other products, pet food)
        for kind, url in SIBLINGS:
            try:
                async with asyncio.timeout(TIMEOUT):
                    resp = await session.get(
                        url.format(code=code), params={"fields": SIBLING_FIELDS}, headers={"User-Agent": USER_AGENT}
                    )
                    data = await resp.json(content_type=None) if resp.status in (200, 404) else None
            except Exception:  # noqa: BLE001 - any failure of a sibling database counts as "not found there"
                _LOGGER.debug("%s not reachable for %s", url, code, exc_info=True)
                continue
            product = _product_of(data)
            if _name(product or {}, language):
                product_type = kind
                break
        else:
            product = None
    name = _name(product or {}, language)
    if not name:
        result: dict[str, Any] = {"found": False, "code": code}
    else:
        brand = str((product or {}).get("brands") or "").split(",")[0].strip()
        package = str((product or {}).get("quantity") or "").strip()
        food = product_type == "food"
        details: dict[str, Any] = {"ean": code, "source": "openfoodfacts" if food else f"open{product_type}facts"}
        if brand:
            details["brand"] = brand
        if package:
            details["package"] = package
        if food:
            details.update(nutrition(product or {}, language))
        result = {
            "found": True,
            "code": code,
            "name": name,
            "brand": brand,
            "quantity": package,
            "category": category_for(name) if food else household_category(name),
            "product_type": product_type,  # food, beauty, product or petfood
            "product": details,
        }
    cache[code] = result
    return result


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/product", vol.Required("code"): str})
@websocket_api.async_response
async def ws_product(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_lookup(hass, msg["code"]))


def _content_entity(hass: HomeAssistant, device_id: str):
    """Entity "Content" of the container for a device ID (or None)."""
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return None
    # by the container ID in the identifiers (DeviceEntry.config_entries is deprecated since 2026.9)
    cc = larder_id(device)
    entry = next((e for e in hass.config_entries.async_entries(DOMAIN) if cc and e.data.get("cc") == cc), None)
    if entry is not None and getattr(entry, "runtime_data", None) is not None:
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
    """Set product data and nutrition of a container (filling after the scan) or change single fields (card)."""
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


# Allergens in the household: terms by which an allergen is recognised in the "Allergens" field (start
# of a word) or in the content (part of a word, longer terms only). Only a hint, no guarantee.
ALLERGEN_KEYS = tuple(key.replace("-", "_") for key in _ALLERGENS)  # translation key without a hyphen
_ALLERGEN_TERMS: dict[str, tuple[str, ...]] = {
    "gluten": ("gluten", "weizen", "wheat", "roggen", "rye", "gerste", "barley", "dinkel", "spelt", "hafer", "oat"),
    "milk": ("milch", "milk", "laktose", "lactose", "sahne", "cream", "käse", "cheese", "joghurt", "yogurt", "quark"),
    "eggs": ("eier", "eggs", "egg", "ei"),
    "nuts": ("schalenfrüchte", "nüsse", "nuss", "nuts", "nut", "mandel", "almond", "haselnuss", "hazelnut", "walnuss", "walnut", "cashew", "pistazie", "pistachio", "pekan", "pecan", "macadamia"),
    "peanuts": ("erdnuss", "erdnüsse", "peanut"),
    "soybeans": ("soja", "soy", "tofu", "edamame"),
    "fish": ("fisch", "fish", "lachs", "salmon", "thunfisch", "tuna", "forelle", "trout", "kabeljau", "hering", "sardine"),
    "crustaceans": ("krebstiere", "crustacean", "garnele", "shrimp", "prawn", "krabbe", "crab", "hummer", "lobster", "scampi"),
    "molluscs": ("weichtiere", "mollusc", "muschel", "mussel", "tintenfisch", "squid", "calamari", "auster", "oyster"),
    "celery": ("sellerie", "celery"),
    "mustard": ("senf", "mustard"),
    "sesame_seeds": ("sesam", "sesame", "tahini"),
    "sulphur_dioxide_and_sulphites": ("schwefeldioxid", "sulfit", "sulphite", "sulfite"),
    "lupin": ("lupine", "lupin"),
}


def allergen_name(key: str, language: str) -> str:
    names = _ALLERGENS.get(key.replace("_", "-"))
    if not names:
        return key
    return names[0 if language.lower().startswith("de") else 1]


def watched_allergens(content: str, allergens: str, watched: list[str] | tuple[str, ...], language: str) -> list[str]:
    """Names of the watched allergens in a container (from allergens and content)."""
    found: list[str] = []
    allergen_text = (allergens or "").casefold()
    content_text = (content or "").casefold()
    for key in watched:
        terms = _ALLERGEN_TERMS.get(key, ())
        hit = any(re.search(rf"(?<![\w]){re.escape(term)}", allergen_text) for term in terms)
        if not hit:
            # in the content also in the middle of a word ("Haselnusscreme"), but only for longer terms
            hit = any(len(term) >= 4 and term in content_text for term in terms)
        if hit:
            found.append(allergen_name(key, language))
    return found
