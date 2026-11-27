"""Tests 6.9.1: a food pack becomes a bag (for an NFC tag)."""

from custom_components.larder.const import DOMAIN, KIND_BAG
from custom_components.larder.devices import entry_of
from custom_components.larder.entity import kind_of
from custom_components.larder.stock import pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_pack_becomes_a_bag(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _packs(hass, hass_ws_client, [{"content": "Rinderfilet", "quantity": 1, "unit": "pieces"}], None, "")
    pack = next(p for p in pack_entries(hass) if p["content"] == "Rinderfilet")
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=pack["device_id"], kind="bag")
    assert res["result"] == {"kind": "bag"}
    await hass.async_block_till_done()
    entry = entry_of(hass, pack["cc"])
    assert kind_of(entry) == KIND_BAG and entry.title == "Beutel 1"
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, pack["cc"])})
    assert device.name == "Beutel 1"
    # a bag cannot become a bag again, a household item cannot become a bag
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=pack["device_id"], kind="bag")
    assert res["success"] is False


async def test_strike_off_the_shopping_list(hass: HomeAssistant, hass_ws_client) -> None:
    """6.9.3 (#242): struck off – gone from the list, nothing in stock; undo puts it back on the same list."""
    from .test_block29 import _list
    from .test_recipes import _options

    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": "Milch"}, blocking=True)
    milk = next(i for i in todo._attr_todo_items if i.summary == "Milch")  # noqa: SLF001
    res = await _ws(hass, hass_ws_client, type="larder/shopping_remove", list="todo.einkaufen", uid=milk.uid, summary="Milch")
    assert res["result"] == {"removed": True, "minimum": False}
    assert todo.open() == [] and not [p for p in pack_entries(hass) if p["content"] == "Milch"]
    res = await _ws(hass, hass_ws_client, type="larder/shopping_add", item="Milch", list="todo.einkaufen")
    assert res["result"]["list"] == "todo.einkaufen" and todo.open() == ["Milch"]
