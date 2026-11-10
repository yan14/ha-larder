"""Optional: MHD jeder Dose als Ganztags-Termin in einen vorhandenen Kalender schreiben.

Der Kalender wird in den Einstellungen gewählt (z. B. Google, CalDAV oder "Lokaler Kalender").
Pro Dose gibt es höchstens einen Termin. Er wird angelegt, wenn ein MHD gesetzt ist, verschoben,
wenn sich MHD oder Inhalt ändern, und gelöscht, wenn das MHD gelöscht oder die Dose entfernt
wird. Erkannt werden die eigenen Termine an einer Kennung in der Beschreibung. Dafür muss der
Kalender Termine anlegen UND löschen können (reine Leser wie ein iCal-Link gehen nicht).
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
import logging
from typing import Any

from homeassistant.components import calendar as ha_calendar
from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    TrackStates,
    async_call_later,
    async_track_state_change_filtered,
)
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_CC, DOMAIN
from .estimate import async_get_estimator, storage_context

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.calendar"
DATA_CALENDAR = "calendar_sync"
DEBOUNCE_SECONDS = 5


def marker(cc: str) -> str:
    return f"[zwilling:{cc}]"


def event_texts(language: str, content: str, name: str, area: str | None, cc: str) -> tuple[str, str]:
    """(Titel, Beschreibung) des Termins."""
    prefix = "MHD" if language.lower().startswith("de") else "Best before"
    title = f"{prefix}: {content or name}"
    details = f"{name} · {area}" if area else name
    return title, f"{details}\n{marker(cc)}"


class CalendarSync:
    """Hält pro Dose einen Termin im gewählten Kalender aktuell."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._records: dict[str, dict[str, str]] = {}
        self._lock = asyncio.Lock()
        self._timers: dict[str, CALLBACK_TYPE] = {}
        self._unsub_state: CALLBACK_TYPE | None = None
        self._unsub_started: CALLBACK_TYPE | None = None

    async def async_load(self) -> None:
        self._records = (await self._store.async_load()) or {}

    # ----- Überwachung -----

    @callback
    def async_start(self) -> None:
        if self._unsub_state is None:
            self._unsub_state = async_track_state_change_filtered(
                self.hass, TrackStates(False, set(), {"date", "text"}), self._state_changed
            ).async_remove
        if self._unsub_started is None:
            self._unsub_started = async_at_started(self.hass, self._started)

    @callback
    def async_stop(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        if self._unsub_started:
            self._unsub_started()
            self._unsub_started = None
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    async def _started(self, _hass: HomeAssistant) -> None:
        await self.async_sync_all()

    @callback
    def _state_changed(self, event: Event[EventStateChangedData]) -> None:
        entry = er.async_get(self.hass).async_get(event.data["entity_id"])
        if entry is None or entry.platform != DOMAIN:
            return
        # unique_id = "<cc>_best_before" oder "<cc>_content"; cc selbst enthält keinen Unterstrich
        cc, _, key = entry.unique_id.partition("_")
        if key in ("best_before", "content"):
            self._schedule(cc)

    def _schedule(self, cc: str) -> None:
        if not self.calendar_entity_id:
            return
        if cancel := self._timers.pop(cc, None):
            cancel()

        async def run(_now: datetime) -> None:
            self._timers.pop(cc, None)
            await self.async_sync(cc)

        self._timers[cc] = async_call_later(self.hass, DEBOUNCE_SECONDS, run)

    # ----- Einstellungen -----

    @property
    def calendar_entity_id(self) -> str | None:
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        return getattr(estimator, "calendar_entity", None)

    # ----- Abgleich -----

    def _desired(self, cc: str) -> tuple[date, str, str] | None:
        """(MHD, Titel, Beschreibung) laut den Entitäten der Dose, oder None ohne MHD."""
        registry = er.async_get(self.hass)
        date_id = registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = self.hass.states.get(date_id) if date_id else None
        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None
        try:
            best = date.fromisoformat(state.state)
        except ValueError:
            return None
        entry = next(
            (e for e in self.hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_CC) == cc),
            None,
        )
        if entry is None:
            return None
        text_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        text_state = self.hass.states.get(text_id) if text_id else None
        content = (
            text_state.state.strip()
            if text_state is not None and text_state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
            else ""
        )
        title, description = event_texts(
            self.hass.config.language, content, entry.title, storage_context(self.hass, cc).area_name, cc
        )
        return best, title, description

    def _entity(self, entity_id: str | None) -> CalendarEntity | None:
        if not entity_id:
            return None
        component = self.hass.data.get(ha_calendar.DATA_COMPONENT)
        return component.get_entity(entity_id) if component else None

    async def _delete_event(self, record: dict[str, str], cc: str) -> bool:
        """Alten Termin löschen. True, wenn nichts mehr zu tun ist."""
        entity = self._entity(record["entity"])
        if entity is None:
            return False  # Kalender (noch) nicht geladen: Eintrag behalten und später erneut versuchen
        if not entity.supported_features & CalendarEntityFeature.DELETE_EVENT:
            _LOGGER.warning("Kalender %s kann keine Termine löschen", record["entity"])
            return True
        start = dt_util.start_of_local_day(date.fromisoformat(record["date"]))
        try:
            events = await entity.async_get_events(self.hass, start, start + timedelta(days=1))
            for event in events:
                if event.uid and marker(cc) in (event.description or ""):
                    await entity.async_delete_event(event.uid, event.recurrence_id)
        except Exception:  # noqa: BLE001 - Kalenderanbieter können vieles werfen
            _LOGGER.warning("Termin in %s konnte nicht gelöscht werden", record["entity"], exc_info=True)
            return False
        return True

    async def async_sync(self, cc: str) -> None:
        """Termin einer Dose mit dem gewählten Kalender abgleichen."""
        async with self._lock:
            await self._sync_locked(cc)

    async def _sync_locked(self, cc: str) -> None:
        target = self.calendar_entity_id
        record = self._records.get(cc)
        desired = self._desired(cc) if target else None

        if record and desired and record == {
            "entity": target,
            "date": desired[0].isoformat(),
            "title": desired[1],
        }:
            return
        if record is None and desired is None:
            return

        if record and not await self._delete_event(record, cc):
            return
        self._records.pop(cc, None)

        if desired and target:
            best, title, description = desired
            entity = self._entity(target)
            if entity is None or not entity.supported_features & CalendarEntityFeature.CREATE_EVENT:
                _LOGGER.debug("Kalender %s nicht verfügbar oder nicht beschreibbar", target)
            else:
                try:
                    await self.hass.services.async_call(
                        "calendar",
                        "create_event",
                        {
                            "entity_id": target,
                            "summary": title,
                            "description": description,
                            "start_date": best.isoformat(),
                            "end_date": (best + timedelta(days=1)).isoformat(),
                        },
                        blocking=True,
                    )
                    self._records[cc] = {"entity": target, "date": best.isoformat(), "title": title}
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("Termin in %s konnte nicht angelegt werden", target, exc_info=True)
        await self._store.async_save(self._records)

    async def async_sync_all(self) -> None:
        """Alle Dosen abgleichen, auch solche, die nur noch im Protokoll stehen (z. B. Kalender gewechselt)."""
        ccs = {e.data[CONF_CC] for e in self.hass.config_entries.async_entries(DOMAIN) if CONF_CC in e.data}
        for cc in sorted(ccs | set(self._records)):
            await self.async_sync(cc)

    async def async_remove_dose(self, cc: str) -> None:
        """Dose wurde entfernt: Termin löschen."""
        if cancel := self._timers.pop(cc, None):
            cancel()
        async with self._lock:
            record = self._records.get(cc)
            if record and await self._delete_event(record, cc):
                self._records.pop(cc, None)
                await self._store.async_save(self._records)


async def async_get_calendar_sync(hass: HomeAssistant) -> CalendarSync:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if (sync := domain_data.get(DATA_CALENDAR)) is None:
        await async_get_estimator(hass)
        sync = CalendarSync(hass)
        await sync.async_load()
        domain_data[DATA_CALENDAR] = sync
    return sync
