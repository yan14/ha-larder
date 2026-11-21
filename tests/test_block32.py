"""Tests block 32 (5.0): the same rules for putting things into stock and taking them out."""

from custom_components.larder.receipt_photo import parse_items
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_put_away_ticks_off_the_list(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"ean": "4006824000016"}}], pantry.id, "Schrank")
    for summary in ("Senf", "Bananen"):
        await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": summary}, blocking=True)
    res = await _ws(hass, hass_ws_client, type="larder/put_away", code="4006824000016")
    assert res["result"]["status"] == "added" and res["result"]["ticked"] == ["Senf"]
    assert todo.open() == ["Bananen"]


async def test_bought_known_goes_to_its_place_unknown_asks(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}], pantry.id, "Schrank")
    stock = await async_get_stock(hass)
    stock.bought = [
        {"id": "a1", "summary": "Senf", "content": "Senf", "count": 2, "kind": "pack"},
        {"id": "b2", "summary": "Spülmittel", "content": "Spülmittel", "count": 1, "kind": "household"},
    ]
    res = await _ws(hass, hass_ws_client, type="larder/bought_add", item_id="a1")
    assert res["result"]["status"] == "added" and res["result"]["area"] == "Vorrat"
    assert [b["id"] for b in res["result"]["items"]] == ["b2"]
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 3
    # not in stock and no place remembered: the dialog asks (as a household item)
    res = await _ws(hass, hass_ws_client, type="larder/bought_add", item_id="b2")
    assert res["result"]["status"] == "unknown" and res["result"]["kind"] == "household"
    assert [b["id"] for b in res["result"]["items"]] == ["b2"]
    res = await _ws(hass, hass_ws_client, type="larder/bought_add", item_id="nope")
    assert not res["success"]


async def test_receipt_household_goods(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    kitchen = ar.async_get(hass).async_create("Küche")
    items = parse_items({"found": True, "items": [{"name": "Klopapier", "household": True}, {"name": "Milch", "count": 2}]})
    assert items == [{"name": "Klopapier", "count": 1, "household": True}, {"name": "Milch", "count": 2}]
    res = await _ws(hass, hass_ws_client, type="larder/receipt_add", area_id=kitchen.id, compartment="", items=[
        {"content": "Klopapier", "quantity": 1, "household": True},
        {"content": "Milch", "quantity": 2},
    ])
    assert res["success"], res
    kinds = sorted((p["content"], p["kind"]) for p in pack_entries(hass))
    assert kinds == [("Klopapier", "household"), ("Milch", "pack")]


async def test_search_by_name_and_shopping_lists(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 2, "unit": "pieces"}], pantry.id, "Schrank")
    res = await _ws(hass, hass_ws_client, type="larder/stock_code", content="senf")
    assert res["result"]["name"] == "Senf" and res["result"]["entries"][0]["count"] == 2
    assert res["result"]["known"]["content"] == "Senf"
    # one pack more by the name (search → ＋ new pack)
    res = await _ws(hass, hass_ws_client, type="larder/put_away", content="Senf")
    assert res["result"]["status"] == "added" and res["result"]["count"] == 3
    res = await _ws(hass, hass_ws_client, type="larder/put_away")
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, type="larder/shopping_lists")
    assert res["result"]["lists"] == ["todo.einkaufen"]
