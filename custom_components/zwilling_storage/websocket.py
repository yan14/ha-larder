"""WebSocket-Befehle für die Liste der gemerkten Schätzungen im Dashboard (nur Administratoren)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN
from .estimate import MAX_DAYS, MIN_DAYS, async_get_estimator

DATA_WS_REGISTERED = "websocket_registered"

_DAYS = vol.All(vol.Coerce(int), vol.Range(min=MIN_DAYS, max=MAX_DAYS))


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Befehle einmalig registrieren (idempotent)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS_REGISTERED):
        return
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_set)
    websocket_api.async_register_command(hass, ws_add)
    websocket_api.async_register_command(hass, ws_delete)
    domain_data[DATA_WS_REGISTERED] = True


def _error(connection: websocket_api.ActiveConnection, msg_id: int, err: HomeAssistantError) -> None:
    connection.send_error(msg_id, "estimate_error", str(err))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/estimates"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    estimator = await async_get_estimator(hass)
    connection.send_result(
        msg["id"], {"mode": estimator.mode, "entries": estimator.list_entries()}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/estimate_set",
        vol.Required("key"): str,
        vol.Required("days"): _DAYS,
        vol.Optional("tip"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    estimator = await async_get_estimator(hass)
    try:
        await estimator.async_set_entry(msg["key"], msg["days"], msg.get("tip"))
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"entries": estimator.list_entries()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/estimate_add",
        vol.Required("content"): str,
        vol.Required("area"): str,
        vol.Optional("vacuum", default=True): bool,
        vol.Required("days"): _DAYS,
        vol.Optional("tip", default=""): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_add(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    estimator = await async_get_estimator(hass)
    try:
        await estimator.async_add_entry(
            msg["content"], msg["area"], msg["vacuum"], msg["days"], msg["tip"]
        )
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"entries": estimator.list_entries()})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/estimate_delete", vol.Required("key"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    estimator = await async_get_estimator(hass)
    try:
        await estimator.async_delete_entry(msg["key"])
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"entries": estimator.list_entries()})
