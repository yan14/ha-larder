"""Tests Block 23 (4.3): put away after shopping by scanning."""

from custom_components.larder.product import API
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block18 import _create
from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401

EAN = "4000000000001"


async def test_put_away_adds_a_pack_at_the_usual_place(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, cellar = areas.async_create("Kühlschrank"), areas.async_create("Keller")
    # opened one in the fridge, most of it (with a date) in the cellar
    await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 1, "unit": "pieces", "product": {"ean": EAN}}], fridge.id)
    await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 3, "unit": "pieces", "best_before": "2027-06-01", "product": {"brand": "Heinz", "price": 1.99, "ean": EAN}}], cellar.id, compartment="Regal")
    stock = await async_get_stock(hass)
    stock.bought = [{"id": "b1", "content": "Ketchup", "summary": "Ketchup (Heinz)"}, {"id": "b2", "content": "Senf", "summary": "Senf"}]
    # first scan: a new entry without a date next to the dated one (the printed date is unknown)
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN))["result"]
    assert (res["status"], res["area"], res["compartment"], res["count"], res["new_entry"]) == ("added", "Keller", "Regal", 1, True)
    # second scan: joins that entry
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN))["result"]
    assert (res["count"], res["new_entry"]) == (2, False)
    cellar_packs = sorted((p["count"], p["best_before"], p["brand"], p["price"]) for p in pack_entries(hass) if p["area_id"] == cellar.id)
    assert cellar_packs == [(2, None, "Heinz", 1.99), (3, "2027-06-01", "Heinz", 1.99)]
    # the bought item of the product is taken care of, others stay
    assert [b["id"] for b in stock.bought] == ["b2"]
    # not added: no take was counted as consumption
    assert stock.takes == []
    # unknown barcode: nothing made, name from the product database
    aioclient_mock.get(API.format(code="5000000000002"), json={"status": 1, "product": {"product_name": "Senf", "brands": "Develey"}})
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code="5000000000002"))["result"]
    assert (res["status"], res["name"], res["product"]["brand"]) == ("unknown", "Senf", "Develey")


async def test_put_away_household_item_adds_a_whole_pack(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    bath = ar.async_get(hass).async_create("Bad")
    await _create(hass, hass_ws_client, "household", [{"content": "Klopapier", "quantity": 5, "unit": "pieces", "product": {"pack_size": 8, "piece": "Rollen", "ean": EAN}}], bath.id)
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN))["result"]
    # the household item has no date: the 8 rolls join the 5 there
    assert (res["kind"], res["added"], res["count"], res["new_entry"]) == ("household", 8, 13, False)
