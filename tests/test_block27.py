"""Tests block 27 (4.8): vouchers – value, valid until, code for administrators, redeem, reminder."""

from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .test_block18 import _create
from .test_disposable import _entities, _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401


def _day(n: int) -> str:
    return (dt_util.now().date() + timedelta(days=n)).isoformat()


async def _voucher(hass, hass_ws_client, name: str, value: float, days: int) -> dict:
    (item,) = await _create(hass, hass_ws_client, "voucher", [{"content": name, "quantity": 1, "unit": "pieces", "best_before": _day(days), "product": {"value": value, "value_initial": value}}])
    return item


def _content(hass: HomeAssistant, cc: str):
    entity_id = er.async_get(hass).async_get_entity_id("text", "larder", f"{cc}_content")
    return hass.states.get(entity_id) if entity_id else None


async def test_voucher_entities_value_and_code(hass: HomeAssistant, hass_ws_client, hass_admin_user) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    item = await _voucher(hass, hass_ws_client, "Thalia", 25, 40)
    assert item["name"] == "Gutschein 1"
    # no code, fill date or switches
    assert _entities(hass, item["device_id"]) >= {"content", "best_before", "compartment"}
    assert not _entities(hass, item["device_id"]) & {"filled_at", "qr_code", "vacuum", "shopping"}
    state = _content(hass, item["cc"])
    assert state.attributes["kind"] == "voucher" and state.attributes["category"] == "voucher"
    assert state.attributes["value"] == 25 and "section" not in state.attributes
    # the code is never in the state; administrators set and read it
    res = await _ws(hass, hass_ws_client, type="larder/voucher_update", device_id=item["device_id"], code="ABC-123", value=20)
    assert res["success"] and res["result"] == {"value": 20}
    assert "code" not in _content(hass, item["cc"]).attributes
    res = await _ws(hass, hass_ws_client, type="larder/voucher_code", device_id=item["device_id"])
    assert res["result"] == {"code": "ABC-123"}
    hass_admin_user.groups = []
    res = await _ws(hass, hass_ws_client, type="larder/voucher_code", device_id=item["device_id"])
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, type="larder/voucher_update", device_id=item["device_id"], code="X")
    assert not res["success"]
    # value and date for everyone
    res = await _ws(hass, hass_ws_client, type="larder/voucher_update", device_id=item["device_id"], value=30, valid_until=_day(90))
    assert res["success"]
    state = _content(hass, item["cc"])
    assert state.attributes["value"] == 30 and state.attributes["value_initial"] == 30


async def test_redeem_expire_stats_and_reminder(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    thalia = await _voucher(hass, hass_ws_client, "Thalia", 25, 20)
    ikea = await _voucher(hass, hass_ws_client, "IKEA", 50, 200)
    old = await _voucher(hass, hass_ws_client, "Kino", 12.5, -3)
    # reminder: within the long warning (60 days), expired vouchers never
    res = await hass.services.async_call("larder", "get_expiring_medicines", {}, blocking=True, return_response=True)
    assert [i["content"] for i in res["items"]] == ["Thalia"]
    assert res["items"][0]["value"] == 25
    assert "Gutschein Thalia (25 €)" in res["summary"]
    assert "der Gutschein Thalia über 25 Euro" in res["speech"]
    res = await hass.services.async_call("larder", "get_expiring_medicines", {"include_vouchers": False}, blocking=True, return_response=True)
    assert res["count"] == 0
    # partly redeemed
    res = await _ws(hass, hass_ws_client, type="larder/voucher_redeem", device_id=ikea["device_id"], amount=20)
    assert res["result"] == {"removed": False, "value": 30}
    assert _content(hass, ikea["cc"]).attributes["value"] == 30
    # the rest: gone
    res = await _ws(hass, hass_ws_client, type="larder/voucher_redeem", device_id=ikea["device_id"], amount=30)
    assert res["result"]["removed"] is True
    await hass.async_block_till_done()
    assert _content(hass, ikea["cc"]) is None
    # expired: value lost
    res = await _ws(hass, hass_ws_client, type="larder/voucher_redeem", device_id=old["device_id"], expired=True)
    assert res["result"] == {"removed": True, "value": 0, "lost": 12.5}
    await hass.async_block_till_done()
    res = await _ws(hass, hass_ws_client, type="larder/voucher_stats")
    assert res["result"] == {"count": 1, "open_value": 25, "lost_value": 12.5, "redeemed_value": 30}
    assert thalia["device_id"]
    # not food: no daily summary, no emergency supply
    res = await hass.services.async_call("larder", "get_expiring", {"days": 365}, blocking=True, return_response=True)
    assert not any(i["kind"] == "voucher" for i in res["items"])
