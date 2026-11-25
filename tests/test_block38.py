"""Tests block 38 (5.9): shopping by store – price per store, the receipt knows the store, "I am at …"."""

from custom_components.larder.receipt_photo import parse_store
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_receipt_store_prices_and_shopping_at_a_store(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [
        {"content": "Senf", "quantity": 1, "unit": "pieces"},
        {"content": "Ketchup", "quantity": 1, "unit": "pieces"},
    ], pantry.id, "")
    # #141: two receipts from two stores – the prices go to their store
    for store, senf, ketchup in (("Rewe", 1.49, 2.29), ("ALDI Süd", 0.99, None)):
        items = [{"content": "Senf", "quantity": 1, "product": {"price": senf, "price_source": "receipt"}}]
        if ketchup:
            items.append({"content": "Ketchup", "quantity": 1, "product": {"price": ketchup, "price_source": "receipt"}})
        res = await _ws(hass, hass_ws_client, type="larder/receipt_add", area_id=pantry.id, items=items, store=store)
        assert res["success"], res
    stock = await async_get_stock(hass)
    # #139: last price per store, cheapest first; the history knows the store
    assert stock.prices_by_store("Senf") == [
        {"store": "ALDI Süd", "price": 0.99, "day": stock.prices_by_store("Senf")[0]["day"]},
        {"store": "Rewe", "price": 1.49, "day": stock.prices_by_store("Senf")[1]["day"]},
    ]
    assert [h.get("store") for h in stock.price_history["senf"]] == ["Rewe", "ALDI Süd"]
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    senf = next(p for p in res["result"]["products"] if p["name"] == "Senf")
    assert [r["store"] for r in senf["store_prices"]] == ["ALDI Süd", "Rewe"]
    res = await _ws(hass, hass_ws_client, type="larder/stores")
    assert [s["name"] for s in res["result"]["stores"]] == ["Rewe", "ALDI Süd"]  # most products first
    # #140: "I am at Aldi" – the ketchup was only bought at Rewe, bananas have no store
    for summary in ("Senf", "Ketchup", "Bananen"):
        await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": summary}, blocking=True)
    res = await _ws(hass, hass_ws_client, type="larder/shopping_mode", store="aldi süd")
    assert res["result"]["store"] == "ALDI Süd"
    here = {i["summary"]: i["here"] for i in res["result"]["items"]}
    assert here == {"Senf": True, "Ketchup": False, "Bananen": None}
    # the store's own order of sections (bakery first at Aldi), the general order everywhere else
    await _ws(hass, hass_ws_client, type="larder/store_save", name="Aldi Süd", order=["fridge", "produce"])
    res = await _ws(hass, hass_ws_client, type="larder/shopping_mode", store="ALDI Süd")
    assert res["result"]["order"][:2] == ["fridge", "produce"]
    res = await _ws(hass, hass_ws_client, type="larder/shopping_mode")
    assert "here" not in res["result"]["items"][0] and res["result"]["store"] is None
    assert next(i for i in res["result"]["items"] if i["summary"] == "Senf")["stores"] == ["ALDI Süd", "Rewe"]
    # deleting a store forgets its prices
    res = await _ws(hass, hass_ws_client, type="larder/store_save", name="rewe", delete=True)
    assert [s["name"] for s in res["result"]["stores"]] == ["ALDI Süd"]
    assert todo.open()  # the list itself is untouched


def test_store_from_the_receipt() -> None:
    assert parse_store({"found": True, "store": "  REWE   Markt "}) == "REWE Markt"
    assert parse_store({"found": True}) is None
    assert parse_store(None) is None
