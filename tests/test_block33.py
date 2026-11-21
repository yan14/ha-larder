"""Tests block 33 (5.1): best-before date from a photo, several packs, recently used, product history."""

from datetime import date

import pytest

from custom_components.larder.date_photo import parse_date
from custom_components.larder.estimate import EstimateError
from custom_components.larder.history import async_get_history, build_record
from custom_components.larder.product_history import build_product_history
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs

TODAY = date(2026, 11, 21)


def test_parse_date() -> None:
    assert parse_date({"found": True, "year": 2027, "month": 3, "day": 12}, TODAY) == "2027-03-12"
    assert parse_date({"found": True, "year": 27, "month": 2}, TODAY) == "2027-02-28"  # month and year only
    assert parse_date({"found": True, "year": 2027, "month": 4, "day": 31}, TODAY) == "2027-04-30"
    for bad in ({"found": False}, {"found": True, "year": 2027}, {"found": True, "year": 2090, "month": 1, "day": 1}, None):
        with pytest.raises(EstimateError):
            parse_date(bad, TODAY)


def _rec(content: str, outcome: str | None, days: int | None, price: float | None = None, emptied: str = "2026-11-01T10:00:00+01:00") -> dict:
    return {"content": content, "cc": "X", "outcome": outcome, "days_stored": days, "emptied": emptied, "filled_at": None,
            **({"product": {"price": price}} if price else {})}


def test_product_history_figures_and_hint() -> None:
    records = [
        _rec("Schinken", "eaten", 4, emptied="2025-06-01T10:00:00+01:00"),
        _rec("Käse", "eaten", 9),
        _rec("schinken", "thrown", 8, 2.49),
        _rec("Schinken", "eaten", 3),
        _rec("Schinken", "thrown", 9, 2.49),
    ]
    res = build_product_history(records, "SCHINKEN", [{"day": "2026-10-01", "price": 2.49}], TODAY)
    assert res["name"] == "Schinken" and len(res["records"]) == 4
    assert res["records"][0]["outcome"] == "thrown"  # newest first
    s = res["summary"]
    assert (s["count"], s["per_year"], s["avg_days"], s["eaten"], s["thrown"], s["thrown_value"]) == (4, 3, 6, 2, 2, 4.98)
    assert res["hint"] == {"key": "thrown_often", "thrown": 2, "of": 4}
    assert res["price_history"][0]["price"] == 2.49
    calm = build_product_history([_rec("Reis", "eaten", 20)] * 3, "Reis", None, TODAY)
    assert calm["hint"] == {"key": "usually_days", "days": 20}
    assert build_product_history([], "Nix", None, TODAY)["summary"]["count"] == 0


async def test_recent_several_packs_and_history_ws(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "product": {"brand": "Develey", "price": 1.49}}], pantry.id, "Schrank")
    res = await _ws(hass, hass_ws_client, type="larder/recent_products")
    item = res["result"]["items"][0]
    assert (item["content"], item["area"], item["compartment"], item["count"], item["product"]["brand"]) == ("Senf", "Vorrat", "Schrank", 1, "Develey")
    # several packs at once (put away ×3)
    res = await _ws(hass, hass_ws_client, type="larder/put_away", content="Senf", packs=3)
    assert res["result"]["added"] == 3 and res["result"]["count"] == 4
    # recently used: again, also when nothing is left
    for p in pack_entries(hass):
        await _ws(hass, hass_ws_client, type="larder/pack_take", device_id=p["device_id"], outcome="eaten")
    stock = await async_get_stock(hass)
    assert stock.recent[0]["content"] == "Senf"
    res = await _ws(hass, hass_ws_client, type="larder/recent_add", content="senf")
    assert res["success"], res
    assert res["result"]["area"] == "Vorrat" and res["result"]["count"] >= 1
    res = await _ws(hass, hass_ws_client, type="larder/recent_add", content="Unbekannt")
    assert not res["success"]
    # product history over the WebSocket
    history = await async_get_history(hass)
    history.add(build_record(cc="X", name="Dose 1", content="Senf", quantity=1, unit="pieces", area="Vorrat", filled_at=None, best_before=None, outcome="thrown"))
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="Senf")
    assert res["result"]["summary"]["thrown"] >= 1 and res["result"]["name"] == "Senf"
