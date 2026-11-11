"""Optional: MHD jeder Dose als Ganztags-Termin in einen vorhandenen Kalender schreiben.

Der Kalender wird in den Einstellungen gewählt (z. B. Google, CalDAV oder "Lokaler Kalender").
Pro Dose gibt es höchstens einen Termin. Er wird angelegt, wenn ein MHD gesetzt ist, verschoben,
wenn sich MHD oder Inhalt ändern, und gelöscht, wenn das MHD gelöscht oder die Dose entfernt
wird. Erkannt werden die eigenen Termine an einer Kennung in der Beschreibung. Dafür muss der
Kalender Termine anlegen UND löschen können (reine Leser wie ein iCal-Link gehen nicht).

Home Assistants CalDAV-Kalender (iCloud, Nextcloud, …) kann selbst nur anlegen; für ihn liest und
löscht `CalDavBackend` direkt über die CalDAV-Verbindung.

Der Abgleich ist selbstheilend: Er sucht die Termine einer Dose im ganzen Kalender (nicht nur am
zuletzt gemerkten Tag), behält genau einen passenden Termin, löscht alle übrigen und legt nur dann
einen neuen an, wenn keiner passt. Dadurch entstehen auch dann keine Doppelten, wenn ein Kalender
Änderungen verzögert zeigt oder ein früheres Löschen nicht geklappt hat.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import calendar as ha_calendar
from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import (
    CALLBACK_TYPE,
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
    callback,
)
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.event import (
    TrackStates,
    async_call_later,
    async_track_state_change_filtered,
)
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_CC, DOMAIN, SERVICE_REBUILD_CALENDAR
from .estimate import async_get_estimator, storage_context
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.calendar"
DATA_CALENDAR = "calendar_sync"
DEBOUNCE_SECONDS = 5
SCAN_DAYS_BACK = 400
SCAN_DAYS_AHEAD = 1600
MARKER_RE = re.compile(r"\[zwilling:([^\]]+)\]")
TITLE_PREFIXES = ("MHD: ", "Best before: ")


def marker(cc: str) -> str:
    return f"[zwilling:{cc}]"


def event_texts(language: str, content: str, name: str, area: str | None, cc: str) -> tuple[str, str]:
    """(Titel, Beschreibung) des Termins."""
    prefix = "MHD" if language.lower().startswith("de") else "Best before"
    title = f"{prefix}: {content or name}"
    details = f"{name} · {area}" if area else name
    return title, f"{details}\n{marker(cc)}"


@dataclass(frozen=True)
class CalendarItem:
    """Ein Termin, unabhängig vom Kalenderanbieter."""

    uid: str | None
    day: date
    summary: str
    description: str
    ref: Any = None  # anbieterspezifisches Objekt (zum Löschen)


class CalendarBackend:
    """Zugriff über die Kalender-Entität von Home Assistant (Lokaler Kalender, Google, …)."""

    def __init__(self, hass: HomeAssistant, entity: CalendarEntity) -> None:
        self.hass = hass
        self.entity = entity
        self.entity_id = entity.entity_id

    @property
    def can_create(self) -> bool:
        return bool(self.entity.supported_features & CalendarEntityFeature.CREATE_EVENT)

    @property
    def can_delete(self) -> bool:
        return bool(self.entity.supported_features & CalendarEntityFeature.DELETE_EVENT)

    @staticmethod
    def _range(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
        """Ohne Angabe: ein weiter Zeitraum um heute."""
        if start is None or end is None:
            start = dt_util.start_of_local_day() - timedelta(days=SCAN_DAYS_BACK)
            end = start + timedelta(days=SCAN_DAYS_BACK + SCAN_DAYS_AHEAD)
        return start, end

    async def async_scan(self, start: datetime | None = None, end: datetime | None = None) -> list[CalendarItem]:
        start, end = self._range(start, end)
        return [
            CalendarItem(e.uid, e.start_datetime_local.date(), e.summary or "", e.description or "", e)
            for e in await self.entity.async_get_events(self.hass, start, end)
        ]

    async def async_delete(self, item: CalendarItem) -> None:
        await self.entity.async_delete_event(item.uid, item.ref.recurrence_id)


class CalDavBackend(CalendarBackend):
    """CalDAV: Home Assistants CalDAV-Kalender kann Termine nur anlegen und nennt keine Termin-IDs.

    Lesen und Löschen laufen deshalb direkt über die CalDAV-Verbindung, die die CalDAV-Integration
    ohnehin offen hält (`entity.coordinator.calendar`). Angelegt wird weiter über Home Assistant.
    """

    @staticmethod
    def matches(entity: CalendarEntity) -> bool:
        platform = getattr(entity, "platform", None)
        calendar = getattr(getattr(entity, "coordinator", None), "calendar", None)
        return getattr(platform, "platform_name", None) == "caldav" and callable(getattr(calendar, "search", None))

    @property
    def can_delete(self) -> bool:
        return True

    def _search(self, start: datetime, end: datetime) -> list[CalendarItem]:
        items = []
        for obj in self.entity.coordinator.calendar.search(start=start, end=end, event=True, expand=False):
            vevent = getattr(getattr(obj, "instance", None), "vevent", None)
            if vevent is None or not hasattr(vevent, "dtstart"):
                continue
            begin = vevent.dtstart.value
            if isinstance(begin, datetime):
                begin = (dt_util.as_local(begin) if begin.tzinfo else begin).date()

            def text(name: str, vevent: Any = vevent) -> str:
                return str(getattr(getattr(vevent, name, None), "value", "") or "")

            items.append(CalendarItem(text("uid") or None, begin, text("summary"), text("description"), obj))
        return items

    async def async_scan(self, start: datetime | None = None, end: datetime | None = None) -> list[CalendarItem]:
        start, end = self._range(start, end)
        return await self.hass.async_add_executor_job(self._search, start, end)

    async def async_delete(self, item: CalendarItem) -> None:
        await self.hass.async_add_executor_job(item.ref.delete)
        if refresh := getattr(self.entity.coordinator, "async_request_refresh", None):
            await refresh()


def backend_for(hass: HomeAssistant, entity: CalendarEntity) -> CalendarBackend:
    return CalDavBackend(hass, entity) if CalDavBackend.matches(entity) else CalendarBackend(hass, entity)


class CalendarSync:
    """Hält pro Dose einen Termin im gewählten Kalender aktuell."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._records: dict[str, dict[str, Any]] = {}
        self._warned: set[str] = set()
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
        old, new = event.data["old_state"], event.data["new_state"]
        # Nur echte Wertänderungen zählen (nicht reine Attributwechsel); "nicht verfügbar" ist kein MHD-Wechsel
        if new is None or new.state == STATE_UNAVAILABLE or (old is not None and old.state == new.state):
            return
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

    def _date_unavailable(self, cc: str) -> bool:
        """Datum der Dose (noch) nicht verfügbar, z. B. direkt nach dem Start: dann nichts verändern."""
        date_id = er.async_get(self.hass).async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = self.hass.states.get(date_id) if date_id else None
        if state is None:
            # Dose gibt es noch, ihr Datum hat aber (noch) keinen Zustand: nicht als "kein MHD" werten
            return any(e.data.get(CONF_CC) == cc for e in self.hass.config_entries.async_entries(DOMAIN))
        return state.state == STATE_UNAVAILABLE

    def _backend(self, entity_id: str | None) -> CalendarBackend | None:
        entity = self._entity(entity_id)
        return backend_for(self.hass, entity) if entity is not None else None

    def supports(self, entity_id: str) -> bool | None:
        """Kann Larder in diesem Kalender Termine anlegen UND löschen? None: Kalender (noch) nicht geladen."""
        backend = self._backend(entity_id)
        return None if backend is None else backend.can_create and backend.can_delete

    def _ours(
        self, events: list[CalendarItem], cc: str, record: dict[str, Any] | None, entity_id: str
    ) -> list[CalendarItem]:
        """Termine dieser Dose.

        Erkannt an der Kennung in der Beschreibung, an der gemerkten Termin-ID oder (nur wenn keine
        ID bekannt ist und der Kalender Beschreibungen verwirft) am gemerkten Titel und Tag.
        """
        same_calendar = bool(record) and record.get("entity") == entity_id
        uid = record.get("uid") if same_calendar else None
        claimed = {
            r["uid"] for other, r in self._records.items() if other != cc and r.get("entity") == entity_id and r.get("uid")
        }
        found = []
        for event in events:
            if not event.uid:
                continue
            if marker(cc) in event.description or (uid and event.uid == uid):
                found.append(event)
            elif (
                same_calendar
                and not uid
                and event.uid not in claimed
                and not MARKER_RE.search(event.description)
                and event.summary == record.get("title")
                and event.day.isoformat() == record.get("date")
            ):
                found.append(event)
        return found

    async def _delete_events(self, backend: CalendarBackend, events: list[CalendarItem]) -> bool:
        """Termine löschen. True, wenn alle weg sind."""
        ok = True
        for event in events:
            try:
                await backend.async_delete(event)
            except Exception:  # noqa: BLE001 - Kalenderanbieter können vieles werfen
                _LOGGER.warning("Termin %s in %s konnte nicht gelöscht werden", event.summary, backend.entity_id, exc_info=True)
                ok = False
        return ok

    async def _purge(self, entity_id: str, cc: str, record: dict[str, Any] | None) -> bool:
        """Alle Termine der Dose in einem Kalender entfernen. True, wenn nichts mehr zu tun ist."""
        backend = self._backend(entity_id)
        if backend is None:
            return False  # Kalender (noch) nicht geladen: Eintrag behalten und später erneut versuchen
        if not backend.can_delete:
            _LOGGER.warning("Kalender %s kann keine Termine löschen", entity_id)
            return True  # nicht lösbar: Eintrag nicht ewig behalten
        try:
            ours = self._ours(await backend.async_scan(), cc, record, entity_id)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Termine in %s konnten nicht gelesen werden", entity_id, exc_info=True)
            return False
        return await self._delete_events(backend, ours)

    async def async_sync(self, cc: str, *, verify: bool = False) -> None:
        """Termin einer Dose mit dem gewählten Kalender abgleichen (verify: auch bei unverändertem Stand prüfen)."""
        async with self._lock:
            await self._sync_locked(cc, verify=verify)

    async def _sync_locked(
        self, cc: str, *, verify: bool = False, events: list[CalendarItem] | None = None
    ) -> None:
        target = self.calendar_entity_id
        if target and self._date_unavailable(cc):
            return
        record = self._records.get(cc)
        desired = self._desired(cc) if target else None

        if (
            not verify
            and record
            and desired
            and (record.get("entity"), record.get("date"), record.get("title"))
            == (target, desired[0].isoformat(), desired[1])
        ):
            return
        if record is None and desired is None and not (verify and target):
            return

        # Anderer (oder kein) Kalender gewählt: Termine im alten Kalender entfernen
        if record and record.get("entity") != target:
            if not await self._purge(record["entity"], cc, record):
                return
            self._records.pop(cc, None)
            record = None

        if target:
            backend = self._backend(target)
            if backend is None:
                _LOGGER.debug("Kalender %s nicht verfügbar", target)
                return
            if not (backend.can_create and backend.can_delete):
                # Ohne Löschen entstünde bei jeder Änderung ein weiterer Termin: lieber gar nichts schreiben
                if target not in self._warned:
                    self._warned.add(target)
                    _LOGGER.warning(
                        "Kalender %s kann Termine nicht anlegen und löschen; MHD-Termine werden nicht geschrieben",
                        target,
                    )
                return
            await self._reconcile(backend, cc, record, desired, events)
        await self._store.async_save(self._records)

    async def _reconcile(
        self,
        backend: CalendarBackend,
        cc: str,
        record: dict[str, Any] | None,
        desired: tuple[date, str, str] | None,
        events: list[CalendarItem] | None = None,
    ) -> None:
        """Genau einen passenden Termin sicherstellen (oder keinen, wenn kein MHD gesetzt ist)."""
        target = backend.entity_id
        try:
            if events is None:
                events = await backend.async_scan()
            ours = self._ours(events, cc, record, target)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Termine in %s konnten nicht gelesen werden", target, exc_info=True)
            return

        keep: CalendarItem | None = None
        if desired:
            best, title, _ = desired
            keep = next((e for e in ours if e.day == best and e.summary == title), None)
        deleted = await self._delete_events(backend, [e for e in ours if e is not keep])

        if desired is None:
            if deleted:
                self._records.pop(cc, None)
            return
        best, title, description = desired
        uid = keep.uid if keep else None
        if keep is None:
            known = {e.uid for e in events}
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
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Termin in %s konnte nicht angelegt werden", target, exc_info=True)
                self._records.pop(cc, None)
                return
            uid = await self._find_created(backend, cc, best, title, known)
            if uid:
                events.append(CalendarItem(uid, best, title, description))
        self._records[cc] = {"entity": target, "date": best.isoformat(), "title": title, "uid": uid}

    async def _find_created(
        self, backend: CalendarBackend, cc: str, best: date, title: str, known: set[str | None]
    ) -> str | None:
        """Termin-ID des eben angelegten Termins ermitteln (None, wenn der Kalender ihn noch nicht zeigt)."""
        claimed = {r.get("uid") for other, r in self._records.items() if other != cc}
        try:
            start = dt_util.start_of_local_day(best)
            fresh = await backend.async_scan(start - timedelta(days=1), start + timedelta(days=2))
        except Exception:  # noqa: BLE001
            return None
        candidates = [
            e for e in fresh if e.uid and e.day == best and e.summary == title and e.uid not in claimed
        ]
        new = [e for e in candidates if e.uid not in known]
        marked = [e for e in new or candidates if marker(cc) in e.description]
        chosen = marked or new
        return chosen[0].uid if chosen else None

    async def async_sync_all(self) -> None:
        """Alle Dosen gründlich abgleichen, auch solche, die nur noch im Protokoll stehen (z. B. Kalender gewechselt)."""
        ccs = {e.data[CONF_CC] for e in self.hass.config_entries.async_entries(DOMAIN) if CONF_CC in e.data}
        async with self._lock:
            # Den Kalender nur einmal lesen, nicht einmal pro Dose (neu angelegte Termine werden nachgetragen)
            events: list[CalendarItem] | None = None
            if (backend := self._backend(self.calendar_entity_id)) is not None and backend.can_delete:
                try:
                    events = await backend.async_scan()
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("Termine in %s konnten nicht gelesen werden", backend.entity_id, exc_info=True)
                    return
            for cc in sorted(ccs | set(self._records)):
                await self._sync_locked(cc, verify=True, events=events)

    async def async_rebuild(self, include_unmarked: bool = False) -> dict[str, int]:
        """Aufräumen: alle Termine neu abgleichen und Reste entfernen, die zu keiner Dose mehr gehören.

        Mit include_unmarked werden zusätzlich Termine ohne Kennung entfernt, die wie MHD-Termine
        heißen ("MHD: …" / "Best before: …"), aber keiner Dose mehr zugeordnet werden können.
        """
        removed = 0
        async with self._lock:
            target = self.calendar_entity_id
            backend = self._backend(target)
            ccs = {e.data[CONF_CC] for e in self.hass.config_entries.async_entries(DOMAIN) if CONF_CC in e.data}
            if backend is not None and backend.can_delete:
                try:
                    events = await backend.async_scan()
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("Termine in %s konnten nicht gelesen werden", target, exc_info=True)
                    events = []
                orphans = []
                for event in events:
                    if not event.uid:
                        continue
                    found = MARKER_RE.search(event.description)
                    is_orphan = found is not None and found.group(1) not in ccs
                    is_unmarked = include_unmarked and found is None and event.summary.startswith(TITLE_PREFIXES)
                    if is_orphan or is_unmarked:
                        orphans.append(event)
                if include_unmarked:
                    # ohne Kennung lässt sich der aktuelle Termin einer Dose nicht erkennen: alles löschen, neu anlegen
                    for cc in ccs:
                        self._records.pop(cc, None)
                if await self._delete_events(backend, orphans):
                    removed = len(orphans)
        await self.async_sync_all()
        return {"removed": removed}

    async def async_remove_dose(self, cc: str) -> None:
        """Dose wurde entfernt: Termin löschen."""
        if cancel := self._timers.pop(cc, None):
            cancel()
        async with self._lock:
            record = self._records.get(cc)
            if record and await self._purge(record["entity"], cc, record):
                self._records.pop(cc, None)
                await self._store.async_save(self._records)


def async_setup_calendar_service(hass: HomeAssistant) -> None:
    """Domain-Service `rebuild_calendar` einmalig registrieren (idempotent)."""
    if hass.services.has_service(DOMAIN, SERVICE_REBUILD_CALENDAR):
        return

    async def handle(call: ServiceCall) -> dict[str, Any]:
        sync = await async_get_calendar_sync(hass)
        return await sync.async_rebuild(call.data["include_unmarked"])

    hass.services.async_register(
        DOMAIN,
        SERVICE_REBUILD_CALENDAR,
        handle,
        schema=vol.Schema({vol.Optional("include_unmarked", default=False): cv.boolean}),
        supports_response=SupportsResponse.OPTIONAL,
    )


async def async_get_calendar_sync(hass: HomeAssistant) -> CalendarSync:
    async def create() -> CalendarSync:
        await async_get_estimator(hass)
        sync = CalendarSync(hass)
        await sync.async_load()
        return sync

    return await async_singleton(hass, DATA_CALENDAR, create)
