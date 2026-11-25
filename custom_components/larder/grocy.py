"""Import from Grocy (6.0, #163).

Grocy has no export file; its web frontend uses its REST API for everything, so the import reads that API
once with an API key from Grocy's user settings (header `GROCY-API-KEY`):

* `/api/objects/locations` – places (matched to Home Assistant areas by name, else chosen in the dialog),
* `/api/objects/products` – names and `default_best_before_days_after_open`,
* `/api/objects/product_barcodes` – barcodes,
* `/api/objects/stock` – every stock entry with amount, best-before date, opened and location.

Each stock entry becomes a Larder pack. Products are taken over by their own name; nothing is merged with
similar Larder products. Grocy's "after opening" days become the per-product value (5.7). The API key is only
used for the request and is not stored.
"""

from __future__ import annotations

import asyncio
from datetime import date
import logging
from typing import Any
from urllib.parse import urlsplit

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, KIND_PACK

_LOGGER = logging.getLogger(__name__)

NEVER = "2999-12-31"  # Grocy's "never expires"
MAX_ITEMS = 500
TIMEOUT = 20


class GrocyError(HomeAssistantError):
    """The Grocy server could not be read (with a reason for the dialog)."""


def base_url(url: str) -> str:
    """'grocy.local:9283/' → 'http://grocy.local:9283'; only http(s), no paths behind /api."""
    url = url.strip().rstrip("/")
    if "://" not in url:
        url = f"http://{url}"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise GrocyError("invalid address")
    path = parts.path.removesuffix("/api").rstrip("/")
    return f"{parts.scheme}://{parts.netloc}{path}"


async def async_fetch(hass: HomeAssistant, url: str, api_key: str) -> dict[str, list[dict[str, Any]]]:
    """The four Grocy tables, or a GrocyError with the reason."""
    session = async_get_clientsession(hass)
    base = base_url(url)
    headers = {"GROCY-API-KEY": api_key.strip(), "Accept": "application/json"}
    out: dict[str, list[dict[str, Any]]] = {}
    for name in ("locations", "products", "product_barcodes", "stock"):
        try:
            async with asyncio.timeout(TIMEOUT):
                resp = await session.get(f"{base}/api/objects/{name}", headers=headers)
                if resp.status in (401, 403):
                    raise GrocyError("API key rejected")
                if resp.status != 200:
                    raise GrocyError(f"HTTP {resp.status}")
                data = await resp.json(content_type=None)
        except GrocyError:
            raise
        except (TimeoutError, aiohttp.ClientError, ValueError) as err:
            raise GrocyError(str(err) or type(err).__name__) from err
        if not isinstance(data, list):
            raise GrocyError("unexpected answer")
        out[name] = [d for d in data if isinstance(d, dict)]
    return out


def _amount(value: Any) -> int:
    try:
        return max(0, round(float(value)))
    except (TypeError, ValueError):
        return 0


def _best(value: Any) -> str | None:
    text = str(value or "")[:10]
    if not text or text >= NEVER:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def build_preview(hass: HomeAssistant, data: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Places with a suggested area, the entries that would be created and the per-product values."""
    areas = {a.name.casefold(): a.id for a in ar.async_get(hass).async_list_areas()}
    products = {str(p.get("id")): p for p in data["products"]}
    barcodes: dict[str, str] = {}
    for b in data["product_barcodes"]:
        barcodes.setdefault(str(b.get("product_id")), str(b.get("barcode") or "").strip())
    items: list[dict[str, Any]] = []
    for entry in data["stock"]:
        product = products.get(str(entry.get("product_id")))
        amount = _amount(entry.get("amount"))
        if product is None or not amount or not str(product.get("name") or "").strip():
            continue
        item: dict[str, Any] = {
            "content": " ".join(str(product["name"]).split())[:255],
            "quantity": amount,
            "location": str(entry.get("location_id") or product.get("location_id") or ""),
        }
        if best := _best(entry.get("best_before_date")):
            item["best_before"] = best
        if str(entry.get("open")) in ("1", "True", "true"):
            item["opened"] = str(entry.get("opened_date") or "")[:10] or None
        if code := barcodes.get(str(product.get("id"))):
            item["ean"] = code
        try:
            if (price := round(float(entry.get("price") or 0), 2)) > 0:
                item["price"] = price
        except (TypeError, ValueError):
            pass
        items.append(item)
    counts: dict[str, int] = {}
    for item in items:
        counts[item["location"]] = counts.get(item["location"], 0) + 1
    locations = [
        {
            "id": str(loc.get("id")),
            "name": str(loc.get("name") or ""),
            "freezer": str(loc.get("is_freezer")) in ("1", "True", "true"),
            "count": counts.get(str(loc.get("id")), 0),
            "area_id": areas.get(str(loc.get("name") or "").casefold()),
        }
        for loc in data["locations"]
    ]
    after_open = {
        " ".join(str(p.get("name")).split()): int(p["default_best_before_days_after_open"])
        for p in data["products"]
        if str(p.get("name") or "").strip() and _amount(p.get("default_best_before_days_after_open")) > 0
    }
    return {"locations": [loc for loc in locations if loc["count"]], "items": items[:MAX_ITEMS], "after_open": after_open, "total": len(items)}


async def async_import(hass: HomeAssistant, preview: dict[str, Any], areas: dict[str, str | None]) -> dict[str, Any]:
    """Create one pack per Grocy stock entry, at the area chosen for its Grocy location."""
    from .disposable import async_create_items  # noqa: PLC0415
    from .stock import async_get_stock  # noqa: PLC0415

    known_areas = {a.id for a in ar.async_get(hass).async_list_areas()}
    by_area: dict[str | None, list[dict[str, Any]]] = {}
    for item in preview["items"]:
        area = areas.get(item["location"])
        area = area if area in known_areas else None
        product: dict[str, Any] = {}
        if item.get("ean"):
            product["ean"] = item["ean"]
        if "opened" in item:
            product["opened"] = item["opened"] or date.today().isoformat()
        if item.get("price"):
            product["price"] = item["price"]
        new = {"content": item["content"], "quantity": item["quantity"], "unit": "pieces", **({"product": product} if product else {})}
        if item.get("best_before"):
            new["best_before"] = date.fromisoformat(item["best_before"])
        by_area.setdefault(area, []).append(new)
    created = 0
    for area, items in by_area.items():
        created += len(await async_create_items(hass, KIND_PACK, items, area, None))
    stock = await async_get_stock(hass)
    for name, days in preview["after_open"].items():
        if not stock.opened_after.get(name.casefold()):
            stock.set_opened_after(name, days, "manual")
    return {"created": created, "after_open": len(preview["after_open"])}


_CONNECT = {
    vol.Required("url"): vol.All(str, vol.Length(min=3, max=300)),
    vol.Required("api_key"): vol.All(str, vol.Length(min=1, max=200)),
}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/grocy_preview", **_CONNECT})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_grocy_preview(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        preview = build_preview(hass, await async_fetch(hass, msg["url"], msg["api_key"]))
    except GrocyError as err:
        connection.send_error(msg["id"], "grocy_failed", str(err))
        return
    connection.send_result(msg["id"], preview)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/grocy_import",
        **_CONNECT,
        vol.Optional("areas", default={}): {str: vol.Any(None, str)},
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_grocy_import(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        preview = build_preview(hass, await async_fetch(hass, msg["url"], msg["api_key"]))
        result = await async_import(hass, preview, msg["areas"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "grocy_failed", str(err))
        return
    connection.send_result(msg["id"], result)


def async_setup_grocy_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("grocy_ws"):
        return
    domain_data["grocy_ws"] = True
    websocket_api.async_register_command(hass, ws_grocy_preview)
    websocket_api.async_register_command(hass, ws_grocy_import)
