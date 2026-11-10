"""Tests: eingebaute Haltbarkeits-Tabelle und die Modi Tabelle / Tabelle+KI / KI."""

from datetime import timedelta

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, label_registry as lr
from homeassistant.util import dt as dt_util

from custom_components.zwilling_storage import shelf_life as sl
from custom_components.zwilling_storage.const import DOMAIN

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
    from custom_components.zwilling_storage.estimate import Estimator

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
