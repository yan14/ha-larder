"""Vouchers (4.8): value, valid until, place – and a reminder before they expire.

A voucher is an entry of the kind `voucher` (no code, no stock, no shopping list). Its remaining value and the
value it started with are product data of the content entity (`value`, `value_initial`); the date entity holds
"valid until", with the long warning of medicines. The code printed on the voucher is optional and kept here,
outside the entity state, because every user can read states: only administrators read or change it.

*Redeemed* lowers the remaining value; at 0 € (or *fully redeemed*) the voucher is emptied with the outcome
"eaten" (redeemed), *Expired* empties it as "thrown" – the history keeps its value, so the dashboard can show
what expired in the last 12 months.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_CC, DOMAIN, KIND_VOUCHER, larder_id
from .entity import kind_of
from .singleton import async_singleton

STORAGE_KEY = f"{DOMAIN}.vouchers"
STORAGE_VERSION = 1
DATA_VOUCHERS = "vouchers"


class Vouchers:
    """Codes of the vouchers (cc → code), readable by administrators only."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.codes: dict[str, str] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.codes = {str(k): str(v) for k, v in (data.get("codes") or {}).items() if v}

    async def async_set_code(self, cc: str, code: str | None) -> None:
        code = (code or "").strip()
        if code:
            self.codes[cc] = code
        else:
            self.codes.pop(cc, None)
        await self._store.async_save({"codes": self.codes})

    async def async_forget(self, cc: str) -> None:
        if cc in self.codes:
            await self.async_set_code(cc, None)


async def async_get_vouchers(hass: HomeAssistant) -> Vouchers:
    async def create() -> Vouchers:
        vouchers = Vouchers(hass)
        await vouchers.async_load()
        return vouchers

    return await async_singleton(hass, DATA_VOUCHERS, create)


def _voucher_entry(hass: HomeAssistant, device_id: str):
    device = dr.async_get(hass).async_get(device_id)
    cc = larder_id(device) if device else None
    entry = next((e for e in hass.config_entries.async_loaded_entries(DOMAIN) if cc and e.data.get(CONF_CC) == cc), None)
    if entry is None or kind_of(entry) != KIND_VOUCHER:
        return None, None
    return entry, cc


def _value(product: dict[str, Any]) -> float:
    try:
        return max(0.0, round(float(product.get("value") or 0), 2))
    except (TypeError, ValueError):
        return 0.0


async def _async_empty(hass: HomeAssistant, cc: str, outcome: str) -> None:
    """Empty the voucher like the card does: the history keeps content, date and value."""
    from .history import async_get_history  # noqa: PLC0415 - avoids an import cycle

    button = er.async_get(hass).async_get_entity_id("button", DOMAIN, f"{cc}_empty_container")
    (await async_get_history(hass)).set_pending(cc, outcome)
    await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)


def voucher_stats(hass: HomeAssistant, records: list[dict[str, Any]], today: date | None = None) -> dict[str, Any]:
    """Open vouchers and their value; redeemed and expired value of the last 12 months (from the history)."""
    today = today or dt_util.now().date()
    registry = er.async_get(hass)
    count = 0
    open_value = 0.0
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc or kind_of(entry) != KIND_VOUCHER:
            continue
        entity_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        state = hass.states.get(entity_id) if entity_id else None
        if state is None or not str(state.state).strip() or state.state in ("unknown", "unavailable"):
            continue
        count += 1
        open_value += _value(dict(state.attributes))
    since = (today - timedelta(days=365)).isoformat()
    lost = redeemed = 0.0
    for record in records:
        if record.get("kind") != KIND_VOUCHER or str(record.get("emptied", ""))[:10] < since:
            continue
        product = record.get("product") or {}
        if record.get("outcome") == "thrown":
            lost += _value(product)
        elif record.get("outcome") == "eaten":
            redeemed += _value(product)
    return {"count": count, "open_value": round(open_value, 2), "lost_value": round(lost, 2), "redeemed_value": round(redeemed, 2)}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/voucher_code", vol.Required("device_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_voucher_code(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Code of a voucher (administrators only)."""
    entry, cc = _voucher_entry(hass, msg["device_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "voucher not found")
        return
    connection.send_result(msg["id"], {"code": (await async_get_vouchers(hass)).codes.get(cc, "")})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/voucher_update",
        vol.Required("device_id"): str,
        vol.Optional("value"): vol.All(vol.Coerce(float), vol.Range(min=0, max=10000)),
        vol.Optional("valid_until"): vol.Any(None, vol.Date()),
        vol.Optional("code"): vol.All(str, vol.Length(max=200)),
    }
)
@websocket_api.async_response
async def ws_voucher_update(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Change the remaining value, the date or (administrators) the code of a voucher."""
    entry, cc = _voucher_entry(hass, msg["device_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "voucher not found")
        return
    if "code" in msg and not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "administrators only")
        return
    ents = entry.runtime_data.resettable
    if "value" in msg:
        value = round(msg["value"], 2)
        product = {"value": value}
        if value > _value({"value": ents["content"].product.get("value_initial")}):
            product["value_initial"] = value
        await ents["content"].async_set_product(product, replace=False)
    if "valid_until" in msg:
        until = msg["valid_until"]
        await ents["best_before"].async_set_value(date.fromisoformat(until) if isinstance(until, str) else until)
    if "code" in msg:
        await (await async_get_vouchers(hass)).async_set_code(cc, msg["code"])
    connection.send_result(msg["id"], {"value": _value(ents["content"].product)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/voucher_redeem",
        vol.Required("device_id"): str,
        vol.Optional("amount"): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=10000)),
        vol.Optional("expired", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_voucher_redeem(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Redeem a voucher (all or `amount`) or mark it expired; at 0 € it is removed."""
    entry, cc = _voucher_entry(hass, msg["device_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "voucher not found")
        return
    content = entry.runtime_data.resettable["content"]
    value = _value(content.product)
    if msg["expired"]:
        await _async_empty(hass, cc, "thrown")
        connection.send_result(msg["id"], {"removed": True, "value": 0, "lost": value})
        return
    amount = msg.get("amount")
    if amount is not None and value and amount < value - 0.005:
        rest = round(value - amount, 2)
        await content.async_set_product({"value": rest}, replace=False)
        connection.send_result(msg["id"], {"removed": False, "value": rest})
        return
    await _async_empty(hass, cc, "eaten")
    connection.send_result(msg["id"], {"removed": True, "value": 0})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/voucher_stats"})
@websocket_api.async_response
async def ws_voucher_stats(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .history import async_get_history  # noqa: PLC0415

    history = await async_get_history(hass)
    connection.send_result(msg["id"], voucher_stats(hass, history.records))


def async_setup_voucher_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("voucher_ws"):
        return
    domain_data["voucher_ws"] = True
    for command in (ws_voucher_code, ws_voucher_update, ws_voucher_redeem, ws_voucher_stats):
        websocket_api.async_register_command(hass, command)
