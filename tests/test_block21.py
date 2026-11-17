"""Tests Block 21 (4.6): replacement interval for consumables."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .test_block18 import _create
from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_replacement_interval_due_replaced_and_event(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    made = (await _create(hass, hass_ws_client, "household", [{"content": "Wasserfilter", "quantity": 3, "unit": "pieces"}]))[0]
    res = await _ws(hass, hass_ws_client, type="larder/replace_interval", content="Wasserfilter", weeks=4)
    interval = res["result"]["interval"]
    assert interval["weeks"] == 4 and interval["days"] == 28
    # on the card
    assert hass.states.get(_eid(hass, "text", made["cc"])).attributes["replace"]["due"] == interval["due"]
    assert (await _ws(hass, hass_ws_client, type="larder/replace_due"))["result"]["items"] == []
    stock = await async_get_stock(hass)

    def replaced_days_ago(days: int) -> None:
        stock.intervals["wasserfilter"]["last"] = (dt_util.now().date() - timedelta(days=days)).isoformat()

    # replaced 23 days ago: due within a week
    replaced_days_ago(23)
    due = (await _ws(hass, hass_ws_client, type="larder/replace_due"))["result"]["items"]
    assert [(i["name"], i["days"]) for i in due] == [("Wasserfilter", 5)]
    # on the due day the event fires once
    events = async_capture_events(hass, "larder_replace_due")
    replaced_days_ago(28)
    stock._check_replace_due()  # noqa: SLF001
    stock._check_replace_due()  # noqa: SLF001
    assert len(events) == 1 and events[0].data["name"] == "Wasserfilter" and "gewechselt" in events[0].data["message"]
    # replaced: one piece taken, the interval starts again
    res = await _ws(hass, hass_ws_client, type="larder/replaced", content="Wasserfilter")
    assert res["result"]["taken"] is True and res["result"]["interval"]["days"] == 28 and res["result"]["due"] == []
    assert next(p for p in pack_entries(hass) if p["content"] == "Wasserfilter")["count"] == 2
    # the interval stays with the product even when nothing is left; 0 removes it
    res = await _ws(hass, hass_ws_client, type="larder/replace_interval", content="Wasserfilter", weeks=0)
    assert res["result"]["interval"] is None and stock.intervals == {}
