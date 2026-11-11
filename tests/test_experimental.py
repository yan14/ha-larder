"""Tests: zweites Panel "Larder experimental", Kategorie am Inhalt und Rezeptbuch."""

import re

from homeassistant.components import frontend
from homeassistant.core import HomeAssistant

from custom_components.larder.const import DOMAIN

from .test_ai_estimate import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


async def _options(hass: HomeAssistant, entry, **data) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"estimate_mode": "table", **data})
    await hass.async_block_till_done()


async def test_experimental_panel_is_off_by_default_and_follows_the_setting(
    hass: HomeAssistant, hass_client
) -> None:
    entry = await _setup(hass)
    panels = hass.data[frontend.DATA_PANELS]
    assert "larder" in panels and "larder-experimental" not in panels

    await _options(hass, entry, experimental_panel=True)
    panel = hass.data[frontend.DATA_PANELS]["larder-experimental"]
    assert panel.sidebar_title == "Larder experimental"
    assert panel.require_admin is False
    assert panel.config["_panel_custom"]["name"] == "larder-experimental"
    assert re.fullmatch(
        r"/larder_static/larder-experimental\.js\?v=\d+\.\d+\.\d+", panel.config["_panel_custom"]["module_url"]
    )
    client = await hass_client()
    resp = await client.get("/larder_static/larder-experimental.js")
    assert resp.status == 200
    assert "larder-experimental" in await resp.text()
    assert "larder" in hass.data[frontend.DATA_PANELS]  # das normale Dashboard bleibt

    await _options(hass, entry, experimental_panel=False)
    assert "larder-experimental" not in hass.data[frontend.DATA_PANELS]
    assert "larder" in hass.data[frontend.DATA_PANELS]


async def test_experimental_panel_survives_reload_and_leaves_with_last_container(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    await _options(hass, entry, experimental_panel=True)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder-experimental" in hass.data[frontend.DATA_PANELS]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder-experimental" not in hass.data[frontend.DATA_PANELS]
    # Die Einstellung bleibt: nach dem Laden ist das Panel wieder da
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder-experimental" in hass.data[frontend.DATA_PANELS]


async def test_content_has_a_category_attribute(hass: HomeAssistant) -> None:
    await _setup(hass)
    text = _eid(hass, "text")
    assert hass.states.get(text).attributes["category"] is None
    for content, category in [("Lachs", "fish"), ("Tomatensuppe", "dish"), ("Gouda", "dairy"), ("Xyzzy", None)]:
        await hass.services.async_call("text", "set_value", {"entity_id": text, "value": content}, blocking=True)
        assert hass.states.get(text).attributes["category"] == category, content
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button")}, blocking=True)
    assert hass.states.get(text).attributes["category"] is None


_IDS = iter(range(1, 10_000))


async def _ws(hass, client, payload):
    await client.send_json({"id": next(_IDS), **payload})
    return await client.receive_json()


async def test_recipe_book_save_update_list_delete(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)

    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipes"})
    assert res["success"] and res["result"] == {"recipes": []}

    res = await _ws(
        hass,
        client,
        {
            "type": f"{DOMAIN}/recipe_save",
            "title": " Mac'n Cheese ",
            "ingredients": ["Nudeln", "  ", "Käse"],
            "steps": ["Kochen", "Überbacken"],
            "minutes": 30,
        },
    )
    assert res["success"]
    recipe = res["result"]["recipe"]
    assert recipe["title"] == "Mac'n Cheese"
    assert recipe["ingredients"] == ["Nudeln", "Käse"]
    assert (recipe["minutes"], recipe["source"]) == (30, "manual")

    res = await _ws(
        hass,
        client,
        {
            "type": f"{DOMAIN}/recipe_save",
            "recipe_id": recipe["id"],
            "title": "Mac and Cheese",
            "ingredients": ["Nudeln"],
            "source": "ai",
        },
    )
    updated = res["result"]["recipe"]
    assert updated["id"] == recipe["id"]
    assert updated["title"] == "Mac and Cheese"
    assert updated["source"] == "manual"  # die Herkunft bleibt
    assert updated["created"] == recipe["created"]

    await _ws(hass, client, {"type": f"{DOMAIN}/recipe_save", "title": "Lasagne", "source": "ai"})
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipes"})
    assert [r["title"] for r in res["result"]["recipes"]] == ["Lasagne", "Mac and Cheese"]  # neueste zuerst

    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipe_delete", "recipe_id": recipe["id"]})
    assert res["success"]
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipe_delete", "recipe_id": recipe["id"]})
    assert not res["success"] and res["error"]["code"] == "not_found"
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipes"})
    assert [r["title"] for r in res["result"]["recipes"]] == ["Lasagne"]


async def test_recipe_book_validation(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipe_save", "title": "   "})
    assert not res["success"] and res["error"]["code"] == "invalid_format"
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipe_save", "title": "X", "minutes": 0})
    assert not res["success"]
    res = await _ws(hass, client, {"type": f"{DOMAIN}/recipe_save", "title": "X", "recipe_id": "gibtsnicht"})
    assert not res["success"] and res["error"]["code"] == "not_found"


async def test_recipe_book_is_readable_by_everyone_but_only_admins_change_it(
    hass: HomeAssistant, hass_ws_client, hass_read_only_access_token
) -> None:
    await _setup(hass)
    admin = await hass_ws_client(hass)
    await _ws(hass, admin, {"type": f"{DOMAIN}/recipe_save", "title": "Lasagne"})
    reader = await hass_ws_client(hass, hass_read_only_access_token)
    res = await _ws(hass, reader, {"type": f"{DOMAIN}/recipes"})
    assert [r["title"] for r in res["result"]["recipes"]] == ["Lasagne"]
    res = await _ws(hass, reader, {"type": f"{DOMAIN}/recipe_save", "title": "Hack"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    res = await _ws(hass, reader, {"type": f"{DOMAIN}/recipe_delete", "recipe_id": "x"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"


async def test_recipe_book_persists(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await _ws(hass, client, {"type": f"{DOMAIN}/recipe_save", "title": "Lasagne", "ingredients": ["Nudeln"]})
    await hass.async_block_till_done()
    stored = hass_storage[f"{DOMAIN}.recipes"]["data"]["recipes"]
    assert [r["title"] for r in stored] == ["Lasagne"]
