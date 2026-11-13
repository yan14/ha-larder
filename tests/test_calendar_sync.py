"""Tests: MHD als Ganztags-Termin in einen vorhandenen Kalender schreiben."""

from datetime import date, datetime, timedelta

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.larder.const import DOMAIN
from homeassistant.components import calendar as ha_calendar
from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

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


class ForgetfulCalendar(FakeCalendar):
    """Kalender, der Beschreibungen verwirft (manche Anbieter tun das)."""

    async def async_create_event(self, **kwargs):
        kwargs.pop("description", None)
        await super().async_create_event(**kwargs)


def _stray(cal: FakeCalendar, day: date, summary: str, description: str | None, uid: str) -> None:
    cal.events.append(CalendarEvent(start=day, end=day + timedelta(days=1), summary=summary, description=description, uid=uid))


async def test_existing_duplicates_are_cleaned_up_and_only_one_stays(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    day = TODAY() + timedelta(days=5)
    # Altlasten: dieselbe Dose mehrfach, an verschiedenen Tagen (auch weit weg vom gemerkten Tag)
    for i, offset in enumerate((5, 5, 9, 40, 300)):
        _stray(cal, TODAY() + timedelta(days=offset), "Best before: Pizza", "Dose\n[zwilling:34OL]", f"alt-{i}")
    _stray(cal, day, "Zahnarzt", None, "fremd")
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", day)
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "Zahnarzt"]
    (pizza,) = [e for e in cal.events if e.summary.startswith("Best before")]
    assert pizza.start == day


async def test_event_far_from_the_remembered_day_is_still_moved(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    # Protokoll geht verloren (z. B. Speicher zurückgesetzt) und das MHD ändert sich
    hass.data[DOMAIN]["calendar_sync"]._records.clear()
    new_day = day + timedelta(days=90)
    await _set(hass, day=new_day)
    (event,) = cal.events
    assert event.start == new_day


async def test_calendar_that_drops_descriptions_does_not_duplicate(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = ForgetfulCalendar("calendar.mhd")
    assert await async_setup_component(hass, "calendar", {})
    await hass.data[ha_calendar.DATA_COMPONENT].async_add_entities([cal])
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    await _set(hass, day=day + timedelta(days=2))
    await _set(hass, day=day + timedelta(days=3))
    await _set(hass, content="Suppe")
    (event,) = cal.events
    assert event.summary == "Best before: Suppe" and event.start == day + timedelta(days=3)
    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    await _settle(hass)
    assert cal.events == []


async def test_emptying_the_container_deletes_the_event(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=5))
    assert len(cal.events) == 1
    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text"), "value": ""}, blocking=True)
    await _settle(hass)
    assert cal.events == []


async def test_unchanged_state_does_not_touch_the_calendar(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=5))
    uid = cal.events[0].uid
    # Attributwechsel (z. B. Kategorie) und erneutes Setzen desselben Werts: Termin bleibt derselbe
    entity_id = _eid(hass, "text")
    hass.states.async_set(entity_id, hass.states.get(entity_id).state, {"category": "andere"})
    await _settle(hass)
    await _set(hass, "Pizza")
    assert [e.uid for e in cal.events] == [uid]


async def test_unavailable_date_does_not_delete_the_event(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=5))
    sync = hass.data[DOMAIN]["calendar_sync"]
    hass.states.async_set(_eid(hass, "date"), "unavailable")
    await sync.async_sync("34OL", verify=True)
    assert len(cal.events) == 1


async def test_startup_sync_repairs_duplicates(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    _stray(cal, day, "Best before: Pizza", "x\n[zwilling:34OL]", "dup-1")
    _stray(cal, day + timedelta(days=3), "Best before: Pizza", "x\n[zwilling:34OL]", "dup-2")
    await hass.data[DOMAIN]["calendar_sync"]._started(hass)
    assert [e.start for e in cal.events] == [day]


async def test_rebuild_service_removes_orphans(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    cal = await _calendar(hass)
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    _stray(cal, day, "Best before: Nudeln", "x\n[zwilling:GONE]", "waise")  # Dose existiert nicht mehr
    _stray(cal, day, "MHD: Reste", None, "ohne-kennung")
    _stray(cal, day, "Zahnarzt", None, "fremd")
    await hass.services.async_call(DOMAIN, "rebuild_calendar", {}, blocking=True)
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "MHD: Reste", "Zahnarzt"]
    await hass.services.async_call(DOMAIN, "rebuild_calendar", {"include_unmarked": True}, blocking=True)
    assert sorted(e.summary for e in cal.events) == ["Best before: Pizza", "Zahnarzt"]


async def test_parallel_setup_creates_only_one_sync_instance(hass: HomeAssistant) -> None:
    """Home Assistant richtet alle Dosen gleichzeitig ein; es darf trotzdem nur einen Abgleich geben."""
    import asyncio
    from unittest.mock import patch

    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.larder.calendar_sync import async_get_calendar_sync
    from custom_components.larder.nfc import async_get_nfc
    from custom_components.larder.recipe_book import async_get_recipe_book
    from homeassistant.helpers.storage import Store

    async def slow_load(self):  # wie echtes Laden von der Platte: gibt die Kontrolle ab
        await asyncio.sleep(0)
        return None

    with patch.object(Store, "async_load", slow_load):
        for getter in (async_get_calendar_sync, async_get_nfc, async_get_recipe_book):
            instances = await asyncio.gather(*(getter(hass) for _ in range(5)))
            assert len({id(i) for i in instances}) == 1

    entries = []
    for cc in ("AAAA", "BBBB", "CCCC", "DDDD"):
        entry = MockConfigEntry(domain=DOMAIN, unique_id=cc, title=f"Dose {cc}", data={"cc": cc, "tc": None, "size": None})
        entry.add_to_hass(hass)
        entries.append(entry)
    assert all(await asyncio.gather(*(hass.config_entries.async_setup(e.entry_id) for e in entries)))
    await hass.async_block_till_done()
    cal = await _calendar(hass)
    await _choose_calendar(hass, entries[0], "calendar.mhd")
    await _set(hass, "Pizza", TODAY() + timedelta(days=5), "AAAA")
    assert len(cal.events) == 1


async def test_same_content_on_the_same_day_keeps_one_event_each_without_descriptions(hass: HomeAssistant) -> None:
    """Zwei Dosen mit gleichem Inhalt am gleichen Tag: jede behält ihren Termin (über die gemerkte Termin-ID)."""
    entry = await _setup(hass, "34OL")
    await _setup(hass, "56BR")
    cal = ForgetfulCalendar("calendar.mhd")
    assert await async_setup_component(hass, "calendar", {})
    await hass.data[ha_calendar.DATA_COMPONENT].async_add_entities([cal])
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Gekochte Eier", day, "34OL")
    await _set(hass, "Gekochte Eier", day, "56BR")
    assert [e.start for e in cal.events] == [day, day]
    records = hass.data[DOMAIN]["calendar_sync"]._records
    assert records["34OL"]["uid"] != records["56BR"]["uid"] and records["34OL"]["uid"]

    await _set(hass, day=day + timedelta(days=2), cc="34OL")  # nur die eine Dose wandert
    assert sorted(e.start for e in cal.events) == [day, day + timedelta(days=2)]
    await hass.data[DOMAIN]["calendar_sync"].async_sync_all()  # gründlicher Abgleich ändert nichts
    assert sorted(e.start for e in cal.events) == [day, day + timedelta(days=2)]

    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date", "56BR")}, blocking=True)
    await _settle(hass)
    assert [e.start for e in cal.events] == [day + timedelta(days=2)]


async def test_create_only_calendar_gets_no_events_at_all(hass: HomeAssistant) -> None:
    """Kann ein Kalender nicht löschen, entstünde bei jeder Änderung ein weiterer Termin: nichts schreiben."""
    entry = await _setup(hass)
    cal = await _calendar(hass, features=CalendarEntityFeature.CREATE_EVENT)
    await _choose_calendar(hass, entry, "calendar.mhd")
    day = TODAY() + timedelta(days=5)
    await _set(hass, "Pizza", day)
    await _set(hass, day=day + timedelta(days=1))
    assert cal.events == []
    assert hass.data[DOMAIN]["calendar_sync"].supports("calendar.mhd") is False


class _Val:
    def __init__(self, value):
        self.value = value


class FakeDavObject:
    """Termin, wie ihn die caldav-Bibliothek liefert (obj.instance.vevent, obj.delete())."""

    def __init__(self, store: list, uid: str, day: date, summary: str, description: str | None) -> None:
        from types import SimpleNamespace

        fields = {"uid": _Val(uid), "dtstart": _Val(day), "summary": _Val(summary)}
        if description is not None:
            fields["description"] = _Val(description)
        self.instance = SimpleNamespace(vevent=SimpleNamespace(**fields))
        self.day = day
        self._store = store

    def delete(self) -> None:
        self._store.remove(self)


class FakeCalDav(CalendarEntity):
    """Wie Home Assistants CalDAV-Kalender: kann nur anlegen, Termine ohne ID; Server hinter `coordinator.calendar`."""

    _attr_has_entity_name = False
    _attr_supported_features = CalendarEntityFeature.CREATE_EVENT

    def __init__(self, entity_id: str) -> None:
        from types import SimpleNamespace

        self.entity_id = entity_id
        self._attr_name = entity_id
        self.server: list[FakeDavObject] = []
        self.refreshed = 0

        def search(start, end, event, expand):
            assert event and not expand
            return [o for o in self.server if start <= dt_util.start_of_local_day(o.day) < end]

        async def refresh():
            self.refreshed += 1

        self.coordinator = SimpleNamespace(calendar=SimpleNamespace(search=search), async_request_refresh=refresh)

    @property
    def event(self):
        return None

    async def async_get_events(self, hass, start_date, end_date):
        return [
            CalendarEvent(start=o.day, end=o.day + timedelta(days=1), summary=o.instance.vevent.summary.value)
            for o in self.server
        ]

    async def async_create_event(self, **kwargs):
        self.server.append(
            FakeDavObject(self.server, f"dav-{len(self.server)}-{kwargs['summary']}-{kwargs['dtstart']}", kwargs["dtstart"], kwargs["summary"], kwargs.get("description"))
        )


async def test_caldav_calendar_moves_and_deletes_via_the_server(hass: HomeAssistant, monkeypatch) -> None:
    from types import SimpleNamespace

    from custom_components.larder.calendar_sync import CalDavBackend

    # Erkennung: Plattform "caldav" mit offener Verbindung
    assert CalDavBackend.matches(SimpleNamespace(platform=SimpleNamespace(platform_name="caldav"), coordinator=SimpleNamespace(calendar=SimpleNamespace(search=print))))
    assert not CalDavBackend.matches(SimpleNamespace(platform=SimpleNamespace(platform_name="google"), coordinator=None))
    monkeypatch.setattr(CalDavBackend, "matches", staticmethod(lambda entity: isinstance(entity, FakeCalDav)))

    entry = await _setup(hass)
    assert await async_setup_component(hass, "calendar", {})
    cal = FakeCalDav("calendar.muell")
    await hass.data[ha_calendar.DATA_COMPONENT].async_add_entities([cal])
    day = TODAY() + timedelta(days=5)
    # Altlasten wie im echten Kalender: viele gleiche Termine, über mehrere Tage verteilt, plus ein fremder
    for i, offset in enumerate((5, 5, 5, 7, 9, 12)):
        cal.server.append(FakeDavObject(cal.server, f"alt-{i}", TODAY() + timedelta(days=offset), "Best before: Gekochte Eier", "Dose\n[zwilling:34OL]"))
    cal.server.append(FakeDavObject(cal.server, "fremd", day, "Restmüll", None))

    await _choose_calendar(hass, entry, "calendar.muell")
    assert hass.data[DOMAIN]["calendar_sync"].supports("calendar.muell") is True
    await _set(hass, "Gekochte Eier", day)
    summaries = lambda: sorted((o.instance.vevent.summary.value, o.day) for o in cal.server)  # noqa: E731
    assert summaries() == [("Best before: Gekochte Eier", day), ("Restmüll", day)]

    await _set(hass, day=day + timedelta(days=3))  # verschieben
    assert summaries() == [("Best before: Gekochte Eier", day + timedelta(days=3)), ("Restmüll", day)]

    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)  # leeren
    await _settle(hass)
    assert summaries() == [("Restmüll", day)]
    assert cal.refreshed > 0
