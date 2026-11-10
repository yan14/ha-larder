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

from . import shelf_life
from .const import (
    CONF_AI_ENABLED,
    CONF_AI_TASK_ENTITY,
    CONF_CALENDAR_ENTITY,
    CONF_ESTIMATE_MODE,
    CONF_NFC_NOTIFY,
    CONF_OPENED_DAYS,
    DEFAULT_OPENED_DAYS,
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
    for label_id in sorted(area.labels):
        if label := label_registry.async_get_label(label_id):
            text = f"{label.name}: {label.description}" if label.description else label.name
            hints.append(text)
            label_texts.append(text)
    return StorageContext(area.name, hints, temperature_c, tuple(label_texts))


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


class Estimator:
    """Globale Einstellungen und gemerkte Schätzungen (gilt für alle Dosen)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.mode = ESTIMATE_TABLE
        self.opened_days = DEFAULT_OPENED_DAYS
        self.calendar_entity: str | None = None
        self.nfc_notify = True
        self.ai_task_entity: str | None = None
        self._cache: dict[str, dict[str, Any]] = {}
        self._recent: list[str] = []

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        settings = data.get("settings", {})
        mode = settings.get(CONF_ESTIMATE_MODE)
        if mode not in ESTIMATE_MODES:
            # Einstellung aus Version 0.5: KI an → nur KI (bisheriges Verhalten), sonst Tabelle.
            mode = ESTIMATE_AI if settings.get(CONF_AI_ENABLED) else ESTIMATE_TABLE
        self.mode = mode
        self.opened_days = min(max(int(settings.get(CONF_OPENED_DAYS, DEFAULT_OPENED_DAYS)), 1), 365)
        self.ai_task_entity = settings.get(CONF_AI_TASK_ENTITY) or None
        self.calendar_entity = settings.get(CONF_CALENDAR_ENTITY) or None
        self.nfc_notify = bool(settings.get(CONF_NFC_NOTIFY, True))
        self._cache = data.get("cache", {})
        self._recent = [str(x) for x in data.get("recent", []) if str(x).strip()][:MAX_RECENT]

    @property
    def enabled(self) -> bool:
        return self.mode != ESTIMATE_OFF

    @property
    def ai_enabled(self) -> bool:
        return self.mode in (ESTIMATE_TABLE_AI, ESTIMATE_AI)

    def _data(self) -> dict[str, Any]:
        return {
            "settings": {
                CONF_ESTIMATE_MODE: self.mode,
                CONF_OPENED_DAYS: self.opened_days,
                CONF_CALENDAR_ENTITY: self.calendar_entity,
                CONF_NFC_NOTIFY: self.nfc_notify,
                CONF_AI_TASK_ENTITY: self.ai_task_entity,
            },
            "cache": self._cache,
            "recent": self._recent,
        }

    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    async def async_update_settings(
        self,
        mode: str,
        entity: str | None,
        opened_days: int | None = None,
        calendar_entity: str | None = None,
        nfc_notify: bool | None = None,
    ) -> None:
        self.calendar_entity = calendar_entity or None
        if nfc_notify is not None:
            self.nfc_notify = nfc_notify
        self.mode = mode if mode in ESTIMATE_MODES else ESTIMATE_TABLE
        if opened_days is not None:
            self.opened_days = min(max(int(opened_days), 1), 365)
        self.ai_task_entity = entity or None
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
        if (hit := self._cache.get(key)) is not None:
            return Estimate(
                int(hit["days"]),
                str(hit.get("tip", "")),
                True,
                key,
                hit.get("source", "learned"),
                str(hit.get("basis", "")),
                hit.get("origin"),
            )

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
                self._cache[key] = {
                    "days": result.days,
                    "tip": result.tip,
                    "source": "table",
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
            "task_name": "Zwilling Food Storage: best-before estimate",
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
        except (TypeError, KeyError, ValueError) as err:
            raise EstimateError("ai_failed", error="unexpected answer") from err
        days = min(max(days, MIN_DAYS), MAX_DAYS)
        tip = str(result.get("storage_tip") or "").strip()

        self._cache[key] = {
            "days": days,
            "tip": tip,
            "source": "ai",
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
