"""Tests Block 19 (4.4): pharmacy (medicines), optional dates for household items, period after opening."""

from datetime import timedelta

from custom_components.larder.household import area_scope, medicine_category, plan_area_scopes
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, label_registry as lr
from homeassistant.util import dt as dt_util

from .test_block18 import _create, _lists
from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401


def _day(n: int) -> str:
    return (dt_util.now().date() + timedelta(days=n)).isoformat()


def test_medicine_categories() -> None:
    assert medicine_category("Ibuprofen 400") == "md_pain"
    assert medicine_category("Nasenspray") == "md_cold"
    assert medicine_category("Pflaster") == "md_wound"
    assert medicine_category("Vitamin D") == "md_vitamin"
    assert medicine_category("Irgendwas") == "md_other"


async def test_medicine_scope_warning_and_list(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    food, pharmacy = await _lists(hass, "todo.einkaufen", "todo.apotheke")
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen", todo_pharmacy="todo.apotheke", long_soon_days=60)
    areas = ar.async_get(hass)
    cabinet = areas.async_create("Arzneischrank")
    # automatic assignment knows the medicine cabinet
    assert [(p["name"], p["scope"]) for p in plan_area_scopes(hass)] == [("Arzneischrank", "pharmacy")]
    res = await _ws(hass, hass_ws_client, type="larder/area_scope_set", area_id=cabinet.id, scope="pharmacy")
    assert res["result"]["scopes"][cabinet.id] == "pharmacy"
    assert any(label.name == "Larder: Apotheke" for label in lr.async_get(hass).async_list_labels())
    assert area_scope(hass, areas.async_get_area(cabinet.id)) == "pharmacy"
    made = (await _create(hass, hass_ws_client, "medicine", [{"content": "Ibuprofen 400", "quantity": 1, "unit": "pieces", "best_before": _day(45)}], cabinet.id))[0]
    assert made["name"] == "Medikament 1"
    text = hass.states.get(_eid(hass, "text", made["cc"]))
    assert text.attributes["kind"] == "medicine" and text.attributes["category"] == "md_pain"
    # the longer warning: 45 days left is "soon" for a medicine
    date_state = hass.states.get(_eid(hass, "date", made["cc"]))
    assert date_state.attributes["soon_days"] == 60
    days = next(s for s in hass.states.async_all("sensor") if s.entity_id.startswith("sensor.medikament_1"))
    assert days.attributes["status"] == "soon"
    # not in the daily summary (food only)
    res = await hass.services.async_call("larder", "get_expiring", {"days": 365}, blocking=True, return_response=True)
    assert res["count"] == 0
    # minimum stock: onto the pharmacy list
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Ibuprofen 400", min=2)
    await hass.async_block_till_done()
    assert pharmacy.summaries == ["Ibuprofen 400"] and food.summaries == []


async def test_period_after_opening_for_household_items(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    # sunscreen: printed date far ahead, 12 months after opening
    made = (await _create(hass, hass_ws_client, "household", [{"content": "Sonnencreme", "quantity": 2, "unit": "pieces", "best_before": _day(700), "product": {"pao": 12}}]))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=made["device_id"])
    assert res["success"], res
    opened = res["result"]
    assert opened["split"] is True and abs((dt_util.parse_date(opened["best_before"]) - dt_util.now().date()).days - 365) <= 1
    # without a period after opening the printed date stays
    plain = (await _create(hass, hass_ws_client, "medicine", [{"content": "Nasenspray", "quantity": 1, "unit": "pieces", "best_before": _day(200)}]))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=plain["device_id"])
    assert res["result"]["best_before"] == _day(200)
    # convert: a pack can become a medicine
    pack = (await _create(hass, hass_ws_client, "pack", [{"content": "Pflaster", "quantity": 1, "unit": "pieces"}]))[0]
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=pack["device_id"], kind="medicine")
    assert res["result"] == {"kind": "medicine"}
