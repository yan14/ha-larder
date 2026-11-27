"""Tests Block 47 (6.6): online shopping – prepare the order, delivery day."""

from datetime import date, timedelta

from custom_components.larder.const import DOMAIN
from custom_components.larder.order import order_text, prepare_order
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401


def test_prepare_order() -> None:
    today = date(2026, 11, 27)
    products = [
        {"name": "Milch", "count": 2, "min": 0, "usage": {"per_week": 7, "lasts_days": 2}},  # 1 a day
        {"name": "Nudeln", "count": 5, "min": 2, "usage": {"per_week": 1, "lasts_days": 35}},
        {"name": "Senf", "count": 0, "min": 1, "brand": "Develey", "package": "250 ml"},
        {"name": "Klopapier", "count": 8, "min": 0, "kind": "household", "pack_size": 8, "usage": {"per_week": 4, "lasts_days": 14}},
        {"name": "Ibuprofen", "count": 0, "min": 1, "kind": "medicine"},
    ]
    items = prepare_order(products, today + timedelta(days=3), today, 7)
    by = {i["name"]: i for i in items}
    # milk: 1 a day for 3 + 7 days → 10, 2 there → 8
    assert by["Milch"]["need"] == 8 and by["Milch"]["reason"] == "usage"
    assert by["Senf"]["need"] == 1 and by["Senf"]["reason"] == "min"
    assert "Nudeln" not in by and "Ibuprofen" not in by
    # household in packs: 4 a week for 10 days = 6 rolls, 8 there → lasts; 14 days > 10 → not needed
    assert "Klopapier" not in by
    assert "1× Senf (Develey 250 ml)" in order_text(items).splitlines() and "8× Milch" in order_text(items).splitlines()


async def test_delivery_day(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    today = dt_util.now().date()
    res = await _ws(hass, hass_ws_client, type="larder/delivery_set", date=today.isoformat())
    assert res["result"]["date"] == today.isoformat()
    out = await hass.services.async_call(DOMAIN, "get_delivery", {}, blocking=True, return_response=True)
    assert out["due"] and out["url"] == "/larder?putaway=1" and out["title"] == "📦 Lieferung heute"
    res = (await _ws(hass, hass_ws_client, type="larder/order_prepare"))["result"]
    assert res["date"] == today.isoformat() and res["saved"] == today.isoformat()
    # a day in the past is forgotten
    stock = await async_get_stock(hass)
    stock.set_delivery(today - timedelta(days=1))
    out = await hass.services.async_call(DOMAIN, "get_delivery", {}, blocking=True, return_response=True)
    assert not out["due"] and out["date"] is None and stock.delivery is None
