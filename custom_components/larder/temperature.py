"""Temperaturwarnung: Lagerort mit Temperatursensor ist zu lange zu warm (z. B. Gefrierschrank offen).

Welche Art von Lagerort ein Bereich ist, kommt aus Name, Label und Vorlage ("Storage:"), nicht aus
dem Sensor selbst (ein warmer Gefrierschrank bleibt ein Gefrierschrank). Grenzen:

- Gefrierschrank: wärmer als −12 °C für 30 Minuten,
- Kühlschrank: wärmer als 8 °C für 60 Minuten,
- 0-°C-Fach: wärmer als 6 °C für 60 Minuten.

Dann gibt es einen Reparaturhinweis mit den gefüllten Dosen dort und das Ereignis
`larder_temperature_warning` (für eigene Benachrichtigungen). Ist es 1 °C unter der Grenze wieder
kalt genug, verschwindet der Hinweis und `larder_temperature_ok` wird ausgelöst.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er, issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from . import shelf_life
from .const import DOMAIN
from .estimate import storage_context
from .singleton import async_singleton

DATA_TEMPERATURE = "temperature_watch"
CHECK_EVERY = timedelta(minutes=5)
HYSTERESIS = 1.0
EVENT_WARNING = f"{DOMAIN}_temperature_warning"
EVENT_OK = f"{DOMAIN}_temperature_ok"
ISSUE_PREFIX = "temperature_"


@dataclass(frozen=True)
class Limit:
    max_c: float
    minutes: int


LIMITS = {
    shelf_life.FREEZER: Limit(-12.0, 30),
    shelf_life.FRIDGE: Limit(8.0, 60),
    shelf_life.ZERO: Limit(6.0, 60),
}


@dataclass
class AreaInfo:
    area_id: str
    name: str
    temperature_c: float | None
    limit: Limit
    containers: list[str]


def watched_areas(hass: HomeAssistant) -> dict[str, AreaInfo]:
    """Bereiche mit Dosen, Temperatursensor und bekannter Art (Gefrier-, Kühlschrank, 0-°C-Fach)."""
    devices = dr.async_get(hass)
    registry = er.async_get(hass)
    areas: dict[str, AreaInfo] = {}
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        device = devices.async_get_device(identifiers={(DOMAIN, cc)}) if cc else None
        if device is None or not device.area_id:
            continue
        context = storage_context(hass, cc)
        storage = shelf_life.classify_storage(context.area_name, None, context.label_texts, context.storage_hint)
        limit = LIMITS.get(storage.key) if storage else None
        if limit is None:
            continue
        info = areas.get(device.area_id)
        if info is None:
            info = areas[device.area_id] = AreaInfo(device.area_id, context.area_name or "", context.temperature_c, limit, [])
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        content = hass.states.get(content_id) if content_id else None
        if content is not None and content.state not in ("", "unknown", "unavailable"):
            info.containers.append(f"{content.state} ({device.name_by_user or device.name or cc})")
    # nur Bereiche mit Sensor
    return {k: v for k, v in areas.items() if v.temperature_c is not None}


class TemperatureWatch:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._since: dict[str, datetime] = {}
        self._warned: set[str] = set()
        self._unsubs: list[CALLBACK_TYPE] = []

    @callback
    def async_start(self) -> None:
        if self._unsubs:
            return
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, CHECK_EVERY))
        if self.hass.is_running:
            self.async_check()
        else:
            self._unsubs.append(
                self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, lambda _e: self.async_check())
            )

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    @callback
    def _tick(self, now: datetime) -> None:
        self.async_check(now)

    @callback
    def async_check(self, now: datetime | None = None) -> None:
        hass = self.hass
        now = now or dt_util.utcnow()
        estimator = hass.data.get(DOMAIN, {}).get("estimator")
        enabled = getattr(estimator, "temperature_warning", True)
        areas = watched_areas(hass) if enabled else {}
        for area_id in list(self._since) + list(self._warned):
            if area_id not in areas:
                self._clear(area_id, None)
        for area_id, info in areas.items():
            temp = info.temperature_c
            if temp > info.limit.max_c:
                since = self._since.setdefault(area_id, now)
                if area_id not in self._warned and now - since >= timedelta(minutes=info.limit.minutes):
                    self._warn(info, temp)
            elif temp <= info.limit.max_c - HYSTERESIS:
                self._clear(area_id, info)

    def _warn(self, info: AreaInfo, temp: float) -> None:
        self._warned.add(info.area_id)
        lang_de = (self.hass.config.language or "en").lower().startswith("de")
        none = "keine" if lang_de else "none"
        ir.async_create_issue(
            self.hass,
            DOMAIN,
            f"{ISSUE_PREFIX}{info.area_id}",
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key="temperature_too_high",
            translation_placeholders={
                "area": info.name,
                "temperature": f"{temp:.1f}",
                "limit": f"{info.limit.max_c:g}",
                "minutes": str(info.limit.minutes),
                "containers": "\n".join(f"- {c}" for c in info.containers) or f"- {none}",
            },
        )
        self.hass.bus.async_fire(
            EVENT_WARNING,
            {
                "area_id": info.area_id,
                "area": info.name,
                "temperature": round(temp, 1),
                "limit": info.limit.max_c,
                "containers": info.containers,
            },
        )

    def _clear(self, area_id: str, info: AreaInfo | None) -> None:
        self._since.pop(area_id, None)
        if area_id in self._warned:
            self._warned.discard(area_id)
            ir.async_delete_issue(self.hass, DOMAIN, f"{ISSUE_PREFIX}{area_id}")
            data: dict[str, Any] = {"area_id": area_id}
            if info is not None:
                data.update(area=info.name, temperature=round(info.temperature_c or 0, 1))
            self.hass.bus.async_fire(EVENT_OK, data)


async def async_get_temperature_watch(hass: HomeAssistant) -> TemperatureWatch:
    async def create() -> TemperatureWatch:
        return TemperatureWatch(hass)

    return await async_singleton(hass, DATA_TEMPERATURE, create)
