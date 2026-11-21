"""Tests block 30 (4.11): scanning in the shopping mode, price and best-before date when ticking off."""

from datetime import timedelta
from unittest.mock import patch

from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


async def test_scan_ticks_off_and_details(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey", "ean": "4006824000016"}}], pantry.id, "Schrank")
    for summary in ("Senf (Develey)", "Bananen"):
        await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": summary}, blocking=True)
    # barcode of a product on the list: ticked off and into stock
    res = await _ws(hass, hass_ws_client, type="larder/shopping_scan", code="4006824000016")
    result = res["result"]
    assert result["matched"] is True and result["summary"] == "Senf (Develey)" and result["status"] == "added"
    assert todo.open() == ["Bananen"]
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 2
    # price and date: the new pack gets its own entry (the other one keeps no date)
    day = (dt_util.now().date() + timedelta(days=200)).isoformat()
    res = await _ws(hass, hass_ws_client, type="larder/shopping_details", device_id=result["device_id"], added=1, price=1.99, best_before=day)
    assert res["success"], res
    senf = sorted((p["count"], p["best_before"] or "", p["price"]) for p in pack_entries(hass) if p["content"] == "Senf")
    assert senf == [(1, "", 1.99), (1, day, 1.99)]
    # price history: two prices → shown in the stock view
    await _ws(hass, hass_ws_client, type="larder/shopping_details", device_id=res["result"]["device_id"], added=1, price=2.49)
    stock = await async_get_stock(hass)
    assert [p["price"] for p in stock.price_history["senf"]] == [2.49]  # same day: the last one counts
    stock.price_history["senf"].insert(0, {"day": "2026-01-01", "price": 1.79})
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    product = next(p for p in res["result"]["products"] if p["key"] == "senf")
    assert [p["price"] for p in product["price_history"]] == [1.79, 2.49]
    # known product, not on the list: into stock anyway
    res = await _ws(hass, hass_ws_client, type="larder/shopping_scan", code="4006824000016")
    assert res["result"]["status"] == "added" and res["result"]["matched"] is False
    # unknown barcode: reported with the name from the product databases
    with patch("custom_components.larder.product.async_lookup", return_value={"found": True, "name": "Hafermilch", "product": {"brand": "Oatly"}, "product_type": "food"}):
        res = await _ws(hass, hass_ws_client, type="larder/shopping_scan", code="7394376616501")
    assert res["result"]["status"] == "unknown" and res["result"]["name"] == "Hafermilch"
    assert res["result"]["product"] == {"brand": "Oatly"}
