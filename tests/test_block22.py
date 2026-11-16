"""Tests Block 22 (4.2): barcode dialog – used up / thrown away per pack, prefill for a new pack."""

from custom_components.larder.history import async_get_history
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block18 import _create
from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_take_one_used_up_or_thrown_away(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    cellar = ar.async_get(hass).async_create("Keller")
    pack = (await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 3, "unit": "pieces", "product": {"brand": "Heinz", "ean": "4000000000001", "price": 1.99}}], cellar.id))[0]
    number = _eid(hass, "number", pack["cc"])
    history = await async_get_history(hass)
    stock = await async_get_stock(hass)
    # used up: −1, consumption, no history entry
    res = await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=pack["device_id"])
    assert res["result"] == {"left": 2} and hass.states.get(number).state == "2.0"
    assert history.list() == [] and sum(t["n"] for t in stock.takes) == 1
    # thrown away: −1 and a history entry for this one pack (counts in the value thrown away)
    res = await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=pack["device_id"], outcome="thrown")
    assert res["result"] == {"left": 1}
    record = history.list()[0]
    assert (record["content"], record["outcome"], record["quantity"], record["kind"], record["area"]) == ("Ketchup", "thrown", 1, "pack", "Keller")
    assert record["product"]["price"] == 1.99
    stats = await hass.services.async_call("larder", "get_statistics", {}, blocking=True, return_response=True)
    assert stats["thrown"] == 1
    # the last one empties the entry with the outcome
    res = await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=pack["device_id"], outcome="thrown")
    await hass.async_block_till_done()
    assert res["result"] == {"left": 0}
    assert [r["outcome"] for r in history.list()] == ["thrown", "thrown"]
    assert hass.states.get(number) is None  # pack removed


async def test_barcode_result_has_kind_place_and_prefill(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, cellar = areas.async_create("Kühlschrank"), areas.async_create("Keller")
    await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 1, "unit": "pieces", "product": {"ean": "4000000000001"}}], fridge.id)
    await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 4, "unit": "pieces", "product": {"brand": "Heinz", "price": 1.99, "ean": "4000000000001"}}], cellar.id)
    res = await _ws(hass, hass_ws_client, type="larder/stock_code", code="4000000000001")
    result = res["result"]
    assert sorted((e["area_id"], e["kind"], e["count"]) for e in result["entries"]) == sorted([(fridge.id, "pack", 1), (cellar.id, "pack", 4)])
    known = result["known"]
    # prefill for "new pack": product data and the place with the most packs
    assert (known["content"], known["kind"], known["area_id"]) == ("Ketchup", "pack", cellar.id)
    assert known["product"]["ean"] == "4000000000001" and known["product"]["brand"] == "Heinz" and known["product"]["price"] == 1.99
