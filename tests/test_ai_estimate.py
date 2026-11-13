"""Tests: Vakuum-Schalter und KI-Schätzung des MHD (mit simuliertem AI-Task-Dienst)."""

from datetime import date, timedelta

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry, mock_restore_cache

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant, State, SupportsResponse
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.util import dt as dt_util

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import (
    StorageContext,
    build_instructions,
    cache_key,
)


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup(hass: HomeAssistant, cc: str = "34OL") -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN, unique_id=cc, title=f"Dose {cc}", data={"cc": cc, "tc": None, "size": None}
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _eid(hass: HomeAssistant, domain: str, cc: str = "34OL") -> str:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    return next(
        e.entity_id
        for e in er.async_entries_for_device(er.async_get(hass), device.id)
        if e.domain == domain and (domain != "switch" or e.unique_id.endswith("_vacuum")) and (domain != "select" or e.unique_id.endswith("_unit")) and (domain != "text" or e.unique_id.endswith("_content"))
    )


def _fake_ai(hass: HomeAssistant, data=None, error: Exception | None = None) -> list[dict]:
    """Simuliert ai_task.generate_data und merkt sich die Aufrufe."""
    calls: list[dict] = []

    async def handler(call):
        calls.append(dict(call.data))
        if error:
            raise error
        return {
            "conversation_id": "x",
            "data": data or {"shelf_life_days": 4, "storage_tip": "Gut verschlossen lagern."},
        }

    hass.services.async_register("ai_task", "generate_data", handler, supports_response=SupportsResponse.ONLY)
    return calls


async def _set_mode(hass: HomeAssistant, entry, mode: str, entity: str | None = None) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    user_input = {"estimate_mode": mode}
    if entity:
        user_input["ai_task_entity"] = entity
    result = await hass.config_entries.options.async_configure(result["flow_id"], user_input)
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def _enable_ai(hass: HomeAssistant, entry, entity: str | None = None) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    user_input = {"estimate_mode": "ai"}
    if entity:
        user_input["ai_task_entity"] = entity
    result = await hass.config_entries.options.async_configure(result["flow_id"], user_input)
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def _estimate(hass: HomeAssistant, **data):
    return await hass.services.async_call(
        DOMAIN,
        "estimate_best_before",
        {"entity_id": _eid(hass, "date"), **data},
        blocking=True,
        return_response=True,
    )


async def _prepare(hass: HomeAssistant, content="Tomatensuppe", area="Kühlschrank"):
    """Dose mit Inhalt und Bereich, KI aktiviert und simuliert."""
    entry = await _setup(hass)
    calls = _fake_ai(hass)
    await _enable_ai(hass, entry)
    if area:
        area_entry = ar.async_get(hass).async_get_or_create(area)
        device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
        dr.async_get(hass).async_update_device(device.id, area_id=area_entry.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": content}, blocking=True
    )
    return entry, calls


# ---------- Vakuum-Schalter ----------


async def test_vacuum_switch_defaults_on_and_survives_emptying(hass: HomeAssistant) -> None:
    await _setup(hass)
    vac = _eid(hass, "switch")
    assert hass.states.get(vac).state == "on"

    await hass.services.async_call("switch", "turn_off", {"entity_id": vac}, blocking=True)
    assert hass.states.get(vac).state == "off"

    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Suppe"}, blocking=True
    )
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    assert hass.states.get(_eid(hass, "text")).state == ""
    assert hass.states.get(vac).state == "off"  # Eigenschaft der Dose, wird nicht zurückgesetzt


async def test_vacuum_switch_restores_last_state(hass: HomeAssistant) -> None:
    mock_restore_cache(hass, [State("switch.dose_34ol_vacuum", "off")])
    await _setup(hass)
    assert hass.states.get("switch.dose_34ol_vacuum").state == "off"


async def test_vacuum_default_setting_applies_to_new_containers_only(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    first = _eid(hass, "switch")
    assert hass.states.get(first).state == "on"

    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"estimate_mode": "table", "vacuum_default": False}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY

    await _setup(hass, "HA-NEW00001")
    assert hass.states.get(_eid(hass, "switch", "HA-NEW00001")).state == "off"
    assert hass.states.get(first).state == "on"  # bestehende Dose bleibt unverändert


async def test_vacuum_default_is_on_without_setting(hass: HomeAssistant) -> None:
    from custom_components.larder.estimate import async_get_estimator

    await _setup(hass)
    assert (await async_get_estimator(hass)).vacuum_default is True


# ---------- Schätzung ----------


async def test_estimate_applies_best_before_from_filled_date(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    filled = dt_util.now().replace(microsecond=0) - timedelta(days=2)
    await hass.services.async_call(
        "datetime", "set_value", {"entity_id": _eid(hass, "datetime"), "datetime": filled.isoformat()}, blocking=True
    )

    response = (await _estimate(hass))[_eid(hass, "date")]
    expected = (filled.date() + timedelta(days=4)).isoformat()
    assert response == {
        "status": "estimated",
        "best_before": expected,
        "days": 4,
        "tip": "Gut verschlossen lagern.",
        "cached": False,
        "source": "ai",
        "origin": None,
        "basis": "",
        "applied": True,
    }
    assert hass.states.get(_eid(hass, "date")).state == expected

    prompt = calls[0]["instructions"]
    assert "Tomatensuppe" in prompt and "Kühlschrank" in prompt and "vacuum-sealed" in prompt
    assert filled.date().isoformat() in prompt
    assert "entity_id" not in calls[0]  # Standard-KI von Home Assistant
    assert set(calls[0]["structure"]) == {"shelf_life_days", "storage_tip"}


async def test_estimate_uses_today_without_filled_date_and_vacuum_off(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    await hass.services.async_call("switch", "turn_off", {"entity_id": _eid(hass, "switch")}, blocking=True)
    response = (await _estimate(hass, apply=False))[_eid(hass, "date")]
    assert response["best_before"] == (dt_util.now().date() + timedelta(days=4)).isoformat()
    assert response["applied"] is False
    assert hass.states.get(_eid(hass, "date")).state == "unknown"  # nur Vorschlag
    assert "not vacuum-sealed" in calls[0]["instructions"]


async def test_estimate_never_overwrites_existing_best_before(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": "2030-01-01"}, blocking=True
    )
    response = (await _estimate(hass))[_eid(hass, "date")]
    assert response["status"] == "already_set"
    assert hass.states.get(_eid(hass, "date")).state == "2030-01-01"
    assert calls == []  # keine unnötige KI-Anfrage

    response = (await _estimate(hass, overwrite=True))[_eid(hass, "date")]
    assert response["status"] == "estimated"
    assert len(calls) == 1


async def test_estimate_is_cached_per_content_area_and_vacuum(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    await _estimate(hass)
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "  tomatensuppe "}, blocking=True
    )
    response = (await _estimate(hass))[_eid(hass, "date")]
    assert response["cached"] is True
    assert len(calls) == 1  # zweites Mal ohne KI

    # anderer Vakuum-Zustand = andere Schätzung
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Tomatensuppe"}, blocking=True
    )
    await hass.services.async_call("switch", "turn_off", {"entity_id": _eid(hass, "switch")}, blocking=True)
    await _estimate(hass)
    assert len(calls) == 2


async def test_manual_correction_is_learned(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    await _estimate(hass)  # 4 Tage geschätzt
    today = dt_util.now().date()
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": (today + timedelta(days=7)).isoformat()}, blocking=True
    )
    # Dose leeren und neu füllen: die Korrektur (7 Tage) gilt jetzt
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Tomatensuppe"}, blocking=True
    )
    response = (await _estimate(hass))[_eid(hass, "date")]
    assert response["days"] == 7 and response["cached"] is True
    assert len(calls) == 1


async def test_confirming_estimate_keeps_cache(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    result = (await _estimate(hass))[_eid(hass, "date")]
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": result["best_before"]}, blocking=True
    )
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Tomatensuppe"}, blocking=True
    )
    assert (await _estimate(hass))[_eid(hass, "date")]["days"] == 4


@pytest.mark.parametrize(
    ("setup", "message"),
    [
        ({"content": ""}, "contents|Inhalt"),
        ({"area": None}, "area|Bereich"),
    ],
)
async def test_estimate_requires_content_and_area(hass: HomeAssistant, setup, message) -> None:
    _, calls = await _prepare(hass, **setup)
    with pytest.raises(HomeAssistantError, match=message):
        await _estimate(hass)
    assert calls == []


async def test_estimate_off_refuses(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    calls = _fake_ai(hass)
    await _set_mode(hass, entry, "off")
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass, "date")).attributes["estimates"] is False
    with pytest.raises(HomeAssistantError, match="switched off|ausgeschaltet"):
        await _estimate(hass)
    assert calls == []


async def test_estimate_without_ai_task_integration(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    await _enable_ai(hass, entry)  # kein ai_task-Dienst registriert
    area = ar.async_get(hass).async_get_or_create("Keller")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Nudeln"}, blocking=True
    )
    with pytest.raises(HomeAssistantError, match="AI Task"):
        await _estimate(hass)


@pytest.mark.parametrize(
    "answer", [{"storage_tip": "kein Wert"}, {"shelf_life_days": "viele"}]
)
async def test_unusable_ai_answer_is_reported_and_not_cached(hass: HomeAssistant, answer) -> None:
    entry = await _setup(hass)
    _fake_ai(hass, data=answer)
    await _enable_ai(hass, entry)
    area = ar.async_get(hass).async_get_or_create("Keller")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Nudeln"}, blocking=True
    )
    with pytest.raises(HomeAssistantError, match="AI estimate failed|KI-Schätzung"):
        await _estimate(hass)
    assert hass.states.get(_eid(hass, "date")).state == "unknown"


async def test_ai_service_error_is_wrapped(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    _fake_ai(hass, error=HomeAssistantError("provider down"))
    await _enable_ai(hass, entry)
    area = ar.async_get(hass).async_get_or_create("Keller")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Nudeln"}, blocking=True
    )
    with pytest.raises(HomeAssistantError, match="provider down"):
        await _estimate(hass)


async def test_days_are_clamped(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass)
    calls.clear()
    # Antwort mit unsinnig großem Wert
    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, data={"shelf_life_days": 99999.4, "storage_tip": ""})
    response = (await _estimate(hass))[_eid(hass, "date")]
    # Kühlschrank: reine KI-Schätzungen sind auf 60 Tage begrenzt, der Tipp sagt es
    assert response["days"] == 60
    assert "capped at 2 months" in response["tip"]


@pytest.mark.parametrize(
    ("area", "limit"),
    [("Kühlschrank", 60), ("Gefrierschrank", 548), ("Vorratskammer", 1095), ("Werkstatt", 365)],
)
async def test_ai_estimates_are_capped_per_storage_place(hass: HomeAssistant, area, limit) -> None:
    await _prepare(hass, area=area)
    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, data={"shelf_life_days": 5000, "storage_tip": "x"})
    assert (await _estimate(hass))[_eid(hass, "date")]["days"] == limit


async def test_ai_estimate_below_the_cap_is_untouched(hass: HomeAssistant) -> None:
    await _prepare(hass)
    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, data={"shelf_life_days": 59, "storage_tip": "Kühl lagern."})
    response = (await _estimate(hass))[_eid(hass, "date")]
    assert (response["days"], response["tip"]) == (59, "Kühl lagern.")


async def test_old_ai_estimates_are_refreshed_but_corrected_ones_stay(hass: HomeAssistant) -> None:
    from datetime import timedelta

    from homeassistant.util import dt as dt_util

    _, calls = await _prepare(hass)
    await _estimate(hass)
    await _estimate(hass, overwrite=True)
    assert len(calls) == 1  # gemerkt

    estimator = hass.data[DOMAIN]["estimator"]
    (key,) = estimator._cache
    old = (dt_util.now().date() - timedelta(days=400)).isoformat()
    estimator._cache[key]["created"] = old
    hass.services.async_remove("ai_task", "generate_data")
    calls = _fake_ai(hass, data={"shelf_life_days": 6, "storage_tip": "neu"})
    response = (await _estimate(hass, overwrite=True))[_eid(hass, "date")]
    assert (response["days"], len(calls)) == (6, 1)  # nach einem Jahr neu geschätzt
    assert estimator._cache[key]["created"] == dt_util.now().date().isoformat()

    # KI nicht erreichbar: der alte Wert gilt weiter
    estimator._cache[key]["created"] = old
    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, error=HomeAssistantError("offline"))
    assert (await _estimate(hass, overwrite=True))[_eid(hass, "date")]["days"] == 6

    # vom Nutzer korrigierte Werte werden nie neu geschätzt
    estimator.learn(key, 9)
    estimator._cache[key]["created"] = old
    hass.services.async_remove("ai_task", "generate_data")
    calls = _fake_ai(hass, data={"shelf_life_days": 2})
    assert (await _estimate(hass, overwrite=True))[_eid(hass, "date")]["days"] == 9
    assert calls == []


async def test_selected_ai_task_entity_is_passed(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    calls = _fake_ai(hass)
    await _enable_ai(hass, entry, entity="ai_task.meine_ki")
    area = ar.async_get(hass).async_get_or_create("Keller")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Nudeln"}, blocking=True
    )
    await _estimate(hass)
    assert calls[0]["entity_id"] == "ai_task.meine_ki"


async def test_settings_change_updates_attribute(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    assert hass.states.get(_eid(hass, "date")).attributes["estimates"] is True  # Standard: Tabelle
    await _set_mode(hass, entry, "off")
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass, "date")).attributes["estimates"] is False
    await _enable_ai(hass, entry)
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass, "date")).attributes["estimates"] is True


# ---------- Kontext des Lagerorts ----------


async def test_prompt_contains_area_temperature_sensor_and_label_description(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, area="Gefrierschrank")
    hass.states.async_set("sensor.gefrier_temp", "-18.4", {"unit_of_measurement": "°C", "device_class": "temperature"})
    label = lr.async_get(hass).async_create("Tiefkühlung", description="ca. -18 °C, Fleisch und Fisch")
    area = ar.async_get(hass).async_get_area_by_name("Gefrierschrank")
    ar.async_get(hass).async_update(
        area.id, temperature_entity_id="sensor.gefrier_temp", labels={label.label_id}
    )
    await _estimate(hass)
    prompt = calls[0]["instructions"]
    assert "Gefrierschrank" in prompt
    assert "measured temperature in this place: -18.4 °C" in prompt
    assert "Tiefkühlung: ca. -18 °C, Fleisch und Fisch" in prompt


async def test_unavailable_temperature_sensor_is_ignored(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, area="Kühlschrank")
    hass.states.async_set("sensor.kuehl_temp", "unavailable", {"device_class": "temperature"})
    area = ar.async_get(hass).async_get_area_by_name("Kühlschrank")
    ar.async_get(hass).async_update(area.id, temperature_entity_id="sensor.kuehl_temp")
    await _estimate(hass)
    assert "measured temperature" not in calls[0]["instructions"]


async def test_area_from_entity_is_used_as_fallback(hass: HomeAssistant) -> None:
    _, calls = await _prepare(hass, area=None)
    area = ar.async_get(hass).async_get_or_create("0-Grad-Fach")
    er.async_get(hass).async_update_entity(_eid(hass, "text"), area_id=area.id)
    await _estimate(hass)
    assert "0-Grad-Fach" in calls[0]["instructions"]


# ---------- reine Funktionen ----------


def test_cache_key_normalizes_whitespace_and_case() -> None:
    assert cache_key("  Tomaten  Suppe ", "Kühlschrank", True) == cache_key("tomaten suppe", " kühlschrank", True)
    assert cache_key("a", "b", True) != cache_key("a", "b", False)
    assert cache_key("a", "b", True) != cache_key("a", "c", True)


def test_build_instructions_without_hints() -> None:
    text = build_instructions(
        content="Kaffeebohnen",
        context=StorageContext("Vorratskammer", []),
        vacuum=True,
        filled=date(2026, 11, 10),
        language="de",
    )
    assert "Kaffeebohnen" in text and "Vorratskammer" in text and "2026-11-10" in text
    assert "Additional information" not in text
    assert "code 'de'" in text


# ---------- MHD und "Befüllt am" leeren ----------


async def test_clear_services_empty_single_fields(hass: HomeAssistant) -> None:
    await _setup(hass)
    await hass.services.async_call(
        "date", "set_value", {"entity_id": _eid(hass, "date"), "date": "2030-01-01"}, blocking=True
    )
    await hass.services.async_call(
        "datetime", "set_value",
        {"entity_id": _eid(hass, "datetime"), "datetime": "2026-11-09T10:00:00+00:00"}, blocking=True,
    )
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Suppe"}, blocking=True
    )

    await hass.services.async_call(DOMAIN, "clear_best_before", {"entity_id": _eid(hass, "date")}, blocking=True)
    assert hass.states.get(_eid(hass, "date")).state == "unknown"
    assert hass.states.get(_eid(hass, "datetime")).state != "unknown"  # nur das MHD

    await hass.services.async_call(DOMAIN, "clear_filled_at", {"entity_id": _eid(hass, "datetime")}, blocking=True)
    assert hass.states.get(_eid(hass, "datetime")).state == "unknown"
    assert hass.states.get(_eid(hass, "text")).state == "Suppe"  # Inhalt bleibt
