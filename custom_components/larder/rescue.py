"""Rescue list of the week (6.5, #180).

Service `larder.get_rescue_list`: everything that has to go this week and is not planned yet – what expires within
the next 7 days, and frozen food in the last weeks of its best quality (setting *Freezer first*) – with a short text
for a push and the link that opens the week suggestion (`/larder?view=recipes&week=1`). The blueprint
*Larder – rescue list of the week* sends it once a week.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse

from .const import DOMAIN, PANEL_URL_PATH, pick
from .estimate import async_get_estimator
from .expiry import collect_expiring
from .plan import async_get_plan
from .recipes import freezer_window

SERVICE_GET_RESCUE_LIST = "get_rescue_list"
DAYS = 7
MAX_LINES = 8

_TEXT = {
    "de": {
        "title": "🛟 Retten diese Woche",
        "head": lambda n: f"{n} {'Sache muss' if n == 1 else 'Sachen müssen'} diese Woche weg:",
        "today": "heute", "tomorrow": "morgen", "days": lambda d: f"in {d} Tagen",
        "frozen": lambda d: f"🧊 beste Qualität noch {d} Tage",
        "more": lambda n: f"… und {n} weitere",
        "button": "In den Wochenplan",
        "none": "Diese Woche muss nichts gerettet werden.",
    },
    "en": {
        "title": "🛟 Rescue this week",
        "head": lambda n: f"{n} {'thing has' if n == 1 else 'things have'} to go this week:",
        "today": "today", "tomorrow": "tomorrow", "days": lambda d: f"in {d} days",
        "frozen": lambda d: f"🧊 best quality {d} more days",
        "more": lambda n: f"… and {n} more",
        "button": "Into the meal plan",
        "none": "Nothing needs rescuing this week.",
    },
    "fr": {
        "title": "🛟 À sauver cette semaine",
        "head": lambda n: f"{n} {'chose doit' if n == 1 else 'choses doivent'} partir cette semaine :",
        "today": "aujourd'hui", "tomorrow": "demain", "days": lambda d: f"dans {d} jours",
        "frozen": lambda d: f"🧊 meilleure qualité encore {d} jours",
        "more": lambda n: f"… et {n} de plus",
        "button": "Dans le planning",
        "none": "Rien à sauver cette semaine.",
    },
    "nl": {
        "title": "🛟 Deze week redden",
        "head": lambda n: f"{n} {'ding moet' if n == 1 else 'dingen moeten'} deze week op:",
        "today": "vandaag", "tomorrow": "morgen", "days": lambda d: f"over {d} dagen",
        "frozen": lambda d: f"🧊 beste kwaliteit nog {d} dagen",
        "more": lambda n: f"… en nog {n}",
        "button": "In het weekplan",
        "none": "Deze week hoeft niets gered te worden.",
    },
}


def build_rescue_list(items: list[dict[str, Any]], planned: set[str], window: int, language: str) -> dict[str, Any]:
    text = pick(_TEXT, language)
    rescue = []
    for item in items:
        if not (item.get("content") or "").strip() or item["cc"] in planned or item.get("kind") == "voucher":
            continue
        left = item.get("days_left")
        if left is None:
            continue
        if item.get("frozen"):
            if window and left <= window:
                rescue.append({**item, "_when": text["frozen"](max(0, left))})
            continue
        if left <= DAYS:
            rescue.append({**item, "_when": text["today"] if left <= 0 else text["tomorrow"] if left == 1 else text["days"](left)})
    # fridge and pantry first (earliest first), frozen food after
    rescue.sort(key=lambda i: (bool(i.get("frozen")), i["days_left"]))
    lines = [f"• {i['content']} ({i['_when']})" for i in rescue[:MAX_LINES]]
    short = [f"• {i['content']}" for i in rescue[:MAX_LINES]]
    if len(rescue) > MAX_LINES:
        lines.append(text["more"](len(rescue) - MAX_LINES))
        short.append(text["more"](len(rescue) - MAX_LINES))
    head = text["head"](len(rescue)) if rescue else text["none"]
    return {
        "count": len(rescue),
        "items": [{k: v for k, v in i.items() if not k.startswith("_")} for i in rescue],
        "title": text["title"],
        "summary": "\n".join([head, *lines]),
        "summary_short": "\n".join([head, *short]),
        "button": text["button"],
        "url": f"/{PANEL_URL_PATH}?view=recipes&week=1",
    }


async def async_rescue_list(hass: HomeAssistant) -> dict[str, Any]:
    estimator = await async_get_estimator(hass)
    window = freezer_window(estimator)
    plan = await async_get_plan(hass)
    planned = {cc for p in plan.list() for cc in p.get("ccs") or []}
    from .devices import device_of  # noqa: PLC0415
    from .freezing import freezable  # noqa: PLC0415

    items = collect_expiring(hass, days=max(DAYS, window), include_expired=False, vouchers=False)
    result = build_rescue_list(items, planned, window, hass.config.language or "en")
    for item in result["items"]:
        device = device_of(hass, item["cc"])
        item["device_id"] = device.id if device else None
        if freezable(hass, item):
            item["freezable"] = True  # 6.5 (#179): 🧊 in the dashboard
    return result


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/rescue_list"})
@websocket_api.async_response
async def ws_rescue_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_rescue_list(hass))


def async_setup_rescue_service(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_GET_RESCUE_LIST):
        return

    async def handle(_call: ServiceCall) -> dict[str, Any]:
        return await async_rescue_list(hass)

    hass.services.async_register(DOMAIN, SERVICE_GET_RESCUE_LIST, handle, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY)
    websocket_api.async_register_command(hass, ws_rescue_list)
