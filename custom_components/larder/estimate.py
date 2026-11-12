"""Schätzung des Mindesthaltbarkeitsdatums: eingebaute Tabelle und/oder KI.

Modus (Einstellung): aus / Tabelle / Tabelle, sonst KI / nur KI.
Die Tabelle (`shelf_life.py`) arbeitet offline und ohne Dienst. Die KI-Schätzung läuft über
die Home-Assistant-Integration "AI Task" (`ai_task.generate_data`), also über den
KI-Dienst, den du dort eingerichtet hast. An die KI gehen nur: Inhalt, Name und Hinweise
des Lagerorts (Bereich), ob die Dose vakuumiert ist, und das Befüll-Datum. Ergebnisse
werden pro Kombination aus Inhalt, Bereich und Vakuum gespeichert; vom Nutzer korrigierte
Werte haben dabei Vorrang vor Tabelle und KI.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, timedelta
import logging
import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import shelf_life
from .const import (
    CONF_AI_ENABLED,
    CONF_AI_TASK_ENTITY,
    CONF_CALENDAR_ENTITY,
    CONF_ESTIMATE_MODE,
    CONF_NFC_NOTIFY,
    CONF_REPAIR_HINTS,
    CONF_SOON_DAYS,
    MAX_SOON_DAYS,
    SOON_DAYS,
    CONF_VACUUM_DEFAULT,
    CONF_OPENED_DAYS,
    CONF_RECIPE_DAYS,
    CONF_THAWED_DAYS,
    CONF_EXPERIMENTAL,
    CONF_TODO_ENTITY,
    DEFAULT_OPENED_DAYS,
    DEFAULT_RECIPE_DAYS,
    MAX_RECIPE_DAYS,
    DEFAULT_THAWED_DAYS,
    DOMAIN,
    ESTIMATE_AI,
    ESTIMATE_MODES,
    ESTIMATE_OFF,
    ESTIMATE_TABLE,
    ESTIMATE_TABLE_AI,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.estimator"
DATA_ESTIMATOR = "estimator"
DATA_ESTIMATOR_LOCK = "estimator_lock"

MIN_DAYS = 1
MAX_DAYS = 3650
MAX_RECENT = 60
MAX_TIP = 300


class EstimateError(HomeAssistantError):
    """Schätzung nicht möglich; der Text kommt aus den Übersetzungen."""

    def __init__(self, key: str, **placeholders: str) -> None:
        super().__init__(
            translation_domain=DOMAIN,
            translation_key=key,
            translation_placeholders=placeholders or None,
        )


@dataclass(frozen=True)
class StorageContext:
    """Was über den Lagerort (Bereich der Dose) bekannt ist."""

    area_name: str | None
    hints: list[str]
    temperature_c: float | None = None
    label_texts: tuple[str, ...] = ()
    storage_hint: str | None = None  # "Storage:" aus der Label-Vorlage
    max_days: int | None = None  # "Max storage:" aus der Label-Vorlage (kürzeste, wenn mehrere)


@dataclass(frozen=True)
class Estimate:
    days: int
    tip: str
    cached: bool
    key: str
    source: str = "ai"  # "table", "ai" oder "learned"
    basis: str = ""
    origin: str | None = None  # bei "learned": woher der Wert vor der Korrektur stammte


def cache_key(content: str, area_name: str | None, vacuum: bool) -> str:
    """Schlüssel für gemerkte Schätzungen: Inhalt + Bereich + Vakuum."""

    def norm(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip().casefold()

    return f"{norm(content)}|{norm(area_name or '')}|{'vacuum' if vacuum else 'normal'}"


def parse_key(key: str) -> tuple[str, str, bool]:
    """(Inhalt, Bereich, Vakuum) aus einem Cache-Schlüssel zurücklesen."""
    content, area, vacuum = key.rsplit("|", 2)
    return content, area, vacuum == "vacuum"


def _clamp(value: Any, default: int, low: int, high: int) -> int:
    """Gespeicherte Zahl robust lesen (kaputte Werte fallen auf den Standard zurück)."""
    try:
        return min(max(int(value), low), high)
    except (TypeError, ValueError):
        return default


def _origin_after_change(previous: dict[str, Any]) -> str | None:
    """Ursprung eines Eintrags, der vom Nutzer geändert wird (Tabelle/KI bleibt erkennbar)."""
    if previous.get("source") in ("table", "ai"):
        return previous["source"]
    return previous.get("origin")


def storage_context(hass: HomeAssistant, cc: str) -> StorageContext:
    """Bereich der Dose samt Temperatursensor und Label-Beschreibungen ermitteln."""
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    area_id = device.area_id if device else None
    if device and not area_id:
        for entity in er.async_entries_for_device(er.async_get(hass), device.id):
            if entity.area_id:
                area_id = entity.area_id
                break
    area = ar.async_get(hass).async_get_area(area_id) if area_id else None
    if area is None:
        return StorageContext(None, [])

    hints: list[str] = []
    temperature_c: float | None = None
    if area.temperature_entity_id:
        state = hass.states.get(area.temperature_entity_id)
        if state is not None:
            try:
                value = float(state.state)
            except ValueError:
                pass
            else:
                unit = state.attributes.get("unit_of_measurement", "")
                if unit in ("°C", "°F"):
                    temperature_c = (value - 32) * 5 / 9 if unit == "°F" else value
                hints.append(f"measured temperature in this place: {state.state} {unit}".strip())
    label_registry = lr.async_get(hass)
    label_texts: list[str] = []
    storage_hint: str | None = None
    limits: list[int] = []
    for label_id in sorted(area.labels):
        if label := label_registry.async_get_label(label_id):
            text = f"{label.name}: {label.description}" if label.description else label.name
            hints.append(text)
            label_texts.append(text)
            template = shelf_life.parse_label_template(label.description)
            storage_hint = storage_hint or template.get("storage")
            if (days := shelf_life.parse_duration(template.get("max_storage"))) is not None:
                limits.append(days)
    return StorageContext(
        area.name,
        hints,
        temperature_c,
        tuple(label_texts),
        storage_hint,
        min(limits) if limits else None,
    )


def build_instructions(
    *,
    content: str,
    context: StorageContext,
    vacuum: bool,
    filled: date,
    language: str,
) -> str:
    place = context.area_name or "unknown"
    lines = [
        "You estimate how long a food item stays good in a household.",
        "Be conservative and food-safety minded. Assume the item is stored right away.",
        f"Item (may be a dish or an ingredient): {content}",
        f"Storage location (name chosen by the user, may be German): {place}",
    ]
    if context.hints:
        lines.append("Additional information about the storage location:")
        lines.extend(f"- {hint}" for hint in context.hints)
    if context.max_days:
        lines.append(
            f"The household allows at most {context.max_days} days in this place; never answer more."
        )
    lines += [
        "Container: "
        + (
            "airtight vacuum-sealed box (air removed)"
            if vacuum
            else "normal box with a lid, not vacuum-sealed"
        ),
        f"Stored on: {filled.isoformat()}",
        "Answer with shelf_life_days (whole days counted from the storage date until the "
        "item should be used up) and storage_tip (one short sentence).",
        f"Write storage_tip in the language with code '{language}'.",
    ]
    return "\n".join(lines)


STRUCTURE: dict[str, Any] = {
    "shelf_life_days": {
        "description": "Whole days the item stays good, counted from the storage date",
        "required": True,
        "selector": {"number": {"min": MIN_DAYS, "max": MAX_DAYS, "mode": "box"}},
    },
    "storage_tip": {
        "description": "One short storage tip",
        "required": False,
        "selector": {"text": {}},
    },
}


def _number(low: int, high: int):
    return lambda value, default: _clamp(value, default, low, high)


def _flag(value: Any, default: bool) -> bool:
    return default if value is None else bool(value)


def _entity(value: Any, default: None) -> str | None:
    return str(value) if value else None


def _mode(value: Any, default: str) -> str:
    return value if value in ESTIMATE_MODES else default


# Einstellung → (Attribut des Schätzers, Vorgabe, Prüfung). Eine neue Einstellung braucht nur hier eine Zeile.
SETTINGS: dict[str, tuple[str, Any, Any]] = {
    CONF_ESTIMATE_MODE: ("mode", ESTIMATE_TABLE, _mode),
    CONF_OPENED_DAYS: ("opened_days", DEFAULT_OPENED_DAYS, _number(1, 365)),
    CONF_THAWED_DAYS: ("thawed_days", DEFAULT_THAWED_DAYS, _number(1, 365)),
    CONF_RECIPE_DAYS: ("recipe_days", DEFAULT_RECIPE_DAYS, _number(0, MAX_RECIPE_DAYS)),
    CONF_SOON_DAYS: ("soon_days", SOON_DAYS, _number(0, MAX_SOON_DAYS)),
    CONF_CALENDAR_ENTITY: ("calendar_entity", None, _entity),
    CONF_TODO_ENTITY: ("todo_entity", None, _entity),
    CONF_EXPERIMENTAL: ("experimental", False, _flag),
    CONF_NFC_NOTIFY: ("nfc_notify", True, _flag),
    CONF_REPAIR_HINTS: ("repair_hints", True, _flag),
    CONF_VACUUM_DEFAULT: ("vacuum_default", True, _flag),
    CONF_AI_TASK_ENTITY: ("ai_task_entity", None, _entity),
}

# Obergrenze für reine KI-Schätzungen je Lagerort (Tage); Tabelle und eigene Werte sind nicht betroffen.
AI_MAX_DAYS = {shelf_life.FRIDGE: 60, shelf_life.ZERO: 90, shelf_life.FREEZER: 548, shelf_life.PANTRY: 1095}
AI_MAX_DAYS_UNKNOWN = 365
AI_REFRESH_DAYS = 365  # so alte KI-Schätzungen werden beim nächsten Gebrauch neu geholt
_KEEP_OLD_ON = ("ai_failed", "ai_unavailable", "table_no_match", "table_unknown_storage")


def _cap_note(days: int, language: str, own: bool) -> str:
    """Hinweis im Tipp, wenn ein Wert begrenzt wurde."""
    span = shelf_life.format_duration(days, language)
    if language.lower().startswith("de"):
        return f"Begrenzt auf die max. Lagerzeit des Bereichs ({span})." if own else f"KI-Schätzung auf {span} begrenzt."
    return f"Capped at the area's max storage time ({span})." if own else f"AI estimate capped at {span}."


def _cap_table(result: shelf_life.TableResult, max_days: int | None, language: str) -> shelf_life.TableResult:
    if not max_days or result.days <= max_days:
        return result
    return shelf_life.TableResult(max_days, f"{result.tip} {_cap_note(max_days, language, True)}".strip(), result.basis)


class Estimator:
    """Globale Einstellungen und gemerkte Schätzungen (gilt für alle Dosen)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        for attr, default, _normalize in SETTINGS.values():
            setattr(self, attr, default)
        self._cache: dict[str, dict[str, Any]] = {}
        self._recent: list[str] = []

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        settings = dict(data.get("settings", {}))
        if settings.get(CONF_ESTIMATE_MODE) not in ESTIMATE_MODES:
            # Einstellung aus Version 0.5: KI an → nur KI (bisheriges Verhalten), sonst Tabelle.
            settings[CONF_ESTIMATE_MODE] = ESTIMATE_AI if settings.get(CONF_AI_ENABLED) else ESTIMATE_TABLE
        self._apply(settings)
        self._cache = data.get("cache", {})
        today = dt_util.now().date().isoformat()
        for entry in self._cache.values():
            if entry.get("source") == "ai":
                entry.setdefault("created", today)  # ältere Einträge altern ab jetzt
        self._recent = [str(x) for x in data.get("recent", []) if str(x).strip()][:MAX_RECENT]

    def _apply(self, settings: dict[str, Any]) -> None:
        """Einstellungen übernehmen; fehlende Schlüssel bleiben unverändert, kaputte Werte werden zur Vorgabe."""
        for conf, (attr, default, normalize) in SETTINGS.items():
            if conf in settings:
                setattr(self, attr, normalize(settings[conf], default))

    @property
    def enabled(self) -> bool:
        return self.mode != ESTIMATE_OFF

    @property
    def ai_enabled(self) -> bool:
        return self.mode in (ESTIMATE_TABLE_AI, ESTIMATE_AI)

    def settings(self) -> dict[str, Any]:
        return {conf: getattr(self, attr) for conf, (attr, _default, _normalize) in SETTINGS.items()}

    def _data(self) -> dict[str, Any]:
        return {"settings": self.settings(), "cache": self._cache, "recent": self._recent}

    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    async def async_update_settings(self, settings: dict[str, Any]) -> None:
        """Einstellungen ändern (Schlüssel wie in `SETTINGS`; nicht genannte bleiben, wie sie sind)."""
        self._apply(settings)
        await self._store.async_save(self._data())

    def learn(self, key: str, days: int, tip: str | None = None) -> None:
        """Wert merken (z. B. wenn der Nutzer das geschätzte MHD korrigiert hat)."""
        if not MIN_DAYS <= days <= MAX_DAYS:
            return
        previous = self._cache.get(key, {})
        entry = {
            k: previous[k] for k in ("content", "area", "basis") if k in previous
        }
        entry.update(
            days=days,
            tip=tip if tip is not None else previous.get("tip", ""),
            source="learned",
        )
        if origin := _origin_after_change(previous):
            entry["origin"] = origin
        self._cache[key] = entry
        self._schedule_save()

    # ----- Vorschläge für den Inhalt ("Dose befüllen") -----

    def remember_content(self, content: str) -> None:
        """Zuletzt eingetragene Inhalte merken (neueste zuerst, ohne Doppelte)."""
        content = content.strip()
        if not content:
            return
        folded = content.casefold()
        recent = [c for c in self._recent if c.casefold() != folded]
        self._recent = [content, *recent][:MAX_RECENT]
        self._schedule_save()

    def content_suggestions(self) -> list[str]:
        """Bekannte Inhalte: zuletzt benutzte zuerst, danach die der gemerkten Schätzungen."""
        seen: set[str] = set()
        out: list[str] = []
        for text in [*self._recent, *(e["content"] for e in self.list_entries())]:
            if text.casefold() not in seen:
                seen.add(text.casefold())
                out.append(text)
        return out

    # ----- Verwaltung der gemerkten Einträge (Dashboard-Liste) -----

    def list_entries(self) -> list[dict[str, Any]]:
        """Alle gemerkten Einträge, sortiert nach Inhalt und Bereich."""
        entries = []
        for key, value in self._cache.items():
            content, area, vacuum = parse_key(key)
            entries.append(
                {
                    "key": key,
                    "content": value.get("content") or content,
                    "area": value.get("area") or area,
                    "vacuum": vacuum,
                    "days": int(value["days"]),
                    "tip": str(value.get("tip", "")),
                    "source": value.get("source", "learned"),
                    "origin": value.get("origin"),
                }
            )
        entries.sort(key=lambda e: (e["content"].casefold(), e["area"].casefold(), not e["vacuum"]))
        return entries

    async def async_set_entry(self, key: str, days: int, tip: str | None = None) -> None:
        """Tage (und optional den Tipp) eines vorhandenen Eintrags ändern."""
        if key not in self._cache:
            raise EstimateError("entry_not_found")
        if not MIN_DAYS <= days <= MAX_DAYS:
            raise EstimateError("days_out_of_range", min=str(MIN_DAYS), max=str(MAX_DAYS))
        self.learn(key, days, tip)
        await self._store.async_save(self._data())

    async def async_add_entry(
        self, content: str, area: str, vacuum: bool, days: int, tip: str = ""
    ) -> str:
        """Eigenen Eintrag anlegen (gilt für genau diese Kombination aus Inhalt, Bereich, Vakuum)."""
        content, area = content.strip(), area.strip()
        if not content:
            raise EstimateError("no_content")
        if not area:
            raise EstimateError("no_area")
        if not MIN_DAYS <= days <= MAX_DAYS:
            raise EstimateError("days_out_of_range", min=str(MIN_DAYS), max=str(MAX_DAYS))
        key = cache_key(content, area, vacuum)
        self._cache[key] = {
            "days": days,
            "tip": tip.strip(),
            "source": "learned",
            "content": content,
            "area": area,
        }
        await self._store.async_save(self._data())
        return key

    async def async_delete_entry(self, key: str) -> None:
        """Eintrag vergessen: beim nächsten Schätzen wird neu berechnet."""
        if self._cache.pop(key, None) is None:
            raise EstimateError("entry_not_found")
        await self._store.async_save(self._data())

    async def async_estimate(
        self, *, content: str, context: StorageContext, vacuum: bool, filled: date
    ) -> Estimate:
        if not self.enabled:
            raise EstimateError("estimates_disabled")
        if not content.strip():
            raise EstimateError("no_content")
        if context.area_name is None:
            raise EstimateError("no_area")

        key = cache_key(content, context.area_name, vacuum)
        hit = self._cache.get(key)
        if hit is not None and hit.get("source") == "table" and hit.get("table_version") != shelf_life.TABLE_VERSION:
            # Tabelle oder Erkennung wurde verbessert: neu nachschlagen (eigene Korrekturen bleiben)
            hit = None
        if hit is not None and self._is_stale(hit):
            # Alte KI-Schätzung: neu schätzen; klappt das nicht, gilt der alte Wert weiter
            try:
                return await self._async_estimate_fresh(key, content, context, vacuum, filled)
            except EstimateError as err:
                if err.translation_key not in _KEEP_OLD_ON:
                    raise
        if hit is not None:
            days, tip = int(hit["days"]), str(hit.get("tip", ""))
            max_days = context.max_days
            if max_days and hit.get("source") in ("table", "ai") and days > max_days:
                # Lagerzeit am Bereich wurde (später) gesenkt: gilt auch für gemerkte Werte, nicht für eigene
                days = max_days
                tip = f"{tip} {_cap_note(max_days, self.hass.config.language, True)}".strip()
            return Estimate(
                days,
                tip,
                True,
                key,
                hit.get("source", "learned"),
                str(hit.get("basis", "")),
                hit.get("origin"),
            )
        return await self._async_estimate_fresh(key, content, context, vacuum, filled)

    @staticmethod
    def _is_stale(entry: dict[str, Any]) -> bool:
        """KI-Schätzung, die der Nutzer nie korrigiert hat und die älter als ein Jahr ist."""
        if entry.get("source") != "ai":
            return False
        try:
            created = date.fromisoformat(str(entry.get("created")))
        except ValueError:
            return False
        return (dt_util.now().date() - created).days >= AI_REFRESH_DAYS

    async def _async_estimate_fresh(
        self, key: str, content: str, context: StorageContext, vacuum: bool, filled: date
    ) -> Estimate:
        """Ohne gemerkten Wert schätzen: Tabelle und/oder KI, je nach Modus."""
        language = self.hass.config.language
        if self.mode in (ESTIMATE_TABLE, ESTIMATE_TABLE_AI):
            try:
                result = shelf_life.lookup(
                    content,
                    area_name=context.area_name,
                    temperature_c=context.temperature_c,
                    label_texts=context.label_texts,
                    vacuum=vacuum,
                    language=language,
                    storage_hint=context.storage_hint,
                )
            except shelf_life.TableUnsuitable as err:
                # Nie an die KI weiterreichen: Die Tabelle sagt bewusst "hier nicht lagern".
                raise EstimateError("table_unsuitable", food=err.food, place=err.place) from err
            except shelf_life.TableNoMatch as err:
                if self.mode == ESTIMATE_TABLE:
                    raise EstimateError("table_no_match") from err
            except shelf_life.TableUnknownStorage as err:
                if self.mode == ESTIMATE_TABLE:
                    raise EstimateError("table_unknown_storage", area=context.area_name) from err
            else:
                result = _cap_table(result, context.max_days, language)
                self._cache[key] = {
                    "days": result.days,
                    "tip": result.tip,
                    "source": "table",
                    "table_version": shelf_life.TABLE_VERSION,
                    "basis": result.basis,
                    "content": content.strip(),
                    "area": context.area_name,
                }
                self._schedule_save()
                return Estimate(result.days, result.tip, False, key, "table", result.basis)

        return await self._async_estimate_ai(key, content, context, vacuum, filled, language)

    async def _async_estimate_ai(
        self,
        key: str,
        content: str,
        context: StorageContext,
        vacuum: bool,
        filled: date,
        language: str,
    ) -> Estimate:
        if not self.hass.services.has_service("ai_task", "generate_data"):
            raise EstimateError("ai_unavailable")

        data: dict[str, Any] = {
            "task_name": "Larder: best-before estimate",
            "instructions": build_instructions(
                content=content.strip(),
                context=context,
                vacuum=vacuum,
                filled=filled,
                language=language,
            ),
            "structure": STRUCTURE,
        }
        if self.ai_task_entity:
            data["entity_id"] = self.ai_task_entity
        try:
            async with asyncio.timeout(90):
                response = await self.hass.services.async_call(
                    "ai_task",
                    "generate_data",
                    data,
                    blocking=True,
                    return_response=True,
                )
        except HomeAssistantError as err:
            raise EstimateError("ai_failed", error=str(err)) from err
        except TimeoutError as err:
            raise EstimateError("ai_failed", error="timeout") from err
        except Exception as err:  # noqa: BLE001 - Schema- und Anbieterfehler sauber melden
            _LOGGER.debug("AI task failed", exc_info=True)
            raise EstimateError("ai_failed", error=str(err)) from err

        result = (response or {}).get("data")
        try:
            days = round(float(result["shelf_life_days"]))
        except (TypeError, KeyError, ValueError, OverflowError) as err:
            raise EstimateError("ai_failed", error="unexpected answer") from err
        days = min(max(days, MIN_DAYS), MAX_DAYS)
        tip = str(result.get("storage_tip") or "").strip()[:MAX_TIP]
        storage = shelf_life.classify_storage(
            context.area_name, context.temperature_c, context.label_texts, context.storage_hint
        )
        limit = AI_MAX_DAYS.get(storage.key, AI_MAX_DAYS_UNKNOWN) if storage else AI_MAX_DAYS_UNKNOWN
        own_limit = context.max_days is not None and context.max_days <= limit
        if own_limit:
            limit = context.max_days
        if days > limit:
            _LOGGER.info("KI-Schätzung für %s von %s auf %s Tage begrenzt", content.strip(), days, limit)
            days = limit
            tip = f"{tip} {_cap_note(limit, language, own_limit)}".strip()

        self._cache[key] = {
            "days": days,
            "tip": tip,
            "source": "ai",
            "created": dt_util.now().date().isoformat(),
            "content": content.strip(),
            "area": context.area_name,
        }
        self._schedule_save()
        return Estimate(days, tip, False, key, "ai")


async def async_get_estimator(hass: HomeAssistant) -> Estimator:
    """Einmalig geladene gemeinsame Instanz (idempotent, egal wie viele Dosen es gibt)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock: asyncio.Lock = domain_data.setdefault(DATA_ESTIMATOR_LOCK, asyncio.Lock())
    async with lock:
        if (estimator := domain_data.get(DATA_ESTIMATOR)) is None:
            estimator = Estimator(hass)
            await estimator.async_load()
            domain_data[DATA_ESTIMATOR] = estimator
        return estimator


def estimate_best_before(filled: date, days: int) -> date:
    return filled + timedelta(days=days)
