"""Tests block 26 (4.12): data care – gaps in the data."""

from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_data_gaps(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [
        {"content": "Senf", "quantity": 2, "unit": "pieces", "best_before": "2030-01-01", "product": {"price": 1.49}},
        {"content": "Ketchup", "quantity": 1, "unit": "pieces"},
    ], pantry.id, "Schrank")
    await _packs(hass, hass_ws_client, [{"content": "Nudeln", "quantity": 1, "unit": "pieces", "best_before": "2030-01-01", "product": {"opened": "2026-11-01"}}])
    stock = await async_get_stock(hass)
    stock.log_take("Senf", 2)
    res = await _ws(hass, hass_ws_client, type="larder/data_gaps")
    result = res["result"]
    names = {k: [r["content"] for r in v] for k, v in result["gaps"].items()}
    assert names["no_price"] == ["Ketchup", "Nudeln"]
    assert names["no_date"] == ["Ketchup"]
    assert names["no_place"] == ["Nudeln"]
    assert names["no_min"] == ["Senf"]
    assert result["counts"]["no_price"] == 2
    # an opened pack without a date
    entry = next(e for e in hass.config_entries.async_loaded_entries("larder") if e.data.get("cc") and e.runtime_data.resettable["content"].native_value == "Ketchup")
    await entry.runtime_data.resettable["content"].async_set_product({"opened": "2026-11-10"}, replace=False)
    res = await _ws(hass, hass_ws_client, type="larder/data_gaps")
    names = {k: [r["content"] for r in v] for k, v in res["result"]["gaps"].items()}
    assert names["opened_no_date"] == ["Ketchup"] and names["no_date"] == []
    # with a price remembered for the product: no gap
    stock.remember_price("Ketchup", 2.29)
    res = await _ws(hass, hass_ws_client, type="larder/data_gaps")
    assert [r["content"] for r in res["result"]["gaps"]["no_price"]] == ["Nudeln"]
