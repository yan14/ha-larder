"""Ablauf-Übersicht über alle Dosen: Service `get_expiring` und Tage-bis-MHD-Berechnung."""

from __future__ import annotations

from datetime import date
from typing import Any

import voluptuous as vol

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SERVICE_GET_EXPIRING, SOON_DAYS
from .estimate import storage_context

DATA_SERVICE_REGISTERED = "get_expiring_registered"

STATUS_NONE = "none"
STATUS_OK = "ok"
STATUS_SOON = "soon"
STATUS_EXPIRED = "expired"


def status_for(days_left: int | None) -> str:
    if days_left is None:
        return STATUS_NONE
    if days_left < 0:
        return STATUS_EXPIRED
    if days_left <= SOON_DAYS:
        return STATUS_SOON
    return STATUS_OK


def days_left(best_before: date, today: date | None = None) -> int:
    return (best_before - (today or dt_util.now().date())).days


_TEXT = {
    "de": {
        "title": "Larder",
        "none": "Nichts läuft bald ab.",
        "head": lambda soon, expired: ", ".join(
            part
            for part in (
                f"{expired} abgelaufen" if expired else "",
                f"{soon} laufen bald ab" if soon and soon != 1 else ("1 läuft bald ab" if soon else ""),
            )
            if part
        ),
        "expired": lambda d: "abgelaufen" if d == -1 else f"seit {-d} Tagen abgelaufen",
        "today": "heute",
        "tomorrow": "morgen",
        "in_days": lambda d: f"in {d} Tagen",
        "unnamed": "Dose",
    },
    "en": {
        "title": "Larder",
        "none": "Nothing expires soon.",
        "head": lambda soon, expired: ", ".join(
            part
            for part in (
                f"{expired} expired" if expired else "",
                f"{soon} expiring soon" if soon else "",
            )
            if part
        ),
        "expired": lambda d: "expired yesterday" if d == -1 else f"expired {-d} days ago",
        "today": "today",
        "tomorrow": "tomorrow",
        "in_days": lambda d: f"in {d} days",
        "unnamed": "Container",
    },
}


def _when(text: dict[str, Any], days: int) -> str:
    if days < 0:
        return text["expired"](days)
    if days == 0:
        return text["today"]
    if days == 1:
        return text["tomorrow"]
    return text["in_days"](days)


def build_summary(items: list[dict[str, Any]], language: str) -> str:
    """Kurzer Text für Benachrichtigungen, in der Sprache von Home Assistant."""
    text = _TEXT["de" if language.lower().startswith("de") else "en"]
    if not items:
        return text["none"]
    expired = sum(1 for i in items if i["status"] == STATUS_EXPIRED)
    soon = len(items) - expired
    lines = [text["head"](soon, expired) + ":"]
    for item in items:
        label = item["content"] or item["name"] or text["unnamed"]
        place = f" ({item['area']})" if item["area"] else ""
        lines.append(f"• {label}{place}: {_when(text, item['days_left'])}")
    return "\n".join(lines)


def collect_expiring(
    hass: HomeAssistant, days: int = SOON_DAYS, include_expired: bool = True
) -> list[dict[str, Any]]:
    """Alle Dosen mit MHD innerhalb der nächsten `days` Tage (und ggf. abgelaufene), früheste zuerst."""
    registry = er.async_get(hass)
    items: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc:
            continue
        date_id = registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = hass.states.get(date_id) if date_id else None
        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            continue
        try:
            best = date.fromisoformat(state.state)
        except ValueError:
            continue
        left = days_left(best)
        if left > days or (left < 0 and not include_expired):
            continue
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        content_state = hass.states.get(content_id) if content_id else None
        content = (
            content_state.state
            if content_state is not None
            and content_state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
            else ""
        )
        items.append(
            {
                "name": entry.title,
                "content": content,
                "area": storage_context(hass, cc).area_name,
                "best_before": best.isoformat(),
                "days_left": left,
                "status": status_for(left),
                "entity_id": date_id,
            }
        )
    items.sort(key=lambda i: (i["days_left"], i["name"].casefold()))
    return items


def async_setup_services(hass: HomeAssistant) -> None:
    """Domain-Service `get_expiring` einmalig registrieren (idempotent)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_SERVICE_REGISTERED):
        return

    async def handle(call: ServiceCall) -> dict[str, Any]:
        items = collect_expiring(hass, call.data["days"], call.data["include_expired"])
        return {
            "count": len(items),
            "expired": sum(1 for i in items if i["status"] == STATUS_EXPIRED),
            "items": items,
            "summary": build_summary(items, hass.config.language),
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_EXPIRING,
        handle,
        schema=vol.Schema(
            {
                vol.Optional("days", default=SOON_DAYS): vol.All(
                    vol.Coerce(int), vol.Range(min=0, max=365)
                ),
                vol.Optional("include_expired", default=True): cv.boolean,
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    domain_data[DATA_SERVICE_REGISTERED] = True
