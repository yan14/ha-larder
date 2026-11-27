"""Finishing the shopping (6.1, Block 46).

* **Recently put away** (#167): everything put away, bought in the shopping mode, read from a receipt or added
  with ＋ in the last days, one row per pack entry – price, best-before date and place can be filled in for
  all of them at once instead of opening every product.
* **Best-before suggestion** (#168): from earlier purchases of exactly this product (how many days it still
  kept when it was put away), else – only for fresh food – from the shelf-life table. Products are never
  merged; only the same product's history counts.
* **Price later** (#170): the price of a product, set from the product view, goes onto all its packs.
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

from . import shelf_life
from .const import DOMAIN, KIND_HOUSEHOLD, KIND_PACK
from .devices import entry_of
from .estimate import storage_context
from .stock import Stock, async_get_stock, async_move_packs, pack_entries, product_key

RECENT_DAYS = 7
# the table only suggests a date for fresh food; for cans, pasta & co. the printed date is far longer
TABLE_CATEGORIES = ("produce", "dairy", "bread", "raw_meat", "fish", "deli")


def suggest_best_before(
    hass: HomeAssistant, stock: Stock, content: str, kind: str, device_id: str | None, start: date | None = None
) -> dict[str, Any] | None:
    """{"best_before", "days", "source": "history" | "table"} or None."""
    if kind == KIND_HOUSEHOLD or not content:
        return None
    start = start or (stock.put_away_day(device_id) if device_id else None) or dt_util.now().date()
    days = stock.typical_buy_days(content)
    if days:
        return {"best_before": (start + timedelta(days=days)).isoformat(), "days": days, "source": "history"}
    if kind != KIND_PACK:
        return None
    pack = next((p for p in pack_entries(hass) if p["device_id"] == device_id), None)
    if pack is None:
        return None
    cc = pack["cc"]
    # 6.3: the row chosen for the product (by you or from Open Food Facts) before the name
    row, _ = stock.table_row(content, {"table": pack.get("table")})
    entry = shelf_life.entry_by_id(row) or shelf_life.find_entry(content)
    if entry is None or not (entry.perishable or entry.cat in TABLE_CATEGORIES):
        return None
    context = storage_context(hass, cc)
    try:
        result = shelf_life.lookup(
            content,
            area_name=context.area_name,
            temperature_c=context.temperature_c,
            label_texts=context.label_texts,
            vacuum=False,
            language=hass.config.language or "en",
            storage_hint=context.storage_hint,
            entry_id=entry.id,
        )
    except (shelf_life.TableNoMatch, shelf_life.TableUnknownStorage, shelf_life.TableUnsuitable):
        return None
    return {"best_before": (start + timedelta(days=result.days)).isoformat(), "days": result.days, "source": "table"}


def recent_put_away(hass: HomeAssistant, stock: Stock, days: int = RECENT_DAYS) -> list[dict[str, Any]]:
    """One row per pack entry put away in the last `days` days, newest first; entries already gone are left out."""
    packs = {p["device_id"]: p for p in pack_entries(hass) if p["device_id"]}
    since = (dt_util.now().date() - timedelta(days=max(0, days))).isoformat()
    rows: dict[str, dict[str, Any]] = {}
    for record in reversed(stock.put_away_log):
        if str(record.get("day")) < since:
            continue
        pack = packs.get(record["device_id"])
        if pack is None:
            continue
        if (row := rows.get(pack["device_id"])) is not None:
            row["added"] = min(row["added"] + int(record.get("added") or 1), pack["count"])
            continue
        row = {
            "device_id": pack["device_id"],
            "content": pack["content"],
            "kind": pack["kind"],
            "day": record.get("day"),
            "added": min(int(record.get("added") or 1), pack["count"]),
            "count": pack["count"],
            "area_id": pack["area_id"],
            "area": pack["area"],
            "compartment": pack["compartment"],
            "best_before": pack["best_before"] if pack["best_before"] not in (None, "", "unknown", "unavailable") else None,
            "price": pack["price"],
            "store": pack.get("store"),
            "opened": bool(pack["opened"]),
        }
        if row["best_before"] is None and pack["kind"] != KIND_HOUSEHOLD:
            try:
                start = date.fromisoformat(str(record.get("day")))
            except ValueError:
                start = None
            if suggestion := suggest_best_before(hass, stock, pack["content"], pack["kind"], pack["device_id"], start):
                row["suggest"] = suggestion
        rows[pack["device_id"]] = row
    return list(rows.values())


async def async_put_away_save(hass: HomeAssistant, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Price, best-before date and place of several rows of the list at once."""
    from .shopping_mode import async_shopping_details  # noqa: PLC0415 - avoids an import cycle

    saved = 0
    for row in rows:
        packs = {p["device_id"]: p for p in pack_entries(hass) if p["device_id"]}
        pack = packs.get(row["device_id"])
        if pack is None:
            continue
        added = max(1, min(int(row.get("added") or 1), pack["count"]))
        price = row.get("price")
        best = row.get("best_before")
        if isinstance(best, str):
            best = date.fromisoformat(best) if best else None
        device_id = pack["device_id"]
        if price or best:
            result = await async_shopping_details(hass, device_id, added, price, best, row.get("store"))
            device_id = result["device_id"]
        if "area_id" in row or "compartment" in row:
            area_id = row.get("area_id", pack["area_id"]) or None
            compartment = " ".join(str(row.get("compartment", pack["compartment"]) or "").split())[:60]
            if area_id and ar.async_get(hass).async_get_area(area_id) is None:
                raise HomeAssistantError("unknown area")
            if (area_id, compartment) != ((pack["area_id"] or None), pack["compartment"]):
                moved = next((p for p in pack_entries(hass) if p["device_id"] == device_id), None)
                if moved is not None:
                    # a date of its own split the new packs off: they move as a whole; else only what was put away
                    count = moved["count"] if device_id != pack["device_id"] else min(added, moved["count"])
                    await async_move_packs(hass, moved["cc"], count, area_id, compartment)
        saved += 1
    return {"saved": saved}


async def async_set_product_price(hass: HomeAssistant, content: str, price: float | None, store: str | None) -> int:
    """#170: price of one pack of a product, on all its packs (own price); without packs it is remembered."""
    key = product_key(content)
    if not key:
        raise HomeAssistantError("no product")
    store = " ".join(str(store or "").split())[:60] or None
    changed = 0
    for pack in pack_entries(hass):
        if product_key(pack["content"]) != key:
            continue
        entry = entry_of(hass, pack["cc"])
        if entry is None:
            continue
        data = {"price": round(price, 2), "price_source": "own", "store": store} if price else {"price": None, "price_source": None}
        await entry.runtime_data.resettable["content"].async_set_product(data, replace=False)
        changed += 1
    stock = await async_get_stock(hass)
    if price and not changed:
        stock.remember_price(content, price, "own", store)
    if not price:
        stock.prices.pop(key, None)
        stock.save_now()
    return changed


# ---------- WebSocket ----------


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/put_away_recent", vol.Optional("days", default=RECENT_DAYS): vol.All(int, vol.Range(min=0, max=30))}
)
@websocket_api.async_response
async def ws_put_away_recent(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {"rows": recent_put_away(hass, stock, msg["days"])})


_ROW = vol.Schema(
    {
        vol.Required("device_id"): str,
        vol.Optional("added"): vol.All(int, vol.Range(min=1, max=999)),
        vol.Optional("price"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=10000))),
        vol.Optional("best_before"): vol.Any(None, "", vol.Date()),
        vol.Optional("store"): vol.Any(None, str),
        vol.Optional("area_id"): vol.Any(None, str),
        vol.Optional("compartment"): vol.Any(None, str),
    }
)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/put_away_save", vol.Required("rows"): vol.All([_ROW], vol.Length(max=200))}
)
@websocket_api.async_response
async def ws_put_away_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_put_away_save(hass, msg["rows"])
    except (HomeAssistantError, ValueError) as err:
        connection.send_error(msg["id"], "save_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/price_set",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=120)),
        vol.Optional("price"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=10000))),
        vol.Optional("store"): vol.Any(None, str),
    }
)
@websocket_api.async_response
async def ws_price_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        changed = await async_set_product_price(hass, msg["content"], msg.get("price") or None, msg.get("store"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "price_failed", str(err))
        return
    connection.send_result(msg["id"], {"packs": changed})


def async_setup_put_away_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("put_away_ws"):
        return
    domain_data["put_away_ws"] = True
    for command in (ws_put_away_recent, ws_put_away_save, ws_price_set):
        websocket_api.async_register_command(hass, command)
