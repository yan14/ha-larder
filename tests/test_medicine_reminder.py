"""Tests #97 (4.5): reminder for medicines and dated household items (service and blueprint)."""

from datetime import timedelta
from pathlib import Path
import shutil

from freezegun.api import FrozenDateTimeFactory
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from .test_block18 import _create
from .test_daily_summary import _at, _notify
from .test_recipes import _fill, _options, _setup, auto_enable_custom_integrations  # noqa: F401

BLUEPRINT = Path(__file__).parents[1] / "blueprints/automation/larder/medicine_reminder.yaml"


def _day(n: int) -> str:
    return (dt_util.now().date() + timedelta(days=n)).isoformat()


@pytest.fixture
async def blueprint(hass: HomeAssistant):
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(BLUEPRINT, target / BLUEPRINT.name)
    yield
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)


async def _stock(hass, hass_ws_client):
    hass.config.language = "de"
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, long_soon_days=60)
    await _fill(hass, "AAAA", "Lachs", 1)  # food: not part of this reminder
    await _create(hass, hass_ws_client, "medicine", [{"content": "Ibuprofen 400", "quantity": 1, "unit": "pieces", "best_before": _day(40)}])
    await _create(hass, hass_ws_client, "medicine", [{"content": "Hustensaft", "quantity": 1, "unit": "pieces", "best_before": _day(-3)}])
    await _create(hass, hass_ws_client, "medicine", [{"content": "Pflaster", "quantity": 1, "unit": "pieces", "best_before": _day(400)}])
    await _create(hass, hass_ws_client, "household", [{"content": "Sonnencreme", "quantity": 1, "unit": "pieces", "best_before": _day(20)}])
    await _create(hass, hass_ws_client, "household", [{"content": "Klopapier", "quantity": 8, "unit": "pieces"}])
    return entry


async def test_service_lists_medicines_and_dated_household_items(hass: HomeAssistant, hass_ws_client) -> None:
    await _stock(hass, hass_ws_client)
    res = await hass.services.async_call("larder", "get_expiring_medicines", {}, blocking=True, return_response=True)
    assert [i["content"] for i in res["items"]] == ["Hustensaft", "Sonnencreme", "Ibuprofen 400"]
    assert (res["count"], res["expired"], res["days"]) == (3, 1, 60)
    assert res["summary"].startswith("💊 2 laufen bald ab, 1 abgelaufen:")
    assert "• Hustensaft (1 Stück): seit 3 Tagen abgelaufen, entsorgen" in res["summary"]
    assert "Hustensaft ist abgelaufen und sollte entsorgt werden." in res["speech"]
    # the daily summary stays food only
    food = await hass.services.async_call("larder", "get_expiring", {"days": 365}, blocking=True, return_response=True)
    assert [i["content"] for i in food["items"]] == ["Lachs"]
    # fewer days, without expired
    res = await hass.services.async_call("larder", "get_expiring_medicines", {"days": 30, "include_expired": False}, blocking=True, return_response=True)
    assert [i["content"] for i in res["items"]] == ["Sonnencreme"]


async def test_blueprint_on_the_chosen_weekday_push_and_voice(hass: HomeAssistant, hass_ws_client, blueprint, freezer: FrozenDateTimeFactory) -> None:
    await _stock(hass, hass_ws_client)
    calls = _notify(hass, "mobile_app_a", "mobile_app_b", "alexa_media_kitchen")
    today = dt_util.now().strftime("%a").lower()[:3]
    assert await async_setup_component(hass, "automation", {"automation": {
        "id": "larder_med", "alias": "Larder med",
        "use_blueprint": {"path": f"larder/{BLUEPRINT.name}", "input": {
            "notify_action": "notify.mobile_app_a, notify.mobile_app_b",
            "voice_action": "notify.alexa_media_kitchen", "voice_data": {"type": "announce"},
            "weekdays": [today], "send_time": "09:00:00"}}}})
    await hass.async_block_till_done()
    await _at(hass, freezer, "09:00:00", days=0 if dt_util.now().hour < 9 else 7)
    assert len(calls["mobile_app_a"]) == 1 and len(calls["mobile_app_b"]) == 1
    push = calls["mobile_app_a"][0]
    assert push["title"] == "💊 Larder" and push["message"].startswith("💊") and push["data"]["url"] == "/larder"
    assert calls["alexa_media_kitchen"][0]["data"] == {"type": "announce"}
    assert "entsorgt" in calls["alexa_media_kitchen"][0]["message"]


async def test_blueprint_not_on_other_days_and_test_by_hand(hass: HomeAssistant, hass_ws_client, blueprint, freezer: FrozenDateTimeFactory) -> None:
    await _stock(hass, hass_ws_client)
    calls = _notify(hass, "mobile_app_a")
    today = dt_util.now().strftime("%a").lower()[:3]
    other = "sun" if today != "sun" else "mon"
    assert await async_setup_component(hass, "automation", {"automation": {
        "id": "larder_med", "alias": "Larder med",
        "use_blueprint": {"path": f"larder/{BLUEPRINT.name}", "input": {
            "notify_action": "notify.mobile_app_a", "weekdays": [other], "send_time": "09:00:00"}}}})
    await hass.async_block_till_done()
    await _at(hass, freezer, "09:00:00", days=0 if dt_util.now().hour < 9 else 7)
    assert calls["mobile_app_a"] == []
    # run by hand: sent regardless of the weekday
    await hass.services.async_call("automation", "trigger", {"entity_id": "automation.larder_med"}, blocking=True)
    await hass.async_block_till_done()
    assert len(calls["mobile_app_a"]) == 1
