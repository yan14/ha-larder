"""WebSocket-Befehle für die Liste der gemerkten Schätzungen im Dashboard (nur Administratoren)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers import config_validation as cv, device_registry as dr

from .const import DOMAIN, EVENT_DOSE_SCANNED, KIND_BAG
from .disposable import DATA_RETIRED, retired_text
from .entity import kind_of
from .estimate import MAX_DAYS, MIN_DAYS, async_get_estimator
from .nfc import async_get_nfc
from .qr import parse_qr

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
    websocket_api.async_register_command(hass, ws_resolve_code)
    websocket_api.async_register_command(hass, ws_scan_session)
    websocket_api.async_register_command(hass, ws_report_scan)
    websocket_api.async_register_command(hass, ws_nfc_tags)
    websocket_api.async_register_command(hass, ws_nfc_link)
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
        # Beutel kennzeichnet jeder im Haushalt, Dosen nur Administratoren
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
    """Vorschläge für das Feld Inhalt (für alle Nutzer, enthält nur Inhaltstexte)."""
    connection.send_result(msg["id"], {"contents": (await async_get_estimator(hass)).content_suggestions()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/settings"})
@websocket_api.async_response
async def ws_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Einstellungen, die die Dashboards brauchen (für alle Nutzer, nichts Vertrauliches)."""
    estimator = await async_get_estimator(hass)
    connection.send_result(
        msg["id"],
        {
            "recipe_days": estimator.recipe_days,
            "soon_days": estimator.soon_days,
            "vacuum_default": estimator.vacuum_default,
            "shopping_list": bool(estimator.todo_entity),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/resolve_code", vol.Required("code"): str})
@callback
def ws_resolve_code(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Gescannten QR-Inhalt einer Dose zuordnen (Serien-Scan im Dashboard)."""
    parsed = parse_qr(msg["code"])
    if parsed is None:
        connection.send_result(msg["id"], {"valid": False})
        return
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, parsed.cc)})
    # Code eines schon geleerten Beutels: Hinweis statt "unbekannte Dose hinzufügen"
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


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/tag_scans"})
@websocket_api.async_response
async def ws_tag_scans(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Gescannte NFC-Tags melden (für Nutzer ohne Administratorrechte, die Beutel kennzeichnen).

    Ereignisse abonnieren dürfen sonst nur Administratoren; hier geht nur die Tag-ID weiter.
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
    """Serien-Scan: jeden Scan eines verknüpften NFC-Tags melden, solange das Abo läuft.

    Während ein Serien-Scan läuft, bekommt das Handy nach einem NFC-Scan keine Benachrichtigung
    (sie würde aus dem Dashboard herausführen).
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
    """Eigener QR-Code wurde gescannt (das Dashboard meldet es): wie bei NFC `larder_dose_scanned` auslösen."""
    nfc = await async_get_nfc(hass)
    try:
        cc = nfc.resolve_cc(cc=msg["cc"])
    except HomeAssistantError as err:
        _error(connection, msg["id"], err)
        return
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
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
