"""Optional: write the best-before date of every container as an all-day event into an existing calendar.

The calendar is chosen in the settings (e.g. Google, CalDAV or "Local calendar").
There is at most one event per container. It is created when a date is set, moved
when the date or the content changes, and deleted when the date is cleared or the container
is removed. Our own events are recognised by a marker in the description. For this the
calendar must be able to create AND delete events (read-only ones like an iCal link do not work).

Only Home Assistant's calendar entity features are used. A calendar that cannot delete events (e.g. Home
Assistant's CalDAV calendar for iCloud or Nextcloud) gets no events at all: without deleting, every change would add
another one. Larder then logs a warning once and the settings say the calendar is not supported.

The sync is self-healing: it looks for the events of a container in the whole calendar (not only on
the day remembered last), keeps exactly one matching event, deletes all others and only creates
a new one if none matches. This way no duplicates appear even if a calendar
shows changes with a delay or an earlier deletion failed.
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
from .devices import entry_of
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
    """(Title, description) of the event."""
    prefix = "MHD" if language.lower().startswith("de") else "Best before"
    title = f"{prefix}: {content or name}"
    details = f"{name} · {area}" if area else name
    return title, f"{details}\n{marker(cc)}"


@dataclass(frozen=True)
class CalendarItem:
    """An event, independent of the calendar provider."""

    uid: str | None
    day: date
    summary: str
    description: str
    ref: Any = None  # provider-specific object (for deleting)


class CalendarBackend:
    """Access through Home Assistant's calendar entity (Local calendar, Google, …)."""

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
        """Without arguments: a wide period around today."""
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


def backend_for(hass: HomeAssistant, entity: CalendarEntity) -> CalendarBackend:
    return CalendarBackend(hass, entity)


class CalendarSync:
    """Keeps one event per container up to date in the chosen calendar."""

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

    # ----- Watching -----

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
        # Only real value changes count (not mere attribute changes); "unavailable" is not a date change
        if new is None or new.state == STATE_UNAVAILABLE or (old is not None and old.state == new.state):
            return
        entry = er.async_get(self.hass).async_get(event.data["entity_id"])
        if entry is None or entry.platform != DOMAIN:
            return
        # unique_id = "<cc>_best_before" or "<cc>_content"; cc itself contains no underscore
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

    # ----- Settings -----

    @property
    def calendar_entity_id(self) -> str | None:
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        return getattr(estimator, "calendar_entity", None)

    # ----- Abgleich -----

    def _desired(self, cc: str) -> tuple[date, str, str] | None:
        """(Best-before date, title, description) from the container's entities, or None without a date."""
        registry = er.async_get(self.hass)
        date_id = registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = self.hass.states.get(date_id) if date_id else None
        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None
        try:
            best = date.fromisoformat(state.state)
        except ValueError:
            return None
        entry = entry_of(self.hass, cc)
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
        """The container's date is not available (yet), e.g. right after start: change nothing then."""
        date_id = er.async_get(self.hass).async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = self.hass.states.get(date_id) if date_id else None
        if state is None:
            # the container still exists but its date has no state (yet): do not treat as "no date"
            return any(e.data.get(CONF_CC) == cc for e in self.hass.config_entries.async_entries(DOMAIN))
        return state.state == STATE_UNAVAILABLE

    def _backend(self, entity_id: str | None) -> CalendarBackend | None:
        entity = self._entity(entity_id)
        return backend_for(self.hass, entity) if entity is not None else None

    def supports(self, entity_id: str) -> bool | None:
        """Can Larder create AND delete events in this calendar? None: calendar not loaded (yet)."""
        backend = self._backend(entity_id)
        return None if backend is None else backend.can_create and backend.can_delete

    def _ours(
        self, events: list[CalendarItem], cc: str, record: dict[str, Any] | None, entity_id: str
    ) -> list[CalendarItem]:
        """Events of this container.

        Recognised by the marker in the description, by the remembered event ID or (only if no
        ID is known and the calendar drops descriptions) by the remembered title and day.
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
        """Delete events. True if all are gone."""
        ok = True
        for event in events:
            try:
                await backend.async_delete(event)
            except Exception:  # noqa: BLE001 - calendar providers can raise many things
                _LOGGER.warning("Termin %s in %s konnte nicht gelöscht werden", event.summary, backend.entity_id, exc_info=True)
                ok = False
        return ok

    async def _purge(self, entity_id: str, cc: str, record: dict[str, Any] | None) -> bool:
        """Remove all events of the container from a calendar. True if nothing is left to do."""
        backend = self._backend(entity_id)
        if backend is None:
            return False  # calendar not loaded (yet): keep the entry and try again later
        if not backend.can_delete:
            _LOGGER.warning("Kalender %s kann keine Termine löschen", entity_id)
            return True  # cannot be solved: do not keep the entry forever
        try:
            ours = self._ours(await backend.async_scan(), cc, record, entity_id)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Termine in %s konnten nicht gelesen werden", entity_id, exc_info=True)
            return False
        return await self._delete_events(backend, ours)

    async def async_sync(self, cc: str, *, verify: bool = False) -> None:
        """Sync a container's event with the chosen calendar (verify: check even if nothing changed)."""
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

        # another (or no) calendar chosen: remove the events from the old calendar
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
                # without deleting, every change would add another event: rather write nothing at all
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
        """Make sure there is exactly one matching event (or none if no date is set)."""
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
        """Find the event ID of the event just created (None if the calendar does not show it yet)."""
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
        """Sync all containers thoroughly, also those only left in the log (e.g. calendar changed)."""
        ccs = {e.data[CONF_CC] for e in self.hass.config_entries.async_entries(DOMAIN) if CONF_CC in e.data}
        async with self._lock:
            # read the calendar only once, not once per container (newly created events are added)
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
        """Clean up: sync all events again and remove leftovers that belong to no container any more.

        With include_unmarked, events without a marker are removed too if they are named like
        best-before events ("MHD: …" / "Best before: …") but can no longer be assigned to a container.
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
                    # without a marker the current event of a container cannot be recognised: delete all, create anew
                    for cc in ccs:
                        self._records.pop(cc, None)
                if await self._delete_events(backend, orphans):
                    removed = len(orphans)
        await self.async_sync_all()
        return {"removed": removed}

    async def async_remove_dose(self, cc: str) -> None:
        """A container was removed: delete its event."""
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
