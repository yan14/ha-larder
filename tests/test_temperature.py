"""Tests: Temperaturwarnung für Lagerorte mit Sensor."""

from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, issue_registry as ir
from homeassistant.util import dt as dt_util

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.temperature import EVENT_OK, EVENT_WARNING, async_get_temperature_watch

from .test_recipes import _fill, _setup, auto_enable_custom_integrations  # noqa: F401


async def _freezer(hass: HomeAssistant, cc: str, temp: str) -> str:
    hass.states.async_set("sensor.truhe", temp, {"unit_of_measurement": "°C", "device_class": "temperature"})
    area = ar.async_get(hass).async_get_or_create("Gefrierschrank")
    ar.async_get(hass).async_update(area.id, temperature_entity_id="sensor.truhe")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    return area.id


def _issue(hass: HomeAssistant, area_id: str):
    return ir.async_get(hass).async_get_issue(DOMAIN, f"temperature_{area_id}")


async def test_warning_after_time_and_clear_with_hysteresis(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Bolognese", 60)
    area_id = await _freezer(hass, "AAAA", "-18")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "BBBB")})
    dr.async_get(hass).async_update_device(device.id, area_id=area_id)
    events = []
    hass.bus.async_listen(EVENT_WARNING, lambda e: events.append(("warn", e.data)))
    hass.bus.async_listen(EVENT_OK, lambda e: events.append(("ok", e.data)))
    watch = await async_get_temperature_watch(hass)
    start = dt_util.utcnow()
    watch.async_check(start)
    assert _issue(hass, area_id) is None

    hass.states.async_set("sensor.truhe", "-5", {"unit_of_measurement": "°C"})
    watch.async_check(start)
    watch.async_check(start + timedelta(minutes=29))
    assert _issue(hass, area_id) is None
    watch.async_check(start + timedelta(minutes=31))
    await hass.async_block_till_done()
    issue = _issue(hass, area_id)
    assert issue is not None and issue.translation_key == "temperature_too_high"
    assert issue.translation_placeholders["containers"] == "- Bolognese (Dose AAAA)"
    assert issue.translation_placeholders["limit"] == "-12"
    assert events == [("warn", {"area_id": area_id, "area": "Gefrierschrank", "temperature": -5.0, "limit": -12.0, "containers": ["Bolognese (Dose AAAA)"]})]
    watch.async_check(start + timedelta(minutes=40))
    await hass.async_block_till_done()
    assert len(events) == 1  # nur einmal

    # knapp unter der Grenze: bleibt (Hysterese), deutlich darunter: weg
    hass.states.async_set("sensor.truhe", "-12.5", {"unit_of_measurement": "°C"})
    watch.async_check(start + timedelta(minutes=45))
    assert _issue(hass, area_id) is not None
    hass.states.async_set("sensor.truhe", "-16", {"unit_of_measurement": "°C"})
    watch.async_check(start + timedelta(minutes=50))
    await hass.async_block_till_done()
    assert _issue(hass, area_id) is None
    assert events[-1][0] == "ok"


async def test_pantry_and_switched_off(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    hass.states.async_set("sensor.keller", "25", {"unit_of_measurement": "°C", "device_class": "temperature"})
    area = ar.async_get(hass).async_get_or_create("Vorratskammer")
    ar.async_get(hass).async_update(area.id, temperature_entity_id="sensor.keller")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    watch = await async_get_temperature_watch(hass)
    start = dt_util.utcnow()
    watch.async_check(start)
    watch.async_check(start + timedelta(hours=3))
    assert _issue(hass, area.id) is None  # Vorratskammer: keine Grenze

    await _setup(hass, "BBBB")
    freezer = await _freezer(hass, "BBBB", "0")
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({"temperature_warning": False})
    watch.async_check(start)
    watch.async_check(start + timedelta(hours=1))
    assert _issue(hass, freezer) is None
