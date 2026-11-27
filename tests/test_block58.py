"""Tests Block 58 (6.10): shopping list 2.0."""

from custom_components.larder.shopping_mode import description_text
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def test_description_text() -> None:
    assert description_text(" 2× ", "laktosefrei") == "2× · laktosefrei"
    assert description_text("", "  die große  ") == "die große"
    assert description_text("", "") == ""


async def test_note_amount_price_and_suggestions(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}], pantry.id, "Schrank")
    await _ws(hass, hass_ws_client, type="larder/price_set", content="Senf", price=1.49)
    for item in ("Senf", "Milch"):
        await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": item}, blocking=True)
    # #244: the test list has no descriptions – the note goes in brackets behind the name
    senf = next(i for i in todo._attr_todo_items if i.summary == "Senf")  # noqa: SLF001
    res = (await _ws(hass, hass_ws_client, type="larder/shopping_note", list="todo.einkaufen", uid=senf.uid, summary="Senf", amount="2×", note="scharf"))["result"]
    assert res == {"description": "2× · scharf", "summary": "Senf (2× · scharf)"}
    view = (await _ws(hass, hass_ws_client, type="larder/shopping_mode"))["result"]["items"]
    item = next(i for i in view if i["summary"].startswith("Senf"))
    # #245: the price of one pack; the product is still found by its name
    assert item["price"] == 1.49 and item["known"] is True
    # ticked off with the amount: two packs into stock
    await _ws(hass, hass_ws_client, type="larder/shopping_check", list="todo.einkaufen", uid=senf.uid, summary=item["summary"], packs=2)
    await hass.async_block_till_done()
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 3
    # #243: struck off and put away lately come as chips; names for typing
    milk = next(i for i in todo._attr_todo_items if i.summary == "Milch")  # noqa: SLF001
    await _ws(hass, hass_ws_client, type="larder/shopping_remove", list="todo.einkaufen", uid=milk.uid, summary="Milch")
    sugg = (await _ws(hass, hass_ws_client, type="larder/shopping_suggest"))["result"]
    assert "Senf" in sugg["chips"] and "Milch" in sugg["chips"] and "Senf" in sugg["known"]
    assert (await async_get_stock(hass)).struck[0] == "Milch"


async def test_paste_several_lines(hass: HomeAssistant, hass_ws_client) -> None:
    """#246: one item per line, nothing twice."""
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": "Brot"}, blocking=True)
    res = (await _ws(hass, hass_ws_client, type="larder/shopping_add_many", items=["Milch", "Brot", "Fettarme Milch"]))["result"]
    assert res == {"added": ["Milch", "Fettarme Milch"], "already": ["Brot"], "failed": []}
    assert todo.open() == ["Brot", "Milch", "Fettarme Milch"]
