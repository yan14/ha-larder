"""Tests Block 63 (6.12): groups in the stock."""

from custom_components.larder.product_units import group_suggestions
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_disposable import _ws
from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def test_group_suggestions_by_base_word() -> None:
    names = ["Vollmilch", "Fettarme Milch", "Schwartau Preiselbeeren", "Wild-Preiselbeeren", "Milchreis", "Brot", "Ketchup Zero"]
    out = group_suggestions(names, lambda n: None, [], set())
    assert [(s["group"], s["members"]) for s in out] == [
        ("Milch", ["Fettarme Milch", "Vollmilch"]),
        ("Preiselbeeren", ["Schwartau Preiselbeeren", "Wild-Preiselbeeren"]),
    ]
    # declined, already grouped, or an existing group with one new member
    assert group_suggestions(names, lambda n: None, [], {"milch", "preiselbeeren"}) == []
    grouped = {"Vollmilch": "Milch"}
    out = group_suggestions(names, grouped.get, ["Milch"], set())
    assert {"key": "milch", "group": "Milch", "members": ["Fettarme Milch"], "exists": True} in out


async def test_suggestion_in_data_care_accept_and_decline(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    items = [{"content": n, "quantity": 1, "unit": "pieces"} for n in ("Vollmilch", "Fettarme Milch", "Ketchup", "Ketchup Zero")]
    await _packs(hass, hass_ws_client, items, fridge.id)
    data = (await _ws(hass, hass_ws_client, type="larder/data_gaps"))["result"]
    assert {s["group"] for s in data["group_suggestions"]} == {"Milch", "Ketchup"}
    res = (await _ws(hass, hass_ws_client, type="larder/group_suggestion", key="ketchup", accept=False))["result"]
    assert [s["group"] for s in res["suggestions"]] == ["Milch"]
    res = (await _ws(hass, hass_ws_client, type="larder/group_suggestion", key="milch", accept=True, group="Milch", members=["Vollmilch", "Fettarme Milch"]))["result"]
    assert res["suggestions"] == [] and res["groups"][0]["count"] == 2
    stock = await async_get_stock(hass)
    assert stock.group_of("Fettarme Milch") == "Milch" and stock.group_of("Ketchup") is None
    assert stock.group_dismissed == ["ketchup"]
