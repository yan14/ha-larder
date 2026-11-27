"""Freeze instead of throwing away (6.5, #179).

Something in the fridge that expires within FREEZE_DAYS days and that keeps in the freezer (the table has a freezer
value for its row) is *freezable*. The daily summary then offers **🧊 Freeze** as a button; the dashboard does too.
Freezing moves it to the freezer area (the one freezer area, else the one with most in it) and gives it the date of
the table for the freezer, counted from today. The row chosen for the product (by you or from Open Food Facts) counts.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.util import dt as dt_util

from . import shelf_life
from .area_storage import area_kind
from .const import DATA_STOCK, DOMAIN, PACK_KINDS, larder_id
from .devices import device_of, entry_of
from .entity import kind_of
from .estimate import storage_context

FREEZE_DAYS = 2


def _storage_of_area(hass: HomeAssistant, area: ar.AreaEntry) -> str | None:
    return area_kind(hass, area)


def freezer_area(hass: HomeAssistant) -> str | None:
    """The freezer area: the only one, else the one with most entries."""
    found = [a.id for a in ar.async_get(hass).async_list_areas() if _storage_of_area(hass, a) == shelf_life.FREEZER]
    if len(found) <= 1:
        return found[0] if found else None
    counts = dict.fromkeys(found, 0)
    for device in dr.async_get(hass).devices.values():
        if device.area_id in counts and any(i[0] == DOMAIN for i in device.identifiers):
            counts[device.area_id] += 1
    return max(found, key=lambda a: counts[a])


def _row(hass: HomeAssistant, cc: str, content: str) -> shelf_life.Entry | None:
    registry = er.async_get(hass)
    content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
    state = hass.states.get(content_id) if content_id else None
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    row = stock.table_row(content, dict(state.attributes) if state else None)[0] if stock is not None else None
    return shelf_life.entry_by_id(row) or shelf_life.find_entry(content)


def freezable(hass: HomeAssistant, item: dict[str, Any]) -> bool:
    """In the fridge (or 0 °C), expiring within FREEZE_DAYS days, and the table has a freezer value."""
    left = item.get("days_left")
    content = (item.get("content") or "").strip()
    if not content or left is None or not 0 <= left <= FREEZE_DAYS or item.get("frozen") or not item.get("cc"):
        return False
    context = storage_context(hass, item["cc"])
    storage = shelf_life.classify_storage(context.area_name, None, context.label_texts, context.storage_hint)
    if storage is None or storage.key not in (shelf_life.FRIDGE, shelf_life.ZERO):
        return False
    entry = _row(hass, item["cc"], content)
    return entry is not None and entry.days.get(shelf_life.FREEZER) is not None and freezer_area(hass) is not None


async def async_freeze(hass: HomeAssistant, cc: str) -> dict[str, Any]:
    """Move the entry to the freezer and give it the freezer date of the table (from today)."""
    from .stock import async_move_packs, pack_entries  # noqa: PLC0415 - avoids an import cycle

    entry = entry_of(hass, cc)
    area_id = freezer_area(hass)
    if entry is None or area_id is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    registry = er.async_get(hass)
    content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
    state = hass.states.get(content_id) if content_id else None
    content = (state.state if state and state.state not in ("unknown", "unavailable") else "").strip()
    if not content:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    area = ar.async_get(hass).async_get_area(area_id)
    entry_row = _row(hass, cc, content)
    target_cc = cc
    if kind_of(entry) in PACK_KINDS:
        pack = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
        if pack is None:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        moved = await async_move_packs(hass, cc, pack["count"], area_id, "")
        device = dr.async_get(hass).async_get(moved["device_id"]) if moved.get("device_id") else None
        target_cc = (larder_id(device) if device else None) or cc
    else:
        device = device_of(hass, cc)
        if device is None:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        dr.async_get(hass).async_update_device(device.id, area_id=area_id)
    best = None
    try:
        result = shelf_life.lookup(
            content,
            area_name=area.name if area else None,
            temperature_c=None,
            label_texts=(),
            vacuum=False,
            language=hass.config.language or "en",
            storage_hint=shelf_life.FREEZER,
            entry_id=entry_row.id if entry_row else None,
        )
        best = dt_util.now().date() + timedelta(days=result.days)
    except (shelf_life.TableNoMatch, shelf_life.TableUnknownStorage, shelf_life.TableUnsuitable):
        best = None
    if best is not None:
        date_id = registry.async_get_entity_id("date", DOMAIN, f"{target_cc}_best_before")
        if date_id:
            await hass.services.async_call("date", "set_value", {"entity_id": date_id, "date": best.isoformat()}, blocking=True)
    return {"what": "FREEZE", "content": content, "area": area.name if area else None, "best_before": best.isoformat() if best else None}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/freeze", vol.Required("device_id"): str})
@websocket_api.async_response
async def ws_freeze(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    device = dr.async_get(hass).async_get(msg["device_id"])
    cc = larder_id(device) if device else None
    try:
        result = await async_freeze(hass, cc or "")
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "freeze_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/freezable"})
@websocket_api.async_response
async def ws_freezable(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """6.8 (#210): which entries can go into the freezer now – for 🧊 on the start page tiles."""
    from .expiry import collect_expiring  # noqa: PLC0415 - avoids an import cycle

    ids = []
    for item in collect_expiring(hass, days=FREEZE_DAYS, include_expired=False, vouchers=False):
        if freezable(hass, item) and (device := device_of(hass, item["cc"])) is not None:
            ids.append(device.id)
    connection.send_result(msg["id"], {"device_ids": ids})


def async_setup_freezing_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("freezing_ws"):
        return
    domain_data["freezing_ws"] = True
    websocket_api.async_register_command(hass, ws_freeze)
    websocket_api.async_register_command(hass, ws_freezable)
