"""Tests Block 14: angebrochene Packungen, Beutel verschieben (Inventur), Vorrats-Karte."""

from datetime import timedelta

from custom_components.larder.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo
from .test_stock import _comp, _packs


def _cc(hass, device_id):
    return next(i for d, i in dr.async_get(hass).async_get(device_id).identifiers if d == DOMAIN)


async def test_open_a_pack_splits_moves_and_shortens(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    printed = (dt_util.now().date() + timedelta(days=300)).isoformat()
    src = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 3, "unit": "pieces", "best_before": printed, "product": {"brand": "Heinz"}}], pantry.id, "Regal"))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=src["device_id"], area_id=fridge.id, compartment="Tür")
    assert res["success"], res
    opened = res["result"]
    assert opened["split"] is True and opened["device_id"] != src["device_id"]
    occ = _cc(hass, opened["device_id"])
    attrs = hass.states.get(_eid(hass, "text", occ)).attributes
    assert attrs["opened"] == dt_util.now().date().isoformat() and attrs["brand"] == "Heinz"
    assert dr.async_get(hass).async_get(opened["device_id"]).area_id == fridge.id and _comp(hass, occ) == "Tür"
    assert hass.states.get(_eid(hass, "number", src["cc"])).state == "2.0"
    best = hass.states.get(_eid(hass, "date", occ)).state
    assert dt_util.now().date().isoformat() < best < printed  # kürzer als aufgedruckt
    # schon geöffnet: nicht noch einmal
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=opened["device_id"])
    assert not res["success"]
    # Strichcode / Vorrat: angebrochene zuerst
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    ketchup = res["result"]["products"][0]
    assert ketchup["opened"] == 1 and ketchup["places"][0]["opened"]

    # eine einzelne Packung wird selbst geöffnet, ohne Ort: bleibt, wo sie ist
    single = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}], pantry.id))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=single["device_id"])
    assert res["result"]["split"] is False and res["result"]["device_id"] == single["device_id"]
    assert dr.async_get(hass).async_get(single["device_id"]).area_id == pantry.id
    assert res["result"]["best_before"] is not None


async def test_bags_move_as_a_whole(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    freezer = ar.async_get(hass).async_create("Gefrierschrank")
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="bag", items=[{"content": "Reh"}])
    bag = res["result"]["items"][0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=bag["device_id"], count=1, area_id=freezer.id, compartment="Fach 3")
    assert res["result"] == {"moved": 1, "merged": False, "device_id": bag["device_id"]}
    assert dr.async_get(hass).async_get(bag["device_id"]).area_id == freezer.id and _comp(hass, bag["cc"]) == "Fach 3"


async def test_stock_shop_puts_a_product_on_the_list(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/stock_shop", content="Senf")
    assert res["error"]["code"] == "no_shopping_list"
    await _options(hass, entry, todo_entity="todo.einkaufen")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey"}}])
    res = await _ws(hass, hass_ws_client, type="larder/stock_shop", content="senf")
    assert res["result"] == {"added": True, "item": "Senf (Develey)"}
    assert todo.summaries == ["Senf (Develey)"]
    res = await _ws(hass, hass_ws_client, type="larder/stock_shop", content="Senf")
    assert res["result"]["added"] is False  # nicht doppelt
