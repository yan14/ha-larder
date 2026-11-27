"""Tests Block 60 (6.11): group and convert products."""

from custom_components.larder.cooking import match_ingredients, stock_items
from custom_components.larder.product_units import amount_text, line_amount, parse_size, unit_price
from custom_components.larder.stock import _shopping_entry, async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def test_parse_size_and_amounts() -> None:
    assert parse_size("500 g") == (500, "g")
    assert parse_size("1,5 l") == (1500, "ml")
    assert parse_size("6 x 0,33 l") == (1980, "ml")
    assert parse_size("1kg") == (1000, "g")
    assert parse_size("8 Stück") == (8, "pcs")
    assert parse_size("groß") is None and parse_size(None) is None
    assert line_amount("200 g Mehl") == (200, "g") and line_amount("0,5 l Milch") == (500, "ml")
    assert line_amount("2 Eier") is None
    assert unit_price(1.99, {"amount": 500, "unit": "g"}) == {"price": 3.98, "per": "kg"}
    assert unit_price(4.8, {"amount": 330, "unit": "ml"}, 6) == {"price": 2.42, "per": "l"}
    assert unit_price(None, {"amount": 1, "unit": "g"}) is None
    assert amount_text(1500, "g") == "1.5 kg" and amount_text(330, "ml") == "330 ml"


async def test_groups_never_merge_and_have_their_own_minimum(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    await _packs(hass, hass_ws_client, [{"content": "Vollmilch", "quantity": 1, "unit": "pieces"}, {"content": "Fettarme Milch", "quantity": 1, "unit": "pieces"}], fridge.id)
    for name in ("Vollmilch", "Fettarme Milch"):
        res = await _ws(hass, hass_ws_client, type="larder/product_group", content=name, group="Milch")
        assert res["success"], res
    data = (await _ws(hass, hass_ws_client, type="larder/stock"))["result"]
    # the products stay separate, the group shows the total
    names = [p["name"] for p in data["products"]]
    assert "Vollmilch" in names and "Fettarme Milch" in names and "Milch" not in names
    group = next(g for g in data["groups"] if g["name"] == "Milch")
    assert group["count"] == 2 and [m["name"] for m in group["members"]] == ["Fettarme Milch", "Vollmilch"]
    # a recipe asking for milk accepts both; "Fettarme Milch" still is not "Vollmilch"
    items = stock_items(hass)
    match = match_ingredients(["200 ml Milch", "Vollmilch"], items)
    assert {m["content"] for m in match[0]["matches"]} == {"Vollmilch", "Fettarme Milch"}
    assert [m["content"] for m in match[1]["matches"]] == ["Vollmilch"]
    # own minimum of the group: the group name onto the list
    res = (await _ws(hass, hass_ws_client, type="larder/group_min", group="Milch", min=3))["result"]
    assert next(g for g in res["groups"] if g["name"] == "Milch")["low"] is True
    await hass.async_block_till_done()
    assert todo.open() == ["Milch"]
    # out of the group again: the group disappears with its last member
    for name in ("Vollmilch", "Fettarme Milch"):
        await _ws(hass, hass_ws_client, type="larder/product_group", content=name, group=None)
    stock = await async_get_stock(hass)
    assert stock.groups == {} and stock.group_minimums == {}


async def test_size_unit_price_short_and_amount_per_tap(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Nudeln", "quantity": 2, "unit": "pieces", "product": {"package": "500 g"}}], pantry.id)
    await _ws(hass, hass_ws_client, type="larder/price_set", content="Nudeln", price=1.99)
    product = next(p for p in (await _ws(hass, hass_ws_client, type="larder/stock"))["result"]["products"] if p["name"] == "Nudeln")
    assert product["size"] == {"amount": 500, "unit": "g", "source": "package"}
    assert product["amount"] == 1000 and product["unit_price"] == {"price": 3.98, "per": "kg"}
    # too little for the recipe: 1 kg there, 1.5 kg needed
    match = match_ingredients(["1,5 kg Nudeln", "500 g Nudeln"], stock_items(hass))
    assert match[0]["short"] == {"need": 1500, "have": 1000, "unit": "g"} and "short" not in match[1]
    # own size wins over the package
    res = (await _ws(hass, hass_ws_client, type="larder/product_size", content="Nudeln", amount=250, unit="g"))["result"]
    assert next(p for p in res["products"] if p["name"] == "Nudeln")["size"]["source"] == "own"
    # amount per tap: −1 takes 2 slices
    await _packs(hass, hass_ws_client, [{"content": "Toast", "quantity": 6, "unit": "pieces"}], pantry.id)
    await _ws(hass, hass_ws_client, type="larder/take_step", content="Toast", step=2)
    toast = next(p for p in pack_entries(hass) if p["content"] == "Toast")
    text = hass.states.get(er.async_get(hass).async_get_entity_id("text", "larder", f"{toast['cc']}_content"))
    assert text.attributes["take_step"] == 2
    res = (await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=toast["device_id"]))["result"]
    assert res == {"left": 4, "taken": 2}
    res = (await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=toast["device_id"], amount=1))["result"]
    assert res == {"left": 3}


async def test_crate_of_bottles_on_the_list(hass: HomeAssistant) -> None:
    """#255: food with pieces per pack is bought in packs (1 crate = 6 bottles)."""
    hass.config.language = "de"
    text, buy = _shopping_entry(hass, {"name": "Wasser", "kind": "pack", "pack_size": 6}, 12, 2, False)
    assert (text, buy) == ("Wasser (2 Packungen)", 2)
