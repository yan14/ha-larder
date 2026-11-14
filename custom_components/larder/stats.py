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
from homeassistant.helpers import entity_registry as er
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


# ---------- Monatsbericht ----------

SERVICE_GET_MONTHLY_REPORT = "get_monthly_report"
_MONTHS = {
    "de": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
}


def _previous_month(month: str) -> str:
    year, mon = (int(x) for x in month.split("-"))
    return f"{year - 1:04d}-12" if mon == 1 else f"{year:04d}-{mon - 1:02d}"


def _current_fills(hass: HomeAssistant) -> list[str]:
    """Befüll-Datum (lokales ISO-Datum) aller gerade gefüllten Einträge."""
    registry = er.async_get(hass)
    out: list[str] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        entity_id = registry.async_get_entity_id("datetime", DOMAIN, f"{cc}_filled_at") if cc else None
        state = hass.states.get(entity_id) if entity_id else None
        parsed = dt_util.parse_datetime(state.state) if state else None
        if parsed:
            out.append(dt_util.as_local(parsed).date().isoformat())
    return out


def build_monthly_report(
    records: list[dict[str, Any]], fills_now: list[str], month: str, language: str
) -> dict[str, Any]:
    """Bericht für einen Monat (YYYY-MM): befüllt, geleert, gegessen, weggeworfen, Vergleich zum Vormonat."""
    lang = "de" if language.lower().startswith("de") else "en"

    def emptied_in(key: str) -> list[dict[str, Any]]:
        return [r for r in records if (d := _emptied_day(r)) and d.strftime("%Y-%m") == key]

    def share(items: list[dict[str, Any]]) -> int | None:
        eaten = sum(1 for r in items if r.get("outcome") == "eaten")
        thrown = sum(1 for r in items if _was_wasted(r))
        return round(100 * thrown / (eaten + thrown)) if eaten + thrown else None

    def filled_on(record: dict[str, Any]) -> str:
        parsed = dt_util.parse_datetime(record.get("filled_at") or "")
        return dt_util.as_local(parsed).date().isoformat() if parsed else ""

    items = emptied_in(month)
    previous = _previous_month(month)
    filled = sum(1 for r in records if filled_on(r).startswith(month)) + sum(1 for d in fills_now if d.startswith(month))
    eaten = sum(1 for r in items if r.get("outcome") == "eaten")
    thrown = sum(1 for r in items if _was_wasted(r))
    waste, waste_before = share(items), share(emptied_in(previous))
    counter: Counter[str] = Counter()
    names: dict[str, str] = {}
    for r in items:
        if _was_wasted(r):
            for part in split_items(r.get("content") or ""):
                counter[part.casefold()] += 1
                names.setdefault(part.casefold(), part)
    top = [{"content": names[k], "count": n} for k, n in counter.most_common(3)]
    year, mon = (int(x) for x in month.split("-"))
    label = f"{_MONTHS[lang][mon - 1]} {year}"
    de = lang == "de"
    lines = [
        (f"📦 {filled} befüllt, {len(items)} geleert" if de else f"📦 {filled} filled, {len(items)} emptied"),
        (f"✅ {eaten} gegessen, 🗑 {thrown} weggeworfen" if de else f"✅ {eaten} eaten, 🗑 {thrown} thrown away"),
    ]
    trend = None
    if waste is not None:
        line = f"Weggeworfen: {waste} %" if de else f"Thrown away: {waste} %"
        if waste_before is not None:
            trend = "better" if waste < waste_before else "worse" if waste > waste_before else "same"
            line += f" (Vormonat {waste_before} %)" if de else f" (previous month {waste_before} %)"
        lines.append(line)
    if top:
        joined = ", ".join(f"{t['content']} ({t['count']}×)" for t in top)
        lines.append(f"Am häufigsten weggeworfen: {joined}" if de else f"Thrown away most: {joined}")
    if de:
        speech = f"Im {label} wurden {filled} Dosen befüllt und {len(items)} geleert. {eaten} davon wurden gegessen und {thrown} weggeworfen."
        if waste is not None and waste_before is not None:
            speech += {"better": f" Das sind {waste} Prozent, weniger als im Vormonat mit {waste_before} Prozent.",
                       "worse": f" Das sind {waste} Prozent, mehr als im Vormonat mit {waste_before} Prozent.",
                       "same": f" Das sind {waste} Prozent, genauso viel wie im Vormonat."}[trend]
        if top:
            speech += f" Am häufigsten weggeworfen: {top[0]['content']}."
    else:
        speech = f"In {label}, {filled} containers were filled and {len(items)} emptied. {eaten} were eaten and {thrown} thrown away."
        if waste is not None and waste_before is not None:
            speech += {"better": f" That is {waste} percent, less than {waste_before} percent the month before.",
                       "worse": f" That is {waste} percent, more than {waste_before} percent the month before.",
                       "same": f" That is {waste} percent, the same as the month before."}[trend]
        if top:
            speech += f" Thrown away most: {top[0]['content']}."
    return {
        "month": month,
        "label": label,
        "title": f"Larder: {label}",
        "filled": filled,
        "emptied": len(items),
        "eaten": eaten,
        "thrown": thrown,
        "waste_percent": waste,
        "previous_waste_percent": waste_before,
        "trend": trend,
        "top_thrown": top,
        "summary": "\n".join(lines),
        "speech": speech,
        "empty": not filled and not items,
    }


async def async_monthly_report(hass: HomeAssistant, month: str | None = None) -> dict[str, Any]:
    if not month:
        month = _previous_month(dt_util.now().date().strftime("%Y-%m"))
    history = await async_get_history(hass)
    return build_monthly_report(history.records, _current_fills(hass), month, hass.config.language or "en")


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

    async def handle_report(call: ServiceCall) -> dict[str, Any]:
        return await async_monthly_report(hass, call.data.get("month"))

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_MONTHLY_REPORT,
        handle_report,
        schema=vol.Schema({vol.Optional("month"): vol.Match(r"^\d{4}-(0[1-9]|1[0-2])$")}),
        supports_response=SupportsResponse.ONLY,
    )
    domain_data[DATA_STATS] = True
