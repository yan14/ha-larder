"""Tests: Inhalt einer geleerten Dose optional auf eine To-do-Liste (Einkaufsliste) setzen."""

import pytest
from pytest_homeassistant_custom_component.common import mock_restore_cache

from homeassistant.components import todo as ha_todo
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component

from custom_components.larder.const import DOMAIN

from .test_ai_estimate import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


class FakeTodo(TodoListEntity):
    _attr_has_entity_name = False
    _attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM

    def __init__(self, entity_id: str) -> None:
        self.entity_id = entity_id
        self._attr_name = entity_id
        self._attr_todo_items: list[TodoItem] = []

    async def async_create_todo_item(self, item: TodoItem) -> None:
        self._attr_todo_items.append(item)

    @property
    def summaries(self) -> list[str]:
        return [i.summary for i in self._attr_todo_items]


async def _todo(hass: HomeAssistant, entity_id: str = "todo.einkaufen") -> FakeTodo:
    assert await async_setup_component(hass, "todo", {})
    todo = FakeTodo(entity_id)
    await hass.data[ha_todo.DATA_COMPONENT].async_add_entities([todo])
    return todo


async def _choose_list(hass: HomeAssistant, entry, entity_id: str | None) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    data = {"estimate_mode": "table"}
    if entity_id:
        data["todo_entity"] = entity_id
    await hass.config_entries.options.async_configure(result["flow_id"], data)
    await hass.async_block_till_done()


def _shopping(hass: HomeAssistant, cc: str = "34OL") -> str:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    return next(
        e.entity_id
        for e in er.async_entries_for_device(er.async_get(hass), device.id)
        if e.unique_id.endswith("_shopping")
    )


async def _fill_and_empty(hass: HomeAssistant, content: str, cc: str = "34OL") -> None:
    await hass.services.async_call(
        "text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": content}, blocking=True
    )
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", cc)}, blocking=True)
    await hass.async_block_till_done()


async def _switch(hass: HomeAssistant, on: bool, cc: str = "34OL") -> None:
    await hass.services.async_call(
        "switch", "turn_on" if on else "turn_off", {"entity_id": _shopping(hass, cc)}, blocking=True
    )


async def test_switch_is_off_by_default_and_survives_emptying(hass: HomeAssistant) -> None:
    await _setup(hass)
    sw = _shopping(hass)
    assert hass.states.get(sw).state == "off"
    assert hass.states.get(sw).attributes["list"] is None
    await _switch(hass, True)
    await _fill_and_empty(hass, "Reis")
    assert hass.states.get(sw).state == "on"  # Eigenschaft der Dose, wird nicht zurückgesetzt


async def test_switch_restores_last_state(hass: HomeAssistant) -> None:
    mock_restore_cache(hass, [State("switch.dose_34ol_shopping_list", "on")])
    await _setup(hass)
    assert hass.states.get("switch.dose_34ol_shopping_list").state == "on"


async def test_emptying_adds_content_when_switch_is_on(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    assert hass.states.get(_shopping(hass)).attributes["list"] == "todo.einkaufen"
    await _switch(hass, True)
    await _fill_and_empty(hass, "Basmati")
    assert todo.summaries == ["Basmati"]
    assert hass.states.get(_eid(hass, "text")).state == ""  # Dose wurde trotzdem geleert


async def test_several_contents_become_separate_items(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    await _switch(hass, True)
    await _fill_and_empty(hass, "Salami, Kochschinken; 1,5 kg Reis")
    assert todo.summaries == ["Salami", "Kochschinken", "1,5 kg Reis"]


async def test_leftovers_do_not_reach_the_list_when_switch_is_off(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    await _fill_and_empty(hass, "Pizza-Reste")
    assert todo.summaries == []


async def test_no_entry_without_selected_list(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    await _setup(hass)
    await _switch(hass, True)
    await _fill_and_empty(hass, "Reis")
    assert todo.summaries == []


async def test_nothing_added_for_empty_container(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    await _switch(hass, True)
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    await hass.async_block_till_done()
    assert todo.summaries == []


async def test_open_duplicate_is_not_added_twice(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    todo._attr_todo_items.append(TodoItem(summary="reis", status=TodoItemStatus.NEEDS_ACTION))
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    await _switch(hass, True)
    await _fill_and_empty(hass, "Reis")
    assert todo.summaries == ["reis"]


async def test_completed_item_may_be_added_again(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    todo._attr_todo_items.append(TodoItem(summary="Reis", status=TodoItemStatus.COMPLETED))
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.einkaufen")
    await _switch(hass, True)
    await _fill_and_empty(hass, "Reis")
    assert todo.summaries == ["Reis", "Reis"]


async def test_missing_list_does_not_break_emptying(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "todo", {})
    entry = await _setup(hass)
    await _choose_list(hass, entry, "todo.gibt_es_nicht")
    await _switch(hass, True)
    await _fill_and_empty(hass, "Reis")
    assert hass.states.get(_eid(hass, "text")).state == ""


async def test_each_container_decides_on_its_own(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    first = await _setup(hass, "34OL")
    await _setup(hass, "HA-SECOND01")
    await _choose_list(hass, first, "todo.einkaufen")
    await _switch(hass, True, "34OL")
    await _fill_and_empty(hass, "Reis", "34OL")
    await _fill_and_empty(hass, "Pizza-Reste", "HA-SECOND01")
    assert todo.summaries == ["Reis"]
