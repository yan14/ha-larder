"""WebSocket commands for the list of remembered estimates in the dashboard (administrators only)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import CONF_CC, CONF_VACUUM_DEFAULT, DOMAIN, EVENT_DOSE_SCANNED, KIND_BAG, SIGNAL_SETTINGS_CHANGED
from .devices import device_of
from .disposable import DATA_RETIRED, retired_text
from .entity import kind_of
from .estimate import MAX_DAYS, MIN_DAYS, async_get_estimator
from .nfc import async_get_nfc
from .qr import parse_qr
from .sections import section_order
from .shopping import any_list
from .stock import async_get_stock

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
    websocket_api.async_register_command(hass, ws_contents)
    websocket_api.async_register_command(hass, ws_settings)
    websocket_api.async_register_command(hass, ws_vacuum_answer)
    websocket_api.async_register_command(hass, ws_resolve_code)
    websocket_api.async_register_command(hass, ws_scan_session)
    websocket_api.async_register_command(hass, ws_report_scan)
    websocket_api.async_register_command(hass, ws_nfc_tags)
    websocket_api.async_register_command(hass, ws_nfc_link)
    websocket_api.async_register_command(hass, ws_tag_ignore)
    websocket_api.async_register_command(hass, ws_nfc_unlink)
    websocket_api.async_register_command(hass, ws_tag_scans)
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


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/nfc_tags"})
@websocket_api.async_response
async def ws_nfc_tags(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    nfc = await async_get_nfc(hass)
    connection.send_result(msg["id"], {"links": nfc.links(), "by_device": nfc.links_by_device()})


@websocket_api.websocket_command(
    vol.All(
        vol.Schema(
            {
                vol.Required("type"): f"{DOMAIN}/nfc_link",
                vol.Required("tag_id"): str,
                vol.Exclusive("cc", "dose"): str,
                vol.Exclusive("entry_id", "dose"): str,
                vol.Exclusive("device_id", "dose"): str,
            }
        ),
        cv.has_at_least_one_key("cc", "entry_id", "device_id"),
    )
)
@websocket_api.async_response
async def ws_nfc_link(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    nfc = await async_get_nfc(hass)
    try:
        cc = nfc.resolve_cc(msg.get("cc"), msg.get("entry_id"), msg.get("device_id"))
        # anyone in the household labels bags, containers only administrators
        entry = nfc._entry(cc)  # noqa: SLF001
        if not connection.user.is_admin and (entry is None or kind_of(entry) != KIND_BAG):
            raise Unauthorized
        await nfc.async_link(msg["tag_id"], cc)
    except Unauthorized:
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Unauthorized")
        return
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"links": nfc.links(), "by_device": nfc.links_by_device()})


@websocket_api.websocket_command(
    vol.All(
        vol.Schema(
            {
                vol.Required("type"): f"{DOMAIN}/nfc_unlink",
                vol.Exclusive("cc", "dose"): str,
                vol.Exclusive("device_id", "dose"): str,
            }
        ),
        cv.has_at_least_one_key("cc", "device_id"),
    )
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_nfc_unlink(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    nfc = await async_get_nfc(hass)
    try:
        cc = nfc.resolve_cc(msg.get("cc"), None, msg.get("device_id"))
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    await nfc.async_unlink(cc)
    connection.send_result(msg["id"], {"links": nfc.links(), "by_device": nfc.links_by_device()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/contents"})
@websocket_api.async_response
async def ws_contents(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Suggestions for the content field (for all users, contains only content texts)."""
    connection.send_result(msg["id"], {"contents": (await async_get_estimator(hass)).content_suggestions()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/settings"})
@websocket_api.async_response
async def ws_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Settings the dashboards need (for all users, nothing confidential)."""
    estimator = await async_get_estimator(hass)
    connection.send_result(
        msg["id"],
        {
            "recipe_days": estimator.recipe_days,
            "soon_days": estimator.soon_days,
            "vacuum_default": estimator.vacuum_default,
            "shopping_list": any_list(hass),
            "supply_check": bool(estimator.supply_check),
            "section_order": section_order(hass),
            # 6.8 (#217): ask once whether there is a vacuum sealer, instead of ticking vacuum for everyone
            "vacuum_asked": (await async_get_stock(hass)).vacuum_asked,
            # 6.9 (#238): names of the own store sections
            "own_sections": dict((await async_get_stock(hass)).own_sections),
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/vacuum_answer", vol.Required("has_sealer"): bool})
@websocket_api.async_response
async def ws_vacuum_answer(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """6.8 (#217): the answer sets the preset for new containers; without a sealer, empty containers lose the tick."""
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({CONF_VACUUM_DEFAULT: msg["has_sealer"]})
    stock = await async_get_stock(hass)
    stock.vacuum_asked = True
    stock.save_now()
    changed = 0
    if not msg["has_sealer"]:
        registry = er.async_get(hass)
        for entry in hass.config_entries.async_entries(DOMAIN):
            cc = entry.data.get(CONF_CC)
            if not cc:
                continue
            switch = registry.async_get_entity_id("switch", DOMAIN, f"{cc}_vacuum")
            content = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
            state = hass.states.get(switch) if switch else None
            filled = hass.states.get(content) if content else None
            # only empty containers: what is stored keeps what it was stored with
            if state is not None and state.state == "on" and (filled is None or not (filled.state or "").strip() or filled.state in ("unknown", "unavailable")):
                await hass.services.async_call("switch", "turn_off", {"entity_id": switch}, blocking=True)
                changed += 1
    async_dispatcher_send(hass, SIGNAL_SETTINGS_CHANGED)
    connection.send_result(msg["id"], {"vacuum_default": msg["has_sealer"], "changed": changed})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/resolve_code", vol.Required("code"): str})
@callback
def ws_resolve_code(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Assign scanned QR content to a container (series scan in the dashboard)."""
    parsed = parse_qr(msg["code"])
    if parsed is None:
        connection.send_result(msg["id"], {"valid": False})
        return
    device = device_of(hass, parsed.cc)
    # code of a bag that was already emptied: a note instead of "add unknown container"
    retired = hass.data.get(DOMAIN, {}).get(DATA_RETIRED)
    info = retired.by_code(parsed.cc) if retired is not None and device is None else None
    connection.send_result(
        msg["id"],
        {
            "valid": True,
            "cc": parsed.cc,
            "device_id": device.id if device else None,
            "name": (device.name_by_user or device.name) if device else None,
            "retired": retired_text(info, hass.config.language or "en") if info else None,
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tag_ignore", vol.Required("tag_id"): vol.All(str, vol.Length(min=1, max=200))})
@websocket_api.async_response
async def ws_tag_ignore(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """An unknown tag belongs to something else: never ask about it again (5.3)."""
    nfc = await async_get_nfc(hass)
    await nfc.async_ignore(msg["tag_id"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tag_scans"})
@websocket_api.async_response
async def ws_tag_scans(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Report scanned NFC tags (for users without administrator rights who label bags).

    Otherwise only administrators may subscribe to events; only the tag ID is passed on here.
    """

    @callback
    def forward(event: Event) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"tag_id": event.data.get("tag_id")}))

    connection.subscriptions[msg["id"]] = hass.bus.async_listen("tag_scanned", forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/scan_session"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_scan_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Series scan: report every scan of a linked NFC tag as long as the subscription runs.

    While a series scan is running, the phone gets no notification after an NFC scan
    (it would lead out of the dashboard).
    """
    nfc = await async_get_nfc(hass)

    @callback
    def forward(data: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], data))

    connection.subscriptions[msg["id"]] = nfc.add_session(forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/report_scan", vol.Required("cc"): str})
@websocket_api.async_response
async def ws_report_scan(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """An own QR code was scanned (the dashboard reports it): fire `larder_dose_scanned` as with NFC."""
    nfc = await async_get_nfc(hass)
    try:
        cc = nfc.resolve_cc(cc=msg["cc"])
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    device = device_of(hass, cc)
    entry = nfc._entry(cc)  # noqa: SLF001
    data = {
        "cc": cc,
        "device_id": device.id if device else None,
        "name": entry.title if entry else cc,
        "scanned_by": None,
        "source": "qr",
        "user_id": connection.user.id if connection.user else None,
    }
    hass.bus.async_fire(EVENT_DOSE_SCANNED, data)
    connection.send_result(msg["id"], {"device_id": data["device_id"]})
