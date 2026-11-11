"""Rezeptideen aus Dosen, die bald ablaufen: Service `larder.suggest_recipes` (KI über "AI Task")."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN, SERVICE_SUGGEST_RECIPES, SOON_DAYS
from .estimate import EstimateError, async_get_estimator
from .expiry import _TEXT, collect_expiring, quantity_text

_LOGGER = logging.getLogger(__name__)

DATA_RECIPES_REGISTERED = "recipes_registered"
DEFAULT_RECIPES = 3
MAX_RECIPES = 5
TIMEOUT = 120

STRUCTURE: dict[str, Any] = {
    "recipes": {
        "description": "Recipe ideas, best one first",
        "required": True,
        "selector": {
            "object": {
                "multiple": True,
                "fields": {
                    "title": {"required": True, "selector": {"text": {}}},
                    "minutes": {"required": False, "selector": {"number": {"min": 1, "max": 600, "mode": "box"}}},
                    "uses": {"required": True, "selector": {"text": {"multiple": True}}},
                    "extra_ingredients": {"required": False, "selector": {"text": {"multiple": True}}},
                    "steps": {"required": True, "selector": {"text": {"multiple": True}}},
                },
            }
        },
    }
}


def _describe(item: dict[str, Any], language: str) -> str:
    """Eine Zutat als kurze Zeile für die Anweisung an die KI (nur Inhalt, Menge, Rest-Haltbarkeit, Ort)."""
    text = _TEXT["de" if language.lower().startswith("de") else "en"]
    parts = [item["content"] or item["name"]]
    if item.get("quantity"):
        parts.append(quantity_text(text, item))
    days = item["days_left"]
    parts.append("use up today" if days <= 0 else f"must be used within {days} day{'s' if days != 1 else ''}")
    if item.get("area"):
        parts.append(f"stored: {item['area']}")
    return " | ".join(parts)


def build_instructions(
    items: list[dict[str, Any]], *, language: str, servings: int | None, max_recipes: int
) -> str:
    lines = [
        "You suggest simple home-cooking ideas that use up food before it spoils.",
        "These containers are in the fridge, freezer or pantry and expire soon "
        "(the most urgent first):",
        *(f"- {_describe(item, language)}" for item in items),
        f"Suggest up to {max_recipes} different recipes. Each one should use as many of the listed "
        "items as sensible, prefer the most urgent ones, and add only common pantry staples "
        "(oil, salt, spices, flour, rice, pasta, eggs, onions) as extra ingredients.",
        "Be food-safety minded: do not suggest eating raw what must be cooked, and do not "
        "suggest anything that needs more than the listed amounts of the listed items.",
        (
            f"Scale the recipes for {servings} {'person' if servings == 1 else 'people'}."
            if servings
            else "Portion size is not specified; assume 2 people."
        ),
        "For `uses` name only items from the list above, as written in the list.",
        f"Write all texts in the language with code '{language}'. Keep steps short.",
    ]
    return "\n".join(lines)


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    return [str(v).strip() for v in value if str(v).strip()]


def parse_recipes(data: Any, limit: int) -> list[dict[str, Any]]:
    """Antwort der KI prüfen und in eine einheitliche Form bringen."""
    raw = data.get("recipes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise EstimateError("recipes_failed", error="unexpected answer")
    recipes: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict) or not str(entry.get("title") or "").strip():
            continue
        try:
            minutes = int(round(float(entry["minutes"]))) if entry.get("minutes") else None
        except (TypeError, ValueError):
            minutes = None
        recipes.append(
            {
                "title": str(entry["title"]).strip(),
                "minutes": minutes,
                "uses": _as_list(entry.get("uses")),
                "extra_ingredients": _as_list(entry.get("extra_ingredients")),
                "steps": _as_list(entry.get("steps")),
            }
        )
    if not recipes:
        raise EstimateError("recipes_failed", error="no recipes in the answer")
    return recipes[:limit]


def build_summary(recipes: list[dict[str, Any]]) -> str:
    """Kurzer Text für Benachrichtigungen: eine Zeile pro Rezept."""
    lines = []
    for recipe in recipes:
        uses = f": {', '.join(recipe['uses'])}" if recipe["uses"] else ""
        lines.append(f"• {recipe['title']}{uses}")
    return "\n".join(lines)


async def async_suggest_recipes(
    hass: HomeAssistant, *, days: int, servings: int | None, max_recipes: int
) -> dict[str, Any]:
    items = collect_expiring(hass, days, include_expired=False)
    if not items:
        return {"count": 0, "ingredients": [], "recipes": [], "summary": ""}
    if not hass.services.has_service("ai_task", "generate_data"):
        raise EstimateError("ai_unavailable")

    language = hass.config.language
    data: dict[str, Any] = {
        "task_name": "Larder: recipe ideas",
        "instructions": build_instructions(
            items, language=language, servings=servings, max_recipes=max_recipes
        ),
        "structure": STRUCTURE,
    }
    estimator = await async_get_estimator(hass)
    if estimator.ai_task_entity:
        data["entity_id"] = estimator.ai_task_entity
    try:
        async with asyncio.timeout(TIMEOUT):
            response = await hass.services.async_call(
                "ai_task", "generate_data", data, blocking=True, return_response=True
            )
    except HomeAssistantError as err:
        raise EstimateError("recipes_failed", error=str(err)) from err
    except TimeoutError as err:
        raise EstimateError("recipes_failed", error="timeout") from err
    except Exception as err:  # noqa: BLE001 - Schema- und Anbieterfehler sauber melden
        _LOGGER.debug("AI recipe task failed", exc_info=True)
        raise EstimateError("recipes_failed", error=str(err)) from err

    recipes = parse_recipes((response or {}).get("data"), max_recipes)
    return {
        "count": len(items),
        "ingredients": items,
        "recipes": recipes,
        "summary": build_summary(recipes),
    }


def async_setup_recipe_service(hass: HomeAssistant) -> None:
    """Domain-Service `suggest_recipes` einmalig registrieren (idempotent)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_RECIPES_REGISTERED):
        return

    async def handle(call: ServiceCall) -> dict[str, Any]:
        return await async_suggest_recipes(
            hass,
            days=call.data["days"],
            servings=call.data.get("servings"),
            max_recipes=call.data["max_recipes"],
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SUGGEST_RECIPES,
        handle,
        schema=vol.Schema(
            {
                vol.Optional("days", default=SOON_DAYS): vol.All(vol.Coerce(int), vol.Range(min=0, max=30)),
                vol.Optional("servings"): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)),
                vol.Optional("max_recipes", default=DEFAULT_RECIPES): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=MAX_RECIPES)
                ),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    domain_data[DATA_RECIPES_REGISTERED] = True
