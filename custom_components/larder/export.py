"""Export und Import: Bestand als CSV, gemerkte Schätzungen als JSON-Datei (Sichern und Teilen).

Die Dateien werden über signierte URLs geladen (wie der Etikettenbogen), damit der Download auch
in der Home-Assistant-App im Browser funktioniert. Der Import läuft über den WebSocket.
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from http import HTTPStatus
import io
import json
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN, UNITS
from .estimate import MAX_DAYS, MIN_DAYS, async_get_estimator, cache_key, storage_context
from .expiry import days_left, soon_days, status_for
from .history import async_get_history

EXPORT_URL = f"/api/{DOMAIN}/export/{{kind}}"
DATA_EXPORT = "export_registered"
EXPORT_FORMAT = 1

_COLUMNS = {
    "de": ["Name", "ID", "Bereich", "Fach", "Inhalt", "Menge", "Einheit", "Eingelagert am", "MHD", "Tage übrig", "Status", "Vakuum"],
    "en": ["Name", "ID", "Area", "Compartment", "Contents", "Quantity", "Unit", "Filled on", "Best before", "Days left", "Status", "Vacuum"],
}
_STATUS = {
    "de": {"none": "", "ok": "gut", "soon": "läuft bald ab", "expired": "abgelaufen"},
    "en": {"none": "", "ok": "good", "soon": "expiring soon", "expired": "expired"},
}
_UNITS = {
    "de": {"portions": "Portionen", "pieces": "Stück", "slices": "Scheiben", "grams": "g", "milliliters": "ml"},
    "en": {"portions": "portions", "pieces": "pieces", "slices": "slices", "grams": "g", "milliliters": "ml"},
}
_YES = {"de": ("ja", "nein"), "en": ("yes", "no")}
_HISTORY_COLUMNS = {
    "de": ["Name", "ID", "Bereich", "Inhalt", "Menge", "Einheit", "Eingelagert am", "MHD", "Geleert am", "Tage gelagert", "Abgelaufen", "Ergebnis"],
    "en": ["Name", "ID", "Area", "Contents", "Quantity", "Unit", "Filled on", "Best before", "Emptied on", "Days stored", "Expired", "Outcome"],
}
_OUTCOME = {"de": {"eaten": "gegessen", "thrown": "weggeworfen"}, "en": {"eaten": "eaten", "thrown": "thrown away"}}


def _lang(hass: HomeAssistant) -> str:
    return "de" if (hass.config.language or "en").lower().startswith("de") else "en"


def _value(hass: HomeAssistant, registry: er.EntityRegistry, platform: str, cc: str, key: str) -> str | None:
    entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
        return None
    return state.state


def inventory_rows(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Alle Dosen mit den wichtigsten Werten (Sprache von Home Assistant), sortiert nach Name."""
    registry = er.async_get(hass)
    lang = _lang(hass)
    soon = soon_days(hass)
    rows: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc:
            continue
        best = _value(hass, registry, "date", cc, "best_before")
        left = None
        if best:
            try:
                left = days_left(date.fromisoformat(best))
            except ValueError:
                best = None
        filled = _value(hass, registry, "datetime", cc, "filled_at")
        if filled:
            parsed = dt_util.parse_datetime(filled)
            filled = dt_util.as_local(parsed).strftime("%Y-%m-%d %H:%M") if parsed else ""
        try:
            quantity = int(float(_value(hass, registry, "number", cc, "portions") or 0))
        except ValueError:
            quantity = 0
        unit = _value(hass, registry, "select", cc, "unit")
        vacuum = _value(hass, registry, "switch", cc, "vacuum")
        rows.append(
            {
                "name": entry.title or cc,
                "cc": cc,
                "area": storage_context(hass, cc).area_name or "",
                "compartment": _value(hass, registry, "text", cc, "compartment") or "",
                "content": _value(hass, registry, "text", cc, "content") or "",
                "quantity": quantity or "",
                "unit": _UNITS[lang].get(unit, "") if quantity and unit in UNITS else "",
                "filled_at": filled or "",
                "best_before": best or "",
                "days_left": "" if left is None else left,
                "status": _STATUS[lang][status_for(left, soon)],
                "vacuum": _YES[lang][0] if vacuum == STATE_ON else _YES[lang][1],
            }
        )
    rows.sort(key=lambda r: str(r["name"]).casefold())
    return rows


def inventory_csv(hass: HomeAssistant) -> bytes:
    """CSV mit BOM (Excel erkennt so UTF-8); auf Deutsch mit Semikolon, wie Excel es dort erwartet."""
    lang = _lang(hass)
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";" if lang == "de" else ",", lineterminator="\r\n")
    writer.writerow(_COLUMNS[lang])
    for row in inventory_rows(hass):
        writer.writerow(row.values())
    return ("﻿" + out.getvalue()).encode("utf-8")


def _local(value: str | None) -> str:
    parsed = dt_util.parse_datetime(value) if value else None
    return dt_util.as_local(parsed).strftime("%Y-%m-%d %H:%M") if parsed else ""


async def history_csv(hass: HomeAssistant) -> bytes:
    """Verlauf aller Dosen (neueste zuerst) als CSV."""
    lang = _lang(hass)
    history = await async_get_history(hass)
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";" if lang == "de" else ",", lineterminator="\r\n")
    writer.writerow(_HISTORY_COLUMNS[lang])
    for r in history.list():
        writer.writerow(
            [
                r.get("name") or "",
                r.get("cc") or "",
                r.get("area") or "",
                r.get("content") or "",
                r.get("quantity") or "",
                _UNITS[lang].get(r.get("unit") or "", "") if r.get("quantity") else "",
                _local(r.get("filled_at")),
                r.get("best_before") or "",
                _local(r.get("emptied")),
                "" if r.get("days_stored") is None else r["days_stored"],
                _YES[lang][0] if r.get("expired") else _YES[lang][1],
                _OUTCOME[lang].get(r.get("outcome") or "", ""),
            ]
        )
    return ("\ufeff" + out.getvalue()).encode("utf-8")


async def estimates_json(hass: HomeAssistant) -> bytes:
    estimator = await async_get_estimator(hass)
    entries = [
        {k: v for k, v in entry.items() if k != "key" and v is not None}
        for entry in estimator.list_entries()
    ]
    data = {
        "domain": DOMAIN,
        "kind": "estimates",
        "format": EXPORT_FORMAT,
        "exported": dt_util.now().isoformat(timespec="seconds"),
        "entries": entries,
    }
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


async def async_import_estimates(hass: HomeAssistant, data: Any, replace: bool = False) -> dict[str, int]:
    """Schätzungen aus einer exportierten Datei übernehmen.

    Ohne `replace` bleiben eigene Korrekturen (Quelle "learned") erhalten, wenn die Datei für dieselbe
    Kombination nur einen Tabellen- oder KI-Wert hat. Ungültige Einträge werden übersprungen.
    """
    if not isinstance(data, dict) or data.get("domain") != DOMAIN or not isinstance(data.get("entries"), list):
        raise vol.Invalid("not a Larder estimates file")
    estimator = await async_get_estimator(hass)
    imported: dict[str, dict[str, Any]] = {}
    skipped = 0
    for raw in data["entries"]:
        try:
            content = str(raw["content"]).strip()
            area = str(raw["area"]).strip()
            days = int(raw["days"])
            vacuum = bool(raw.get("vacuum", False))
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        if not content or not area or not MIN_DAYS <= days <= MAX_DAYS:
            skipped += 1
            continue
        source = raw.get("source") if raw.get("source") in ("learned", "table", "ai") else "learned"
        entry: dict[str, Any] = {
            "days": days,
            "tip": str(raw.get("tip") or ""),
            "source": source,
            "content": content,
            "area": area,
        }
        if raw.get("origin") in ("table", "ai"):
            entry["origin"] = raw["origin"]
        if source == "ai":
            entry["created"] = str(raw.get("created") or dt_util.now().date().isoformat())
        imported[cache_key(content, area, vacuum)] = entry
    return {**estimator.import_entries(imported, replace), "skipped": skipped}


class ExportView(HomeAssistantView):
    """GET /api/larder/export/containers.csv | estimates.json"""

    url = EXPORT_URL
    name = f"api:{DOMAIN}:export"

    async def get(self, request: web.Request, kind: str) -> web.Response:
        hass = request.app[KEY_HASS]
        stamp = datetime.now().strftime("%Y-%m-%d")
        if kind == "containers.csv":
            body, ctype, name = inventory_csv(hass), "text/csv", f"larder-containers-{stamp}.csv"
        elif kind == "history.csv":
            body, ctype, name = await history_csv(hass), "text/csv", f"larder-history-{stamp}.csv"
        elif kind == "estimates.json":
            user = request.get("hass_user")
            if user is None or not user.is_admin:
                return self.json_message("admin required", HTTPStatus.UNAUTHORIZED)
            body, ctype, name = await estimates_json(hass), "application/json", f"larder-estimates-{stamp}.json"
        else:
            return self.json_message("unknown export", HTTPStatus.NOT_FOUND)
        return web.Response(
            body=body,
            content_type=ctype,
            charset="utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/estimates_import",
        vol.Required("data"): dict,
        vol.Optional("replace", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    try:
        result = await async_import_estimates(hass, msg["data"], msg["replace"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_file", str(err))
        return
    estimator = await async_get_estimator(hass)
    connection.send_result(msg["id"], {**result, "entries": estimator.list_entries()})


def async_setup_export(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_EXPORT):
        return
    hass.http.register_view(ExportView())
    websocket_api.async_register_command(hass, ws_import)
    domain_data[DATA_EXPORT] = True
