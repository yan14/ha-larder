"""Week plan suggestion: dishes for the next days that first use up the containers expiring soon.

Source (setting, as with the best-before estimate): recipe book only, AI only, recipe book else AI, or both
together. Recipes from the recipe book fit if an ingredient line names the content of a container; the AI gets
the containers still left and says which ones a dish uses up.

Day by day the dish is chosen that uses up the most urgent containers still free (the earlier the date,
the more a container counts). Days that already have a plan are skipped. Nothing is saved until
the suggestion is accepted in the dashboard (like a normal entry in the week plan).
"""

from __future__ import annotations

from datetime import date, timedelta
import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.util import dt as dt_util

from .const import DOMAIN, PLAN_SOURCES
from .devices import device_of
from .estimate import EstimateError, async_get_estimator
from .expiry import collect_expiring
from .plan import async_get_plan
from .recipe_book import async_get_recipe_book
from .recipes import _allergen_warning, async_suggest_recipes

_LOGGER = logging.getLogger(__name__)

DEFAULT_PLAN_SOURCE = "book_ai"
DEFAULT_PLAN_DAYS = 5
MAX_PLAN_DAYS = 14
MAX_ITEMS = 30
_STOP = {"und", "mit", "der", "die", "das", "von", "and", "with", "the", "rest", "reste", "portion", "portionen"}


def _words(text: str) -> list[str]:
    return [w for w in re.sub(r"[^\w]+", " ", (text or "").casefold()).split() if len(w) >= 3 and w not in _STOP]


def uses_content(line: str, content: str) -> bool:
    """Does this ingredient line name the content of a container? (all words of the content, also as the start of a word)"""
    words = _words(content)
    have = _words(line)
    def hit(w: str, h: str) -> bool:
        # start of a word in both directions ("Tomaten"/"Tomatensoße"), for longer words also compounds ("Rinderhack")
        return h == w or (len(h) >= 4 and (h.startswith(w) or w.startswith(h))) or (len(w) >= 4 and w in h)

    return bool(words) and all(any(hit(w, h) for h in have) for w in words)


def _weight(item: dict[str, Any]) -> float:
    left = item.get("days_left")
    return 1.0 / (1 + max(0, left if left is not None else 30))


def choose(candidates: list[dict[str, Any]], items: list[dict[str, Any]], days: list[date]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Greedily per day the dish with the most urgent containers still free. Returns (days, remaining candidates)."""
    free = {i["cc"] for i in items}
    by_cc = {i["cc"]: i for i in items}
    pool = list(candidates)
    out: list[dict[str, Any]] = []
    for day in days:
        best, best_score = None, 0.0
        for cand in pool:
            score = sum(_weight(by_cc[cc]) for cc in cand["ccs"] if cc in free)
            if score > best_score:
                best, best_score = cand, score
        if best is None:
            break
        pool.remove(best)
        used = [cc for cc in best["ccs"] if cc in free]
        free -= set(used)
        out.append({**best, "date": day.isoformat(), "ccs": used})
    return out, [c for c in pool if any(cc in free for cc in c["ccs"])]


def _book_candidates(recipes: list[dict[str, Any]], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for recipe in recipes:
        ccs = [i["cc"] for i in items if any(uses_content(line, i["content"]) for line in recipe.get("ingredients") or [])]
        if ccs:
            out.append(
                {
                    "title": recipe["title"],
                    "source": "book",
                    "recipe_id": recipe["id"],
                    "ccs": ccs,
                    "ingredients": list(recipe.get("ingredients") or []),
                }
            )
    return out


def _ai_candidates(recipes: list[dict[str, Any]], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for recipe in recipes:
        ccs = [i["cc"] for i in items if any(uses_content(use, i["content"]) or uses_content(i["content"], use) for use in recipe.get("uses") or [])]
        if ccs:
            out.append(
                {
                    "title": recipe["title"],
                    "source": "ai",
                    "ccs": ccs,
                    "ingredients": list(recipe.get("extra_ingredients") or []),
                    "steps": list(recipe.get("steps") or []),
                    "minutes": recipe.get("minutes"),
                }
            )
    return out


async def async_suggest_week(hass: HomeAssistant, days: int | None = None, source: str | None = None) -> dict[str, Any]:
    estimator = await async_get_estimator(hass)
    source = source if source in PLAN_SOURCES else getattr(estimator, "plan_source", DEFAULT_PLAN_SOURCE)
    count = max(1, min(MAX_PLAN_DAYS, int(days or getattr(estimator, "plan_days", DEFAULT_PLAN_DAYS))))
    plan = await async_get_plan(hass)
    today = dt_util.now().date()
    taken_days = {p.get("date") for p in plan.list()}
    planned = {cc for p in plan.list() if p.get("date", "") >= today.isoformat() for cc in p.get("ccs") or []}
    plan_days = [d for d in (today + timedelta(days=i) for i in range(count)) if d.isoformat() not in taken_days]
    items = [
        i
        for i in collect_expiring(hass, days=None, include_expired=False)
        if (i.get("content") or "").strip() and i["cc"] not in planned and not _allergen_warning(hass, i["cc"])
    ][:MAX_ITEMS]
    result: dict[str, Any] = {"source": source, "days": [], "others": [], "error": None}
    if not items or not plan_days:
        return _public(hass, result, items)

    candidates: list[dict[str, Any]] = []
    if source in ("book", "book_ai", "both"):
        candidates += _book_candidates((await async_get_recipe_book(hass)).as_list(), items)

    async def ai(for_items: list[dict[str, Any]], how_many: int) -> list[dict[str, Any]]:
        dr.async_get(hass)
        ids = [d.id for i in for_items if (d := device_of(hass, i["cc"]))]
        try:
            res = await async_suggest_recipes(hass, containers=ids, max_recipes=max(1, min(5, how_many)))
        except EstimateError as err:
            result["error"] = str(err)
            return []
        return _ai_candidates(res.get("recipes") or [], for_items)

    if source in ("ai", "both"):
        candidates += await ai(items, len(plan_days))
    chosen, others = choose(candidates, items, plan_days)
    if source == "book_ai" and len(chosen) < len(plan_days):
        used = {cc for c in chosen for cc in c["ccs"]}
        rest = [i for i in items if i["cc"] not in used]
        if rest:
            more, more_others = choose(await ai(rest, len(plan_days) - len(chosen)), rest, plan_days[len(chosen):])
            chosen += more
            others += more_others
    result["days"], result["others"] = chosen, others
    return _public(hass, result, items)


def _public(hass: HomeAssistant, result: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """For the dashboard: device IDs and contents instead of cc."""
    dr.async_get(hass)
    by_cc = {i["cc"]: i for i in items}

    def public(entry: dict[str, Any]) -> dict[str, Any]:
        uses = []
        for cc in entry["ccs"]:
            device = device_of(hass, cc)
            item = by_cc.get(cc, {})
            uses.append({"device_id": device.id if device else None, "content": item.get("content"), "name": item.get("name"), "best_before": item.get("best_before")})
        return {k: v for k, v in entry.items() if k != "ccs"} | {"uses": uses}

    return {
        "source": result["source"],
        "days": [public(d) for d in result["days"]],
        "others": [public(o) for o in result["others"]][:10],
        "error": result["error"],
        "expiring": len(items),
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_suggest",
        vol.Optional("days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_PLAN_DAYS)),
        vol.Optional("source"): vol.In(PLAN_SOURCES),
    }
)
@websocket_api.async_response
async def ws_plan_suggest(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_suggest_week(hass, msg.get("days"), msg.get("source")))


@callback
def async_setup_week_plan_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("week_plan_ws"):
        return
    hass.data[DOMAIN]["week_plan_ws"] = True
    websocket_api.async_register_command(hass, ws_plan_suggest)
