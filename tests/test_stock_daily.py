"""Tests Block 12: Vorrat im Alltag (Strichcode, ältestes zuerst, Einkaufsliste → Vorrat)."""

from datetime import timedelta

from custom_components.larder.product import API
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import FakeTodo, _todo
from .test_stock import _packs


def _day(n: int) -> str:
    return (dt_util.now().date() + timedelta(days=n)).isoformat()


async def test_barcode_finds_the_oldest_pack_first(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "best_before": _day(300), "product": {"ean": "4000000000001"}}], pantry.id, "Keller")
    old = (await _packs(hass, hass_ws_client, [{"content": "ketchup", "quantity": 1, "unit": "pieces", "best_before": _day(20)}], fridge.id))[0]
    # über die EAN gefunden (eine Packung hat sie), der Rest über den gleichen Inhalt
    aioclient_mock.get(API.format(code="4000000000001"), json={"status": 1, "product": {"product_name": "Ketchup"}})
    res = await _ws(hass, hass_ws_client, type="larder/stock_code", code="4000000000001")
    result = res["result"]
    assert result["name"] == "Ketchup"
    assert [(e["area"], e["count"]) for e in result["entries"]] == [("Vorrat", 2)]  # EAN passt nur zu einer
    # ohne EAN an den Packungen: über den Produktnamen aus Open Food Facts, früheste MHD zuerst
    aioclient_mock.get(API.format(code="5000000000002"), json={"status": 1, "product": {"product_name": "Ketchup"}})
    res = await _ws(hass, hass_ws_client, type="larder/stock_code", code="5000000000002")
    entries = res["result"]["entries"]
    assert [(e["area"], e["compartment"], e["best_before"]) for e in entries] == [("Kühlschrank", "", _day(20)), ("Vorrat", "Keller", _day(300))]
    assert entries[0]["device_id"] == old["device_id"]
    # unbekannt im Vorrat: Produktdaten zum Anlegen
    aioclient_mock.get(API.format(code="6000000000003"), json={"status": 1, "product": {"product_name": "Senf", "brands": "Develey"}})
    res = await _ws(hass, hass_ws_client, type="larder/stock_code", code="6000000000003")
    assert res["result"]["entries"] == [] and res["result"]["name"] == "Senf" and res["result"]["product"]["brand"] == "Develey"
    # Vorrats-Ansicht: Orte nach MHD, frühestes MHD je Produkt
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    ketchup = res["result"]["products"][0]
    assert ketchup["earliest"] == _day(20) and ketchup["places"][0]["area"] == "Kühlschrank"


class CheckableTodo(FakeTodo):
    _attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM

    async def async_create_todo_item(self, item: TodoItem) -> None:
        item.uid = item.uid or f"u{len(self._attr_todo_items)}"
        item.status = item.status or TodoItemStatus.NEEDS_ACTION
        self._attr_todo_items.append(item)

    def check(self, summary: str) -> None:
        for item in self._attr_todo_items:
            if item.summary == summary:
                item.status = TodoItemStatus.COMPLETED
        self.async_write_ha_state()


async def test_checked_off_items_are_offered_for_the_stock(hass: HomeAssistant, hass_ws_client) -> None:
    from homeassistant.components import todo as ha_todo
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "todo", {})
    todo = CheckableTodo("todo.einkaufen")
    await hass.data[ha_todo.DATA_COMPONENT].async_add_entities([todo])
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    pack = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey"}}], pantry.id, "Schrank"))[0]
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Senf", min=2)
    await hass.async_block_till_done()
    assert todo.summaries == ["Senf (Develey)"]
    res = await _ws(hass, hass_ws_client, type="larder/bought")
    assert res["result"]["items"] == []

    todo.check("Senf (Develey)")  # abgehakt: Larder bietet es für den Vorrat an
    await hass.async_block_till_done()
    res = await _ws(hass, hass_ws_client, type="larder/bought")
    items = res["result"]["items"]
    assert len(items) == 1
    item = items[0]
    assert (item["content"], item["product"], item["area_id"], item["compartment"], item["count"]) == ("Senf", {"brand": "Develey"}, pantry.id, "Schrank", 1)
    assert pack
    res = await _ws(hass, hass_ws_client, type="larder/bought_dismiss", item_id=item["id"])
    assert res["result"]["items"] == []


async def test_emptied_container_on_the_list_is_tracked(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    from custom_components.larder.const import DATA_STOCK, DOMAIN

    shopping = next(s.entity_id for s in hass.states.async_all("switch") if s.entity_id.endswith("shopping_list"))
    await hass.services.async_call("switch", "turn_on", {"entity_id": shopping}, blocking=True)
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "AAAA"), "value": "Basmati"}, blocking=True)
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", "AAAA")}, blocking=True)
    await hass.async_block_till_done()
    assert todo.summaries == ["Basmati"]
    assert hass.data[DOMAIN][DATA_STOCK].tracked["basmati"]["source"] == "emptied"
