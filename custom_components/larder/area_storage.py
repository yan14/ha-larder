"""Storage kind of each area (6.7, #196).

Larder recognises fridge, 0 °C compartment, freezer and pantry from the area's temperature sensor, its labels
and its name. The dashboard shows "recognised as: …" per area; when nothing is recognised (or the guess is
wrong) you choose the kind yourself. The choice is kept in Larder's own store and counts like a label
"Storage: …" (only a temperature sensor of the area comes first).
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, label_registry as lr

from . import shelf_life
from .const import DATA_STOCK, DOMAIN

KINDS = (shelf_life.FRIDGE, shelf_life.ZERO, shelf_life.FREEZER, shelf_life.PANTRY)
# the chosen kind as a storage hint the table understands
_HINTS = {
    shelf_life.FREEZER: "freezer",
    shelf_life.ZERO: "0 °C",
    shelf_life.FRIDGE: "fridge",
    shelf_life.PANTRY: "pantry",
}


def own_kind(hass: HomeAssistant, area_id: str | None) -> str | None:
    """The kind chosen in the dashboard for this area (None = recognise automatically)."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    if not area_id or stock is None:
        return None
    kind = stock.area_storage.get(area_id)
    return kind if kind in KINDS else None


def own_hint(hass: HomeAssistant, area_id: str | None) -> str | None:
    kind = own_kind(hass, area_id)
    return _HINTS[kind] if kind else None


def _label_parts(hass: HomeAssistant, area: ar.AreaEntry) -> tuple[list[str], str | None]:
    labels = lr.async_get(hass)
    texts: list[str] = []
    hint = None
    for label_id in sorted(area.labels):
        if label := labels.async_get_label(label_id):
            texts.append(f"{label.name}: {label.description}" if label.description else label.name)
            hint = hint or shelf_life.parse_label_template(label.description).get("storage")
    return texts, hint


def recognised_kind(hass: HomeAssistant, area: ar.AreaEntry) -> str | None:
    """What Larder recognises without your choice: labels and name (the sensor only changes the factor)."""
    texts, hint = _label_parts(hass, area)
    storage = shelf_life.classify_storage(area.name, None, texts, hint)
    return storage.key if storage else None


def area_kind(hass: HomeAssistant, area: ar.AreaEntry) -> str | None:
    """The kind used for this area: your choice, else what is recognised."""
    return own_kind(hass, area.id) or recognised_kind(hass, area)


def area_overview(hass: HomeAssistant) -> list[dict[str, Any]]:
    out = []
    for area in ar.async_get(hass).async_list_areas():
        out.append(
            {
                "area_id": area.id,
                "name": area.name,
                "recognised": recognised_kind(hass, area),
                "own": own_kind(hass, area.id),
                "sensor": bool(area.temperature_entity_id),
            }
        )
    return sorted(out, key=lambda a: a["name"].casefold())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/area_storage"})
@websocket_api.async_response
async def ws_area_storage(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .stock import async_get_stock  # noqa: PLC0415

    await async_get_stock(hass)
    connection.send_result(msg["id"], {"areas": area_overview(hass)})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/area_storage_set",
        vol.Required("area_id"): str,
        vol.Optional("kind"): vol.Any(None, vol.In(KINDS)),
    }
)
@websocket_api.async_response
async def ws_area_storage_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .stock import async_get_stock  # noqa: PLC0415

    if ar.async_get(hass).async_get_area(msg["area_id"]) is None:
        connection.send_error(msg["id"], "not_found", "Unknown area")
        return
    stock = await async_get_stock(hass)
    stock.set_area_storage(msg["area_id"], msg.get("kind"))
    connection.send_result(msg["id"], {"areas": area_overview(hass)})


def async_setup_area_storage_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("area_storage_ws"):
        return
    domain_data["area_storage_ws"] = True
    websocket_api.async_register_command(hass, ws_area_storage)
    websocket_api.async_register_command(hass, ws_area_storage_set)
