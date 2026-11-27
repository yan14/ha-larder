"""Tests Block 49 (6.5): throw away less – freeze instead, rescue list, what is thrown away most."""

from datetime import timedelta

from custom_components.larder.const import DOMAIN
from custom_components.larder.freezing import freezable, freezer_area
from custom_components.larder.notify_actions import item_actions
from custom_components.larder.rescue import build_rescue_list
from custom_components.larder.stats import waste_top
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_block43 import _move
from .test_disposable import _ws
from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_freeze_instead_of_throwing_away(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    areas = ar.async_get(hass)
    fridge, freezer = areas.async_create("Kühlschrank"), areas.async_create("Gefrierschrank")
    _move(hass, "AAAA", fridge.id)
    _move(hass, "BBBB", fridge.id)
    await hass.async_block_till_done()
    await _fill(hass, "AAAA", "Hackfleisch", 1)
    await _fill(hass, "BBBB", "Gekochte Eier", 1)
    assert freezer_area(hass) == freezer.id
    mince = {"cc": "AAAA", "content": "Hackfleisch", "days_left": 1}
    assert freezable(hass, mince)
    assert not freezable(hass, {**mince, "days_left": 5})  # not yet
    assert not freezable(hass, {"cc": "BBBB", "content": "Gekochte Eier", "days_left": 1})  # boiled eggs do not freeze
    # the button in the push: right after "used up"
    actions = item_actions({**mince, "freezable": True}, "de")
    assert [a["title"] for a in actions[:3]] == ["Verbraucht", "🧊 Einfrieren", "Weggeworfen"]
    # the dashboard: freezing moves it and gives it the freezer date of the table (ground meat: 3 months)
    device_id = (await _ws(hass, hass_ws_client, type="larder/rescue_list"))["result"]["items"][0]["device_id"]
    res = (await _ws(hass, hass_ws_client, type="larder/freeze", device_id=device_id))["result"]
    assert res["area"] == "Gefrierschrank"
    assert res["best_before"] == (dt_util.now().date() + timedelta(days=90)).isoformat()
    state = hass.states.get(_eid(hass, "date", "AAAA"))
    assert state.state == res["best_before"] and state.attributes.get("storage") == "freezer"


def test_rescue_list_texts() -> None:
    items = [
        {"cc": "a", "content": "Milch", "days_left": 1},
        {"cc": "b", "content": "Gulasch", "days_left": 20, "frozen": True},
        {"cc": "c", "content": "Gulasch", "days_left": 120, "frozen": True},
        {"cc": "d", "content": "Joghurt", "days_left": 3},
        {"cc": "e", "content": "Reis", "days_left": 30},
        {"cc": "f", "content": "Lasagne", "days_left": 0},
    ]
    res = build_rescue_list(items, planned={"f"}, window=42, language="de")
    assert [i["content"] for i in res["items"]] == ["Milch", "Joghurt", "Gulasch"]
    assert res["summary"].startswith("3 Sachen müssen diese Woche weg:")
    assert "• Milch (morgen)" in res["summary"] and "🧊 beste Qualität noch 20 Tage" in res["summary"]
    assert res["url"] == "/larder?view=recipes&week=1" and res["button"] == "In den Wochenplan"
    assert build_rescue_list([], set(), 42, "de")["count"] == 0


async def test_rescue_service_and_waste_top(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Joghurt", 2)
    res = await hass.services.async_call(DOMAIN, "get_rescue_list", {}, blocking=True, return_response=True)
    assert res["count"] == 1 and res["items"][0]["content"] == "Joghurt"
    wasted = [
        {"content": "Brot", "product": {"price": 2.5}},
        {"content": "Brot", "product": {"price": 2.5}},
        {"content": "Gekochte Eier"},
        {"content": "Hackfleisch"},
    ]
    top = waste_top(hass, wasted)
    assert top[0] == {"content": "Brot", "count": 2, "value": 5.0, "tip": "freeze"}
    tips = {t["content"]: t["tip"] for t in top}
    assert tips["Gekochte Eier"] == "smaller" and tips["Hackfleisch"] == "freeze"


async def test_blueprint_rescue_list(hass: HomeAssistant, freezer) -> None:
    from pathlib import Path
    import shutil

    from homeassistant.setup import async_setup_component

    from .test_daily_summary import _at, _notify

    hass.config.language = "de"
    path = Path(__file__).parents[1] / "blueprints/automation/larder/rescue_list.yaml"
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(path, target / path.name)
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Joghurt", 3)
    calls = _notify(hass, "mobile_app_yan")
    weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(dt_util.now() + timedelta(days=1)).weekday()]
    assert await async_setup_component(hass, "automation", {"automation": {"id": "rescue", "alias": "rescue", "use_blueprint": {
        "path": f"larder/{path.name}", "input": {"notify_action": "notify.mobile_app_yan", "weekday": weekday, "send_time": "17:00:00"}}}})
    await hass.async_block_till_done()
    await _at(hass, freezer, "17:00:00", days=1)
    assert len(calls["mobile_app_yan"]) == 1
    push = calls["mobile_app_yan"][0]
    assert push["title"] == "🛟 Retten diese Woche" and "Joghurt" in push["message"]
    assert push["data"]["actions"][0]["uri"] == "/larder?view=recipes&week=1"
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)
