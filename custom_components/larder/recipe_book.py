"""Rezeptbuch: gespeicherte Rezepte (von Hand eingetragen oder aus den KI-Vorschlägen übernommen).

Die Rezepte liegen in Home Assistants `.storage/larder.recipes`. Lesen dürfen alle Benutzer, ändern
nur Administratoren (WebSocket-Befehle `larder/recipes`, `larder/recipe_save`, `larder/recipe_delete`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .singleton import async_singleton

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.recipes"
DATA_RECIPE_BOOK = "recipe_book"
DATA_RECIPE_WS = "recipe_ws_registered"
MAX_RECIPES = 500

_LINES = vol.All([vol.All(str, vol.Length(max=300))], vol.Length(max=100))


def _clean(lines: list[str]) -> list[str]:
    return [line.strip() for line in lines if line.strip()]


class RecipeBook:
    """Liste der gespeicherten Rezepte."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._recipes: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._recipes = {r["id"]: r for r in data.get("recipes", []) if isinstance(r, dict) and r.get("id")}

    def as_list(self) -> list[dict[str, Any]]:
        return sorted(self._recipes.values(), key=lambda r: r.get("created", ""), reverse=True)

    async def async_save(
        self,
        *,
        title: str,
        ingredients: list[str],
        steps: list[str],
        minutes: int | None = None,
        source: str = "manual",
        recipe_id: str | None = None,
    ) -> dict[str, Any]:
        """Rezept anlegen oder (mit `recipe_id`) ersetzen."""
        existing = self._recipes.get(recipe_id) if recipe_id else None
        if recipe_id and existing is None:
            raise KeyError(recipe_id)
        if existing is None and len(self._recipes) >= MAX_RECIPES:
            raise OverflowError
        recipe = {
            "id": recipe_id or uuid.uuid4().hex[:12],
            "title": title.strip(),
            "ingredients": _clean(ingredients),
            "steps": _clean(steps),
            "minutes": minutes,
            "source": existing["source"] if existing else source,
            "created": existing["created"] if existing else datetime.now(UTC).isoformat(),
        }
        self._recipes[recipe["id"]] = recipe
        await self._store.async_save({"recipes": list(self._recipes.values())})
        return recipe

    async def async_delete(self, recipe_id: str) -> bool:
        if self._recipes.pop(recipe_id, None) is None:
            return False
        await self._store.async_save({"recipes": list(self._recipes.values())})
        return True


async def async_get_recipe_book(hass: HomeAssistant) -> RecipeBook:
    async def create() -> RecipeBook:
        book = RecipeBook(hass)
        await book.async_load()
        return book

    return await async_singleton(hass, DATA_RECIPE_BOOK, create)


@callback
def async_setup_recipe_book_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_RECIPE_WS):
        return
    websocket_api.async_register_command(hass, ws_recipes)
    websocket_api.async_register_command(hass, ws_recipe_save)
    websocket_api.async_register_command(hass, ws_recipe_delete)
    domain_data[DATA_RECIPE_WS] = True


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recipes"})
@websocket_api.async_response
async def ws_recipes(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"recipes": (await async_get_recipe_book(hass)).as_list()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/recipe_save",
        vol.Optional("recipe_id"): str,
        vol.Required("title"): vol.All(str, vol.Length(min=1, max=120)),
        vol.Optional("ingredients", default=list): _LINES,
        vol.Optional("steps", default=list): _LINES,
        vol.Optional("minutes"): vol.Any(None, vol.All(vol.Coerce(int), vol.Range(min=1, max=1440))),
        vol.Optional("source", default="manual"): vol.In(["manual", "ai", "photo"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_recipe_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not msg["title"].strip():
        connection.send_error(msg["id"], "invalid_format", "title is empty")
        return
    book = await async_get_recipe_book(hass)
    try:
        recipe = await book.async_save(
            title=msg["title"],
            ingredients=msg["ingredients"],
            steps=msg["steps"],
            minutes=msg.get("minutes"),
            source=msg["source"],
            recipe_id=msg.get("recipe_id"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "recipe not found")
    except OverflowError:
        connection.send_error(msg["id"], "too_many", "too many recipes")
    else:
        connection.send_result(msg["id"], {"recipe": recipe})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recipe_delete", vol.Required("recipe_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_recipe_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if await (await async_get_recipe_book(hass)).async_delete(msg["recipe_id"]):
        connection.send_result(msg["id"], {"deleted": True})
    else:
        connection.send_error(msg["id"], "not_found", "recipe not found")
