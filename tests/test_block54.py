"""Tests Blocks 54 + 55 (6.8): start page, repair hint links, first start, filling and putting away."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.repair_hints import ISSUE_LONG_EXPIRED, ISSUE_NO_AREA, async_get_repairs
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .test_block29 import _list
from .test_block43 import _move
from .test_disposable import _ws
from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_freezable_for_the_start_tiles(hass: HomeAssistant, hass_ws_client) -> None:
    """#210: the start page asks which tiles get 🧊."""
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    areas = ar.async_get(hass)
    fridge = areas.async_create("Kühlschrank")
    areas.async_create("Gefrierschrank")
    _move(hass, "AAAA", fridge.id)
    _move(hass, "BBBB", fridge.id)
    await hass.async_block_till_done()
    await _fill(hass, "AAAA", "Hackfleisch", 1)
    await _fill(hass, "BBBB", "Gekochte Eier", 1)
    res = (await _ws(hass, hass_ws_client, type="larder/freezable"))["result"]
    mince = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    assert res == {"device_ids": [mince.id]}


async def test_area_and_expired_fixes_list_contents_and_links(hass: HomeAssistant) -> None:
    """#211: like the best-before hint – contents, place and a link per entry."""
    from homeassistant.components.repairs import repairs_flow_manager
    from homeassistant.setup import async_setup_component

    hass.config.language = "de"
    assert await async_setup_component(hass, "repairs", {})
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Lachs", 2)
    cellar = ar.async_get(hass).async_create("Keller")
    _move(hass, "BBBB", cellar.id)
    await hass.async_block_till_done()
    await _fill(hass, "BBBB", "Chili", -20)
    (await async_get_repairs(hass)).async_update()
    flows = repairs_flow_manager(hass)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    result = await flows.async_init(DOMAIN, data={"issue_id": ISSUE_NO_AREA})
    assert result["step_id"] == "area"
    assert f"- **Lachs** – Dose AAAA, ohne Bereich → [öffnen](/larder?open={device.id})" in result["description_placeholders"]["containers"]
    result = await flows.async_init(DOMAIN, data={"issue_id": ISSUE_LONG_EXPIRED})
    assert result["step_id"] == "empty"
    assert "- **Chili** – Dose BBBB, Keller → [öffnen]" in result["description_placeholders"]["containers"]


async def test_shopping_list_from_the_first_steps(hass: HomeAssistant, hass_ws_client) -> None:
    """#213: the list is picked right in step 2 – the same setting as in Configure."""
    await _list(hass)
    await _setup(hass, "AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/shopping_list_set", entity_id="todo.einkaufen")
    assert res["result"] == {"entity_id": "todo.einkaufen"}
    assert (await async_get_estimator(hass)).todo_entity == "todo.einkaufen"
    assert (await _ws(hass, hass_ws_client, type="larder/settings"))["result"]["shopping_list"] is True
    res = await _ws(hass, hass_ws_client, type="larder/shopping_list_set", entity_id="todo.gibtsnicht")
    assert res["success"] is False


async def test_vacuum_question(hass: HomeAssistant, hass_ws_client) -> None:
    """#217: asked once; without a sealer the preset goes off and empty containers lose the tick."""
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "BBBB", "Gulasch", 30)
    assert (await _ws(hass, hass_ws_client, type="larder/settings"))["result"]["vacuum_asked"] is False
    switch_a, switch_b = _eid(hass, "switch", "AAAA"), _eid(hass, "switch", "BBBB")
    assert hass.states.get(switch_a).state == "on"
    res = await _ws(hass, hass_ws_client, type="larder/vacuum_answer", has_sealer=False)
    await hass.async_block_till_done()
    assert res["result"] == {"vacuum_default": False, "changed": 1}
    assert hass.states.get(switch_a).state == "off"
    assert hass.states.get(switch_b).state == "on"  # filled: stays as it was stored
    assert (await async_get_estimator(hass)).vacuum_default is False
    assert (await async_get_stock(hass)).vacuum_asked is True
    assert (await _ws(hass, hass_ws_client, type="larder/settings"))["result"]["vacuum_asked"] is True


async def test_put_away_by_name(hass: HomeAssistant, hass_ws_client) -> None:
    """#223: bread from the bakery – no barcode, just the name; unknown names are collected."""
    await _setup(hass, "AAAA")
    res = (await _ws(hass, hass_ws_client, type="larder/put_away", content="Bauernbrot"))["result"]
    assert res["status"] == "unknown"
