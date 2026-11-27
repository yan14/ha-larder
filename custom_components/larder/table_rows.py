"""The row of the shelf-life table per product (6.3, Block 48).

* **From Open Food Facts** (#173): a scanned product keeps the row its categories and labels point to (`table` in
  the product data) – *Rügenwalder Mühle Vegane Mühlen Salami* is plant-based because Open Food Facts says so.
* **Chosen by you** (#174): data care lists the products the table does not recognise; one tap picks the row. It
  belongs to exactly this product and comes before Open Food Facts and the name.

Order everywhere: your choice → Open Food Facts → the name (keywords).
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from . import shelf_life
from .const import CONF_CC, DOMAIN, KIND_BAG, KIND_CONTAINER, KIND_PACK
from .devices import device_of
from .entity import kind_of
from .stock import Stock, async_get_stock, product_key

FOOD_KINDS = (KIND_CONTAINER, KIND_BAG, KIND_PACK)


def _content_entities(hass: HomeAssistant) -> list[tuple[Any, str, Any]]:
    """(config entry, cc, state of "Content") of every filled food entry."""
    registry = er.async_get(hass)
    out = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc or kind_of(entry) not in FOOD_KINDS:
            continue
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        state = hass.states.get(content_id) if content_id else None
        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE) or not state.state.strip():
            continue
        out.append((entry, cc, state))
    return out


def unknown_products(hass: HomeAssistant, stock: Stock) -> list[dict[str, Any]]:
    """Food the table does not recognise (no own row, nothing from Open Food Facts, no keyword) – once per product."""
    seen: set[str] = set()
    rows = []
    for entry, cc, state in _content_entities(hass):
        content = state.state.strip()
        key = product_key(content)
        if key in seen:
            continue
        seen.add(key)
        row, _ = stock.table_row(content, dict(state.attributes))
        if row or shelf_life.category_for(content) is not None:
            continue
        device = device_of(hass, cc)
        rows.append({"device_id": device.id if device else None, "content": content, "kind": kind_of(entry), "place": ""})
    return rows


def table_choices(language: str | None) -> list[dict[str, str]]:
    """Every row with its name in the language, sorted by name."""
    lang = shelf_life._lang(language or "en")  # noqa: SLF001 - same language rules as the table
    rows = [{"id": e.id, "name": shelf_life.food_name(e, lang), "cat": e.cat} for e in shelf_life.ENTRIES]
    return sorted(rows, key=lambda r: r["name"].casefold())


def _refresh(hass: HomeAssistant, content: str) -> None:
    """The category of the product's entries follows the new row."""
    key = product_key(content)
    for entry, _cc, state in _content_entities(hass):
        if product_key(state.state) == key and (entity := entry.runtime_data.resettable.get("content")) is not None:
            entity.async_write_ha_state()


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/table_rows", vol.Optional("content"): str, vol.Optional("language"): str}
)
@websocket_api.async_response
async def ws_table_rows(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    result: dict[str, Any] = {"rows": table_choices(msg.get("language") or hass.config.language)}
    if content := (msg.get("content") or "").strip():
        product = next((dict(s.attributes) for _e, _c, s in _content_entities(hass) if product_key(s.state) == product_key(content)), None)
        row, source = stock.table_row(content, product)
        found = shelf_life.find_entry(content, msg.get("language"))
        result.update({"current": row or (found.id if found else None), "source": source or ("name" if found else None)})
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/table_row_set",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=120)),
        vol.Optional("entry"): vol.Any(None, str),
    }
)
@websocket_api.async_response
async def ws_table_row_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry_id = msg.get("entry") or None
    if entry_id and shelf_life.entry_by_id(entry_id) is None:
        connection.send_error(msg["id"], "unknown_row", entry_id)
        return
    stock = await async_get_stock(hass)
    stock.set_table_row(msg["content"], entry_id)
    _refresh(hass, msg["content"])
    connection.send_result(msg["id"], {"entry": entry_id})


def async_setup_table_rows_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("table_rows_ws"):
        return
    domain_data["table_rows_ws"] = True
    websocket_api.async_register_command(hass, ws_table_rows)
    websocket_api.async_register_command(hass, ws_table_row_set)
