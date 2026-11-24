"""Tests block 25: store sections on the shopping list and the emergency supply check."""

import uuid

from custom_components.larder.sections import SECTIONS, suggest_section
from custom_components.larder.shopping import async_add_to_shopping_list
from custom_components.larder.stock import async_get_stock
from homeassistant.components import todo as ha_todo
from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from .test_ai_estimate import _setup, auto_enable_custom_integrations  # noqa: F401


class MovableTodo(TodoListEntity):
    _attr_has_entity_name = False
    _attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.MOVE_TODO_ITEM

    def __init__(self, entity_id: str, items: list[str], movable: bool = True) -> None:
        self.entity_id = entity_id
        self._attr_name = entity_id
        if not movable:
            self._attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM
        self._attr_todo_items = [TodoItem(summary=s, uid=uuid.uuid4().hex, status=TodoItemStatus.NEEDS_ACTION) for s in items]

    async def async_create_todo_item(self, item: TodoItem) -> None:
        item.uid = uuid.uuid4().hex
        self._attr_todo_items.append(item)

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        items = self._attr_todo_items
        moving = next(i for i in items if i.uid == uid)
        items.remove(moving)
        index = 0 if previous_uid is None else next(n for n, i in enumerate(items) if i.uid == previous_uid) + 1
        items.insert(index, moving)

    @property
    def summaries(self) -> list[str]:
        return [i.summary for i in self._attr_todo_items]


async def _todo(hass: HomeAssistant, items: list[str], movable: bool = True) -> MovableTodo:
    assert await async_setup_component(hass, "todo", {})
    todo = MovableTodo("todo.einkaufen", items, movable)
    await hass.data[ha_todo.DATA_COMPONENT].async_add_entities([todo])
    return todo


def test_suggested_sections() -> None:
    assert suggest_section("Äpfel") == "produce"
    assert suggest_section("Vollkornbrot") == "bakery"
    assert suggest_section("Hackfleisch") == "meat"
    assert suggest_section("Milch") == "fridge"
    assert suggest_section("Spaghetti") == "dry"
    assert suggest_section("TK-Erbsen") == "frozen"
    assert suggest_section("Mineralwasser") == "drinks"
    assert suggest_section("Klopapier", "household") == "drugstore"
    assert suggest_section("Ibuprofen", "medicine") == "pharmacy"
    assert suggest_section("Geschenkband") == "other"
    assert SECTIONS[0] == "produce" and SECTIONS[-1] == "other"


async def test_items_are_sorted_into_their_section(hass: HomeAssistant, hass_ws_client) -> None:
    """5.3.4: items are added at the end (no reaching into the list); sections and their order stay for the shopping mode."""
    await _setup(hass, "AAAA")
    todo = await _todo(hass, ["Äpfel", "Milch", "Spaghetti"])
    assert await async_add_to_shopping_list(hass, "todo.einkaufen", "Brot")
    assert todo.summaries == ["Äpfel", "Milch", "Spaghetti", "Brot"]
    # own section from the card
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "larder/product_section", "content": "Kaffee", "section": "produce"})
    assert (await client.receive_json())["result"] == {"section": "produce"}
    # back to the suggestion
    await client.send_json_auto_id({"type": "larder/product_section", "content": "Kaffee"})
    assert (await client.receive_json())["result"] == {"section": "breakfast"}
    assert "kaffee" not in (await async_get_stock(hass)).sections
    # order of the sections (administrators): drinks first
    await client.send_json_auto_id({"type": "larder/section_order", "order": ["drinks", "produce"]})
    order = (await client.receive_json())["result"]["order"]
    assert order[:2] == ["drinks", "produce"] and len(order) == len(SECTIONS)
    await client.send_json_auto_id({"type": "larder/sections"})
    assert (await client.receive_json())["result"]["order"][0] == "drinks"


async def test_list_without_moving_stays_as_it_is(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    todo = await _todo(hass, ["Milch"], movable=False)
    assert await async_add_to_shopping_list(hass, "todo.einkaufen", "Äpfel")
    assert todo.summaries == ["Milch", "Äpfel"]


def test_amounts_and_groups() -> None:
    from custom_components.larder.supply import food_group, parse_amount

    assert parse_amount("400 g") == (0.4, "kg")
    assert parse_amount("6 x 1,5 l") == (9.0, "l")
    assert parse_amount("500ml") == (0.5, "l")
    assert parse_amount("Glas") is None
    assert food_group("Mineralwasser") == "drinks"
    assert food_group("Spaghetti") == "grain"
    assert food_group("Kidneybohnen") == "vegetables"
    assert food_group("Pfirsiche in Dosen") == "fruit"
    assert food_group("H-Milch") == "dairy"
    assert food_group("Thunfisch") == "protein"
    assert food_group("Rapsöl") == "fats"
    assert food_group("Gummibärchen") is None


async def test_supply_check(hass: HomeAssistant, hass_ws_client) -> None:
    from .test_block18 import _create, _lists
    from .test_recipes import _options

    hass.config.language = "de"
    food, drug, pharmacy = await _lists(hass, "todo.einkaufen", "todo.drogerie", "todo.apotheke")
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen", todo_household="todo.drogerie", todo_pharmacy="todo.apotheke", supply_persons=2, supply_days=10)
    await _create(hass, hass_ws_client, "pack", [
        {"content": "Mineralwasser", "quantity": 2, "unit": "pieces", "product": {"package": "6 x 1,5 l"}},
        {"content": "Spaghetti", "quantity": 4, "unit": "pieces", "product": {"package": "500 g"}},
        {"content": "Kidneybohnen", "quantity": 3, "unit": "pieces"},
    ])
    await _create(hass, hass_ws_client, "household", [{"content": "Kerzen", "quantity": 10, "unit": "pieces"}])
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "larder/supply"})
    res = (await client.receive_json())["result"]
    assert res["enabled"] is True and res["persons"] == 2 and res["days"] == 10
    groups = {g["key"]: g for g in res["groups"]}
    assert groups["drinks"]["need"] == 40.0 and groups["drinks"]["have"] == 18.0 and groups["drinks"]["share"] == 0.45
    assert groups["grain"]["have"] == 2.0 and groups["grain"]["need"] == 7.0
    assert groups["vegetables"]["have"] == 0 and groups["vegetables"]["unknown"] == 1
    assert res["days_covered"] == 0  # no fats, no dairy yet
    items = {i["key"]: i for i in res["items"]}
    assert items["light"] == {"key": "light", "present": True, "names": ["Kerzen"]}
    assert items["radio"]["present"] is False
    # 🛒: onto the right list
    await client.send_json_auto_id({"type": "larder/supply_shop", "key": "fats"})
    assert (await client.receive_json())["result"]["item"] == "Speiseöl"
    await client.send_json_auto_id({"type": "larder/supply_shop", "key": "radio"})
    assert (await client.receive_json())["result"]["list"] == "todo.drogerie"
    await client.send_json_auto_id({"type": "larder/supply_shop", "key": "first_aid"})
    assert (await client.receive_json())["result"]["list"] == "todo.apotheke"
    await hass.async_block_till_done()
    assert "Speiseöl" in [i.summary for i in food.todo_items]
    # switched off
    await _options(hass, entry, supply_check=False)
    await client.send_json_auto_id({"type": "larder/settings"})
    assert (await client.receive_json())["result"]["supply_check"] is False
