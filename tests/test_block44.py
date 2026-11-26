"""Tests Block 44 (6.2): freezer first, compartment suggestion, the user's language."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.place_suggest import async_suggest_place
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from .test_block18 import _create
from .test_block43 import _move
from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_compartment_suggestion_same_before_free(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    freezer = ar.async_get(hass).async_create("Gefrierschrank")
    await _create(hass, hass_ws_client, "bag", [{"content": "Hackfleisch"}], freezer.id, compartment="Schublade 1")
    await _create(hass, hass_ws_client, "bag", [{"content": "Erbsen"}, {"content": "Spinat"}], freezer.id, compartment="Schublade 2")
    await _create(hass, hass_ws_client, "bag", [{"content": "Heinz Ketchup Zero"}], freezer.id, compartment="Schublade 3")
    # 1. where the same is
    assert await async_suggest_place(hass, "hackfleisch", freezer.id) == {"area_id": freezer.id, "compartment": "Schublade 1", "reason": "same"}
    # never a similar product: Heinz Ketchup is not Heinz Ketchup Zero → the emptiest compartment
    res = await _ws(hass, hass_ws_client, type="larder/place_suggest", content="Heinz Ketchup", area_id=freezer.id)
    assert res["result"]["suggestion"]["reason"] == "free" and res["result"]["suggestion"]["compartment"] in ("Schublade 1", "Schublade 3")
    # 2. where it was last time
    stock = await async_get_stock(hass)
    stock.recent.insert(0, {"content": "Rotkohl", "kind": "bag", "area_id": freezer.id, "compartment": "Schublade 2"})
    assert (await async_suggest_place(hass, "Rotkohl", freezer.id))["reason"] == "before"
    # no area chosen: the area of the same product comes along
    assert (await async_suggest_place(hass, "Erbsen"))["area_id"] == freezer.id
    # nothing known, no area: no suggestion
    assert await async_suggest_place(hass, "Lachs") is None


async def test_estimate_uses_the_language_of_the_user(hass: HomeAssistant) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    _move(hass, "AAAA", fridge.id)
    await hass.async_block_till_done()
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "AAAA"), "value": "Pommes"}, blocking=True)
    date_id = _eid(hass, "date", "AAAA")
    # a German user: chips, a dish (the system language is German as well)
    out = (await hass.services.async_call(DOMAIN, "estimate_best_before", {"entity_id": date_id, "overwrite": True, "apply": False}, blocking=True, return_response=True))[date_id]
    assert "Gericht" in out["basis"] or "Reste" in out["basis"], out
    # a French user: apples, and the tip in French
    out = (await hass.services.async_call(DOMAIN, "estimate_best_before", {"entity_id": date_id, "overwrite": True, "apply": False, "language": "fr"}, blocking=True, return_response=True))[date_id]
    assert "Pommes" in out["basis"] and "réfrigérateur" in out["basis"].lower(), out
