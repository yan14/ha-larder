"""Tests block 34 (5.2): buttons in notifications, buying again by consumption, weekly review."""

from datetime import timedelta

from custom_components.larder.history import async_get_history
from custom_components.larder.notify_actions import item_actions, parse_action
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_daily_summary import _at, _automation, _notify, blueprint  # noqa: F401, F811
from .test_disposable import _ws
from .test_recipes import _fill, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def test_item_actions() -> None:
    actions = item_actions({"cc": "AAAA", "kind": "container", "content": "Chili"}, "de")
    assert [a["title"] for a in actions] == ["Verbraucht", "Weggeworfen", "MHD +2 Tage", "Auf die Liste"]
    assert actions[0]["action"] == "LARDER_EATEN_AAAA"
    assert item_actions({"cc": "V1", "kind": "voucher", "content": "Thalia"}, "en") == []
    assert parse_action("LARDER_PLUS2_HA-12") == ("PLUS2", "HA-12")
    assert parse_action("LARDER_THAWED") is None


async def test_buttons_in_the_push_are_carried_out(hass: HomeAssistant, blueprint, freezer) -> None:  # noqa: F811
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    calls = _notify(hass, "mobile_app_yan")
    await _at(hass, freezer, "06:00:00", days=1)
    await _fill(hass, "AAAA", "Lachs", 0)
    await _fill(hass, "BBBB", "Gouda", 1)
    await _automation(hass, notify_action="notify.mobile_app_yan", item_pushes=True, max_item_pushes=1)
    await _at(hass, freezer, "08:00:00", days=1)
    pushes = calls["mobile_app_yan"]
    assert len(pushes) == 2  # one entry with buttons, the rest counted
    first = pushes[0]
    assert first["message"].startswith("Lachs")
    assert [a["title"] for a in first["data"]["actions"]][:3] == ["Verbraucht", "Weggeworfen", "MHD +2 Tage"]
    assert first["data"]["tag"] == "larder-AAAA"
    assert "1 weitere" in pushes[1]["message"]
    # +2 days
    before = dt_util.parse_date(hass.states.get("date.dose_bbbb_mhd").state)
    hass.bus.async_fire("mobile_app_notification_action", {"action": "LARDER_PLUS2_BBBB"})
    await hass.async_block_till_done()
    expected = (before + timedelta(days=2)).isoformat()
    assert hass.states.get("date.dose_bbbb_mhd").state == expected
    # thrown away: emptied, in the history
    done = []
    hass.bus.async_listen("larder_notification_action_done", lambda e: done.append(e.data))
    hass.bus.async_fire("mobile_app_notification_action", {"action": "LARDER_THROWN_AAAA"})
    await hass.async_block_till_done()
    history = await async_get_history(hass)
    assert history.records[-1]["content"] == "Lachs" and history.records[-1]["outcome"] == "thrown"
    assert done[-1]["what"] == "THROWN"
    # unknown container: nothing happens
    hass.bus.async_fire("mobile_app_notification_action", {"action": "LARDER_EATEN_NOPE"})
    await hass.async_block_till_done()


async def test_pack_used_up_from_the_push(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 2, "unit": "pieces"}], pantry.id, "")
    cc = pack_entries(hass)[0]["cc"]
    hass.bus.async_fire("mobile_app_notification_action", {"action": f"LARDER_EATEN_{cc}"})
    await hass.async_block_till_done()
    assert pack_entries(hass)[0]["count"] == 1
    stock = await async_get_stock(hass)
    assert stock is not None


async def test_buy_again_by_consumption(hass: HomeAssistant, hass_ws_client) -> None:
    from .test_block29 import _list
    from .test_recipes import _options

    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Milch", "quantity": 2, "unit": "pieces"}], pantry.id, "")
    stock = await async_get_stock(hass)
    today = dt_util.now().date()
    stock.takes = [{"key": "milch", "day": (today - timedelta(days=d)).isoformat(), "n": 1} for d in range(1, 22, 2)]
    res = await _ws(hass, hass_ws_client, type="larder/auto_reorder", content="Milch", enabled=True)
    assert res["success"], res
    milk = next(p for p in res["result"]["products"] if p["key"] == "milch")
    assert milk["auto"] is True and milk["usage"]["lasts_days"] <= 7
    assert len(res["result"]["added"]) == 1 and todo.open()[0].startswith("Milch")
    # not twice while it is on the list
    from custom_components.larder.stock import async_check_auto_reorder

    assert await async_check_auto_reorder(hass) == []
    res = await _ws(hass, hass_ws_client, type="larder/auto_reorder", content="Milch", enabled=False)
    assert "milch" not in stock.auto_reorder


def test_build_weekly_review() -> None:
    from datetime import date

    from custom_components.larder.stats import build_weekly_review

    today = date(2026, 11, 22)
    records = [
        {"content": "Schinken", "outcome": "thrown", "emptied": "2026-11-20T10:00:00+01:00", "product": {"price": 2.49}},
        {"content": "Chili", "outcome": "eaten", "emptied": "2026-11-19T10:00:00+01:00"},
        {"content": "Alt", "outcome": "thrown", "emptied": "2026-11-01T10:00:00+01:00"},
        {"content": "Spülmittel", "outcome": "thrown", "kind": "household", "emptied": "2026-11-20T10:00:00+01:00"},
    ]
    review = build_weekly_review(records, [{"content": "Lachs", "kind": "container"}], today, "de")
    assert (review["eaten"], review["thrown"], review["thrown_value"], review["expiring_count"]) == (1, 1, 2.49, 1)
    assert "ca. 2,49 €" in review["summary"] and "Weggeworfen: Schinken" in review["summary"]
    assert "Lachs" in review["summary"] and review["title"] == "🗓 Wochenrückblick"


async def test_weekly_review_blueprint(hass: HomeAssistant, freezer) -> None:
    from pathlib import Path
    import shutil

    from homeassistant.setup import async_setup_component

    hass.config.language = "de"
    path = Path(__file__).parents[1] / "blueprints/automation/larder/weekly_review.yaml"
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(path, target / path.name)
    await _setup(hass, "AAAA")
    calls = _notify(hass, "mobile_app_yan")
    await _at(hass, freezer, "06:00:00", days=1)
    await _fill(hass, "AAAA", "Lachs", 3)
    weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][dt_util.now().weekday()]
    assert await async_setup_component(hass, "automation", {"automation": {"id": "week", "alias": "week", "use_blueprint": {
        "path": f"larder/{path.name}", "input": {"notify_action": "notify.mobile_app_yan", "weekday": weekday, "send_time": "18:00:00"}}}})
    await hass.async_block_till_done()
    await _at(hass, freezer, "18:00:00")
    assert len(calls["mobile_app_yan"]) == 1
    assert calls["mobile_app_yan"][0]["title"] == "🗓 Wochenrückblick"
    assert "Lachs" in calls["mobile_app_yan"][0]["message"]
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)
