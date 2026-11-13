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
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN
from .shelf_life import category_for

_LOGGER = logging.getLogger(__name__)

DATA_WS = "product_ws_registered"
DATA_CACHE = "product_cache"
API = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = "product_name,product_name_de,product_name_en,generic_name,generic_name_de,brands,quantity"
TIMEOUT = 8
USER_AGENT = "HomeAssistant-Larder/1 (https://github.com/yan14/ha-larder)"
_CODE_RE = re.compile(r"^\d{8,14}$")


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
        result = {
            "found": True,
            "code": code,
            "name": name,
            "brand": str((product or {}).get("brands") or "").split(",")[0].strip(),
            "quantity": str((product or {}).get("quantity") or "").strip(),
            "category": category_for(name),
        }
    cache[code] = result
    return result


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/product", vol.Required("code"): str})
@websocket_api.async_response
async def ws_product(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_lookup(hass, msg["code"]))


def async_setup_product_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_product)
    domain_data[DATA_WS] = True
