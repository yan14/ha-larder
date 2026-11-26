"""Tests Block 46 (6.1): finishing the shopping – list after putting away, best-before suggestion, invoices, price."""

from datetime import timedelta
from http import HTTPStatus

from custom_components.larder.receipt_photo import URL as RECEIPT_URL, build_instructions
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_block18 import _create
from .test_disposable import _ws
from .test_recipe_photo import _fake_ai, _form, ready  # noqa: F401
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401

EAN = "4000000000001"


async def test_put_away_list_finishes_price_date_and_place(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, cellar = areas.async_create("Kühlschrank"), areas.async_create("Keller")
    await _create(hass, hass_ws_client, "pack", [{"content": "Milch", "quantity": 1, "unit": "pieces", "product": {"ean": EAN}}], fridge.id)
    stock = await async_get_stock(hass)
    # the ＋ dialog logs the new pack, put away logs the added one
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN))["result"]
    assert res["status"] == "added"
    rows = (await _ws(hass, hass_ws_client, type="larder/put_away_recent"))["result"]["rows"]
    assert [(r["content"], r["added"], r["count"]) for r in rows] == [("Milch", 2, 2)]
    # no history yet: milk (fresh) gets a suggestion from the table, marked as such
    assert rows[0]["suggest"]["source"] == "table"

    today = dt_util.now().date()
    best = (today + timedelta(days=9)).isoformat()
    res = await _ws(hass, hass_ws_client, type="larder/put_away_save", rows=[{"device_id": rows[0]["device_id"], "added": 2, "price": 1.19, "best_before": best, "store": "Rewe", "area_id": cellar.id, "compartment": "Regal"}])
    assert res["success"] and res["result"]["saved"] == 1
    packs = [(p["area_id"], p["compartment"], p["count"], p["best_before"], p["price"]) for p in pack_entries(hass) if p["content"] == "Milch"]
    assert packs == [(cellar.id, "Regal", 2, best, 1.19)]
    # learned: milk keeps 9 days when bought – the next purchase is suggested from that
    assert stock.typical_buy_days("Milch") == 9
    assert stock.typical_buy_days("Hafermilch") is None  # never shared with similar products
    rows = (await _ws(hass, hass_ws_client, type="larder/put_away_recent"))["result"]["rows"]
    assert rows[0]["best_before"] == best and "suggest" not in rows[0]
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN))["result"]
    assert res["suggest"] == {"best_before": best, "days": 9, "source": "history"}


async def test_put_away_list_only_dates_the_new_packs(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _create(hass, hass_ws_client, "pack", [{"content": "Spaghetti", "quantity": 3, "unit": "pieces", "product": {"ean": EAN}}], pantry.id)
    stock = await async_get_stock(hass)
    stock.put_away_log = []  # the three were there before
    await _ws(hass, hass_ws_client, type="larder/put_away", code=EAN)
    rows = (await _ws(hass, hass_ws_client, type="larder/put_away_recent"))["result"]["rows"]
    assert [(r["added"], r["count"]) for r in rows] == [(1, 4)]
    assert "suggest" not in rows[0]  # pasta: no table suggestion for long-life packs
    res = await _ws(hass, hass_ws_client, type="larder/put_away_save", rows=[{"device_id": rows[0]["device_id"], "added": 1, "best_before": "2028-01-31"}])
    assert res["success"]
    assert sorted((p["count"], p["best_before"]) for p in pack_entries(hass)) == [(1, "2028-01-31"), (3, None)]
    # the list follows the new entry
    rows = (await _ws(hass, hass_ws_client, type="larder/put_away_recent"))["result"]["rows"]
    assert [(r["added"], r["count"], r["best_before"]) for r in rows] == [(1, 1, "2028-01-31")]


async def test_price_set_from_the_product_view(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _create(hass, hass_ws_client, "pack", [{"content": "Heinz Ketchup", "quantity": 2, "unit": "pieces"}, {"content": "Heinz Ketchup Zero", "quantity": 1, "unit": "pieces"}], pantry.id)
    res = await _ws(hass, hass_ws_client, type="larder/price_set", content="heinz ketchup", price=2.49, store="Rewe")
    assert res["result"] == {"packs": 1}
    prices = {p["content"]: p["price"] for p in pack_entries(hass)}
    assert prices == {"Heinz Ketchup": 2.49, "Heinz Ketchup Zero": None}
    stock = await async_get_stock(hass)
    assert stock.prices_by_store("Heinz Ketchup")[0]["store"] == "Rewe"
    res = await _ws(hass, hass_ws_client, type="larder/price_set", content="Heinz Ketchup", price=None)
    assert res["success"]
    assert {p["content"]: p["price"] for p in pack_entries(hass)}["Heinz Ketchup"] is None
    # no packs: only remembered for the next purchase
    res = await _ws(hass, hass_ws_client, type="larder/price_set", content="Senf", price=0.99)
    assert res["result"] == {"packs": 0} and stock.prices["senf"]["price"] == 0.99


async def test_receipt_takes_an_invoice_as_pdf(hass: HomeAssistant, hass_client, ready) -> None:  # noqa: F811
    calls = _fake_ai(hass, {"found": True, "store": "REWE", "items": [{"name": "Milch", "count": 2, "price": 1.19}]})
    client = await hass_client()
    resp = await client.post(RECEIPT_URL, data=_form(("rechnung.pdf", "application/pdf", b"%PDF-1.4 x")))
    assert resp.status == HTTPStatus.OK
    assert (await resp.json()) == {"items": [{"name": "Milch", "count": 2, "price": 1.19}], "store": "REWE"}
    assert calls[0]["attachments"][0]["media_content_type"] == "application/pdf"
    text = build_instructions("de")
    assert "invoice" in text and "delivery" in text and "several pages" in text


# ---------- Block 44 (6.2): freezer first ----------


def test_freezer_first_weights_and_choice() -> None:
    from datetime import date

    from custom_components.larder.week_plan import _weight, choose

    window = 42
    fridge_soon = {"cc": "f1", "days_left": 2}
    fridge_week = {"cc": "f2", "days_left": 7}
    pantry = {"cc": "p1", "days_left": 200}
    frozen_near = {"cc": "z1", "days_left": 20, "frozen": True}
    frozen_far = {"cc": "z2", "days_left": 200, "frozen": True}
    # fridge within a week first, then frozen near the end of its best quality, before long-life food
    assert _weight(fridge_soon, window) > _weight(fridge_week, window) >= _weight(frozen_near, window) > _weight(pantry, window)
    assert _weight(frozen_far, window) == 0.0  # nothing is thawed at random
    assert _weight(frozen_far) > 0  # setting off: as before
    items = [fridge_soon, frozen_near, frozen_far, pantry]
    candidates = [
        {"title": "Gulasch", "ccs": ["z1"]},
        {"title": "Eintopf", "ccs": ["p1"]},
        {"title": "Omelett", "ccs": ["f1"]},
        {"title": "Braten", "ccs": ["z2"]},
    ]
    days = [date(2026, 12, 1), date(2026, 12, 2), date(2026, 12, 3), date(2026, 12, 4)]
    chosen, _ = choose(candidates, items, days, window)
    assert [c["title"] for c in chosen] == ["Omelett", "Gulasch", "Eintopf"]


def test_recipe_instructions_name_frozen_food() -> None:
    from custom_components.larder.recipes import _describe

    line = _describe({"content": "Gulasch", "name": "Dose 1", "days_left": 20, "frozen": True, "area": "Gefrierschrank"}, "de")
    assert "frozen, best quality ends in 20 days" in line and "thawing" in line
