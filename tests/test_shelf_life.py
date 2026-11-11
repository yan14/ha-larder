"""Tests: eingebaute Haltbarkeits-Tabelle und die Modi Tabelle / Tabelle+KI / KI."""

from datetime import timedelta

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, label_registry as lr
from homeassistant.util import dt as dt_util

from custom_components.larder import shelf_life as sl
from custom_components.larder.const import DOMAIN

from .test_ai_estimate import (  # noqa: F401 - Fixture und Helfer wiederverwenden
    _eid,
    _estimate,
    _fake_ai,
    _set_mode,
    _setup,
    auto_enable_custom_integrations,
)

# ---------- Zuordnung Inhalt → Eintrag ----------


@pytest.mark.parametrize(
    ("content", "entry_id"),
    [
        ("Tomatensuppe", "soup"),
        ("Hähnchen-Curry", "dish"),
        ("Hähnchenbrust roh", "poultry"),
        ("Hackfleisch", "ground_meat"),
        ("Kaffeebohnen", "coffee"),
        ("Gemahlener Kaffee", "coffee_ground"),
        ("Penne", "pasta"),
        ("Basmati Reis", "rice"),
        ("Vollkornreis", "brown_rice"),
        ("Parmesan", "hard_cheese"),
        ("Kartoffelsalat", "salad_dish"),
        ("Rührei", "egg_cooked"),
        ("Gekochte Eier", "egg_boiled"),
        ("Eier", "egg"),
        ("Käsekuchen", "cake"),
        ("Spaghetti Bolognese", "dish"),
        ("Haferflocken", "cereal"),
        ("leftover chicken curry", "dish"),
        ("MILCH", "milk"),
    ],
)
def test_content_matches_entry(content: str, entry_id: str) -> None:
    entry = sl.find_entry(content)
    assert entry is not None and entry.id == entry_id


@pytest.mark.parametrize("content", ["Kreis", "xyzzy", "", "   "])
def test_unknown_content_has_no_entry(content: str) -> None:
    assert sl.find_entry(content) is None


def test_every_entry_is_well_formed() -> None:
    ids = [e.id for e in sl.ENTRIES]
    assert len(ids) == len(set(ids))
    for entry in sl.ENTRIES:
        assert entry.cat in sl.TIPS
        assert set(entry.days) == {sl.FRIDGE, sl.ZERO, sl.FREEZER, sl.PANTRY}
        assert all(d is None or d > 0 for d in entry.days.values())
        assert entry.keywords and all(entry.keywords)
        # 0-Grad-Fach hält mindestens so lange wie der Kühlschrank, Gefrierschrank länger (wo erlaubt)
        fridge, zero, freezer = (entry.days[k] for k in (sl.FRIDGE, sl.ZERO, sl.FREEZER))
        if fridge and zero:
            assert zero >= fridge, entry.id
        if fridge and freezer:
            assert freezer >= fridge, entry.id


# ---------- Lagerort ----------


@pytest.mark.parametrize(
    ("area", "temp", "labels", "expected"),
    [
        ("Kühlschrank", None, (), (sl.FRIDGE, 1.0)),
        ("0 Grad Fach", None, (), (sl.ZERO, 1.0)),
        ("Gefrierschrank", None, (), (sl.FREEZER, 1.0)),
        ("Gefrierfach", None, (), (sl.FREEZER, 0.5)),
        ("Vorratsschrank", None, (), (sl.PANTRY, 1.0)),
        ("Speisekammer", None, (), (sl.PANTRY, 1.0)),
        ("Fridge", None, (), (sl.FRIDGE, 1.0)),
        ("Irgendwo", 4.2, (), (sl.FRIDGE, 1.0)),  # Sensor schlägt Name
        ("Kühlschrank", -18.0, (), (sl.FREEZER, 1.0)),
        ("Irgendwo", -10.0, (), (sl.FREEZER, 0.5)),
        ("Irgendwo", 0.5, (), (sl.ZERO, 1.0)),
        ("Irgendwo", 21.0, (), (sl.PANTRY, 1.0)),
        ("Irgendwo", None, ("Temperatur: ca. -18 °C",), (sl.FREEZER, 1.0)),
        ("Irgendwo", None, ("Kühl: 5 Grad",), (sl.FRIDGE, 1.0)),
    ],
)
def test_classify_storage(area, temp, labels, expected) -> None:
    storage = sl.classify_storage(area, temp, labels)
    assert storage is not None
    assert (storage.key, storage.factor) == expected


def test_classify_storage_unknown() -> None:
    assert sl.classify_storage("Irgendwo", None, ()) is None
    assert sl.classify_storage(None, None, ()) is None


# ---------- Berechnung ----------


def _lookup(content, area="Kühlschrank", *, vacuum=False, temp=None, labels=(), language="de"):
    return sl.lookup(
        content, area_name=area, temperature_c=temp, label_texts=labels, vacuum=vacuum, language=language
    )


def test_lookup_basic_values_and_texts() -> None:
    result = _lookup("Tomatensuppe")
    assert result.days == 3
    assert "Kühlschrank" in result.basis and "Suppe" in result.basis
    assert _lookup("Tomatensuppe", language="en").basis == "Soup / broth / sauce · fridge"


def test_vacuum_extends_non_perishables_but_not_perishables_in_fridge() -> None:
    assert _lookup("Parmesan").days == 28
    assert _lookup("Parmesan", vacuum=True).days == round(28 * 1.3)
    # Leicht verderblich im Kühlschrank: Vakuum ändert nichts, sagt das aber im Tipp
    plain, vac = _lookup("Hackfleisch"), _lookup("Hackfleisch", vacuum=True)
    assert plain.days == vac.days == 1
    assert "Vakuum" in vac.tip and "Vakuum" not in plain.tip
    # Im Gefrierschrank hilft Vakuum immer
    assert _lookup("Hackfleisch", "Gefrierschrank", vacuum=True).days == round(90 * 1.5)


def test_freezer_compartment_is_less_cold() -> None:
    assert _lookup("Hackfleisch", "Gefrierschrank").days == 90
    assert _lookup("Hackfleisch", "Gefrierfach").days == 45


def test_pantry_dry_goods() -> None:
    assert _lookup("Nudeln", "Vorrat").days == 365
    assert _lookup("Kaffeebohnen", "Vorrat", vacuum=True).days == 45


def test_minimum_one_day() -> None:
    assert _lookup("Hackfleisch", "Gefrierfach").days >= 1


def test_no_match_unknown_storage_and_unsuitable() -> None:
    with pytest.raises(sl.TableNoMatch):
        _lookup("xyzzy")
    with pytest.raises(sl.TableUnknownStorage):
        _lookup("Suppe", "Irgendwo")
    with pytest.raises(sl.TableUnsuitable) as exc:
        _lookup("Salat", "Gefrierschrank")
    assert exc.value.place == "Gefrierschrank"
    with pytest.raises(sl.TableUnsuitable):
        _lookup("Fleisch", "Vorrat")  # roh bei Raumtemperatur: nie


# ---------- Modi in der Integration ----------


async def _prepare(hass: HomeAssistant, content: str, area: str | None, mode: str | None):
    entry = await _setup(hass)
    calls = _fake_ai(hass)
    if mode:
        await _set_mode(hass, entry, mode)
    if area:
        area_entry = ar.async_get(hass).async_get_or_create(area)
        device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
        dr.async_get(hass).async_update_device(device.id, area_id=area_entry.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": content}, blocking=True
    )
    return entry, calls


async def test_default_mode_is_table_without_ai(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, "Tomatensuppe", "Kühlschrank", None)
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["status"] == "estimated" and out["days"] == 3
    assert out["source"] == "table" and "Soup" in out["basis"] and out["tip"]
    expected = (dt_util.now().date() + timedelta(days=3)).isoformat()
    assert hass.states.get(_eid(hass, "date")).state == expected
    assert calls == []


async def test_table_result_respects_vacuum_switch(hass: HomeAssistant) -> None:
    _, _ = await _prepare(hass, "Parmesan", "Kühlschrank", None)
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == round(28 * 1.3)  # Vakuum ist standardmäßig an
    await hass.services.async_call("switch", "turn_off", {"entity_id": _eid(hass, "switch")}, blocking=True)
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 28


async def test_table_uses_area_temperature_sensor_and_label(hass: HomeAssistant) -> None:
    _, _ = await _prepare(hass, "Hackfleisch", "Fach A", None)
    area = ar.async_get(hass).async_get_area_by_name("Fach A")
    hass.states.async_set("sensor.fach_temp", "-19", {"device_class": "temperature", "unit_of_measurement": "°C"})
    ar.async_get(hass).async_update(area.id, temperature_entity_id="sensor.fach_temp")
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    await hass.services.async_call("switch", "turn_off", {"entity_id": _eid(hass, "switch")}, blocking=True)
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["days"] == 90  # Sensor sagt: Gefrierschrank

    labels = lr.async_get(hass)
    label = labels.async_create("Kühl", description="ca. 5 °C")
    ar.async_get(hass).async_update(area.id, temperature_entity_id=None, labels={label.label_id})
    hass.states.async_remove("sensor.fach_temp")
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Wurst"}, blocking=True
    )
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 4  # Label sagt: Kühlschrank (Wurst)


@pytest.mark.parametrize(
    ("content", "area", "message"),
    [
        ("xyzzy", "Kühlschrank", "table|Tabelle"),
        ("Suppe", "Irgendwo", "Irgendwo"),
        ("Salat", "Gefrierschrank", "Salat|Lettuce|Salad"),
    ],
)
async def test_table_only_errors_never_call_ai(hass: HomeAssistant, content, area, message) -> None:
    _, calls = await _prepare(hass, content, area, "table")
    with pytest.raises(HomeAssistantError, match=message):
        await _estimate(hass)
    assert calls == []
    assert hass.states.get(_eid(hass, "date")).state == "unknown"


async def test_table_then_ai_falls_back_only_when_table_has_no_answer(hass: HomeAssistant) -> None:
    entry, calls = await _prepare(hass, "Tomatensuppe", "Kühlschrank", "table_ai")
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["source"] == "table" and calls == []

    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Omas Geheimrezept"}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["source"] == "ai" and out["days"] == 4 and len(calls) == 1

    # unbekannter Lagerort → ebenfalls KI
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    area = ar.async_get(hass).async_get_or_create("Irgendwo")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Tomatensuppe"}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["source"] == "ai" and len(calls) == 2


async def test_unsuitable_storage_is_never_sent_to_ai(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, "Salat", "Gefrierschrank", "table_ai")
    with pytest.raises(HomeAssistantError):
        await _estimate(hass)
    assert calls == []


async def test_ai_mode_ignores_table(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, "Tomatensuppe", "Kühlschrank", "ai")
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["source"] == "ai" and out["days"] == 4 and len(calls) == 1


async def test_corrected_value_beats_table_and_is_remembered(hass: HomeAssistant) -> None:
    await _prepare(hass, "Tomatensuppe", "Kühlschrank", None)
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["days"] == 3
    base = dt_util.now().date()
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": (base + timedelta(days=6)).isoformat()}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert out["days"] == 6 and out["cached"] is True and out["source"] == "learned"


async def test_legacy_ai_enabled_setting_migrates(hass: HomeAssistant) -> None:
    from custom_components.larder.estimate import Estimator

    for legacy, expected in (({"ai_enabled": True}, "ai"), ({"ai_enabled": False}, "table"), ({}, "table")):
        estimator = Estimator(hass)

        async def load(legacy=legacy):
            return {"settings": legacy, "cache": {}}

        estimator._store.async_load = load
        await estimator.async_load()
        assert estimator.mode == expected


# ---------- Herkunft korrigierter Werte und Verwaltung der gemerkten Einträge ----------


async def _set_date(hass: HomeAssistant, days: int) -> None:
    value = (dt_util.now().date() + timedelta(days=days)).isoformat()
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": value}, blocking=True
    )


@pytest.mark.parametrize(("mode", "origin"), [(None, "table"), ("ai", "ai")])
async def test_corrected_value_remembers_its_origin(hass: HomeAssistant, mode, origin) -> None:
    await _prepare(hass, "Tomatensuppe", "Kühlschrank", mode)
    await _estimate(hass)
    await _set_date(hass, 9)
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert (out["source"], out["origin"], out["days"]) == ("learned", origin, 9)

    # nochmal korrigieren: Ursprung bleibt erhalten
    await _set_date(hass, 10)
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert (out["source"], out["origin"], out["days"]) == ("learned", origin, 10)


async def _ws(hass: HomeAssistant, hass_ws_client, payload: dict):
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, **payload})
    return await client.receive_json()


async def test_ws_list_edit_delete_and_add(hass: HomeAssistant, hass_ws_client) -> None:
    await _prepare(hass, "Tomatensuppe", "Kühlschrank", None)
    await _estimate(hass)

    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/estimates"})
    assert res["success"] and res["result"]["mode"] == "table"
    (entry,) = res["result"]["entries"]
    assert entry["content"] == "Tomatensuppe" and entry["area"] == "Kühlschrank"
    assert (entry["vacuum"], entry["days"], entry["source"], entry["origin"]) == (True, 3, "table", None)
    key = entry["key"]

    # Ändern → "von dir", Ursprung Tabelle bleibt sichtbar
    res = await _ws(
        hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_set", "key": key, "days": 5, "tip": "Mein Tipp"}
    )
    (entry,) = res["result"]["entries"]
    assert (entry["days"], entry["tip"], entry["source"], entry["origin"]) == (5, "Mein Tipp", "learned", "table")
    assert entry["content"] == "Tomatensuppe"  # Schreibweise bleibt erhalten
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    assert (await _estimate(hass))[_eid(hass, "date")]["days"] == 5

    # Hinzufügen
    res = await _ws(
        hass,
        hass_ws_client,
        {"type": f"{DOMAIN}/estimate_add", "content": " Lasagne ", "area": "Keller", "vacuum": False, "days": 2},
    )
    entries = res["result"]["entries"]
    assert [e["content"] for e in entries] == ["Lasagne", "Tomatensuppe"]
    assert entries[0]["source"] == "learned" and entries[0]["origin"] is None

    # Löschen → beim nächsten Schätzen wieder Tabelle
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_delete", "key": key})
    assert [e["content"] for e in res["result"]["entries"]] == ["Lasagne"]
    await hass.services.async_call(
        DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True
    )
    out = (await _estimate(hass))[_eid(hass, "date")]
    assert (out["source"], out["days"]) == ("table", 3)


async def test_ws_errors(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_delete", "key": "gibt|es|nicht"})
    assert not res["success"] and res["error"]["code"] == "estimate_error"
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_set", "key": "x|y|normal", "days": 3})
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_set", "key": "x|y|normal", "days": 0})
    assert not res["success"]  # Schema: mindestens 1
    res = await _ws(
        hass, hass_ws_client, {"type": f"{DOMAIN}/estimate_add", "content": "  ", "area": "Keller", "days": 3}
    )
    assert not res["success"] and res["error"]["code"] == "estimate_error"


async def test_ws_requires_admin(hass: HomeAssistant, hass_ws_client, hass_admin_user) -> None:
    await _setup(hass)
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/estimates"})
    res = await client.receive_json()
    assert not res["success"] and res["error"]["code"] == "unauthorized"


# ---------- Ablauf-Übersicht, Sensor, Blueprint ----------

from pathlib import Path  # noqa: E402

from custom_components.larder.expiry import build_summary, status_for  # noqa: E402


def test_status_for() -> None:
    assert [status_for(x) for x in (None, -1, 0, 3, 4)] == ["none", "expired", "soon", "soon", "ok"]


def test_build_summary_in_both_languages() -> None:
    items = [
        {"content": "Pizza", "name": "Dose A", "area": "Kühlschrank", "days_left": -2, "status": "expired"},
        {"content": "", "name": "Dose B", "area": None, "days_left": 0, "status": "soon"},
        {"content": "Suppe", "name": "C", "area": "Keller", "days_left": 1, "status": "soon"},
    ]
    de = build_summary(items, "de")
    assert de.splitlines()[0] == "1 abgelaufen, 2 laufen bald ab:"
    assert "• Pizza (Kühlschrank): seit 2 Tagen abgelaufen" in de
    assert "• Dose B: heute" in de and "• Suppe (Keller): morgen" in de
    en = build_summary(items, "en-GB")
    assert en.splitlines()[0] == "1 expired, 2 expiring soon:"
    assert "expired 2 days ago" in en and "tomorrow" in en
    assert build_summary([], "de") == "Nichts läuft bald ab."


async def _fill(hass: HomeAssistant, cc: str, content: str, days: int | None, area: str | None = None) -> None:
    def eid(domain):
        return _eid(hass, domain, cc)

    await hass.services.async_call("text", "set_value", {"entity_id": eid("text"), "value": content}, blocking=True)
    if days is not None:
        value = (dt_util.now().date() + timedelta(days=days)).isoformat()
        await hass.services.async_call("date", "set_value", {"entity_id": eid("date"), "date": value}, blocking=True)
    if area:
        area_entry = ar.async_get(hass).async_get_or_create(area)
        device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
        dr.async_get(hass).async_update_device(device.id, area_id=area_entry.id)


async def test_days_left_sensor_follows_date(hass: HomeAssistant) -> None:
    await _setup(hass)
    sensor = _eid(hass, "sensor")
    assert hass.states.get(sensor).state == "unknown"
    await _fill(hass, "34OL", "Pizza", 2)
    await hass.async_block_till_done()
    state = hass.states.get(sensor)
    assert state.state == "2" and state.attributes["status"] == "soon"
    assert state.attributes["unit_of_measurement"] == "d"
    await _fill(hass, "34OL", "Pizza", -1)
    await hass.async_block_till_done()
    assert hass.states.get(sensor).state == "-1"
    assert hass.states.get(sensor).attributes["status"] == "expired"
    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(sensor).state == "unknown"
    assert hass.states.get(sensor).attributes["status"] == "none"


async def test_get_expiring_service(hass: HomeAssistant) -> None:
    await _setup(hass, "34OL")
    await _setup(hass, "56BR")
    await _setup(hass, "56IN")
    await _fill(hass, "34OL", "Pizza", 1, "Kühlschrank")
    await _fill(hass, "56BR", "Schinken", 9, "0 Grad Fach")
    await _fill(hass, "56IN", "Suppe", -2)
    await hass.async_block_till_done()

    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert out["count"] == 2 and out["expired"] == 1
    assert [i["content"] for i in out["items"]] == ["Suppe", "Pizza"]  # früheste zuerst
    assert out["items"][1]["area"] == "Kühlschrank" and out["items"][1]["days_left"] == 1
    assert "Pizza" in out["summary"] and "Schinken" not in out["summary"]

    out = await hass.services.async_call(
        DOMAIN, "get_expiring", {"days": 10, "include_expired": False}, blocking=True, return_response=True
    )
    assert [i["content"] for i in out["items"]] == ["Pizza", "Schinken"]

    out = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 0, "include_expired": False}, blocking=True, return_response=True)
    assert out["count"] == 0 and out["summary"] == "Nothing expires soon."  # Test-HA ist englisch


def test_blueprint_is_valid() -> None:
    from homeassistant.components.blueprint.models import Blueprint
    from homeassistant.util.yaml import load_yaml

    path = Path(__file__).parent.parent / "blueprints/automation/larder/expiry_notification.yaml"
    blueprint = Blueprint(load_yaml(path), schema=__import__("homeassistant.components.automation.config", fromlist=["x"]).AUTOMATION_BLUEPRINT_SCHEMA)
    assert blueprint.domain == "automation"
    assert set(blueprint.inputs) >= {"notify_action", "send_time", "days", "include_expired", "title"}


async def test_mark_opened_shortens_or_sets(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    date_id = _eid(hass, "date")
    today = dt_util.now().date()
    # ohne MHD: wird gesetzt (Standard 3 Tage)
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=3)).isoformat() and out["shortened"] is True
    # längeres MHD wird gekürzt, kürzeres bleibt
    await _fill(hass, "34OL", "Käse", 20)
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=3)).isoformat()
    await _fill(hass, "34OL", "Käse", 1)
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id, "days": 5}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=1)).isoformat() and out["shortened"] is False

    # Einstellung "Tage nach dem Öffnen"
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"estimate_mode": "table", "opened_days": 7})
    await _fill(hass, "34OL", "Käse", 30)
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=7)).isoformat()


async def test_mark_thawed_shortens_and_uses_its_own_setting(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    date_id = _eid(hass, "date")
    today = dt_util.now().date()
    await _fill(hass, "34OL", "Chili", 90)  # eingefroren
    out = (await hass.services.async_call(DOMAIN, "mark_thawed", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=2)).isoformat() and out["shortened"] is True
    # nie verlängern
    await _fill(hass, "34OL", "Chili", 1)
    out = (await hass.services.async_call(DOMAIN, "mark_thawed", {"entity_id": date_id, "days": 4}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=1)).isoformat() and out["shortened"] is False
    # Einstellung "Tage nach dem Auftauen" (unabhängig von "nach dem Öffnen")
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"estimate_mode": "table", "thawed_days": 4})
    await _fill(hass, "34OL", "Chili", 90)
    out = (await hass.services.async_call(DOMAIN, "mark_thawed", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=4)).isoformat()
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=3)).isoformat()


async def test_portions_entity_defaults_to_zero_and_is_reset_by_emptying(hass: HomeAssistant) -> None:
    await _setup(hass)
    portions = _eid(hass, "number")
    assert float(hass.states.get(portions).state) == 0
    await hass.services.async_call("number", "set_value", {"entity_id": portions, "value": 4}, blocking=True)
    assert float(hass.states.get(portions).state) == 4
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    assert float(hass.states.get(portions).state) == 0


async def test_unit_select_defaults_to_portions_and_is_reset_by_emptying(hass: HomeAssistant) -> None:
    await _setup(hass)
    unit = _eid(hass, "select")
    assert hass.states.get(unit).state == "portions"
    await hass.services.async_call("select", "select_option", {"entity_id": unit, "option": "slices"}, blocking=True)
    assert hass.states.get(unit).state == "slices"
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    assert hass.states.get(unit).state == "portions"


async def test_get_expiring_reports_quantity_and_unit(hass: HomeAssistant) -> None:
    await _setup(hass)
    await _fill(hass, "34OL", "Schinken", 1)
    plain = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert plain["items"][0]["quantity"] is None and plain["items"][0]["unit"] is None
    assert "Portion" not in plain["summary"] and "Scheibe" not in plain["summary"]
    await hass.services.async_call("number", "set_value", {"entity_id": _eid(hass, "number"), "value": 5}, blocking=True)
    await hass.services.async_call("select", "select_option", {"entity_id": _eid(hass, "select"), "option": "slices"}, blocking=True)
    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert (out["items"][0]["quantity"], out["items"][0]["unit"]) == (5, "slices")
    assert "(5 Scheiben" in out["summary"] or "(5 slices" in out["summary"]
    await hass.services.async_call("select", "select_option", {"entity_id": _eid(hass, "select"), "option": "grams"}, blocking=True)
    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert "(500 g" not in out["summary"] and "(5 g" in out["summary"]


async def test_content_suggestions_recent_first_and_non_admin(
    hass: HomeAssistant, hass_ws_client, hass_admin_user
) -> None:
    await _setup(hass)
    text = _eid(hass, "text")
    for value in ("Pizza", "Suppe", "pizza", ""):
        await hass.services.async_call(
            "text", "set_value", {"entity_id": text, "value": value}, blocking=True
        )
    # Auch ein nicht-Admin darf die Vorschläge lesen
    hass_admin_user.groups = []
    hass_admin_user.is_admin = False
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/contents"})
    assert res["success"]
    assert res["result"]["contents"] == ["pizza", "Suppe"]



# ---------- Vorlage für die Beschreibung eines Bereichs-Labels ----------


def test_label_template_is_parsed_in_english_and_german() -> None:
    text = "Storage: freezer\nTemperature: -18 °C\nMax storage: 18 months\nNotes: meat and fish\nirgendein freier Text"
    assert sl.parse_label_template(text) == {
        "storage": "freezer",
        "temperature": "-18 °C",
        "max_storage": "18 months",
        "notes": "meat and fish",
    }
    assert sl.parse_label_template("Lagerort: Vorrat; Max. Lagerzeit: 3 Jahre") == {"storage": "Vorrat", "max_storage": "3 Jahre"}
    assert sl.parse_label_template("MAX   STORAGE : 6 weeks") == {"max_storage": "6 weeks"}
    assert sl.parse_label_template(None) == {} and sl.parse_label_template("ca. -18 °C, Fleisch") == {}
    # Das Beschreibungsfeld eines Labels ist einzeilig: alles in einer Zeile
    one_line = "Storage: freezer Temperature: -18 °C Max storage: 18 months Notes: meat and fish"
    assert sl.parse_label_template(one_line) == {
        "storage": "freezer",
        "temperature": "-18 °C",
        "max_storage": "18 months",
        "notes": "meat and fish",
    }
    assert sl.parse_label_template("Max. Lagerzeit: 3 Jahre, Hinweis: Truhe") == {"max_storage": "3 Jahre", "notes": "Truhe"}
    assert sl.parse_label_template("Max storage time: 1 year") == {"max_storage": "1 year"}


@pytest.mark.parametrize(
    ("text", "days"),
    [
        ("3 years", 1095), ("3 Jahre", 1095), ("1 year", 365), ("18 months", 540), ("18 Monate", 540),
        ("6 weeks", 42), ("2 Wochen", 14), ("90 days", 90), ("90", 90), ("10 Tage", 10), ("1,5 Jahre", 548),
        ("bald", None), ("", None), (None, None), ("3 lightyears", None), ("0 days", None),
    ],
)
def test_parse_duration(text, days) -> None:
    assert sl.parse_duration(text) == days


def test_format_duration() -> None:
    assert sl.format_duration(1095, "de") == "3 Jahre"
    assert sl.format_duration(365, "en") == "1 year"
    assert sl.format_duration(540, "de") == "18 Monate"
    assert sl.format_duration(42, "en") == "6 weeks"
    assert sl.format_duration(10, "de") == "10 Tage"


def test_storage_from_the_template_beats_the_area_name() -> None:
    assert sl.classify_storage("Keller", None, (), "freezer").key == sl.FREEZER
    assert sl.classify_storage("Keller", None, (), "-18 °C").key == sl.FREEZER
    assert sl.classify_storage("Keller", None, (), "unbekannt").key == sl.PANTRY  # Name als Rückfall
    assert sl.classify_storage("Keller", 5.0, (), "freezer").key == sl.FRIDGE  # Sensor gewinnt


async def _label_area(hass: HomeAssistant, description: str) -> None:
    label = lr.async_get(hass).async_create("Larder", description=description)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    area_id = dr.async_get(hass).async_get(device.id).area_id
    ar.async_get(hass).async_update(area_id, labels={label.label_id})


async def test_max_storage_from_the_label_caps_table_values(hass: HomeAssistant) -> None:
    await _prepare(hass, "Reis", "Vorratsschrank", None)
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    uncapped = out["days"]
    assert uncapped > 60

    await _label_area(hass, "Storage: pantry\nMax storage: 2 months")
    # gemerkter Tabellenwert wird beim Lesen begrenzt
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 60 and "max storage time (2 months)" in out["tip"]

    # eigene Korrektur bleibt unangetastet
    estimator = hass.data[DOMAIN]["estimator"]
    (key,) = estimator._cache
    estimator.learn(key, 200)
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 200

    # neu berechneter Tabellenwert wird ebenfalls begrenzt
    await estimator.async_delete_entry(key)
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 60 and estimator._cache[key]["days"] == 60


async def test_storage_line_of_the_label_lets_the_table_place_an_unknown_area(hass: HomeAssistant) -> None:
    await _prepare(hass, "Tomatensuppe", "Garage", None)
    with pytest.raises(HomeAssistantError):
        await _estimate(hass, overwrite=True, apply=False)
    await _label_area(hass, "Storage: fridge")
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 3 and out["basis"].endswith("· fridge")


async def test_max_storage_from_the_label_caps_ai_values_and_is_in_the_prompt(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, "Wildschwein-Ragout", "Gefrierschrank", "ai")
    await _label_area(hass, "Max storage: 6 months; Notes: Truhe im Keller")
    hass.services.async_remove("ai_task", "generate_data")
    calls = _fake_ai(hass, data={"shelf_life_days": 365, "storage_tip": "Gut einfrieren."})
    out = (await _estimate(hass, overwrite=True, apply=False))[_eid(hass, "date")]
    assert out["days"] == 180
    assert out["tip"] == "Gut einfrieren. Capped at the area's max storage time (6 months)."
    assert "at most 180 days in this place" in calls[0]["instructions"]
