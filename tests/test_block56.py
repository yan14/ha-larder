"""Tests Block 56 (6.9): store sections – more built-in ones and own ones."""

from custom_components.larder.sections import SECTIONS, merge_order, section_of, section_order, suggest_section
from homeassistant.core import HomeAssistant

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401


def test_new_sections_are_suggested() -> None:
    """#237: pasta & rice, canned, baking, spices, international, sweets – and drinks no longer by accident."""
    expected = {
        "Spaghetti": "pasta", "Basmati Reis": "pasta", "Gehackte Tomaten": "canned", "Thunfisch in Öl": "canned",
        "Mehl": "baking", "Zucker": "baking", "Backpulver": "baking", "Salz": "spices", "Paprikapulver": "spices",
        "Kokosmilch": "international", "Pelmeni": "international", "Ajvar": "international",
        "Schokolade": "sweets", "Gummibärchen": "sweets", "Chips": "sweets", "Kaffee": "breakfast",
        "Pfefferminztee": "breakfast", "Erdbeeren": "produce", "Wildpreiselbeeren": "breakfast",
        "Schweinefleisch": "meat", "Wassermelone": "produce", "Orangensaft": "drinks", "Rotwein": "drinks",
        "Ketchup": "dry", "Milch": "fridge",
    }
    assert {name: suggest_section(name) for name in expected} == expected


def test_saved_order_keeps_its_shape() -> None:
    """A full order saved before 6.9 gets the new sections behind their old neighbour."""
    old = ["fridge", "produce", "bakery", "meat", "dry", "breakfast", "drinks", "frozen", "drugstore", "pharmacy", "other"]
    order = merge_order(old, list(SECTIONS))
    assert order[:10] == ["fridge", "produce", "bakery", "meat", "dry", "pasta", "canned", "baking", "spices", "international"]
    assert order[10:12] == ["breakfast", "sweets"] and len(order) == len(SECTIONS)
    # a partial order: the rest is appended as before
    assert merge_order(["drinks", "produce"], list(SECTIONS))[:3] == ["drinks", "produce", "bakery"]


async def test_own_sections(hass: HomeAssistant, hass_ws_client) -> None:
    """#238: add, use, rename and delete an own section."""
    await _setup(hass, "AAAA")
    res = (await _ws(hass, hass_ws_client, type="larder/section_own", name="Bio-Ecke"))["result"]
    key = res["key"]
    assert key == "own_bio_ecke" and res["own"] == {key: "Bio-Ecke"}
    assert key in res["order"] and res["order"].index(key) < res["order"].index("other")
    # the card: a product goes into it
    await _ws(hass, hass_ws_client, type="larder/product_section", content="Hafermilch", section=key)
    assert section_of(hass, "Hafermilch") == key
    # the general order and a store order take it
    order = section_order(hass)
    await _ws(hass, hass_ws_client, type="larder/section_order", order=[key, *[s for s in order if s != key]])
    assert section_order(hass)[0] == key
    await _ws(hass, hass_ws_client, type="larder/store_save", name="Rewe", order=[key, "produce"])
    # rename keeps the key
    res = (await _ws(hass, hass_ws_client, type="larder/section_own", key=key, name="Bio"))["result"]
    assert res["own"] == {key: "Bio"}
    assert (await _ws(hass, hass_ws_client, type="larder/settings"))["result"]["own_sections"] == {key: "Bio"}
    # delete: the product gets its suggestion again, the orders forget it
    res = (await _ws(hass, hass_ws_client, type="larder/section_own", key=key, delete=True))["result"]
    assert res["own"] == {} and key not in res["order"]
    assert section_of(hass, "Hafermilch") == "fridge"
    stores = (await _ws(hass, hass_ws_client, type="larder/stores"))["result"]["stores"]
    assert next(s for s in stores if s["name"] == "Rewe")["order"] == ["produce"]
    # unknown keys are refused
    res = await _ws(hass, hass_ws_client, type="larder/product_section", content="Milch", section="own_gibtsnicht")
    assert section_of(hass, "Milch") == "fridge"
    assert res["success"] is True
