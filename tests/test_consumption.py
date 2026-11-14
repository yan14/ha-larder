"""Tests Block 15: Verbrauch, Vorschlag Mindestbestand, Preise (eigene, gemerkte, Open Prices), Kosten."""

from datetime import date, timedelta

from custom_components.larder.consumption import OPEN_PRICES_URL, forecast, open_prices_median, suggested_minimum
from custom_components.larder.receipt_photo import parse_items
from custom_components.larder.stats import build_monthly_report, record_value
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs

TODAY = date(2026, 11, 14)


def _takes(*ages, n=1):
    return [{"day": (TODAY - timedelta(days=a)).isoformat(), "n": n} for a in ages]


def test_forecast_adapts_the_window_and_weights_recent_takes() -> None:
    # alle 3 Wochen eine Flasche, seit 4 Monaten: Fenster 90 Tage genügt
    weekly = forecast(_takes(0, 21, 42, 63, 84, 105, 126), 3, TODAY)
    assert weekly["takes"] == 5 and weekly["days"] == 90
    assert 0.25 < weekly["per_week"] < 0.5 and 40 < weekly["lasts_days"] < 90
    # selten: in 90 Tagen nur 1, in 180 Tagen 2, in 365 Tagen 3 → Fenster ein Jahr
    rare = forecast(_takes(30, 150, 300), 1, TODAY)
    assert rare["days"] == 301 and rare["takes"] == 3
    assert forecast(_takes(10, 20), 2, TODAY) is None  # zu wenig
    assert forecast([], 2, TODAY) is None
    # neuere Entnahmen zählen stärker: gleich viele, aber zuletzt gehäuft → höherer Verbrauch
    recent = forecast(_takes(1, 2, 3, 80, 85, 89), 1, TODAY)
    early = forecast(_takes(1, 50, 55, 80, 85, 89), 1, TODAY)
    assert recent["per_week"] > early["per_week"]
    # erst seit kurzem erfasst: rechnet ab der ersten Entnahme (mindestens 14 Tage)
    new = forecast(_takes(0, 3, 6, 9), 2, TODAY)
    assert new["days"] == 14


def test_suggested_minimum() -> None:
    assert suggested_minimum(0.35, 7) == 1
    assert suggested_minimum(3.5, 7) == 4
    assert suggested_minimum(None, 7) is None


def test_open_prices_median_prefers_own_country_and_regular_prices() -> None:
    items = [
        {"price": 1.3, "price_is_discounted": True, "price_without_discount": 1.5, "currency": "EUR", "date": "2026-10-01", "location": {"osm_address_country_code": "DE"}},
        {"price": 1.9, "currency": "EUR", "date": "2026-09-01", "location": {"osm_address_country_code": "DE"}},
        {"price": 1.7, "currency": "EUR", "date": "2026-08-01", "location": {"osm_address_country_code": "DE"}},
        {"price": 0.9, "currency": "EUR", "date": "2026-10-01", "location": {"osm_address_country_code": "ES"}},
        {"price": 2.0, "currency": "USD", "date": "2026-10-01", "location": {}},
        {"price": 1.0, "currency": "EUR", "date": "2024-01-01", "location": {"osm_address_country_code": "DE"}},
        {"price": 5.0, "currency": "EUR", "date": "2026-10-01", "price_per": "KILOGRAM", "location": {}},
    ]
    assert open_prices_median(items, "DE", TODAY) == {"price": 1.7, "source": "openprices", "count": 3, "local": True}
    assert open_prices_median(items, "FR", TODAY)["count"] == 4  # kein Preis aus FR: alle aus der EU
    assert open_prices_median([], "DE", TODAY) is None


def test_receipt_prices_and_record_value() -> None:
    items = parse_items({"found": True, "items": [{"name": "Ketchup", "count": 2, "price": 1.99}, {"name": "Brot", "price": "x"}]})
    assert items == [{"name": "Ketchup", "count": 2, "price": 1.99}, {"name": "Brot", "count": 1}]
    records = [
        {"product": {"price": 2.5}, "kind": "pack", "quantity": 2, "unit": "pieces"},
        {"product": {"price": 1.2}},
        {"product": {}},
    ]
    assert record_value(records) == (6.2, 2)
    report = build_monthly_report(
        [{"content": "Käse", "filled_at": "2026-10-01T10:00:00+01:00", "emptied": "2026-10-20T10:00:00+01:00", "best_before": "2026-10-10", "expired": True, "outcome": "thrown", "product": {"price": 3.49}}],
        [], "2026-10", "de",
    )
    assert report["thrown_value"] == 3.49 and "ca. 3,49 € weggeworfen" in report["summary"] and "etwa 3 Euro" in report["speech"]


async def test_takes_are_logged_and_feed_the_stock_view(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    aioclient_mock.get(OPEN_PRICES_URL, json={"items": [
        {"price": 2.29, "currency": "EUR", "date": dt_util.now().date().isoformat(), "location": {"osm_address_country_code": "DE"}}]})
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, stock_lead_days=21)
    pantry, fridge = ar.async_get(hass).async_create("Vorrat"), ar.async_get(hass).async_create("Kühlschrank")
    src = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 6, "unit": "pieces", "product": {"price": 1.99, "price_source": "receipt", "ean": "4000000000001"}}], pantry.id))[0]
    stock = await async_get_stock(hass)
    assert stock.prices["ketchup"]["price"] == 1.99 and stock.prices["ketchup"]["source"] == "receipt"
    number = _eid(hass, "number", src["cc"])
    # Umräumen und Anbrechen zählen nicht als Verbrauch
    await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=src["device_id"], count=1, area_id=fridge.id)
    await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=src["device_id"])
    assert stock.takes == []
    # Entnahmen: -1 und -2
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 3}, blocking=True)
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 1}, blocking=True)
    await hass.async_block_till_done()
    assert [t["n"] for t in stock.takes] == [1, 2]
    attrs = hass.states.get(_eid(hass, "text", src["cc"])).attributes
    assert attrs["consumption_per_week"] > 0 and attrs["consumption_basis"]["takes"] == 3
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    ketchup = next(p for p in res["result"]["products"] if p["key"] == "ketchup")
    assert ketchup["usage"]["takes"] == 3 and ketchup["usage"]["lasts_days"] >= 0
    assert ketchup["suggested_min"] >= 1 and res["result"]["lead_days"] == 21
    assert ketchup["price"] == {"price": 1.99, "source": "receipt"}
    assert ketchup["value"] == round(ketchup["count"] * 1.99, 2) and res["result"]["value"] == ketchup["value"]

    # ohne eigenen Preis, aber mit Strichcode: Open Prices im Hintergrund
    senf_pack = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 2, "unit": "pieces", "product": {"ean": "4000000000002"}}]))[0]
    await _ws(hass, hass_ws_client, type="larder/stock")
    await hass.async_block_till_done()
    assert stock.prices["senf"]["source"] == "openprices" and stock.prices["senf"]["price"] == 2.29
    attrs = hass.states.get(_eid(hass, "text", senf_pack["cc"])).attributes
    assert attrs["price_remembered"] == 2.29 and attrs["price_remembered_source"] == "openprices"
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    senf = next(p for p in res["result"]["products"] if p["key"] == "senf")
    assert senf["price"]["source"] == "openprices" and senf["price"]["count"] == 1 and senf["value"] == 4.58
    # eigener Preis schlägt die Schätzung, umgekehrt nicht
    stock.remember_price("Senf", 1.49, "own")
    stock.remember_price("Senf", 2.29, "openprices")
    assert stock.prices["senf"]["price"] == 1.49
