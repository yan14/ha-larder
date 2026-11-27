"""Online shopping (6.6, Block 47).

* **Prepare the next order** (#176): with the delivery day of the next online order, Larder lists what runs out by
  then by consumption (and what is below its minimum stock), with how many – as a copyable list for the shop's app,
  or onto the shopping list.
* **Delivery day** (#177): the blueprint *Larder – delivery day* sends a push on that day, its button opens put
  away (and the list of 6.1 afterwards). The day is forgotten once it is over.

Only Home Assistant's own ways: the day is kept in Larder's storage, the push goes through the notify action of
the blueprint. No e-mail or shop account is read.
"""

from __future__ import annotations

from datetime import date
from math import ceil
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.util import dt as dt_util

from .const import DOMAIN, KIND_MEDICINE, PANEL_URL_PATH, pick
from .estimate import async_get_estimator
from .stock import async_get_stock, async_shop_product, stock_overview

SERVICE_GET_DELIVERY = "get_delivery"

_TEXT = {
    "de": {"title": "📦 Lieferung heute", "message": lambda d: "Deine Bestellung kommt heute – gleich einräumen? Danach Preis und MHD in einer Liste nachtragen.", "button": "📥 Einräumen"},
    "en": {"title": "📦 Delivery today", "message": lambda d: "Your order arrives today – put it away? Then add price and date in one list.", "button": "📥 Put away"},
    "fr": {"title": "📦 Livraison aujourd'hui", "message": lambda d: "Votre commande arrive aujourd'hui – la ranger ? Ensuite prix et date dans une seule liste.", "button": "📥 Ranger"},
    "nl": {"title": "📦 Levering vandaag", "message": lambda d: "Je bestelling komt vandaag – meteen opbergen? Daarna prijs en datum in één lijst.", "button": "📥 Opbergen"},
}


def prepare_order(products: list[dict[str, Any]], delivery: date, today: date, lead_days: int) -> list[dict[str, Any]]:
    """What runs out before the delivery after this one (delivery day + lead time), or is below its minimum."""
    horizon = max(0, (delivery - today).days) + max(1, int(lead_days or 7))
    out = []
    for p in products:
        if p.get("kind") == KIND_MEDICINE:
            continue
        count = int(p.get("count") or 0)
        need, reason = 0, None
        minimum = int(p.get("min") or 0)
        if minimum and count < minimum:
            need, reason = minimum - count, "min"
        usage = p.get("usage")
        if usage and usage.get("per_week") and usage.get("lasts_days") is not None and usage["lasts_days"] <= horizon:
            target = ceil(float(usage["per_week"]) / 7 * horizon)
            if target - count > need:
                need, reason = max(1, target - count), "usage"
            need = max(need, 1)
            reason = reason or "usage"
        if not need:
            continue
        pack_size = max(1, int(p.get("pack_size") or 1))
        packs = ceil(need / pack_size) if pack_size > 1 else need
        out.append(
            {
                "name": p["name"],
                "count": count,
                "need": packs,
                "reason": reason,
                "lasts_days": usage.get("lasts_days") if usage else None,
                "brand": p.get("brand"),
                "package": p.get("package"),
            }
        )
    out.sort(key=lambda r: (r["lasts_days"] if r["lasts_days"] is not None else -1, r["name"].casefold()))
    return out


def order_text(items: list[dict[str, Any]]) -> str:
    lines = []
    for item in items:
        extra = " ".join(x for x in (item.get("brand"), item.get("package")) if x)
        lines.append(f"{item['need']}× {item['name']}{f' ({extra})' if extra else ''}")
    return "\n".join(lines)


async def async_prepare(hass: HomeAssistant, delivery: date | None) -> dict[str, Any]:
    stock = await async_get_stock(hass)
    estimator = await async_get_estimator(hass)
    today = dt_util.now().date()
    when = delivery or stock.delivery_day() or today
    items = prepare_order(stock_overview(hass, stock.minimums, stock), when, today, estimator.stock_lead_days)
    return {"date": when.isoformat(), "saved": stock.delivery_day().isoformat() if stock.delivery_day() else None, "items": items, "text": order_text(items)}


async def async_get_delivery(hass: HomeAssistant) -> dict[str, Any]:
    """For the blueprint: is the delivery today? (A day in the past is forgotten.)"""
    stock = await async_get_stock(hass)
    today = dt_util.now().date()
    day = stock.delivery_day()
    if day is not None and day < today:
        stock.set_delivery(None)
        day = None
    text = pick(_TEXT, hass.config.language or "en")
    return {
        "due": day == today,
        "date": day.isoformat() if day else None,
        "title": text["title"],
        "message": text["message"](day),
        "button": text["button"],
        "url": f"/{PANEL_URL_PATH}?putaway=1",
    }


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/order_prepare", vol.Optional("date"): vol.Any(None, vol.Date())}
)
@websocket_api.async_response
async def ws_order_prepare(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    day = msg.get("date")
    connection.send_result(msg["id"], await async_prepare(hass, date.fromisoformat(day) if day else None))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/delivery_set", vol.Optional("date"): vol.Any(None, vol.Date())}
)
@websocket_api.async_response
async def ws_delivery_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    day = msg.get("date")
    stock.set_delivery(date.fromisoformat(day) if isinstance(day, str) and day else day or None)
    day = stock.delivery_day()
    connection.send_result(msg["id"], {"date": day.isoformat() if day else None})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/order_to_list", vol.Required("names"): vol.All([str], vol.Length(max=100))}
)
@websocket_api.async_response
async def ws_order_to_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from homeassistant.exceptions import HomeAssistantError  # noqa: PLC0415

    added = []
    for name in msg["names"]:
        try:
            ok, text = await async_shop_product(hass, name)
        except HomeAssistantError as err:
            connection.send_error(msg["id"], "no_list", str(err))
            return
        if ok:
            added.append(text)
    connection.send_result(msg["id"], {"added": added})


def async_setup_order(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("order_setup"):
        return
    domain_data["order_setup"] = True
    for command in (ws_order_prepare, ws_delivery_set, ws_order_to_list):
        websocket_api.async_register_command(hass, command)

    async def handle(_call: ServiceCall) -> dict[str, Any]:
        return await async_get_delivery(hass)

    hass.services.async_register(DOMAIN, SERVICE_GET_DELIVERY, handle, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY)
