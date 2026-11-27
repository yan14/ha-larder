"""Statistics from the history: eaten or thrown away, what is thrown away often, how long is it stored.

Plus the current stock (filled, empty, expired, expires soon). Available through the service
`larder.get_statistics` (e.g. for template sensors) and the dashboard (☰ → Statistics).
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

from .const import DOMAIN, lang_code, pick
from .expiry import collect_expiring, soon_days
from .history import async_get_history
from .shelf_life import split_items

SERVICE_GET_STATISTICS = "get_statistics"
DATA_STATS = "stats_registered"
TOP = 5
MONTHS = 6


def _was_wasted(record: dict[str, Any]) -> bool:
    """Thrown away; without an answer a container that had expired when emptied counts as (probably) thrown away."""
    return record.get("outcome") == "thrown" or (record.get("outcome") is None and bool(record.get("expired")))


def _emptied_day(record: dict[str, Any]) -> date | None:
    parsed = dt_util.parse_datetime(record.get("emptied") or "")
    return dt_util.as_local(parsed).date() if parsed else None


def record_value(records: list[dict[str, Any]]) -> tuple[float | None, int]:
    """Sum of the prices (price per pack × count for packs) and how many entries had a price."""
    total, priced = 0.0, 0
    for r in records:
        price = (r.get("product") or {}).get("price")
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        count = r.get("quantity") if r.get("kind") == "pack" and r.get("unit") in ("pieces", "portions") and r.get("quantity") else 1
        total += price * count
        priced += 1
    return (round(total, 2) if priced else None), priced


WASTE_TOP = 5


def waste_top(hass: HomeAssistant, wasted: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """6.5 (#181): the products thrown away most, with their value and one tip each:
    "min" (it has a minimum stock: lower it), "freeze" (keeps in the freezer: freeze half), else "smaller" (smaller pack).
    Exactly one product per entry (similar products are not merged)."""
    from . import shelf_life  # noqa: PLC0415
    from .const import DATA_STOCK  # noqa: PLC0415
    from .stock import product_key  # noqa: PLC0415

    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    groups: dict[str, list[dict[str, Any]]] = {}
    names: dict[str, str] = {}
    for r in wasted:
        content = (r.get("content") or "").strip()
        if not content:
            continue
        key = product_key(content)
        groups.setdefault(key, []).append(r)
        names.setdefault(key, content)
    out = []
    for key, items in sorted(groups.items(), key=lambda kv: (-len(kv[1]), names[kv[0]].casefold()))[:WASTE_TOP]:
        content = names[key]
        value, _priced = record_value(items)
        row = stock.table_row(content, items[-1].get("product"))[0] if stock is not None else None
        entry = shelf_life.entry_by_id(row) or shelf_life.find_entry(content)
        if stock is not None and stock.minimum(content):
            tip = "min"
        elif entry is not None and entry.days.get(shelf_life.FREEZER) is not None:
            tip = "freeze"
        else:
            tip = "smaller"
        out.append({"content": content, "count": len(items), "value": value, "tip": tip})
    return out


def build_statistics(hass: HomeAssistant, records: list[dict[str, Any]], days: int | None = None) -> dict[str, Any]:
    today = dt_util.now().date()
    since = today - timedelta(days=days) if days else None
    records = [r for r in records if r.get("kind") not in ("household", "medicine")]  # food only
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
    thrown_value, thrown_priced = record_value(wasted)
    by_area: Counter[str] = Counter(r.get("area") or "" for r in wasted)

    # months (newest last): eaten and thrown away
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
    total = sum(1 for e in hass.config_entries.async_entries(DOMAIN) if e.data.get("cc"))
    return {
        "days": days,
        "emptied": len(chosen),
        "eaten": len(eaten),
        "thrown": len(wasted),
        "unknown": len(unknown),
        "waste_percent": round(100 * len(wasted) / decided) if decided else None,
        "avg_days_stored": round(sum(stored) / len(stored), 1) if stored else None,
        "thrown_value": thrown_value,
        "thrown_priced": thrown_priced,
        "top_thrown": top(wasted),
        "waste_top": waste_top(hass, wasted),
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
    "fr": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    "nl": ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
}


def _previous_month(month: str) -> str:
    year, mon = (int(x) for x in month.split("-"))
    return f"{year - 1:04d}-12" if mon == 1 else f"{year:04d}-{mon - 1:02d}"


def _current_fills(hass: HomeAssistant) -> list[str]:
    """Fill date (local ISO date) of all entries filled right now."""
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


_MONTH_TEXT: dict[str, dict[str, Any]] = {
    "de": {
        "filled": lambda f, e: f"📦 {f} befüllt, {e} geleert",
        "eaten": lambda e, t: f"✅ {e} gegessen, 🗑 {t} weggeworfen",
        "waste": lambda w: f"Weggeworfen: {w} %",
        "before": lambda b: f" (Vormonat {b} %)",
        "value": lambda m: f"💶 ca. {m} weggeworfen",
        "top": lambda names: f"Am häufigsten weggeworfen: {names}",
        "speech": lambda label, f, e, eaten, thrown: f"Im {label} wurden {f} Dosen befüllt und {e} geleert. {eaten} davon wurden gegessen und {thrown} weggeworfen.",
        "trend": {
            "better": lambda w, b: f" Das sind {w} Prozent, weniger als im Vormonat mit {b} Prozent.",
            "worse": lambda w, b: f" Das sind {w} Prozent, mehr als im Vormonat mit {b} Prozent.",
            "same": lambda w, b: f" Das sind {w} Prozent, genauso viel wie im Vormonat.",
        },
        "speech_value": lambda v: f" Das waren etwa {v} Euro.",
        "speech_top": lambda name: f" Am häufigsten weggeworfen: {name}.",
    },
    "en": {
        "filled": lambda f, e: f"📦 {f} filled, {e} emptied",
        "eaten": lambda e, t: f"✅ {e} eaten, 🗑 {t} thrown away",
        "waste": lambda w: f"Thrown away: {w} %",
        "before": lambda b: f" (previous month {b} %)",
        "value": lambda m: f"💶 about {m} thrown away",
        "top": lambda names: f"Thrown away most: {names}",
        "speech": lambda label, f, e, eaten, thrown: f"In {label}, {f} containers were filled and {e} emptied. {eaten} were eaten and {thrown} thrown away.",
        "trend": {
            "better": lambda w, b: f" That is {w} percent, less than {b} percent the month before.",
            "worse": lambda w, b: f" That is {w} percent, more than {b} percent the month before.",
            "same": lambda w, b: f" That is {w} percent, the same as the month before.",
        },
        "speech_value": lambda v: f" That was about {v} euros.",
        "speech_top": lambda name: f" Thrown away most: {name}.",
    },
    "fr": {
        "filled": lambda f, e: f"📦 {f} remplies, {e} vidées",
        "eaten": lambda e, t: f"✅ {e} mangées, 🗑 {t} jetées",
        "waste": lambda w: f"Jeté : {w} %",
        "before": lambda b: f" (mois précédent {b} %)",
        "value": lambda m: f"💶 environ {m} jetés",
        "top": lambda names: f"Le plus jeté : {names}",
        "speech": lambda label, f, e, eaten, thrown: f"En {label}, {f} boîtes ont été remplies et {e} vidées. {eaten} ont été mangées et {thrown} jetées.",
        "trend": {
            "better": lambda w, b: f" Cela fait {w} pour cent, moins que les {b} pour cent du mois précédent.",
            "worse": lambda w, b: f" Cela fait {w} pour cent, plus que les {b} pour cent du mois précédent.",
            "same": lambda w, b: f" Cela fait {w} pour cent, autant que le mois précédent.",
        },
        "speech_value": lambda v: f" Cela représentait environ {v} euros.",
        "speech_top": lambda name: f" Le plus jeté : {name}.",
    },
    "nl": {
        "filled": lambda f, e: f"📦 {f} gevuld, {e} geleegd",
        "eaten": lambda e, t: f"✅ {e} opgegeten, 🗑 {t} weggegooid",
        "waste": lambda w: f"Weggegooid: {w} %",
        "before": lambda b: f" (vorige maand {b} %)",
        "value": lambda m: f"💶 ongeveer {m} weggegooid",
        "top": lambda names: f"Meest weggegooid: {names}",
        "speech": lambda label, f, e, eaten, thrown: f"In {label} werden {f} dozen gevuld en {e} geleegd. {eaten} daarvan werden opgegeten en {thrown} weggegooid.",
        "trend": {
            "better": lambda w, b: f" Dat is {w} procent, minder dan de {b} procent van de vorige maand.",
            "worse": lambda w, b: f" Dat is {w} procent, meer dan de {b} procent van de vorige maand.",
            "same": lambda w, b: f" Dat is {w} procent, net zoveel als de vorige maand.",
        },
        "speech_value": lambda v: f" Dat was ongeveer {v} euro.",
        "speech_top": lambda name: f" Meest weggegooid: {name}.",
    },
}


def build_monthly_report(
    records: list[dict[str, Any]], fills_now: list[str], month: str, language: str
) -> dict[str, Any]:
    """Report for a month (YYYY-MM): filled, emptied, eaten, thrown away, comparison with the previous month."""
    records = [r for r in records if r.get("kind") not in ("household", "medicine")]  # food only
    lang = lang_code(language)

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
    thrown_value, _priced = record_value([r for r in items if _was_wasted(r)])
    year, mon = (int(x) for x in month.split("-"))
    label = f"{_MONTHS[lang][mon - 1]} {year}"
    text = pick(_MONTH_TEXT, language)
    lines = [text["filled"](filled, len(items)), text["eaten"](eaten, thrown)]
    trend = None
    if waste is not None:
        line = text["waste"](waste)
        if waste_before is not None:
            trend = "better" if waste < waste_before else "worse" if waste > waste_before else "same"
            line += text["before"](waste_before)
        lines.append(line)
    if thrown_value:
        lines.append(text["value"](_money(thrown_value, lang)))
    if top:
        lines.append(text["top"](", ".join(f"{t['content']} ({t['count']}×)" for t in top)))
    speech = text["speech"](label, filled, len(items), eaten, thrown)
    if waste is not None and waste_before is not None:
        speech += text["trend"][trend](waste, waste_before)
    if thrown_value:
        speech += text["speech_value"](round(thrown_value))
    if top:
        speech += text["speech_top"](top[0]["content"])
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
        "thrown_value": thrown_value,
        "summary": "\n".join(lines),
        # 5.8 (#157): one line – eaten, thrown away and its value
        "summary_short": " · ".join([lines[1], *[line for line in lines if line.startswith("💶")]]),
        "speech": speech,
        "empty": not filled and not items,
    }


def household_statistics(takes: list[dict[str, Any]], names: dict[str, dict[str, Any]], today: date, months: int = 6) -> dict[str, Any]:
    """Household items: pieces used and money spent per month, per product and in total (#82).

    Built from the takes of household items (−1, stocktake, last piece). Spending = pieces / pieces per pack ×
    price per pack, both as they were at the time of the take. Averages count the months since the first take
    in the window (at least one), so a product bought three weeks ago is not spread over half a year.
    """
    keys: list[str] = []
    for i in range(months - 1, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            y, m = y - 1, m + 12
        keys.append(f"{y:04d}-{m:02d}")
    first_month = keys[0]
    per_month: dict[str, dict[str, Any]] = {k: {"month": k, "pieces": 0, "cost": 0.0, "priced": True} for k in keys}
    products: dict[str, dict[str, Any]] = {}
    for take in takes:
        if not take.get("hh"):
            continue
        month = str(take.get("day", ""))[:7]
        if month < first_month or month not in per_month:
            continue
        n = int(take.get("n") or 0)
        size = max(1, int(take.get("size") or 1))
        cost = n / size * float(take["price"]) if take.get("price") else None
        info = names.get(take["key"]) or {}
        product = products.setdefault(
            take["key"],
            {"key": take["key"], "name": info.get("name") or take["key"], "piece": info.get("piece"), "pieces": 0,
             "cost": 0.0, "priced": True, "first": month},
        )
        product["pieces"] += n
        product["first"] = min(product["first"], month)
        per_month[month]["pieces"] += n
        if cost is None:
            product["priced"] = False
            per_month[month]["priced"] = False
        else:
            product["cost"] += cost
            per_month[month]["cost"] += cost

    def span(first: str) -> int:
        return max(1, len(keys) - keys.index(first))

    rows = []
    for product in products.values():
        n_months = span(product.pop("first"))
        rows.append({
            **{k: product[k] for k in ("key", "name", "piece", "pieces")},
            "pieces_per_month": round(product["pieces"] / n_months, 1),
            "cost": round(product["cost"], 2) if product["cost"] else None,
            "cost_per_month": round(product["cost"] / n_months, 2) if product["cost"] else None,
            "complete": product["priced"],  # False: some takes had no price
        })
    rows.sort(key=lambda r: (-(r["cost_per_month"] or 0), -r["pieces_per_month"], r["name"].casefold()))
    used = [m for m in keys if per_month[m]["pieces"]]
    total = sum(m["cost"] for m in per_month.values())
    n_total = span(used[0]) if used else 1
    return {
        "months": [{**m, "cost": round(m["cost"], 2)} for m in per_month.values()],
        "products": rows,
        "cost_per_month": round(total / n_total, 2) if total else None,
        "complete": all(p["complete"] for p in rows),
    }


async def async_household_statistics(hass: HomeAssistant, months: int = 6) -> dict[str, Any]:
    from .stock import async_get_stock, pack_entries, product_key  # noqa: PLC0415 - avoids an import cycle

    stock = await async_get_stock(hass)
    names: dict[str, dict[str, Any]] = {k: {"name": v.get("name"), "piece": (v.get("product") or {}).get("piece")} for k, v in stock.minimums.items()}
    for entry in pack_entries(hass):
        key = product_key(entry["content"])
        names.setdefault(key, {})
        names[key]["name"] = names[key].get("name") or entry["content"]
        names[key]["piece"] = names[key].get("piece") or entry.get("piece")
    return household_statistics(stock.takes, names, dt_util.now().date(), months)


# ---------- Weekly review (5.2, #129) ----------

SERVICE_GET_WEEKLY_REVIEW = "get_weekly_review"
WEEK = 7


def _money(value: float, lang: str | bool) -> str:
    """Euros as people write them: 4,98 € (de, fr, nl) or €4.98 (en)."""
    if lang is True or lang in ("de", "fr"):
        return f"{value:.2f} €".replace(".", ",")
    if lang == "nl":
        return f"€ {value:.2f}".replace(".", ",")
    return f"€{value:.2f}"


_WEEK_TEXT: dict[str, dict[str, Any]] = {
    "de": {
        "eaten": lambda e, t, v: f"✅ {e} gegessen, 🗑 {t} weggeworfen" + (f" (ca. {v})" if v else ""),
        "thrown": "Weggeworfen: ",
        "soon": "📅 Nächste Woche läuft ab: ",
        "none": "📅 Nächste Woche läuft nichts ab.",
        "speech": lambda e, t: f"Diese Woche wurden {e} Sachen gegessen und {t} weggeworfen.",
        "speech_soon": lambda names: f" Nächste Woche läuft {names} ab.",
        "speech_none": " Nächste Woche läuft nichts ab.",
        "title": "🗓 Wochenrückblick",
    },
    "en": {
        "eaten": lambda e, t, v: f"✅ {e} eaten, 🗑 {t} thrown away" + (f" (about {v})" if v else ""),
        "thrown": "Thrown away: ",
        "soon": "📅 Expiring next week: ",
        "none": "📅 Nothing expires next week.",
        "speech": lambda e, t: f"This week {e} things were eaten and {t} thrown away.",
        "speech_soon": lambda names: f" Next week {names} expire.",
        "speech_none": " Nothing expires next week.",
        "title": "🗓 Weekly review",
    },
    "fr": {
        "eaten": lambda e, t, v: f"✅ {e} mangés, 🗑 {t} jetés" + (f" (environ {v})" if v else ""),
        "thrown": "Jeté : ",
        "soon": "📅 Périme la semaine prochaine : ",
        "none": "📅 Rien ne périme la semaine prochaine.",
        "speech": lambda e, t: f"Cette semaine, {e} choses ont été mangées et {t} jetées.",
        "speech_soon": lambda names: f" La semaine prochaine périme : {names}.",
        "speech_none": " Rien ne périme la semaine prochaine.",
        "title": "🗓 Bilan de la semaine",
    },
    "nl": {
        "eaten": lambda e, t, v: f"✅ {e} opgegeten, 🗑 {t} weggegooid" + (f" (ongeveer {v})" if v else ""),
        "thrown": "Weggegooid: ",
        "soon": "📅 Volgende week verloopt: ",
        "none": "📅 Volgende week verloopt niets.",
        "speech": lambda e, t: f"Deze week werden {e} dingen opgegeten en {t} weggegooid.",
        "speech_soon": lambda names: f" Volgende week verloopt {names}.",
        "speech_none": " Volgende week verloopt niets.",
        "title": "🗓 Weekoverzicht",
    },
}


def build_weekly_review(
    records: list[dict[str, Any]], expiring: list[dict[str, Any]], today: date, language: str
) -> dict[str, Any]:
    """The last 7 days (eaten, thrown away and its value) and what expires in the next 7 days, with text and speech."""
    since = today - timedelta(days=WEEK)
    week = [r for r in records if r.get("kind") not in ("household", "medicine") and (d := _emptied_day(r)) and since < d <= today]
    thrown = [r for r in week if _was_wasted(r)]
    eaten = [r for r in week if r.get("outcome") == "eaten"]
    value, _priced = record_value(thrown)
    names = list(dict.fromkeys(r.get("content") or r.get("name") or "?" for r in thrown))
    upcoming = [i for i in expiring if i.get("kind") not in ("voucher",)]
    soon_names = [i.get("content") or i.get("name") for i in upcoming]
    text = pick(_WEEK_TEXT, language)
    lines: list[str] = [text["eaten"](len(eaten), len(thrown), _money(value, lang_code(language)) if value else None)]
    if names:
        lines.append(text["thrown"] + ", ".join(names[:5]))
    lines.append((text["soon"] + ", ".join(soon_names[:6])) if soon_names else text["none"])
    speech = text["speech"](len(eaten), len(thrown))
    speech += text["speech_soon"](", ".join(soon_names[:3])) if soon_names else text["speech_none"]
    return {
        "eaten": len(eaten),
        "thrown": len(thrown),
        "thrown_value": value,
        "thrown_items": names,
        "expiring": upcoming,
        "expiring_count": len(upcoming),
        "title": text["title"],
        "summary": "\n".join(lines),
        # 5.8 (#157): two short lines – the figures and what expires next week
        "summary_short": "\n".join([lines[0], lines[-1]]),
        "speech": speech,
    }


async def async_weekly_review(hass: HomeAssistant) -> dict[str, Any]:
    history = await async_get_history(hass)
    expiring = collect_expiring(hass, WEEK, include_expired=False)
    return build_weekly_review(history.records, expiring, dt_util.now().date(), hass.config.language or "en")


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


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/household_statistics"})
@websocket_api.async_response
async def ws_household_statistics(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], await async_household_statistics(hass))


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
    websocket_api.async_register_command(hass, ws_household_statistics)

    async def handle_report(call: ServiceCall) -> dict[str, Any]:
        return await async_monthly_report(hass, call.data.get("month"))

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_MONTHLY_REPORT,
        handle_report,
        schema=vol.Schema({vol.Optional("month"): vol.Match(r"^\d{4}-(0[1-9]|1[0-2])$")}),
        supports_response=SupportsResponse.ONLY,
    )

    async def handle_week(_call: ServiceCall) -> dict[str, Any]:
        return await async_weekly_review(hass)

    hass.services.async_register(
        DOMAIN, SERVICE_GET_WEEKLY_REVIEW, handle_week, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY
    )
    domain_data[DATA_STATS] = True
