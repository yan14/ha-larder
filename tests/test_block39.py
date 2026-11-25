"""Tests block 39 (5.5): shelf life after opening from USDA FoodKeeper, hidden features forward."""

from datetime import timedelta

import pytest

from custom_components.larder import shelf_life
from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import StorageContext, build_instructions
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def _opened(content: str, area: str) -> shelf_life.TableResult:
    return shelf_life.lookup(content, area_name=area, temperature_c=None, label_texts=(), vacuum=False, language="de", opened=True)


@pytest.mark.parametrize(
    ("content", "fridge"),
    [("Ketchup", 180), ("Curry Ketchup", 180), ("Senf", 365), ("Mayonnaise", 60), ("Sojasoße", 30), ("BBQ Sauce", 120),
     ("Sriracha", 180), ("Salatdressing", 30), ("Meerrettich", 90), ("Oliven", 14), ("Gewürzgurken", 30),
     ("Erdbeer Marmelade", 180), ("Milch", 7), ("Joghurt", 7)],
)
def test_values_after_opening_follow_foodkeeper(content: str, fridge: int) -> None:
    result = _opened(content, "Kühlschrank")
    assert result.days == fridge
    assert "USDA FoodKeeper" in result.tip and "USDA FoodKeeper" in result.basis


def test_after_opening_in_the_pantry() -> None:
    assert _opened("Ketchup", "Vorrat").days == 30
    assert _opened("Tabasco", "Vorrat").days == 180
    with pytest.raises(shelf_life.TableUnsuitable):
        _opened("Mayonnaise", "Vorrat")  # keep cold once opened
    # several items: the shortest decides
    assert _opened("Ketchup, Mayo", "Kühlschrank").days == 60
    # without a value after opening the storage value applies (fresh food)
    assert _opened("Hackfleisch", "Kühlschrank").days == 1


def test_condiments_no_longer_share_one_row() -> None:
    ids = {shelf_life.find_entry(n).id for n in ("Ketchup", "Senf", "Mayonnaise", "Sojasoße", "Worcestershire")}
    assert ids == {"ketchup", "mustard", "mayonnaise", "soy_sauce", "worcester"}
    assert shelf_life.find_entry("Tomatensoße").id == "soup"


def test_ai_is_asked_for_after_opening() -> None:
    text = build_instructions(content="Chutney", context=StorageContext("Kühlschrank", []), vacuum=False,
                              filled=dt_util.now().date(), language="de", opened=True)
    assert "AFTER OPENING" in text and "FoodKeeper" in text


async def test_opened_button_uses_the_table(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, pantry = areas.async_create("Kühlschrank"), areas.async_create("Vorrat")
    today = dt_util.now().date()
    printed = (today + timedelta(days=300)).isoformat()
    ketchup = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 1, "unit": "pieces", "best_before": printed}], fridge.id, ""))[0]
    date_id = _eid(hass, "date", ketchup["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=180)).isoformat()
    assert out["source"] == "table" and "6 Monate" in out["tip"]
    # mayonnaise in the pantry: keep cold → setting "shelf life after opening", with the reason
    mayo = (await _packs(hass, hass_ws_client, [{"content": "Mayonnaise", "quantity": 1, "unit": "pieces", "best_before": printed}], pantry.id, ""))[0]
    date_id = _eid(hass, "date", mayo["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=3)).isoformat()
    assert out["source"] == "setting" and out["reason"] == "table_unsuitable"
    # never longer than the printed date
    short = (today + timedelta(days=20)).isoformat()
    senf = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "best_before": short}], fridge.id, ""))[0]
    date_id = _eid(hass, "date", senf["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == short


async def test_open_pack_into_the_fridge_gets_six_months(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    today = dt_util.now().date()
    printed = (today + timedelta(days=300)).isoformat()
    src = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "best_before": printed}], pantry.id, ""))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=src["device_id"], area_id=fridge.id)
    assert res["success"], res
    assert res["result"]["best_before"] == (today + timedelta(days=180)).isoformat()
    assert dr.async_get(hass).async_get(res["result"]["device_id"]).area_id == fridge.id


async def test_product_view_brings_stock_and_history_together(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Keller")
    await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "product": {"price": 2.49, "brand": "Heinz"}}], pantry.id, "Regal")
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Ketchup", min=3)
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="ketchup")
    product = res["result"]["product"]
    assert product["name"] == "Ketchup" and product["count"] == 2 and product["min"] == 3 and product["low"] is True
    assert product["places"][0]["area"] == "Keller" and product["price"]["price"] == 2.49
    # unknown product: history only
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="Senf")
    assert res["result"]["product"] is None
