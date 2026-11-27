"""Tests Block 37 (6.4): cooking with the stock."""

from custom_components.larder.cooking import _staple, match_ingredients, rank_recipes
from custom_components.larder.recipe_book import async_get_recipe_book
from custom_components.larder.stock import pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block18 import _create
from .test_disposable import _ws
from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def test_staples_and_matching() -> None:
    assert _staple("1 TL Salz") and _staple("Pfeffer") and _staple("2 EL Öl") and not _staple("500 g Hackfleisch")
    items = [
        {"cc": "a", "device_id": "da", "content": "Hackfleisch", "days_left": 1},
        {"cc": "b", "device_id": "db", "content": "Hackfleisch", "days_left": 5},
        {"cc": "c", "device_id": "dc", "content": "Heinz Ketchup Zero", "days_left": 90},
    ]
    out = match_ingredients(["500 g Hackfleisch", "Salz", "2 EL Heinz Ketchup"], items)
    # the earliest first; "Heinz Ketchup" does not take "Heinz Ketchup Zero"
    assert out[0]["pick"] == "da" and [m["device_id"] for m in out[0]["matches"]] == ["da", "db"]
    assert out[1]["staple"] and out[2]["matches"] == []
    ranked = rank_recipes(
        [
            {"id": "1", "title": "Bolognese", "ingredients": ["Hackfleisch", "Tomaten", "Salz"]},
            {"id": "2", "title": "Frikadellen", "ingredients": ["Hackfleisch", "Salz"]},
            {"id": "3", "title": "Pfannkuchen", "ingredients": ["Mehl", "Eier"]},
        ],
        items,
    )
    assert [(r["title"], r["have"], r["total"], r["soon"]) for r in ranked] == [("Frikadellen", 1, 1, 1), ("Bolognese", 1, 2, 1)]
    assert ranked[1]["missing"] == ["Tomaten"]


async def test_cook_from_the_recipe_book(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Tomatensoße", 2, quantity=3, unit="portions")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _create(hass, hass_ws_client, "pack", [{"content": "Spaghetti", "quantity": 2, "unit": "pieces"}], pantry.id)
    book = await async_get_recipe_book(hass)
    recipe = await book.async_save(title="Spaghetti Napoli", ingredients=["500 g Spaghetti", "1 Glas Tomatensoße", "Salz", "Basilikum"], steps=["Kochen"])
    recipe_id = recipe["id"] if isinstance(recipe, dict) else recipe
    res = (await _ws(hass, hass_ws_client, type="larder/cook_check", recipe_id=recipe_id))["result"]
    picks = [i["pick"] for i in res["ingredients"]]
    assert picks[0] and picks[1] and picks[2] is None and picks[3] is None
    ranking = (await _ws(hass, hass_ws_client, type="larder/cook_ranking"))["result"]["recipes"]
    assert ranking[0]["title"] == "Spaghetti Napoli" and (ranking[0]["have"], ranking[0]["total"]) == (2, 3)
    res = (await _ws(hass, hass_ws_client, type="larder/cook_done", device_ids=[p for p in picks if p], recipe_id=recipe_id))["result"]
    assert res == {"emptied": 0, "taken": 2}
    # a portion of the sauce, a pack of spaghetti
    assert hass.states.get(_eid(hass, "number", "AAAA")).state == "2.0"
    assert [p["count"] for p in pack_entries(hass) if p["content"] == "Spaghetti"] == [1]
