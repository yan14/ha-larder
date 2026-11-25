"""Tests block 45 (6.0): import from Grocy, recipe from a link, French and Dutch."""

from datetime import timedelta

import pytest

from custom_components.larder.grocy import GrocyError, base_url
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401

GROCY = "http://grocy.local:9283"


def _grocy(aioclient_mock, best: str) -> None:
    aioclient_mock.get(f"{GROCY}/api/objects/locations", json=[
        {"id": 1, "name": "Kühlschrank", "is_freezer": 0}, {"id": 2, "name": "Keller", "is_freezer": 0}, {"id": 3, "name": "Leer", "is_freezer": 0}])
    aioclient_mock.get(f"{GROCY}/api/objects/products", json=[
        {"id": 10, "name": "Heinz Ketchup Zero", "location_id": 1, "default_best_before_days_after_open": 56},
        {"id": 11, "name": "Spaghetti", "location_id": 2, "default_best_before_days_after_open": 0}])
    aioclient_mock.get(f"{GROCY}/api/objects/product_barcodes", json=[{"product_id": 10, "barcode": "8715700421360"}])
    aioclient_mock.get(f"{GROCY}/api/objects/stock", json=[
        {"product_id": 10, "amount": "2", "best_before_date": best, "open": 1, "opened_date": "2026-11-01", "location_id": 1, "price": "2.49"},
        {"product_id": 11, "amount": "3", "best_before_date": "2999-12-31", "open": 0, "location_id": 2},
        {"product_id": 99, "amount": "1", "best_before_date": best, "location_id": 2}])


def test_grocy_address() -> None:
    assert base_url("grocy.local:9283/") == "http://grocy.local:9283"
    assert base_url("https://x.example/grocy/api/") == "https://x.example/grocy"
    with pytest.raises(GrocyError):
        base_url("ftp://x")


async def test_import_from_grocy(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    best = (dt_util.now().date() + timedelta(days=100)).isoformat()
    _grocy(aioclient_mock, best)
    res = await _ws(hass, hass_ws_client, type="larder/grocy_preview", url="grocy.local:9283", api_key="k")
    assert res["success"], res
    preview = res["result"]
    assert preview["total"] == 2  # the entry of an unknown product is skipped
    assert [(loc["name"], loc["area_id"], loc["count"]) for loc in preview["locations"]] == [("Kühlschrank", fridge.id, 1), ("Keller", None, 1)]
    cellar = ar.async_get(hass).async_create("Vorratskeller")
    res = await _ws(hass, hass_ws_client, type="larder/grocy_import", url="grocy.local:9283", api_key="k", areas={"1": fridge.id, "2": cellar.id})
    assert res["success"], res
    assert res["result"] == {"created": 2, "after_open": 1}
    packs = {p["content"]: p for p in pack_entries(hass)}
    ketchup, pasta = packs["Heinz Ketchup Zero"], packs["Spaghetti"]
    assert (ketchup["area_id"], ketchup["count"], ketchup["best_before"], ketchup["opened"]) == (fridge.id, 2, best, "2026-11-01")
    assert (pasta["area_id"], pasta["count"], pasta["best_before"]) == (cellar.id, 3, None)
    stock = await async_get_stock(hass)
    assert stock.opened_after["heinz ketchup zero"]["days"] == 56 and "spaghetti" not in stock.opened_after


async def test_grocy_errors(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    aioclient_mock.get(f"{GROCY}/api/objects/locations", status=401)
    res = await _ws(hass, hass_ws_client, type="larder/grocy_preview", url=GROCY, api_key="wrong")
    assert not res["success"] and res["error"]["code"] == "grocy_failed" and "API key" in res["error"]["message"]


PAGE = """<html><head><title>Chili</title>
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
 {"@type": "WebPage", "name": "x"},
 {"@type": ["Recipe"], "name": "Chili sin Carne &amp; Reis", "totalTime": "PT1H15M",
  "recipeIngredient": ["400 g Kidneybohnen", "1 Dose <b>Tomaten</b>", ""],
  "recipeInstructions": [{"@type": "HowToSection", "name": "Vorbereiten", "itemListElement": [
     {"@type": "HowToStep", "text": "Zwiebeln schneiden."}]},
     {"@type": "HowToStep", "text": "Alles 30 Minuten köcheln."}]}]}
</script></head><body>…</body></html>"""


def test_recipe_from_page() -> None:
    from custom_components.larder.recipe_link import RecipeLinkError, parse_recipe

    recipe = parse_recipe(PAGE)
    assert recipe == {
        "title": "Chili sin Carne & Reis",
        "ingredients": ["400 g Kidneybohnen", "1 Dose Tomaten"],
        "steps": ["Zwiebeln schneiden.", "Alles 30 Minuten köcheln."],
        "minutes": 75,
    }
    with pytest.raises(RecipeLinkError):
        parse_recipe("<html><body>Kein Rezept</body></html>")


async def test_recipe_from_link_and_save(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    await _setup(hass, "AAAA")
    aioclient_mock.get("https://koch.example/chili", text=PAGE)
    aioclient_mock.get("https://koch.example/none", text="<html></html>")
    res = await _ws(hass, hass_ws_client, type="larder/recipe_from_url", url="https://koch.example/chili")
    assert res["success"], res
    recipe = res["result"]["recipe"]
    assert recipe["source"] == "link" and recipe["url"] == "https://koch.example/chili" and recipe["minutes"] == 75
    res = await _ws(hass, hass_ws_client, type="larder/recipe_save", title=recipe["title"], ingredients=recipe["ingredients"],
                    steps=recipe["steps"], minutes=75, source="link", url=recipe["url"])
    assert res["result"]["recipe"]["source"] == "link" and res["result"]["recipe"]["url"] == "https://koch.example/chili"
    res = await _ws(hass, hass_ws_client, type="larder/recipe_from_url", url="https://koch.example/none")
    assert not res["success"] and res["error"]["code"] == "no_recipe"
