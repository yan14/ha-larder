"""Tests block 29 (4.10): shopping mode (tick off into stock) and recurring purchases."""

from datetime import timedelta
import uuid

from custom_components.larder.shopping_mode import async_check_recurring, recurring_due
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.components import todo as ha_todo
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


class ShopTodo(TodoListEntity):
    _attr_has_entity_name = False
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM | TodoListEntityFeature.MOVE_TODO_ITEM
    )

    def __init__(self, entity_id: str) -> None:
        self.entity_id = entity_id
        self._attr_name = entity_id
        self._attr_todo_items: list[TodoItem] = []

    async def async_create_todo_item(self, item: TodoItem) -> None:
        item.uid = uuid.uuid4().hex
        item.status = TodoItemStatus.NEEDS_ACTION
        self._attr_todo_items.append(item)
        self.async_write_ha_state()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        for own in self._attr_todo_items:
            if own.uid == item.uid:
                own.status = item.status or own.status
        self.async_write_ha_state()

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        items = self._attr_todo_items
        moving = next(i for i in items if i.uid == uid)
        items.remove(moving)
        index = 0 if previous_uid is None else next(n for n, i in enumerate(items) if i.uid == previous_uid) + 1
        items.insert(index, moving)

    def open(self) -> list[str]:
        return [i.summary for i in self._attr_todo_items if i.status == TodoItemStatus.NEEDS_ACTION]


async def _list(hass: HomeAssistant) -> ShopTodo:
    assert await async_setup_component(hass, "todo", {})
    todo = ShopTodo("todo.einkaufen")
    await hass.data[ha_todo.DATA_COMPONENT].async_add_entities([todo])
    return todo


async def test_shopping_mode(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey"}}], pantry.id, "Schrank")
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Senf", min=3)
    await hass.async_block_till_done()
    assert todo.open() == ["Senf (Develey)"]
    for summary in ("Bananen", "Milch"):
        await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": summary}, blocking=True)
    res = await _ws(hass, hass_ws_client, type="larder/shopping_mode")
    items = res["result"]["items"]
    assert [i["summary"].split(" (")[0] for i in items] == ["Bananen", "Milch", "Senf"]
    assert [i["section"] for i in items][:2] == ["produce", "fridge"]
    senf = next(i for i in items if i["summary"].startswith("Senf"))
    assert senf["known"] is True and next(i for i in items if i["summary"] == "Bananen")["known"] is False
    # tick off: into stock at its place, as many packs as asked for
    res = await _ws(hass, hass_ws_client, type="larder/shopping_check", list=senf["list"], uid=senf["uid"], summary=senf["summary"])
    result = res["result"]
    assert result["status"] == "added" and result["area"] == "Vorrat" and result["compartment"] == "Schrank"
    await hass.async_block_till_done()
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 3
    assert not any(s.startswith("Senf") for s in todo.open())
    # not offered again under "bought"
    await (await async_get_stock(hass)).async_poll()
    res = await _ws(hass, hass_ws_client, type="larder/bought")
    assert res["result"]["items"] == []
    # unknown: reported, the dashboard collects it
    bananen = next(i for i in items if i["summary"] == "Bananen")
    res = await _ws(hass, hass_ws_client, type="larder/shopping_check", list=bananen["list"], uid=bananen["uid"], summary="Bananen")
    assert res["result"] == {"status": "unknown", "name": "Bananen"}
    assert todo.open() == ["Milch"]


def test_recurring_due() -> None:
    from datetime import date

    friday = date(2026, 11, 20)
    assert recurring_due({"weekdays": [4]}, friday)
    assert not recurring_due({"weekdays": [4], "last": "2026-11-20"}, friday)
    assert not recurring_due({"weekdays": [0, 2]}, friday)
    assert recurring_due({"every_days": 3, "last": "2026-11-17"}, friday)
    assert not recurring_due({"every_days": 3, "last": "2026-11-18"}, friday)


async def test_recurring_purchases(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    today = dt_util.now().date()
    res = await _ws(hass, hass_ws_client, type="larder/recurring_set", name="Wasserkiste", weekdays=[today.weekday()])
    assert res["success"]
    res = await _ws(hass, hass_ws_client, type="larder/recurring_set", name="Milch", every_days=3)
    items = res["result"]["items"]
    assert [i["name"] for i in items] == ["Milch", "Wasserkiste"]
    assert items[1]["weekdays"] == [today.weekday()] and items[0]["every_days"] == 3
    # today: the crate (weekday), not the milk (counted from today)
    assert await async_check_recurring(hass, today) == ["Wasserkiste"]
    assert todo.open() == ["Wasserkiste"]
    assert await async_check_recurring(hass, today) == []
    # in three days the milk; the crate only on its weekday again
    later = today + timedelta(days=3)
    assert await async_check_recurring(hass, later) == ["Milch"]
    # still open on the list: not twice
    assert await async_check_recurring(hass, today + timedelta(days=7)) == []
    assert todo.open().count("Wasserkiste") == 1
    # neither weekdays nor days: refused; delete
    res = await _ws(hass, hass_ws_client, type="larder/recurring_set", name="Brot")
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, type="larder/recurring_delete", key="milch")
    assert [i["name"] for i in res["result"]["items"]] == ["Wasserkiste"]
