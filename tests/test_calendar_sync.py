"""Tests: MHD als Ganztags-Termin in einen vorhandenen Kalender schreiben."""

from datetime import date, datetime, timedelta

import pytest
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant.components import calendar as ha_calendar
from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from custom_components.zwilling_storage.const import DOMAIN

from .test_ai_estimate import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


class FakeCalendar(CalendarEntity):
    """Einfacher beschreibbarer Kalender im Speicher."""

    _attr_has_entity_name = False

    def __init__(self, entity_id: str, features=CalendarEntityFeature.CREATE_EVENT | CalendarEntityFeature.DELETE_EVENT):
        self.entity_id = entity_id
        self._attr_name = entity_id
        self._attr_supported_features = features
        self.events: list[CalendarEvent] = []
        self._n = 0

    @property
    def event(self):
        return None

    async def async_get_events(self, hass, start_date, end_date):
        out = []
        for ev in self.events:
            start = dt_util.start_of_local_day(ev.start) if not isinstance(ev.start, datetime) else ev.start
            if start_date <= start < end_date:
                out.append(ev)
        return out

    async def async_create_event(self, **kwargs):
        self._n += 1
        self.events.append(
            CalendarEvent(
                start=kwargs["dtstart"],
                end=kwargs["dtend"],
                summary=kwargs["summary"],
                description=kwargs.get("description"),
                uid=f"uid-{self._n}",
            )
        )

    async def async_delete_event(self, uid, recurrence_id=None, recurrence_range=None):
        self.events = [e for e in self.events if e.uid != uid]


async def _calendar(hass: HomeAssistant, entity_id="calendar.mhd", **kwargs) -> FakeCalendar:
    assert await async_setup_component(hass, "calendar", {})
    cal = FakeCalendar(entity_id, **kwargs)
    await hass.data[ha_calendar.DATA_COMPONENT].async_add_entities([cal])
    return cal


async def _choose_calendar(hass: HomeAssistant, entry, entity_id: str | None) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    data = {"estimate_mode": "table"}
    if entity_id:
        data["calendar_entity"] = entity_id
    await hass.config_entries.options.async_configure(result["flow_id"], data)
    await hass.async_block_till_done()


async def _settle(hass: HomeAssistant) -> None:
    """Entprellzeit verstreichen lassen und alles abarbeiten."""
    await hass.async_block_till_done()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=30))
    await hass.async_block_till_done()


async def _set(hass: HomeAssistant, content=None, day: date | None = None, cc="34OL") -> None:
    if content is not None:
        await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": content}, blocking=True)
    if day is not None:
        await hass.services.async_call("date", "set_value", {"entity_id": _eid(hass, "date", cc), "date": day.isoformat()}, blocking=True)
    await _settle(hass)


TODAY = lambda: dt_util.now().date()  # noqa: E731


async def test_event_is_created_moved_renamed_and_deleted(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    assert cal.events == []  # ohne MHD kein Termin

    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    (event,) = cal.events
    assert event.summary == "Best before: Pizza"  # Test-HA ist englisch
    assert (event.start, event.end) == (day, day + timedelta(days=1))
    assert "[zwilling:34OL]" in event.description and "Dose 34OL" in event.description

    # Datum geändert: ein Termin, am neuen Tag
    new_day = day + timedelta(days=2)
    await _set(hass, day=new_day)
    (event,) = cal.events
    assert event.start == new_day

    # Inhalt geändert: Titel folgt
    await _set(hass, content="Suppe")
    (event,) = cal.events
    assert event.summary == "Best before: Suppe"

    # MHD gelöscht: Termin weg
    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    await _settle(hass)
    assert cal.events == []


async def test_foreign_events_are_never_touched(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    day = TODAY() + timedelta(days=3)
    cal.events.append(CalendarEvent(start=day, end=day + timedelta(days=1), summary="Zahnarzt", uid="fremd"))
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", day)
    await _set(hass, day=day + timedelta(days=1))
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "Zahnarzt"]
    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    await _settle(hass)
    assert [e.summary for e in cal.events] == ["Zahnarzt"]


async def test_changing_or_clearing_the_calendar_moves_events(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    first = await _calendar(hass, "calendar.eins")
    second = FakeCalendar("calendar.zwei")
    await hass.data[ha_calendar.DATA_COMPONENT].async_add_entities([second])
    await _choose_calendar(hass, entry, "calendar.eins")
    await _set(hass, "Pizza", TODAY() + timedelta(days=4))
    assert len(first.events) == 1

    await _choose_calendar(hass, entry, "calendar.zwei")
    assert first.events == [] and len(second.events) == 1

    await _choose_calendar(hass, entry, None)
    assert second.events == []


async def test_removing_the_container_removes_the_event(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=4))
    assert len(cal.events) == 1
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert cal.events == []


async def test_two_containers_get_separate_events(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "34OL")
    await _setup(hass, "56BR")
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=2)
    await _set(hass, "Pizza", day, "34OL")
    await _set(hass, "Suppe", day, "56BR")
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "Best before: Suppe"]
    await _set(hass, day=day + timedelta(days=1), cc="34OL")
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "Best before: Suppe"]
    assert {e.summary: e.start for e in cal.events}["Best before: Suppe"] == day


async def test_read_only_calendar_is_ignored_gracefully(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass, features=CalendarEntityFeature(0))
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=4))
    assert cal.events == []
    assert hass.states.get(_eid(hass, "date")).state != "unknown"  # Dose funktioniert weiter


async def test_without_calendar_nothing_happens(hass: HomeAssistant) -> None:
    await _setup(hass)
    cal = await _calendar(hass)
    await _set(hass, "Pizza", TODAY() + timedelta(days=4))
    assert cal.events == []
