"""Tests block 35 (5.3): overview sensors, blueprints."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_block29 import _list
from .test_recipes import _fill, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_overview_sensors(hass: HomeAssistant, hass_ws_client, main_entry) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    await hass.async_block_till_done()
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 2, "unit": "pieces", "product": {"price": 1.5}}], pantry.id, "")
    await _fill(hass, "AAAA", "Lachs", -1)
    await _fill(hass, "BBBB", "Gouda", 1)
    await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": "Brot"}, blocking=True)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
    await hass.async_block_till_done()
    expired = hass.states.get("sensor.larder_expired")
    assert expired.state == "1" and expired.attributes["items"] == ["Lachs"]
    assert expired.name == "Larder abgelaufen"
    assert hass.states.get("sensor.larder_expiring_soon").attributes["items"] == ["Gouda"]
    assert float(hass.states.get("sensor.larder_stock_value").state) == 3.0
    assert hass.states.get("sensor.larder_shopping_open").state == "1"
    assert todo.open() == ["Brot"]
    assert hass.states.get("sensor.larder_supply_days") is not None
    # the main entry can be unloaded again
    assert await hass.config_entries.async_unload(main_entry.entry_id)


async def _blueprints(hass: HomeAssistant, **blueprints: dict) -> None:
    from pathlib import Path
    import shutil

    from homeassistant.setup import async_setup_component

    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    automations = []
    for name, inputs in blueprints.items():
        path = Path(__file__).parents[1] / f"blueprints/automation/larder/{name}.yaml"
        shutil.copy(path, target / path.name)
        automations.append({"id": name, "alias": name, "use_blueprint": {"path": f"larder/{name}.yaml", "input": inputs}})
    assert await async_setup_component(hass, "automation", {"automation": automations})
    await hass.async_block_till_done()


async def test_fridge_door_and_compartment_blueprints(hass: HomeAssistant) -> None:
    from .test_daily_summary import _notify

    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Lachs", 0)
    await _fill(hass, "BBBB", "Gouda", 5)
    calls = _notify(hass, "alexa")
    hass.states.async_set("binary_sensor.kuehlschrank", "off")
    await _blueprints(
        hass,
        fridge_door={"door": "binary_sensor.kuehlschrank", "voice_action": "notify.alexa"},
        compartment_announce={"voice_action": "notify.alexa", "only": "Keller · Regal"},
    )
    hass.states.async_set("binary_sensor.kuehlschrank", "on")
    await hass.async_block_till_done()
    assert [c["message"] for c in calls["alexa"]] == ["Bitte zuerst aufbrauchen: Lachs."]
    # cooldown: not again right away
    hass.states.async_set("binary_sensor.kuehlschrank", "off")
    hass.states.async_set("binary_sensor.kuehlschrank", "on")
    await hass.async_block_till_done()
    assert len(calls["alexa"]) == 1
    hass.bus.async_fire("larder_compartment_scanned", {"name": "Keller · Regal", "items": ["Senf", "Ketchup"]})
    hass.bus.async_fire("larder_compartment_scanned", {"name": "Bad", "items": ["Seife"]})
    await hass.async_block_till_done()
    assert [c["message"] for c in calls["alexa"]][1:] == ["Keller · Regal: Senf, Ketchup"]
