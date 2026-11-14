"""Behältergrößen: fest an der Dose oder variabel je Befüllung, lose Behälter und freie Behälter je Größe.

* **Feste Größe** (Standard): gehört zur Dose, z. B. "1 l".
* **Variable Größe**: der Code sitzt auf einem Deckel, der auf Behälter verschiedener Größe passt. Die Größe wird
  bei jeder Befüllung gewählt (vorgeschlagen: die zuletzt benutzte). Wie viele Behälter es je Größe gibt, steht
  unter "lose Behälter" (z. B. 4 × 1 l, 2 × 2 l).
* **Frei**: leere Dosen mit fester Größe + lose Behälter − mit einem variablen Deckel befüllte.

Größen sind freier Text; gleich gelten sie, wenn sie ohne Leerzeichen und Groß-/Kleinschreibung gleich sind
("1 l" = "1L", "0,5 l" = "0.5 l").
"""

from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import CONF_CC, DOMAIN, KIND_CONTAINER, SIGNAL_STOCK_CHANGED
from .entity import kind_of
from .singleton import async_singleton

STORAGE_KEY = f"{DOMAIN}.sizes"
STORAGE_VERSION = 1
DATA_SIZES = "sizes"
MAX_SIZE = 20
MAX_LOOSE = 999


def clean_size(value: str | None) -> str:
    return " ".join(str(value or "").split())[:MAX_SIZE]


def size_key(value: str | None) -> str:
    return re.sub(r"\s+", "", clean_size(value).casefold()).replace(",", ".")


def _litres(value: str) -> float | None:
    """Größe in Litern zum Sortieren und Aufteilen ("500 ml" → 0,5); None, wenn nicht erkennbar."""
    found = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(ml|cl|l|liter|litre)?", clean_size(value).casefold())
    if not found:
        return None
    number = float(found.group(1).replace(",", "."))
    unit = found.group(2) or "l"
    return number / 1000 if unit == "ml" else number / 100 if unit == "cl" else number


def sort_sizes(sizes: list[str]) -> list[str]:
    return sorted(sizes, key=lambda s: (_litres(s) is None, _litres(s) or 0, s.casefold()))


class Sizes:
    """Größen je Dose (cc) und lose Behälter."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.containers: dict[str, dict[str, Any]] = {}  # cc → {size, variable, current, last}
        self.loose: dict[str, int] = {}  # Größe → Anzahl

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.containers = {k: v for k, v in (data.get("containers") or {}).items() if isinstance(v, dict)}
        self.loose = {clean_size(k): int(v) for k, v in (data.get("loose") or {}).items() if clean_size(k) and int(v) > 0}

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"containers": self.containers, "loose": self.loose}, 1)
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)  # Karten zeigen die Größe

    def info(self, cc: str) -> dict[str, Any]:
        return dict(self.containers.get(cc) or {})

    def effective(self, cc: str) -> str | None:
        """Größe der Dose jetzt: variabel → die der aktuellen Befüllung, sonst die feste."""
        info = self.containers.get(cc) or {}
        return (info.get("current") if info.get("variable") else info.get("size")) or None

    def set_container(self, cc: str, size: str | None, variable: bool) -> None:
        info = dict(self.containers.get(cc) or {})
        info["size"] = clean_size(size) or None
        info["variable"] = bool(variable)
        self.containers[cc] = {k: v for k, v in info.items() if v not in (None, False, "")} or {}
        if not self.containers[cc]:
            del self.containers[cc]
        self._save()

    def set_filling(self, cc: str, size: str | None) -> None:
        """Größe der aktuellen Befüllung einer variablen Dose (merkt sie als Vorschlag fürs nächste Mal)."""
        info = dict(self.containers.get(cc) or {})
        size = clean_size(size)
        info["variable"] = True
        info["current"] = size or None
        if size:
            info["last"] = size
        self.containers[cc] = {k: v for k, v in info.items() if v not in (None, "")}
        self._save()

    def set_loose(self, loose: dict[str, int]) -> None:
        out: dict[str, int] = {}
        for size, count in loose.items():
            size = clean_size(size)
            if size and int(count) > 0:
                existing = next((k for k in out if size_key(k) == size_key(size)), size)
                out[existing] = min(MAX_LOOSE, out.get(existing, 0) + int(count))
        self.loose = out
        self._save()

    def known(self) -> list[str]:
        """Alle bekannten Größen (für Vorschläge)."""
        seen: dict[str, str] = {}
        for info in self.containers.values():
            for key in ("size", "current", "last"):
                if info.get(key):
                    seen.setdefault(size_key(info[key]), info[key])
        for size in self.loose:
            seen.setdefault(size_key(size), size)
        return sort_sizes(list(seen.values()))

    def overview(self) -> list[dict[str, Any]]:
        """Je Größe: insgesamt, befüllt, frei (feste Dosen und lose Behälter zusammen)."""
        registry = er.async_get(self.hass)
        rows: dict[str, dict[str, Any]] = {}

        def row(size: str) -> dict[str, Any]:
            return rows.setdefault(size_key(size), {"size": size, "total": 0, "filled": 0, "free": 0})

        for size, count in self.loose.items():
            row(size)["total"] += count
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            cc = entry.data.get(CONF_CC)
            if not cc or kind_of(entry) != KIND_CONTAINER or cc not in self.containers:
                continue
            info = self.containers[cc]
            content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
            state = self.hass.states.get(content_id) if content_id else None
            filled = state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE) and bool(state.state.strip())
            if info.get("variable"):
                if filled and info.get("current"):
                    row(info["current"])["filled"] += 1
            elif info.get("size"):
                r = row(info["size"])
                r["total"] += 1
                if filled:
                    r["filled"] += 1
        for r in rows.values():
            r["free"] = max(0, r["total"] - r["filled"])
        return [rows[k] for k in (size_key(s) for s in sort_sizes([r["size"] for r in rows.values()]))]


async def async_get_sizes(hass: HomeAssistant) -> Sizes:
    async def create() -> Sizes:
        sizes = Sizes(hass)
        await sizes.async_load()
        return sizes

    return await async_singleton(hass, DATA_SIZES, create)


def _cc_of(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    return next((ident for domain, ident in (device.identifiers if device else ()) if domain == DOMAIN), None)


def _result(sizes: Sizes) -> dict[str, Any]:
    return {"overview": sizes.overview(), "loose": sizes.loose, "known": sizes.known()}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/sizes"})
@websocket_api.async_response
async def ws_sizes(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _result(await async_get_sizes(hass)))


_SIZE = vol.All(str, vol.Length(max=MAX_SIZE))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/size_set",
        vol.Required("device_id"): str,
        vol.Optional("size", default=""): _SIZE,
        vol.Optional("variable", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_size_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Feste Größe bzw. "variable Größe" einer Dose setzen."""
    cc = _cc_of(hass, msg["device_id"])
    if not cc:
        connection.send_error(msg["id"], "not_found", "unknown container")
        return
    sizes = await async_get_sizes(hass)
    sizes.set_container(cc, msg["size"], msg["variable"])
    connection.send_result(msg["id"], _result(sizes))


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/size_fill", vol.Required("device_id"): str, vol.Optional("size", default=""): _SIZE}
)
@websocket_api.async_response
async def ws_size_fill(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Größe der aktuellen Befüllung einer variablen Dose (aus dem Befüll-Dialog)."""
    cc = _cc_of(hass, msg["device_id"])
    if not cc:
        connection.send_error(msg["id"], "not_found", "unknown container")
        return
    sizes = await async_get_sizes(hass)
    sizes.set_filling(cc, msg["size"])
    connection.send_result(msg["id"], _result(sizes))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/loose_set",
        vol.Required("loose"): {_SIZE: vol.All(vol.Coerce(int), vol.Range(min=0, max=MAX_LOOSE))},
    }
)
@websocket_api.async_response
async def ws_loose_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Lose Behälter (für Deckel mit variabler Größe): Anzahl je Größe."""
    sizes = await async_get_sizes(hass)
    sizes.set_loose(msg["loose"])
    connection.send_result(msg["id"], _result(sizes))


@callback
def async_setup_sizes_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("sizes_ws"):
        return
    hass.data[DOMAIN]["sizes_ws"] = True
    for command in (ws_sizes, ws_size_set, ws_size_fill, ws_loose_set):
        websocket_api.async_register_command(hass, command)
