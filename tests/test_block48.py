"""Tests Block 48 (6.3): better recognition – Open Food Facts categories, own table row, history in data care."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.product import API
from custom_components.larder.shelf_life import category_for, entry_from_off, lookup
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block18 import _create
from .test_block43 import _move
from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


def test_open_food_facts_categories_choose_the_row() -> None:
    # the most specific category counts
    assert entry_from_off(["en:plant-based-foods-and-beverages", "en:meat-analogues"]) == "tofu"
    assert entry_from_off(["en:dairies", "en:milks"]) == "milk"
    assert entry_from_off(["en:spreads", "en:fruit-preserves", "en:jams"]) == "jam"
    # a vegan "salami" keeps like tofu & co.
    assert entry_from_off(["en:meats", "en:sausages"], ["en:vegan"]) == "tofu"
    assert entry_from_off(["en:meats", "en:sausages"]) == "deli"
    assert entry_from_off(["de:wurst"]) is None and entry_from_off(None) is None
    # the row decides the category and the shelf life, whatever the name says
    assert category_for("Mühlen Spicker Classic", "tofu") == "plant"
    result = lookup("Mühlen Spicker Classic", area_name="Kühlschrank", temperature_c=None, label_texts=(), vacuum=False, language="de", entry_id="tofu")
    assert result.days == 5


async def test_scan_stores_the_row_from_open_food_facts(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    code = "4000405002285"
    aioclient_mock.get(API.format(code=code), json={"status": 1, "product": {
        "product_name": "Vegane Mühlen Salami", "brands": "Rügenwalder Mühle",
        "categories_tags": ["en:plant-based-foods", "en:meat-analogues"], "labels_tags": ["en:vegan"]}})
    res = (await _ws(hass, hass_ws_client, type="larder/product", code=code))["result"]
    assert res["product"]["table"] == "tofu" and res["category"] == "plant"


async def test_own_row_in_data_care_and_estimate(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    _move(hass, "AAAA", fridge.id)
    await hass.async_block_till_done()
    await _create(hass, hass_ws_client, "pack", [{"content": "Hafer Kochcreme Bio Spezial X", "quantity": 1, "unit": "pieces"}, {"content": "Zaubertrank", "quantity": 1, "unit": "pieces"}], fridge.id)
    res = (await _ws(hass, hass_ws_client, type="larder/data_gaps"))["result"]
    assert [r["content"] for r in res["gaps"]["no_table"]] == ["Zaubertrank"]
    assert "history" in res["counts"]
    # the list of rows in the user's language, with the current one
    rows = (await _ws(hass, hass_ws_client, type="larder/table_rows", content="Zaubertrank", language="de"))["result"]
    assert any(r["id"] == "dish" and r["name"] == "Gericht / Reste" for r in rows["rows"]) and rows["current"] is None
    res = await _ws(hass, hass_ws_client, type="larder/table_row_set", content="zaubertrank", entry="juice")
    assert res["success"]
    stock = await async_get_stock(hass)
    assert stock.table_row("Zaubertrank") == ("juice", "own")
    assert (await _ws(hass, hass_ws_client, type="larder/data_gaps"))["result"]["counts"]["no_table"] == 0
    # the container: an estimate with the chosen row
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "AAAA"), "value": "Zaubertrank"}, blocking=True)
    date_id = _eid(hass, "date", "AAAA")
    out = (await hass.services.async_call(DOMAIN, "estimate_best_before", {"entity_id": date_id, "overwrite": True, "apply": False}, blocking=True, return_response=True))[date_id]
    assert out["source"] == "table" and "Saft" in out["basis"], out
    from custom_components.larder.shelf_life import entry_by_id

    assert hass.states.get(_eid(hass, "text", "AAAA")).attributes["category"] == entry_by_id("juice").cat
    # unknown row is refused; None goes back to the name
    assert not (await _ws(hass, hass_ws_client, type="larder/table_row_set", content="Zaubertrank", entry="nope"))["success"]
    await _ws(hass, hass_ws_client, type="larder/table_row_set", content="Zaubertrank", entry=None)
    assert stock.table_row("Zaubertrank") == (None, None)
