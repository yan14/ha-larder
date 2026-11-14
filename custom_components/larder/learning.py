"""Die Schätzung lernt aus dem Verlauf: Vorschläge für kürzere oder längere Haltbarkeit.

Für jede gemerkte Schätzung (Inhalt + Bereich + Vakuum) schaut Larder in den Verlauf:

* **Kürzer:** wurde der Inhalt mehrmals *vor* dem MHD weggeworfen (und nie nach dem MHD noch gegessen),
  schlägt Larder vor, wie lange er tatsächlich gehalten hat (Median der Lagerzeiten).
* **Länger:** wurde er mehrmals deutlich *nach* dem MHD noch gegessen und nie vorher weggeworfen, schlägt
  Larder die kürzeste dieser Lagerzeiten vor (vorsichtig) – höchstens das Doppelte des bisherigen Werts.

Es wird nie still geändert: Die Vorschläge stehen in "Gemerkte Schätzungen" zum Übernehmen oder Ignorieren.
Ein ignorierter Vorschlag kommt erst wieder, wenn sich der vorgeschlagene Wert ändert.
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import median
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .estimate import MAX_DAYS, MIN_DAYS, async_get_estimator, cache_key, parse_key
from .history import async_get_history
from .singleton import async_singleton

MIN_RECORDS = 2  # so oft muss es passiert sein
LOOKBACK_DAYS = 365
LATE_DAYS = 2  # "deutlich" nach dem MHD: mindestens so viele Tage
DATA_LEARNING = "learning"
DATA_WS = "learning_ws_registered"
STORAGE_KEY = f"{DOMAIN}.learning"


def _day(value: str | None) -> date | None:
    if not value:
        return None
    parsed = dt_util.parse_datetime(value)
    if parsed is not None:
        return dt_util.as_local(parsed).date()
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _norm(text: str | None) -> str:
    return " ".join((text or "").split()).casefold()


def build_suggestions(
    entries: list[dict[str, Any]], records: list[dict[str, Any]], ignored: dict[str, int], today: date | None = None
) -> list[dict[str, Any]]:
    today = today or dt_util.now().date()
    since = today - timedelta(days=LOOKBACK_DAYS)
    # Verlauf nach Schlüssel (ohne Vakuum-Angabe: passt zu beiden Varianten)
    by_key: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        filled, emptied, best = _day(record.get("filled_at")), _day(record.get("emptied")), _day(record.get("best_before"))
        if not (filled and emptied and best) or emptied < since or record.get("outcome") not in ("eaten", "thrown"):
            continue
        item = {"lived": (emptied - filled).days, "margin": (emptied - best).days, "outcome": record["outcome"]}
        vacuums = [record["vacuum"]] if isinstance(record.get("vacuum"), bool) else [True, False]
        for vacuum in vacuums:
            by_key.setdefault(cache_key(record.get("content") or "", record.get("area"), vacuum), []).append(item)
    out: list[dict[str, Any]] = []
    for entry in entries:
        content, area, vacuum = parse_key(entry["key"])
        items = by_key.get(cache_key(content, area, vacuum), [])
        early = [i for i in items if i["outcome"] == "thrown" and i["margin"] < 0 and i["lived"] >= MIN_DAYS]
        late = [i for i in items if i["outcome"] == "eaten" and i["margin"] >= LATE_DAYS]
        current = int(entry["days"])
        suggestion: dict[str, Any] | None = None
        if len(early) >= MIN_RECORDS and not late:
            days = max(MIN_DAYS, int(median(i["lived"] for i in early)))  # abgerundet: lieber etwas zu kurz
            if days < current:
                suggestion = {"suggested": days, "direction": "shorter", "count": len(early)}
        elif len(late) >= MIN_RECORDS and not any(i["outcome"] == "thrown" and i["margin"] < 0 for i in items):
            days = min(min(i["lived"] for i in late), current * 2, MAX_DAYS)
            if days > current:
                suggestion = {"suggested": days, "direction": "longer", "count": len(late)}
        if suggestion and ignored.get(entry["key"]) != suggestion["suggested"]:
            out.append({"key": entry["key"], "content": entry["content"], "area": entry["area"], "vacuum": entry["vacuum"], "days": current, **suggestion})
    out.sort(key=lambda s: s["content"].casefold())
    return out


class Learning:
    """Ignorierte Vorschläge (Schlüssel → vorgeschlagene Tage)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, 1, STORAGE_KEY)
        self.ignored: dict[str, int] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.ignored = {str(k): int(v) for k, v in (data.get("ignored") or {}).items()}

    async def async_ignore(self, key: str, days: int) -> None:
        self.ignored[key] = days
        await self._store.async_save({"ignored": self.ignored})

    async def async_suggestions(self) -> list[dict[str, Any]]:
        estimator = await async_get_estimator(self.hass)
        history = await async_get_history(self.hass)
        return build_suggestions(estimator.list_entries(), history.records, self.ignored)


async def async_get_learning(hass: HomeAssistant) -> Learning:
    async def create() -> Learning:
        learning = Learning(hass)
        await learning.async_load()
        return learning

    return await async_singleton(hass, DATA_LEARNING, create)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/estimate_suggestions"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_suggestions(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"suggestions": await (await async_get_learning(hass)).async_suggestions()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/estimate_suggestion",
        vol.Required("key"): str,
        vol.Required("action"): vol.In(("accept", "ignore")),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_suggestion(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    learning = await async_get_learning(hass)
    current = next((s for s in await learning.async_suggestions() if s["key"] == msg["key"]), None)
    if current is None:
        connection.send_error(msg["id"], "not_found", "no suggestion for this entry")
        return
    estimator = await async_get_estimator(hass)
    if msg["action"] == "accept":
        await estimator.async_set_entry(msg["key"], current["suggested"])
    else:
        await learning.async_ignore(msg["key"], current["suggested"])
    connection.send_result(
        msg["id"], {"suggestions": await learning.async_suggestions(), "entries": estimator.list_entries()}
    )


@callback
def async_setup_learning_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_suggestions)
    websocket_api.async_register_command(hass, ws_suggestion)
    domain_data[DATA_WS] = True
