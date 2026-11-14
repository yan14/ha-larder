"""Verbrauch und Kosten: wie schnell ein Produkt verbraucht wird, was es kostet, was weggeworfen wurde.

* **Verbrauch** aus den Entnahmen von Packungen (−1, letzte Packung geleert, in eine Dose umgefüllt). Das
  Zeitfenster passt sich an: 90 Tage, bei weniger als 3 Entnahmen 180, dann 365 Tage. Neuere Entnahmen
  zählen stärker (Halbwertszeit 45 Tage), damit sich ein geänderter Verbrauch schnell zeigt.
* **Vorschlag für den Mindestbestand**: so viel, wie bis zum nächsten Einkauf (Vorlaufzeit) gebraucht wird.
* **Preise** je Packung: eigener Preis (Kassenbon, von Hand) vor gemerktem Preis vor Open Prices
  (prices.openfoodfacts.org, Median der Preise der letzten 12 Monate, bevorzugt aus dem eigenen Land).
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
import logging
import math
from statistics import median
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

WINDOWS = (90, 180, 365)
MIN_TAKES = 3
HALF_LIFE = 45  # Tage
MIN_SPAN = 14  # so kurz rechnet die Prognose höchstens (sonst wirkt ein einzelner Tag riesig)
OPEN_PRICES_URL = "https://prices.openfoodfacts.org/api/v1/prices"
OPEN_PRICES_TIMEOUT = 8
OPEN_PRICES_MAX_AGE = 365
DATA_OPEN_PRICES = "open_prices_cache"
USER_AGENT = "HomeAssistant-Larder/1 (https://github.com/yan14/ha-larder)"


def _weight(age: int) -> float:
    return 0.5 ** (age / HALF_LIFE)


def forecast(takes: list[dict[str, Any]], count: int, today: date | None = None) -> dict[str, Any] | None:
    """Verbrauch je Woche und wie lange `count` Packungen reichen; None ohne genug Entnahmen.

    `takes`: Einträge {"day": "YYYY-MM-DD", "n": Anzahl} eines Produkts.
    """
    today = today or dt_util.now().date()
    days = []
    for take in takes:
        try:
            day = date.fromisoformat(str(take.get("day")))
        except ValueError:
            continue
        if day <= today:
            days.append((day, max(1, int(take.get("n") or 1))))
    if not days:
        return None
    first = min(d for d, _ in days)
    for window in WINDOWS:
        inside = [(d, n) for d, n in days if (today - d).days < window]
        if sum(n for _, n in inside) >= MIN_TAKES:
            break
    else:
        return None
    # beobachteter Zeitraum: nicht länger als das Fenster und nicht vor der ersten bekannten Entnahme
    span = max(MIN_SPAN, min(window, (today - first).days + 1))
    taken = sum(n * _weight((today - d).days) for d, n in inside)
    exposure = sum(_weight(age) for age in range(span))
    per_day = taken / exposure if exposure else 0
    if per_day <= 0:
        return None
    return {
        "per_week": round(per_day * 7, 2),
        "lasts_days": int(count / per_day) if count > 0 else 0,
        "takes": sum(n for _, n in inside),
        "days": span,
    }


def suggested_minimum(per_week: float | None, lead_days: int) -> int | None:
    """So viele Packungen, wie bis zum nächsten Einkauf (Vorlaufzeit) gebraucht werden, mindestens 1."""
    if not per_week:
        return None
    return max(1, math.ceil(per_week / 7 * lead_days))


def price_of(pack_product: dict[str, Any], remembered: dict[str, Any] | None) -> dict[str, Any] | None:
    """Preis einer Packung: eigener vor gemerktem (beide mit Quelle)."""
    try:
        own = float(pack_product.get("price")) if pack_product.get("price") not in (None, "") else None
    except (TypeError, ValueError):
        own = None
    if own is not None and own > 0:
        return {"price": round(own, 2), "source": pack_product.get("price_source") or "own"}
    if remembered and remembered.get("price"):
        return {"price": round(float(remembered["price"]), 2), "source": remembered.get("source") or "own"}
    return None


def open_prices_median(items: list[dict[str, Any]], country: str | None, today: date | None = None) -> dict[str, Any] | None:
    """Median der Preise in Euro der letzten 12 Monate, bevorzugt aus `country` (Rabatte: regulärer Preis)."""
    today = today or dt_util.now().date()
    found: list[tuple[float, bool]] = []
    for item in items:
        if item.get("currency") != "EUR" or item.get("type", "PRODUCT") != "PRODUCT":
            continue
        try:
            day = date.fromisoformat(str(item.get("date"))[:10])
        except ValueError:
            continue
        if (today - day).days > OPEN_PRICES_MAX_AGE:
            continue
        value = item.get("price_without_discount") if item.get("price_is_discounted") else item.get("price")
        try:
            value = float(value)
        except (TypeError, ValueError):
            continue
        if value <= 0 or item.get("price_per") not in (None, "UNIT"):
            continue
        location = item.get("location") or {}
        found.append((value, bool(country) and str(location.get("osm_address_country_code") or "").upper() == country.upper()))
    local = [v for v, here in found if here]
    chosen = local or [v for v, _ in found]
    if not chosen:
        return None
    return {"price": round(median(chosen), 2), "source": "openprices", "count": len(chosen), "local": bool(local)}


async def async_open_prices(hass: HomeAssistant, ean: str) -> dict[str, Any] | None:
    """Durchschnittspreis (Median) aus Open Prices; einen Tag zwischengespeichert, Fehler zählen als nichts."""
    code = "".join(ch for ch in str(ean or "") if ch.isdigit())
    if not 8 <= len(code) <= 14:
        return None
    cache: dict[str, tuple[str, Any]] = hass.data.setdefault(DOMAIN, {}).setdefault(DATA_OPEN_PRICES, {})
    today = dt_util.now().date().isoformat()
    if code in cache and cache[code][0] == today:
        return cache[code][1]
    session = async_get_clientsession(hass)
    since = (dt_util.now().date() - timedelta(days=OPEN_PRICES_MAX_AGE)).isoformat()
    try:
        async with asyncio.timeout(OPEN_PRICES_TIMEOUT):
            resp = await session.get(
                OPEN_PRICES_URL,
                params={"product_code": code, "currency": "EUR", "date__gte": since, "order_by": "-date", "size": 50},
                headers={"User-Agent": USER_AGENT},
            )
            data = await resp.json(content_type=None) if resp.status == 200 else None
    except (aiohttp.ClientError, TimeoutError, ValueError):
        _LOGGER.debug("Open Prices nicht erreichbar für %s", code, exc_info=True)
        return None
    result = open_prices_median((data or {}).get("items") or [], hass.config.country)
    cache[code] = (today, result)
    return result
