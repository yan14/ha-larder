"""Estimate of the best-before date: built-in table and/or AI.

Mode (setting): off / table / table, else AI / AI only.
The table (`shelf_life.py`) works offline and without a service. The AI estimate runs through
the Home Assistant integration "AI Task" (`ai_task.generate_data`), i.e. through the
AI service you set up there. Only these go to the AI: content, name and notes
of the storage place (area), whether the container is vacuumed, and the fill date. Results
are stored per combination of content, area and vacuum; values corrected by the user
take precedence over table and AI.
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
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import shelf_life
from .area_storage import own_hint
from .const import (
    CONF_AI_TASK_ENTITY,
    CONF_CALENDAR_ENTITY,
    CONF_ESTIMATE_MODE,
    CONF_FREEZER_FIRST_WEEKS,
    CONF_LONG_SOON_DAYS,
    CONF_MEAL_CALENDAR,
    CONF_NFC_NOTIFY,
    CONF_OPENED_DAYS,
    CONF_PLAN_DAYS,
    CONF_PLAN_SOURCE,
    CONF_RECALL_CHECK,
    CONF_RECALL_STATE,
    CONF_RECIPE_DAYS,
    CONF_REORDER_SHOPPING,
    CONF_REPAIR_HINTS,
    CONF_SECTION_ORDER,
    CONF_SHOPPING_DETAILS,
    CONF_SOON_DAYS,
    CONF_STOCK_LEAD_DAYS,
    CONF_SUPPLY_CHECK,
    CONF_SUPPLY_DAYS,
    CONF_SUPPLY_PERSONS,
    CONF_TEMPERATURE_WARNING,
    CONF_THAW_DAYS,
    CONF_THAWED_DAYS,
    CONF_TODO_ENTITY,
    CONF_TODO_HOUSEHOLD,
    CONF_TODO_PHARMACY,
    CONF_VACUUM_DEFAULT,
    CONF_WATCH_ALLERGENS,
    DEFAULT_FREEZER_FIRST_WEEKS,
    DEFAULT_LONG_SOON_DAYS,
    DEFAULT_OPENED_DAYS,
    DEFAULT_RECIPE_DAYS,
    DEFAULT_THAW_DAYS,
    DEFAULT_THAWED_DAYS,
    DOMAIN,
    ESTIMATE_AI,
    ESTIMATE_MODES,
    ESTIMATE_OFF,
    ESTIMATE_TABLE,
    ESTIMATE_TABLE_AI,
    MAX_RECIPE_DAYS,
    MAX_SOON_DAYS,
    PLAN_SOURCES,
    RECALL_STATES,
    SOON_DAYS,
)
from .devices import device_of
from .product import ALLERGEN_KEYS
from .sections import SECTIONS, normalize_order

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
    """Estimate not possible; the text comes from the translations."""

    def __init__(self, key: str, **placeholders: str) -> None:
        super().__init__(
            translation_domain=DOMAIN,
            translation_key=key,
            translation_placeholders=placeholders or None,
        )


@dataclass(frozen=True)
class StorageContext:
    """What is known about the storage place (area of the container)."""

    area_name: str | None
    hints: list[str]
    temperature_c: float | None = None
    label_texts: tuple[str, ...] = ()
    storage_hint: str | None = None  # "Storage:" from the label template
    max_days: int | None = None  # "Max storage:" from the label template (shortest if several)


@dataclass(frozen=True)
class Estimate:
    days: int
    tip: str
    cached: bool
    key: str
    source: str = "ai"  # "table", "ai" or "learned"
    basis: str = ""
    origin: str | None = None  # for "learned": where the value came from before the correction


def cache_key(content: str, area_name: str | None, vacuum: bool) -> str:
    """Key for remembered estimates: content + area + vacuum."""

    def norm(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip().casefold()

    return f"{norm(content)}|{norm(area_name or '')}|{'vacuum' if vacuum else 'normal'}"


def parse_key(key: str) -> tuple[str, str, bool]:
    """Read (content, area, vacuum) back from a cache key."""
    content, area, vacuum = key.rsplit("|", 2)
    return content, area, vacuum.split("#", 1)[0].split("@", 1)[0] == "vacuum"  # 6.2: "#fr" another language, 6.3: "@row"


def _clamp(value: Any, default: int, low: int, high: int) -> int:
    """Read a stored number robustly (broken values fall back to the default)."""
    try:
        return min(max(int(value), low), high)
    except (TypeError, ValueError):
        return default


def _origin_after_change(previous: dict[str, Any]) -> str | None:
    """Origin of an entry changed by the user (table/AI stays recognisable)."""
    if previous.get("source") in ("table", "ai"):
        return previous["source"]
    return previous.get("origin")


def storage_context(hass: HomeAssistant, cc: str) -> StorageContext:
    """Find the container's area with its temperature sensor and label descriptions."""
    device = device_of(hass, cc)
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
    # 6.7 (#196): the kind chosen in the dashboard counts like a label "Storage: …"
    if (own := own_hint(hass, area.id)) is not None:
        storage_hint = own
        hints.append(f"storage kind set by the user: {own}")
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
    opened: bool = False,
) -> str:
    place = context.area_name or "unknown"
    lines = [
        "You estimate how long a food item stays good in a household.",
        "Be conservative and food-safety minded. Assume the item is stored right away.",
    ]
    if opened:
        lines.append(
            "The item is a bought product that was opened just now: answer how long it stays good "
            "AFTER OPENING at this place, following official guidance such as USDA FoodKeeper "
            "(e.g. ketchup 6 months refrigerated, mayonnaise 2 months)."
        )
    lines += [
        f"Item (may be a dish or an ingredient): {content}",
        "If several items are listed (separated by commas), they share one container: "
        "answer for the item that spoils first and name it in the storage tip.",
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


def _allergen_keys(value: Any, default: list[str]) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return list(default)
    return [key for key in ALLERGEN_KEYS if key in value]


def _mode(value: Any, default: str) -> str:
    return value if value in ESTIMATE_MODES else default


# Setting → (attribute of the estimator, default, check). A new setting only needs one line here.
SETTINGS: dict[str, tuple[str, Any, Any]] = {
    CONF_ESTIMATE_MODE: ("mode", ESTIMATE_TABLE, _mode),
    CONF_OPENED_DAYS: ("opened_days", DEFAULT_OPENED_DAYS, _number(1, 365)),
    CONF_THAWED_DAYS: ("thawed_days", DEFAULT_THAWED_DAYS, _number(1, 365)),
    CONF_RECIPE_DAYS: ("recipe_days", DEFAULT_RECIPE_DAYS, _number(0, MAX_RECIPE_DAYS)),
    CONF_SOON_DAYS: ("soon_days", SOON_DAYS, _number(0, MAX_SOON_DAYS)),
    CONF_CALENDAR_ENTITY: ("calendar_entity", None, _entity),
    CONF_TODO_ENTITY: ("todo_entity", None, _entity),
    CONF_TODO_HOUSEHOLD: ("todo_household", None, _entity),
    CONF_TODO_PHARMACY: ("todo_pharmacy", None, _entity),
    CONF_LONG_SOON_DAYS: ("long_soon_days", DEFAULT_LONG_SOON_DAYS, _number(1, 365)),
    CONF_NFC_NOTIFY: ("nfc_notify", True, _flag),
    CONF_REPAIR_HINTS: ("repair_hints", True, _flag),
    CONF_TEMPERATURE_WARNING: ("temperature_warning", True, _flag),
    CONF_MEAL_CALENDAR: ("meal_calendar", None, _entity),
    CONF_THAW_DAYS: ("thaw_days", DEFAULT_THAW_DAYS, _number(0, 3)),
    CONF_VACUUM_DEFAULT: ("vacuum_default", True, _flag),
    CONF_WATCH_ALLERGENS: ("watch_allergens", [], _allergen_keys),
    CONF_SHOPPING_DETAILS: ("shopping_details", True, _flag),
    CONF_STOCK_LEAD_DAYS: ("stock_lead_days", 7, _number(1, 60)),
    CONF_REORDER_SHOPPING: ("reorder_shopping", False, _flag),
    CONF_RECALL_CHECK: ("recall_check", True, _flag),
    CONF_PLAN_SOURCE: ("plan_source", "book_ai", lambda value, default: value if value in PLAN_SOURCES else default),
    CONF_PLAN_DAYS: ("plan_days", 5, _number(1, 14)),
    CONF_FREEZER_FIRST_WEEKS: ("freezer_first_weeks", DEFAULT_FREEZER_FIRST_WEEKS, _number(0, 26)),
    CONF_RECALL_STATE: ("recall_state", None, lambda value, default: value if value in RECALL_STATES else None),
    CONF_AI_TASK_ENTITY: ("ai_task_entity", None, _entity),
    CONF_SECTION_ORDER: ("section_order", list(SECTIONS), normalize_order),
    CONF_SUPPLY_CHECK: ("supply_check", True, _flag),
    CONF_SUPPLY_PERSONS: ("supply_persons", 2, _number(1, 20)),
    CONF_SUPPLY_DAYS: ("supply_days", 10, _number(3, 30)),
}

# Upper limit for pure AI estimates per storage place (days); table and own values are not affected.
AI_MAX_DAYS = {shelf_life.FRIDGE: 60, shelf_life.ZERO: 90, shelf_life.FREEZER: 548, shelf_life.PANTRY: 1095}
AI_MAX_DAYS_UNKNOWN = 365
AI_REFRESH_DAYS = 365  # AI estimates this old are fetched anew on next use
_KEEP_OLD_ON = ("ai_failed", "ai_unavailable", "table_no_match", "table_unknown_storage")


def _cap_note(days: int, language: str, own: bool) -> str:
    """Note in the tip if a value was limited."""
    span = shelf_life.format_duration(days, language)
    lang = str(language or "en").lower()[:2]
    if lang == "de":
        return f"Begrenzt auf die max. Lagerzeit des Bereichs ({span})." if own else f"KI-Schätzung auf {span} begrenzt."
    if lang == "fr":
        return f"Limité à la durée de stockage max. de la pièce ({span})." if own else f"Estimation de l'IA limitée à {span}."
    if lang == "nl":
        return f"Begrensd tot de max. bewaartijd van de ruimte ({span})." if own else f"AI-schatting begrensd tot {span}."
    return f"Capped at the area's max storage time ({span})." if own else f"AI estimate capped at {span}."


def _cap_table(result: shelf_life.TableResult, max_days: int | None, language: str) -> shelf_life.TableResult:
    if not max_days or result.days <= max_days:
        return result
    return shelf_life.TableResult(max_days, f"{result.tip} {_cap_note(max_days, language, True)}".strip(), result.basis)


class Estimator:
    """Global settings and remembered estimates (apply to all containers)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        for attr, default, _normalize in SETTINGS.values():
            setattr(self, attr, default)
        self._cache: dict[str, dict[str, Any]] = {}
        self._recent: list[str] = []
        self._opened: dict[str, dict[str, Any]] = {}  # AI values after opening (5.5), key as cache_key

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        settings = dict(data.get("settings", {}))
        self._apply(settings)
        self._cache = data.get("cache", {})
        today = dt_util.now().date().isoformat()
        for entry in self._cache.values():
            if entry.get("source") == "ai":
                entry.setdefault("created", today)  # older entries age from now on
        self._recent = [str(x) for x in data.get("recent", []) if str(x).strip()][:MAX_RECENT]
        self._opened = dict(data.get("opened", {}))

    def _apply(self, settings: dict[str, Any]) -> None:
        """Apply settings; missing keys stay unchanged, broken values become the default."""
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
        return {"settings": self.settings(), "cache": self._cache, "recent": self._recent, "opened": self._opened}

    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    async def async_update_settings(self, settings: dict[str, Any]) -> None:
        """Change settings (keys as in `SETTINGS`; those not named stay as they are)."""
        self._apply(settings)
        await self._store.async_save(self._data())

    def learn(self, key: str, days: int, tip: str | None = None) -> None:
        """Remember a value (e.g. when the user corrected the estimated date)."""
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

    # ----- Suggestions for the content ("Fill container") -----

    def remember_content(self, content: str) -> None:
        """Remember the contents entered last (newest first, no duplicates)."""
        content = content.strip()
        if not content:
            return
        folded = content.casefold()
        recent = [c for c in self._recent if c.casefold() != folded]
        self._recent = [content, *recent][:MAX_RECENT]
        self._schedule_save()

    def content_suggestions(self) -> list[str]:
        """Known contents: recently used first, then those of the remembered estimates."""
        seen: set[str] = set()
        out: list[str] = []
        for text in [*self._recent, *(e["content"] for e in self.list_entries())]:
            if text.casefold() not in seen:
                seen.add(text.casefold())
                out.append(text)
        return out

    # ----- Managing the remembered entries (dashboard list) -----

    def list_entries(self) -> list[dict[str, Any]]:
        """All remembered entries, sorted by content and area."""
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
        """Change the days (and optionally the tip) of an existing entry."""
        if key not in self._cache:
            raise EstimateError("entry_not_found")
        if not MIN_DAYS <= days <= MAX_DAYS:
            raise EstimateError("days_out_of_range", min=str(MIN_DAYS), max=str(MAX_DAYS))
        self.learn(key, days, tip)
        await self._store.async_save(self._data())

    async def async_add_entry(
        self, content: str, area: str, vacuum: bool, days: int, tip: str = ""
    ) -> str:
        """Create an own entry (applies to exactly this combination of content, area, vacuum)."""
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

    def import_entries(self, entries: dict[str, dict[str, Any]], replace: bool = False) -> dict[str, int]:
        """Apply imported entries (keys as in `cache_key`); see export.async_import_estimates."""
        added = updated = kept = 0
        if replace:
            self._cache = {}
        for key, entry in entries.items():
            previous = self._cache.get(key)
            if previous is None:
                added += 1
            elif previous.get("source") == "learned" and entry.get("source") != "learned":
                kept += 1  # an own correction beats a table/AI value from the file
                continue
            else:
                updated += 1
            if entry.get("source") == "table":
                entry = {**entry, "table_version": shelf_life.TABLE_VERSION}
            self._cache[key] = entry
        self._schedule_save()
        return {"added": added, "updated": updated, "kept": kept}

    async def async_delete_entry(self, key: str) -> None:
        """Forget an entry: the next estimate is calculated anew."""
        if self._cache.pop(key, None) is None:
            raise EstimateError("entry_not_found")
        await self._store.async_save(self._data())

    async def async_estimate(
        self, *, content: str, context: StorageContext, vacuum: bool, filled: date, language: str | None = None,
        entry_id: str | None = None,
    ) -> Estimate:
        """`language`: of the person asking (6.2, #172: the dashboard sends it); else the system language.
        `entry_id` (6.3): the table row chosen for the product (by you or from Open Food Facts)."""
        if not self.enabled:
            raise EstimateError("estimates_disabled")
        if not content.strip():
            raise EstimateError("no_content")
        if context.area_name is None:
            raise EstimateError("no_area")

        key = cache_key(content, context.area_name, vacuum)
        if language and (lang := str(language).lower()[:2]) != str(self.hass.config.language or "").lower()[:2]:
            # 6.2 (#172): the same word can mean something else in another language ("Pommes")
            key = f"{key}#{lang}"
        if entry_id:
            key = f"{key}@{entry_id}"  # 6.3: another row, another value
        hit = self._cache.get(key)
        if hit is not None and hit.get("source") == "table" and hit.get("table_version") != shelf_life.TABLE_VERSION:
            # table or detection was improved: look up again (own corrections stay)
            hit = None
        if hit is not None and self._is_stale(hit):
            # old AI estimate: estimate again; if that fails the old value still applies
            try:
                return await self._async_estimate_fresh(key, content, context, vacuum, filled, language, entry_id)
            except EstimateError as err:
                if err.translation_key not in _KEEP_OLD_ON:
                    raise
        if hit is not None:
            days, tip = int(hit["days"]), str(hit.get("tip", ""))
            max_days = context.max_days
            if max_days and hit.get("source") in ("table", "ai") and days > max_days:
                # storage time of the area was lowered (later): also applies to remembered values, not to own ones
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
        return await self._async_estimate_fresh(key, content, context, vacuum, filled, language, entry_id)

    async def async_estimate_opened(self, *, content: str, context: StorageContext) -> Estimate:
        """Shelf life after opening a bought product, counted from today (5.5).

        Table (USDA FoodKeeper values after opening) → AI asked explicitly for "after opening" (mode
        table + AI or AI) → EstimateError, then the caller uses the setting "shelf life after opening".
        """
        if not self.enabled:
            raise EstimateError("estimates_disabled")
        if not content.strip():
            raise EstimateError("no_content")
        language = self.hass.config.language or "en"
        if self.mode in (ESTIMATE_TABLE, ESTIMATE_TABLE_AI):
            try:
                result = shelf_life.lookup(
                    content,
                    area_name=context.area_name,
                    temperature_c=context.temperature_c,
                    label_texts=context.label_texts,
                    vacuum=False,
                    language=language,
                    storage_hint=context.storage_hint,
                    opened=True,
                )
            except shelf_life.TableUnsuitable as err:
                raise EstimateError("table_unsuitable", food=err.food, place=err.place) from err
            except (shelf_life.TableNoMatch, shelf_life.TableUnknownStorage) as err:
                if self.mode == ESTIMATE_TABLE:
                    raise EstimateError("table_no_match") from err
            else:
                result = _cap_table(result, context.max_days, language)
                return Estimate(result.days, result.tip, False, "", "table", result.basis)
        key = cache_key(content, context.area_name, False)
        hit = self._opened.get(key)
        if hit is not None and not self._is_stale(hit):
            return Estimate(int(hit["days"]), str(hit.get("tip", "")), True, key, "ai")
        estimate = await self._async_estimate_ai(
            key, content, context, False, dt_util.now().date(), language, opened=True
        )
        return estimate

    @staticmethod
    def _is_stale(entry: dict[str, Any]) -> bool:
        """AI estimate the user never corrected and that is older than a year."""
        if entry.get("source") != "ai":
            return False
        try:
            created = date.fromisoformat(str(entry.get("created")))
        except ValueError:
            return False
        return (dt_util.now().date() - created).days >= AI_REFRESH_DAYS

    async def _async_estimate_fresh(
        self, key: str, content: str, context: StorageContext, vacuum: bool, filled: date, language: str | None = None,
        entry_id: str | None = None,
    ) -> Estimate:
        """Estimate without a remembered value: table and/or AI, depending on the mode."""
        language = language or self.hass.config.language
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
                    entry_id=entry_id,
                )
            except shelf_life.TableUnsuitable as err:
                # Never pass on to the AI: the table says "do not store here" on purpose.
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
        opened: bool = False,
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
                opened=opened,
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
        except Exception as err:  # noqa: BLE001 - report schema and provider errors cleanly
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

        (self._opened if opened else self._cache)[key] = {
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
    """Shared instance loaded once (idempotent, no matter how many containers there are)."""
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
