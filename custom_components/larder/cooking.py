"""Cooking with the stock (6.4, Block 37).

* **Cooked** on a recipe of the recipe book (#136): Larder finds the containers and packs in stock that its
  ingredient lines name, the earliest date first; after checking, cooking takes them (a portion or a pack, the
  last one empties the entry as eaten). The meal plan's *Cooked* uses the same.
* **Leftovers** (#137): the dashboard offers to fill an empty container with the dish right away.
* **What can I cook?** (#138): the recipes of the recipe book, ranked by how many of their ingredients are in
  stock and how much of that expires soon – without AI. Salt, pepper, water and oil count as always there.

Products are never merged: an ingredient line matches a content only if all words of the content are in it.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, PACK_KINDS
from .devices import device_of, entry_of
from .entity import kind_of
from .expiry import collect_expiring
from .recipe_book import async_get_recipe_book

_LOGGER = logging.getLogger(__name__)

STAPLES = {
    "salz", "pfeffer", "wasser", "öl", "oel", "olivenöl", "rapsöl", "salt", "pepper", "water", "oil", "olive oil",
    "sel", "poivre", "eau", "huile", "zout", "peper", "olie",
}
_AMOUNT = re.compile(r"^[\d\s.,/½¼¾⅓-]*(?:g|kg|ml|l|el|tl|stk|stück|prise|tbsp|tsp|cup|cups|dose|glas|pck|päckchen)?\.?\s+", re.IGNORECASE)


def _staple(line: str) -> bool:
    text = _AMOUNT.sub("", str(line).strip().casefold())
    text = re.sub(r"\(.*?\)|,.*$", "", text).strip()
    return text in STAPLES or text.rstrip(".") in STAPLES


def stock_items(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Everything filled with food (containers, bags, packs), earliest date first, without a date last."""
    items = [i for i in collect_expiring(hass, days=None, include_expired=True, include_undated=True, vouchers=False) if (i.get("content") or "").strip()]
    for item in items:
        device = device_of(hass, item["cc"])
        item["device_id"] = device.id if device else None
        entry = entry_of(hass, item["cc"])
        item["kind"] = kind_of(entry) if entry else None
    return items


def match_ingredients(ingredients: list[str], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per ingredient line the entries in stock it names (earliest date first) and the one chosen first."""
    from .week_plan import uses_content  # noqa: PLC0415 - avoids an import cycle

    used: set[str] = set()
    out = []
    for line in ingredients:
        staple = _staple(line)
        matches = [] if staple else [i for i in items if uses_content(line, i["content"])]
        pick = next((m for m in matches if m["cc"] not in used), None)
        if pick is not None:
            used.add(pick["cc"])
        out.append(
            {
                "line": line,
                "staple": staple,
                "matches": [_public(m) for m in matches[:6]],
                "pick": pick["device_id"] if pick else None,
            }
        )
    return out


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "device_id": item.get("device_id"),
        "content": item.get("content"),
        "name": item.get("name"),
        "kind": item.get("kind"),
        "area": item.get("area"),
        "best_before": item.get("best_before"),
        "days_left": item.get("days_left"),
        **({"frozen": True} if item.get("frozen") else {}),
    }


def rank_recipes(recipes: list[dict[str, Any]], items: list[dict[str, Any]], soon_days: int = 3) -> list[dict[str, Any]]:
    """#138: recipes by the share of their ingredients in stock, then by how much of it expires soon."""
    ranked = []
    for recipe in recipes:
        matched = match_ingredients(list(recipe.get("ingredients") or []), items)
        lines = [m for m in matched if not m["staple"]]
        if not lines:
            continue
        have = [m for m in lines if m["matches"]]
        soon = sum(1 for m in have if any(x["days_left"] is not None and x["days_left"] <= soon_days for x in m["matches"]))
        ranked.append(
            {
                "recipe_id": recipe["id"],
                "title": recipe["title"],
                "have": len(have),
                "total": len(lines),
                "soon": soon,
                "missing": [m["line"] for m in lines if not m["matches"]][:8],
            }
        )
    ranked.sort(key=lambda r: (-(r["have"] / r["total"]), -r["soon"], -r["have"], r["title"].casefold()))
    return [r for r in ranked if r["have"]]


async def async_use_up(hass: HomeAssistant, ccs: list[str]) -> dict[str, int]:
    """Cooked: a pack less (consumption), one portion of a container with several, else empty it as eaten."""
    from .history import async_get_history  # noqa: PLC0415
    from .stock import async_take_one  # noqa: PLC0415

    registry = er.async_get(hass)
    history = await async_get_history(hass)
    emptied = taken = 0

    def state(domain: str, cc: str, key: str) -> str | None:
        entity_id = registry.async_get_entity_id(domain, DOMAIN, f"{cc}_{key}")
        st = hass.states.get(entity_id) if entity_id else None
        return st.state if st is not None and st.state not in ("unknown", "unavailable") else None

    for cc in ccs:
        if not (state("text", cc, "content") or "").strip():
            continue
        entry = entry_of(hass, cc)
        if entry is not None and kind_of(entry) in PACK_KINDS:
            try:
                result = await async_take_one(hass, cc, "eaten")
            except HomeAssistantError:
                _LOGGER.debug("Taking from %s not possible", cc, exc_info=True)
                continue
            if not result.get("left"):
                emptied += 1
            else:
                taken += 1
            continue
        try:
            quantity = int(float(state("number", cc, "portions") or 0))
        except ValueError:
            quantity = 0
        unit = state("select", cc, "unit") or "portions"
        number_id = registry.async_get_entity_id("number", DOMAIN, f"{cc}_portions")
        if quantity > 1 and unit in ("portions", "pieces", "slices") and number_id:
            await hass.services.async_call("number", "set_value", {"entity_id": number_id, "value": quantity - 1}, blocking=True)
            taken += 1
            continue
        button = registry.async_get_entity_id("button", DOMAIN, f"{cc}_empty_container")
        if button:
            history.set_pending(cc, "eaten")
            try:
                await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
                emptied += 1
            except HomeAssistantError:
                _LOGGER.debug("Emptying %s not possible", cc, exc_info=True)
            history.pop_pending(cc)
    return {"emptied": emptied, "taken": taken}


def _ccs_of(hass: HomeAssistant, device_ids: list[str]) -> list[str]:
    from homeassistant.helpers import device_registry as dr  # noqa: PLC0415

    from .const import larder_id  # noqa: PLC0415

    registry = dr.async_get(hass)
    out = []
    for device_id in device_ids:
        device = registry.async_get(device_id)
        if device is not None and (cc := larder_id(device)) and cc not in out:
            out.append(cc)
    return out


# ---------- WebSocket ----------


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cook_check", vol.Required("recipe_id"): str})
@websocket_api.async_response
async def ws_cook_check(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    recipe = next((r for r in (await async_get_recipe_book(hass)).as_list() if r.get("id") == msg["recipe_id"]), None)
    if recipe is None:
        connection.send_error(msg["id"], "not_found", "recipe not found")
        return
    connection.send_result(
        msg["id"], {"title": recipe["title"], "ingredients": match_ingredients(list(recipe.get("ingredients") or []), stock_items(hass))}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/cook_done",
        vol.Required("device_ids"): vol.All([str], vol.Length(max=40)),
        vol.Optional("recipe_id"): str,
    }
)
@websocket_api.async_response
async def ws_cook_done(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    result = await async_use_up(hass, _ccs_of(hass, msg["device_ids"]))
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cook_ranking"})
@websocket_api.async_response
async def ws_cook_ranking(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .expiry import soon_days  # noqa: PLC0415

    recipes = (await async_get_recipe_book(hass)).as_list()
    connection.send_result(msg["id"], {"recipes": rank_recipes(recipes, stock_items(hass), soon_days(hass))})


def async_setup_cooking_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("cooking_ws"):
        return
    domain_data["cooking_ws"] = True
    for command in (ws_cook_check, ws_cook_done, ws_cook_ranking):
        websocket_api.async_register_command(hass, command)
