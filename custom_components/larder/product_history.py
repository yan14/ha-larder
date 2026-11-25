"""Product history and recently used products (5.1, #125, #126).

* **Product history:** the history records of every container, bag and pack with the same contents
  (case-insensitive), newest first, with figures (how often a year, how long it lasted, thrown away and
  its value), the price history and a hint ("2 of 5 thrown away – freeze smaller portions?").
* **Recently used:** the last products added (＋ dialog, put away, receipt, shopping mode); one tap adds one
  pack again at its usual place.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .history import async_get_history
from .stock import async_add_known, async_get_stock, pack_entries, product_key

RECORDS_SHOWN = 50
RECENT_SHOWN = 8
HINT_MIN_RECORDS = 3


def _day(value: Any) -> date | None:
    try:
        return dt_util.as_local(dt_util.parse_datetime(str(value))).date() if "T" in str(value) else date.fromisoformat(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def build_product_history(
    records: list[dict[str, Any]], content: str, prices: list[dict[str, Any]] | None, today: date
) -> dict[str, Any]:
    """Records of one product (newest first) and its figures. `records`: all history records, oldest first."""
    key = product_key(content)
    mine = [r for r in records if product_key(r.get("content")) == key]
    mine.reverse()
    year_ago = today - timedelta(days=365)
    last_year = [r for r in mine if (d := _day(r.get("emptied"))) and d >= year_ago]
    stored = [r["days_stored"] for r in mine if isinstance(r.get("days_stored"), int) and r["days_stored"] >= 0]
    thrown = [r for r in mine if r.get("outcome") == "thrown"]
    eaten = [r for r in mine if r.get("outcome") == "eaten"]
    value = round(sum(float((r.get("product") or {}).get("price") or 0) for r in thrown), 2)
    summary: dict[str, Any] = {
        "count": len(mine),
        "per_year": len(last_year),
        "avg_days": round(sum(stored) / len(stored)) if stored else None,
        "eaten": len(eaten),
        "thrown": len(thrown),
        "thrown_value": value or None,
        "first": mine[-1].get("filled_at") or mine[-1].get("emptied") if mine else None,
    }
    hint = None
    answered = len(eaten) + len(thrown)
    if answered >= HINT_MIN_RECORDS and len(thrown) * 3 >= answered:
        hint = {"key": "thrown_often", "thrown": len(thrown), "of": answered}
    elif len(stored) >= HINT_MIN_RECORDS and summary["avg_days"] is not None:
        hint = {"key": "usually_days", "days": summary["avg_days"]}
    name = mine[0]["content"] if mine else content
    return {
        "name": name,
        "records": mine[:RECORDS_SHOWN],
        "summary": summary,
        "hint": hint,
        "price_history": list(prices or []),
    }


def recent_products(hass: HomeAssistant, stock) -> list[dict[str, Any]]:
    """The last products added, with the name of their area and how many there are now."""
    areas = ar.async_get(hass)
    counts: dict[str, int] = {}
    for p in pack_entries(hass):
        counts[product_key(p["content"])] = counts.get(product_key(p["content"]), 0) + p["count"]
    out = []
    for r in stock.recent[:RECENT_SHOWN]:
        area = areas.async_get_area(r["area_id"]) if r.get("area_id") else None
        out.append({**r, "area": area.name if area else None, "count": counts.get(product_key(r["content"]), 0)})
    return out


async def async_recent_add(hass: HomeAssistant, content: str, packs: int = 1) -> dict[str, Any]:
    """One pack (or more) of a recently used product again: at its usual place (where it is now, else where it was)."""
    stock = await async_get_stock(hass)
    key = product_key(content)
    recent = next((r for r in stock.recent if product_key(r.get("content")) == key), None)
    if recent is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    from .stock import _known_product  # noqa: PLC0415

    found = [p for p in pack_entries(hass) if product_key(p["content"]) == key and p["kind"] == recent["kind"]]
    known = _known_product(found, "") if found else {
        "content": recent["content"],
        "kind": recent["kind"],
        "product": dict(recent.get("product") or {}),
        "area_id": recent.get("area_id"),
        "compartment": recent.get("compartment") or "",
    }
    return await async_add_known(hass, known, packs)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/product_history", vol.Required("content"): vol.All(str, vol.Length(min=1, max=255))}
)
@websocket_api.async_response
async def ws_product_history(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    history = await async_get_history(hass)
    stock = await async_get_stock(hass)
    key = product_key(msg["content"])
    prices = stock.price_history.get(key)
    result = build_product_history(history.records, msg["content"], prices, dt_util.now().date())
    # 5.5 (#142): the product view also shows stock, places, minimum stock, buy again and price
    from .stock import stock_overview  # noqa: PLC0415

    minimums = {k: v for k, v in stock.minimums.items() if k == key}
    result["product"] = next(
        (p for p in stock_overview(hass, minimums, stock) if p["key"] == key and (p["count"] or p["min"] or p.get("auto"))),
        None,
    )
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recent_products"})
@websocket_api.async_response
async def ws_recent_products(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {"items": recent_products(hass, stock)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/recent_add",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Optional("packs", default=1): vol.All(int, vol.Range(min=1, max=50)),
    }
)
@websocket_api.async_response
async def ws_recent_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_recent_add(hass, msg["content"], msg["packs"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "recent_add_failed", str(err))
        return
    connection.send_result(msg["id"], result)


def async_setup_product_history_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("product_history_ws"):
        return
    domain_data["product_history_ws"] = True
    for command in (ws_product_history, ws_recent_products, ws_recent_add):
        websocket_api.async_register_command(hass, command)
