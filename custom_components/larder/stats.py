"""Statistik aus dem Verlauf: gegessen oder weggeworfen, was wird oft weggeworfen, wie lange lagert es.

Dazu der aktuelle Bestand (gefüllt, leer, abgelaufen, läuft bald ab). Abrufbar über den Service
`larder.get_statistics` (z. B. für Template-Sensoren) und das Dashboard (☰ → Statistik).
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .expiry import collect_expiring, soon_days
from .history import async_get_history
from .shelf_life import split_items

SERVICE_GET_STATISTICS = "get_statistics"
DATA_STATS = "stats_registered"
TOP = 5
MONTHS = 6


def _was_wasted(record: dict[str, Any]) -> bool:
    """Weggeworfen; ohne Antwort zählt eine beim Leeren abgelaufene Dose als (vermutlich) weggeworfen."""
    return record.get("outcome") == "thrown" or (record.get("outcome") is None and bool(record.get("expired")))


def _emptied_day(record: dict[str, Any]) -> date | None:
    parsed = dt_util.parse_datetime(record.get("emptied") or "")
    return dt_util.as_local(parsed).date() if parsed else None


def build_statistics(hass: HomeAssistant, records: list[dict[str, Any]], days: int | None = None) -> dict[str, Any]:
    today = dt_util.now().date()
    since = today - timedelta(days=days) if days else None
    chosen = [r for r in records if (d := _emptied_day(r)) is not None and (since is None or d > since)]

    eaten = [r for r in chosen if r.get("outcome") == "eaten"]
    wasted = [r for r in chosen if _was_wasted(r)]
    unknown = [r for r in chosen if r.get("outcome") is None and not r.get("expired")]
    decided = len(eaten) + len(wasted)

    def top(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        counter: Counter[str] = Counter()
        names: dict[str, str] = {}
        for r in items:
            for part in split_items(r.get("content") or ""):
                key = part.casefold()
                counter[key] += 1
                names.setdefault(key, part)
        return [{"content": names[k], "count": n} for k, n in counter.most_common(TOP)]

    stored = [r["days_stored"] for r in eaten if isinstance(r.get("days_stored"), int)]
    by_area: Counter[str] = Counter(r.get("area") or "" for r in wasted)

    # Monate (neueste zuletzt): gegessen und weggeworfen
    months: list[dict[str, Any]] = []
    first = today.replace(day=1)
    for i in range(MONTHS - 1, -1, -1):
        year, month = first.year, first.month - i
        while month < 1:
            month += 12
            year -= 1
        key = f"{year:04d}-{month:02d}"
        in_month = [r for r in records if (d := _emptied_day(r)) and d.strftime("%Y-%m") == key]
        months.append(
            {
                "month": key,
                "eaten": sum(1 for r in in_month if r.get("outcome") == "eaten"),
                "thrown": sum(1 for r in in_month if _was_wasted(r)),
            }
        )

    current = collect_expiring(hass, days=None, include_expired=True, include_undated=True)
    filled = [i for i in current if i["content"]]
    soon = soon_days(hass)
    total = len(hass.config_entries.async_entries(DOMAIN))
    return {
        "days": days,
        "emptied": len(chosen),
        "eaten": len(eaten),
        "thrown": len(wasted),
        "unknown": len(unknown),
        "waste_percent": round(100 * len(wasted) / decided) if decided else None,
        "avg_days_stored": round(sum(stored) / len(stored), 1) if stored else None,
        "top_thrown": top(wasted),
        "top_eaten": top(eaten),
        "thrown_by_area": [{"area": a, "count": n} for a, n in by_area.most_common() if a],
        "months": months,
        "containers": {
            "total": total,
            "filled": len(filled),
            "empty": total - len(filled),
            "expired": sum(1 for i in filled if i["days_left"] is not None and i["days_left"] < 0),
            "soon": sum(1 for i in filled if i["days_left"] is not None and 0 <= i["days_left"] <= soon),
            "undated": sum(1 for i in filled if i["days_left"] is None),
        },
    }


async def async_statistics(hass: HomeAssistant, days: int | None = None) -> dict[str, Any]:
    history = await async_get_history(hass)
    return build_statistics(hass, history.records, days)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/statistics", vol.Optional("days"): vol.Any(None, vol.All(int, vol.Range(min=1, max=3650)))}
)
@websocket_api.async_response
async def ws_statistics(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_statistics(hass, msg.get("days")))


def async_setup_statistics(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_STATS):
        return

    async def handle(call: ServiceCall) -> dict[str, Any]:
        return await async_statistics(hass, call.data.get("days"))

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_STATISTICS,
        handle,
        schema=vol.Schema({vol.Optional("days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=3650))}),
        supports_response=SupportsResponse.ONLY,
    )
    websocket_api.async_register_command(hass, ws_statistics)
    domain_data[DATA_STATS] = True
