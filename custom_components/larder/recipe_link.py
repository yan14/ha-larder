"""Take over a recipe from a link (6.0, #165).

Most recipe pages describe their recipe for search engines as schema.org `Recipe` in JSON-LD
(`<script type="application/ld+json">`). Larder reads that – title, ingredients, steps, time – and opens it in the
recipe dialog; nothing is saved before the user confirms. Pages without it are reported, Larder does not guess.
"""

from __future__ import annotations

import asyncio
import html
import json
import re
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

MAX_BYTES = 3_000_000
TIMEOUT = 20
_SCRIPT_RE = re.compile(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_DURATION_RE = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$", re.IGNORECASE)


class RecipeLinkError(Exception):
    """No recipe on the page (or the page could not be read); `code` for the dialog."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code


def _text(value: Any) -> str:
    return " ".join(html.unescape(_TAG_RE.sub(" ", str(value or ""))).split())


def _is_recipe(node: Any) -> bool:
    kind = node.get("@type") if isinstance(node, dict) else None
    return kind == "Recipe" or (isinstance(kind, list) and "Recipe" in kind)


def _find_recipe(data: Any) -> dict[str, Any] | None:
    if isinstance(data, list):
        for item in data:
            if found := _find_recipe(item):
                return found
        return None
    if not isinstance(data, dict):
        return None
    if _is_recipe(data):
        return data
    for key in ("@graph", "mainEntity", "itemListElement"):
        if key in data and (found := _find_recipe(data[key])):
            return found
    return None


def _steps(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, str):
        parts = [p for p in re.split(r"\n+|(?<=\.)\s+(?=[A-ZÄÖÜ])", html.unescape(value)) if p.strip()] if "\n" in value else [value]
        return [t for p in parts if (t := _text(p))]
    if isinstance(value, dict):
        if value.get("@type") == "HowToSection" or "itemListElement" in value:
            return _steps(value.get("itemListElement"))
        return [t] if (t := _text(value.get("text") or value.get("name"))) else []
    if isinstance(value, list):
        for item in value:
            out.extend(_steps(item))
    return out


def _minutes(recipe: dict[str, Any]) -> int | None:
    for key in ("totalTime", "cookTime", "prepTime"):
        if m := _DURATION_RE.match(str(recipe.get(key) or "").strip()):
            days, hours, minutes = (int(x) if x else 0 for x in m.groups())
            total = days * 1440 + hours * 60 + minutes
            if 0 < total <= 1440:
                return total
    return None


def parse_recipe(page: str) -> dict[str, Any]:
    """Title, ingredients, steps and minutes from the JSON-LD of a page."""
    for block in _SCRIPT_RE.findall(page):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        recipe = _find_recipe(data)
        if recipe is None:
            continue
        title = _text(recipe.get("name"))[:120]
        ingredients = [t[:300] for t in (_text(i) for i in (recipe.get("recipeIngredient") or recipe.get("ingredients") or [])) if t][:100]
        steps = [t[:300] for t in _steps(recipe.get("recipeInstructions"))][:100]
        if not title or not ingredients:
            continue
        return {"title": title, "ingredients": ingredients, "steps": steps, "minutes": _minutes(recipe)}
    raise RecipeLinkError("no_recipe")


async def async_recipe_from_url(hass: HomeAssistant, url: str) -> dict[str, Any]:
    session = async_get_clientsession(hass)
    try:
        async with asyncio.timeout(TIMEOUT):
            resp = await session.get(url, headers={"Accept": "text/html", "User-Agent": "Home Assistant Larder"})
            if resp.status != 200:
                raise RecipeLinkError("unreadable", f"HTTP {resp.status}")
            raw = await resp.content.read(MAX_BYTES)
    except RecipeLinkError:
        raise
    except (TimeoutError, aiohttp.ClientError) as err:
        raise RecipeLinkError("unreadable", str(err) or type(err).__name__) from err
    recipe = parse_recipe(raw.decode(resp.charset or "utf-8", errors="replace"))
    return {**recipe, "url": url, "source": "link"}


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/recipe_from_url", vol.Required("url"): vol.All(str, vol.Length(max=500), vol.Match(r"^https?://"))}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_recipe_from_url(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        recipe = await async_recipe_from_url(hass, msg["url"])
    except RecipeLinkError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], {"recipe": recipe})


def async_setup_recipe_link_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("recipe_link_ws"):
        return
    domain_data["recipe_link_ws"] = True
    websocket_api.async_register_command(hass, ws_recipe_from_url)
