"""Verlauf pro Dose: was war drin, von wann bis wann, und wurde es gegessen oder weggeworfen.

Ein Eintrag entsteht beim Leeren (Button "Behälter leeren", egal ob aus dem Dashboard, einer
Automation oder der Geräteseite). Das Dashboard fragt vorher "Gegessen / Weggeworfen" und meldet
die Antwort über `larder/empty`; ohne Antwort bleibt `outcome` leer.
"""

from __future__ import annotations

from datetime import date
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .singleton import async_singleton

DATA_HISTORY = "history"
DATA_WS = "history_ws_registered"
STORAGE_KEY = f"{DOMAIN}.history"
STORAGE_VERSION = 1
MAX_RECORDS = 5000
OUTCOMES = ("eaten", "thrown")


class History:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.records: list[dict[str, Any]] = []
        self._pending: dict[str, str | None] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.records = [r for r in data.get("records", []) if isinstance(r, dict)]

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"records": self.records}, 1)

    def set_pending(self, cc: str, outcome: str | None) -> None:
        """Antwort aus dem Dashboard für das gleich folgende Leeren merken."""
        self._pending[cc] = outcome

    def pop_pending(self, cc: str) -> str | None:
        return self._pending.pop(cc, None)

    def add(self, record: dict[str, Any]) -> dict[str, Any]:
        record = {"id": uuid.uuid4().hex[:12], **record}
        self.records.append(record)
        if len(self.records) > MAX_RECORDS:
            self.records = self.records[-MAX_RECORDS:]
        self._save()
        return record

    def set_outcome(self, record_id: str, outcome: str | None) -> bool:
        for record in self.records:
            if record["id"] == record_id:
                record["outcome"] = outcome
                self._save()
                return True
        return False

    def list(self, cc: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        """Neueste zuerst; optional nur eine Dose."""
        items = [r for r in reversed(self.records) if cc is None or r.get("cc") == cc]
        return items[:limit] if limit else items


def build_record(
    *,
    cc: str,
    name: str,
    content: str,
    quantity: int | None,
    unit: str | None,
    area: str | None,
    filled_at: str | None,
    best_before: str | None,
    outcome: str | None,
    compartment: str | None = None,
    product: dict[str, Any] | None = None,
    kind: str | None = None,
    vacuum: bool | None = None,
) -> dict[str, Any]:
    now = dt_util.now()
    filled_day: date | None = None
    if filled_at and (parsed := dt_util.parse_datetime(filled_at)):
        filled_day = dt_util.as_local(parsed).date()
    expired = False
    if best_before:
        try:
            expired = date.fromisoformat(best_before) < now.date()
        except ValueError:
            best_before = None
    return {
        "cc": cc,
        "name": name,
        "content": content,
        "quantity": quantity or None,
        "unit": unit if quantity else None,
        "area": area,
        "compartment": compartment or None,
        "filled_at": filled_at,
        "best_before": best_before,
        "emptied": now.isoformat(timespec="seconds"),
        "days_stored": (now.date() - filled_day).days if filled_day else None,
        "expired": expired,
        "outcome": outcome if outcome in OUTCOMES else None,
        **({"product": product} if product else {}),
        **({"kind": kind} if kind and kind != "container" else {}),
        **({"vacuum": vacuum} if vacuum is not None else {}),
    }


async def async_get_history(hass: HomeAssistant) -> History:
    async def create() -> History:
        history = History(hass)
        await history.async_load()
        return history

    return await async_singleton(hass, DATA_HISTORY, create)


def _cc_of_device(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return None
    return next((ident for domain, ident in device.identifiers if domain == DOMAIN), None)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/empty",
        vol.Required("device_id"): str,
        vol.Optional("outcome"): vol.Any(None, vol.In(OUTCOMES)),
    }
)
@websocket_api.async_response
async def ws_empty(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Dose leeren und dabei festhalten, ob der Inhalt gegessen oder weggeworfen wurde."""
    cc = _cc_of_device(hass, msg["device_id"])
    button = er.async_get(hass).async_get_entity_id("button", DOMAIN, f"{cc}_empty_container") if cc else None
    if not button:
        connection.send_error(msg["id"], "not_found", "container not found")
        return
    history = await async_get_history(hass)
    history.set_pending(cc, msg.get("outcome"))
    try:
        await hass.services.async_call(
            "button", "press", {"entity_id": button}, blocking=True, context=connection.context(msg)
        )
    except HomeAssistantError as err:
        history.pop_pending(cc)
        connection.send_error(msg["id"], "empty_failed", str(err))
        return
    history.pop_pending(cc)  # falls nichts geleert wurde
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/history",
        vol.Optional("device_id"): str,
        vol.Optional("limit", default=50): vol.All(int, vol.Range(min=1, max=MAX_RECORDS)),
    }
)
@websocket_api.async_response
async def ws_history(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    history = await async_get_history(hass)
    cc = _cc_of_device(hass, msg["device_id"]) if msg.get("device_id") else None
    if msg.get("device_id") and cc is None:
        connection.send_result(msg["id"], {"records": []})
        return
    connection.send_result(msg["id"], {"records": history.list(cc, msg["limit"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/history_outcome",
        vol.Required("record_id"): str,
        vol.Required("outcome"): vol.Any(None, vol.In(OUTCOMES)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history_outcome(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Nachträglich festlegen oder ändern, ob gegessen oder weggeworfen."""
    history = await async_get_history(hass)
    if not history.set_outcome(msg["record_id"], msg["outcome"]):
        connection.send_error(msg["id"], "not_found", "record not found")
        return
    connection.send_result(msg["id"], {})


def async_setup_history_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_empty)
    websocket_api.async_register_command(hass, ws_history)
    websocket_api.async_register_command(hass, ws_history_outcome)
    domain_data[DATA_WS] = True
