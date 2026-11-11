"""Ablauf-Übersicht über alle Dosen: Service `get_expiring` und Tage-bis-MHD-Berechnung."""

from __future__ import annotations

from datetime import date
from typing import Any

import voluptuous as vol

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DEFAULT_UNIT, DOMAIN, SERVICE_GET_EXPIRING, SOON_DAYS, UNITS
from .estimate import storage_context

DATA_SERVICE_REGISTERED = "get_expiring_registered"

STATUS_NONE = "none"
STATUS_OK = "ok"
STATUS_SOON = "soon"
STATUS_EXPIRED = "expired"


def soon_days(hass: HomeAssistant) -> int:
    """Einstellung "läuft bald ab" (Tage); Vorgabe, solange die Einstellungen nicht geladen sind."""
    estimator = hass.data.get(DOMAIN, {}).get("estimator")
    return getattr(estimator, "soon_days", SOON_DAYS)


def status_for(days_left: int | None, soon: int = SOON_DAYS) -> str:
    if days_left is None:
        return STATUS_NONE
    if days_left < 0:
        return STATUS_EXPIRED
    if days_left <= soon:
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
        "units": {
            "portions": lambda n: "1 Portion" if n == 1 else f"{n} Portionen",
            "pieces": lambda n: f"{n} Stück",
            "slices": lambda n: "1 Scheibe" if n == 1 else f"{n} Scheiben",
            "grams": lambda n: f"{n} g",
            "milliliters": lambda n: f"{n} ml",
        },
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
        "units": {
            "portions": lambda n: "1 portion" if n == 1 else f"{n} portions",
            "pieces": lambda n: "1 piece" if n == 1 else f"{n} pieces",
            "slices": lambda n: "1 slice" if n == 1 else f"{n} slices",
            "grams": lambda n: f"{n} g",
            "milliliters": lambda n: f"{n} ml",
        },
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


def quantity_text(text: dict[str, Any], item: dict[str, Any]) -> str:
    """'4 Portionen', '5 Scheiben' ... in der Sprache der Zusammenfassung."""
    return text["units"].get(item.get("unit"), text["units"][DEFAULT_UNIT])(item["quantity"])


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
        extras = [quantity_text(text, item)] if item.get("quantity") else []
        if item["area"]:
            extras.append(item["area"])
        place = f" ({', '.join(extras)})" if extras else ""
        lines.append(f"• {label}{place}: {_when(text, item['days_left'])}")
    return "\n".join(lines)


MAX_SPOKEN = 6  # so viele Dosen nennt die Sprachausgabe, der Rest wird gezählt

_SPEECH = {
    "de": {
        "none": "Nichts läuft bald ab.",
        "and": "und",
        "more": lambda n: f"{n} weitere",
        "today": lambda names, n: f"Heute {'läuft' if n == 1 else 'laufen'} {names} ab.",
        "tomorrow": lambda names, n: f"Morgen {'läuft' if n == 1 else 'laufen'} {names} ab.",
        "in_days": lambda d, names, n: f"In {d} Tagen {'läuft' if n == 1 else 'laufen'} {names} ab.",
        "expired": lambda names, n: f"{'Abgelaufen ist' if n == 1 else 'Abgelaufen sind'} {names}.",
    },
    "en": {
        "none": "Nothing expires soon.",
        "and": "and",
        "more": lambda n: f"{n} more",
        "today": lambda names, n: f"{names} {'expires' if n == 1 else 'expire'} today.",
        "tomorrow": lambda names, n: f"{names} {'expires' if n == 1 else 'expire'} tomorrow.",
        "in_days": lambda d, names, n: f"{names} {'expires' if n == 1 else 'expire'} in {d} days.",
        "expired": lambda names, n: f"{names} {'has' if n == 1 else 'have'} expired.",
    },
}

LABELS = {
    "de": {"recipes": "Rezepte", "dashboard": "Dashboard"},
    "en": {"recipes": "Recipes", "dashboard": "Dashboard"},
}


def _join(words: list[str], conj: str) -> str:
    if len(words) <= 1:
        return "".join(words)
    return f"{', '.join(words[:-1])} {conj} {words[-1]}"


def build_speech(items: list[dict[str, Any]], language: str, limit: int = MAX_SPOKEN) -> str:
    """Kurzer Text zum Vorlesen (Alexa, Assist): ganze Sätze, keine Symbole, höchstens `limit` Dosen.

    Reihenfolge: heute, morgen, später, zuletzt Abgelaufenes.
    """
    text = _SPEECH["de" if language.lower().startswith("de") else "en"]
    if not items:
        return text["none"]
    unnamed = _TEXT["de" if language.lower().startswith("de") else "en"]["unnamed"]
    groups: dict[int, list[str]] = {}
    expired: list[str] = []
    for item in items:
        name = (item["content"] or item["name"] or unnamed).strip()
        if item["days_left"] is None:
            continue
        if item["days_left"] < 0:
            expired.append(name)
        else:
            groups.setdefault(item["days_left"], []).append(name)
    ordered = [(d, groups[d]) for d in sorted(groups)] + ([(-1, expired)] if expired else [])
    sentences: list[str] = []
    spoken = 0
    skipped = 0
    for days, names in ordered:
        room = limit - spoken
        if room <= 0:
            skipped += len(names)
            continue
        shown = names[:room]
        spoken += len(shown)
        skipped += len(names) - len(shown)
        joined = _join(shown, text["and"])
        count = len(shown)
        if days < 0:
            sentences.append(text["expired"](joined, count))
        elif days == 0:
            sentences.append(text["today"](joined, count))
        elif days == 1:
            sentences.append(text["tomorrow"](joined, count))
        else:
            sentences.append(text["in_days"](days, joined, count))
    if skipped:
        extra = text["more"](skipped)
        sentences.append(f"{'Dazu' if language.lower().startswith('de') else 'Plus'} {extra}.")
    return " ".join(s[0].upper() + s[1:] for s in sentences)


def collect_expiring(
    hass: HomeAssistant,
    days: int | None = SOON_DAYS,
    include_expired: bool = True,
    include_undated: bool = False,
) -> list[dict[str, Any]]:
    """Alle Dosen mit MHD innerhalb der nächsten `days` Tage (und ggf. abgelaufene), früheste zuerst.

    `days=None` heißt ohne Zeitgrenze; mit `include_undated` kommen auch Dosen ohne MHD dazu
    (dann mit `best_before` und `days_left` = None, ganz hinten einsortiert).
    """
    registry = er.async_get(hass)
    soon = soon_days(hass)
    items: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get("cc")
        if not cc:
            continue
        date_id = registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
        state = hass.states.get(date_id) if date_id else None
        best: date | None = None
        if state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            try:
                best = date.fromisoformat(state.state)
            except ValueError:
                best = None
        if best is None:
            if not include_undated or state is None or state.state == STATE_UNAVAILABLE:
                continue
            left = None
        else:
            left = days_left(best)
            if (days is not None and left > days) or (left < 0 and not include_expired):
                continue
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        content_state = hass.states.get(content_id) if content_id else None
        content = (
            content_state.state
            if content_state is not None
            and content_state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
            else ""
        )
        quantity_id = registry.async_get_entity_id("number", DOMAIN, f"{cc}_portions")
        quantity_state = hass.states.get(quantity_id) if quantity_id else None
        try:
            quantity = int(float(quantity_state.state)) if quantity_state is not None else 0
        except ValueError:
            quantity = 0
        unit_id = registry.async_get_entity_id("select", DOMAIN, f"{cc}_unit")
        unit_state = hass.states.get(unit_id) if unit_id else None
        unit = unit_state.state if unit_state is not None and unit_state.state in UNITS else DEFAULT_UNIT
        items.append(
            {
                "name": entry.title,
                "cc": cc,
                "content": content,
                "quantity": quantity or None,
                "unit": unit if quantity else None,
                "area": storage_context(hass, cc).area_name,
                "best_before": best.isoformat() if best else None,
                "days_left": left,
                "status": status_for(left, soon),
                "entity_id": date_id,
            }
        )
    items.sort(
        key=lambda i: (i["days_left"] is None, i["days_left"] or 0, i["name"].casefold())
    )
    return items


def async_setup_services(hass: HomeAssistant) -> None:
    """Domain-Service `get_expiring` einmalig registrieren (idempotent)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_SERVICE_REGISTERED):
        return

    async def handle(call: ServiceCall) -> dict[str, Any]:
        items = collect_expiring(hass, call.data.get("days", soon_days(hass)), call.data["include_expired"])
        return {
            "count": len(items),
            "expired": sum(1 for i in items if i["status"] == STATUS_EXPIRED),
            "items": items,
            "summary": build_summary(items, hass.config.language),
            "speech": build_speech(items, hass.config.language),
            "labels": LABELS["de" if hass.config.language.lower().startswith("de") else "en"],
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_EXPIRING,
        handle,
        schema=vol.Schema(
            {
                vol.Optional("days"): vol.All(
                    vol.Coerce(int), vol.Range(min=0, max=365)
                ),
                vol.Optional("include_expired", default=True): cv.boolean,
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    domain_data[DATA_SERVICE_REGISTERED] = True
