"""Wochenplan: Gerichte für einen Tag einplanen, mit den Dosen, die dafür gebraucht werden.

- Optional als ganztägiger Termin im gewählten Kalender ("🍽 Bolognese"), mit Markierung in der
  Beschreibung, damit er beim Löschen des Plans wieder entfernt werden kann.
- Auftau-Erinnerung: liegt eine benötigte Dose im Gefrierschrank, nennt die tägliche Zusammenfassung
  sie rechtzeitig (Vorlauf einstellbar, Vorgabe: 1 Tag). Der Knopf "Aufgetaut" in der Push-Nachricht
  (Aktion LARDER_THAWED) oder im Dashboard markiert sie als aufgetaut (MHD wie beim Knopf
  "Aufgetaut"); variable Dosen ziehen dabei in den Kühlschrank, wenn es genau einen gibt.
"""

from __future__ import annotations

from datetime import date, timedelta
import logging
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import calendar as ha_calendar, websocket_api
from homeassistant.components.calendar import CalendarEntity
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, callback
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
from .const import DOMAIN
from .estimate import storage_context
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

DATA_PLAN = "plan"
DATA_WS = "plan_ws_registered"
STORAGE_KEY = f"{DOMAIN}.plan"
STORAGE_VERSION = 1
KEEP_DAYS = 30  # vergangene Pläne so lange behalten
THAW_ACTION = "LARDER_THAWED"
MARKER = "larder-plan:"


def _cc_of_device(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return None
    return next((ident for domain, ident in device.identifiers if domain == DOMAIN), None)


def _state(hass: HomeAssistant, platform: str, cc: str, key: str) -> str | None:
    entity_id = er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
        return None
    return state.state


def storage_kind(hass: HomeAssistant, cc: str) -> str | None:
    """Art des Lagerorts nach Name/Label (nicht nach Sensor): freezer, fridge, zero, pantry."""
    context = storage_context(hass, cc)
    storage = shelf_life.classify_storage(context.area_name, None, context.label_texts, context.storage_hint)
    return storage.key if storage else None


def fridge_area(hass: HomeAssistant) -> str | None:
    """Der eine Kühlschrank-Bereich (nach Name oder Label), sonst None."""
    found = []
    labels = lr.async_get(hass)
    for area in ar.async_get(hass).async_list_areas():
        texts: list[str] = []
        hint = None
        for label_id in area.labels:
            if label := labels.async_get_label(label_id):
                texts.append(f"{label.name}: {label.description}" if label.description else label.name)
                hint = hint or shelf_life.parse_label_template(label.description).get("storage")
        storage = shelf_life.classify_storage(area.name, None, texts, hint)
        if storage and storage.key == shelf_life.FRIDGE:
            found.append(area.id)
    return found[0] if len(found) == 1 else None


class MealPlan:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.plans: list[dict[str, Any]] = []
        self._unsub = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.plans = [p for p in data.get("plans", []) if isinstance(p, dict)]

    def _save(self) -> None:
        cutoff = (dt_util.now().date() - timedelta(days=KEEP_DAYS)).isoformat()
        self.plans = [p for p in self.plans if p.get("date", "") >= cutoff]
        self._store.async_delay_save(lambda: {"plans": self.plans}, 1)

    @callback
    def async_start(self) -> None:
        if self._unsub is None:
            self._unsub = self.hass.bus.async_listen("mobile_app_notification_action", self._notification_action)

    @callback
    def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    async def _notification_action(self, event: Event) -> None:
        if event.data.get("action") == THAW_ACTION:
            await self.async_mark_thawed([item["cc"] for item in self.thaw_items()])

    # ----- Pläne -----

    def list(self, since: date | None = None) -> list[dict[str, Any]]:
        """Offene Pläne ab heute (gekochte nicht mehr)."""
        since_iso = (since or dt_util.now().date()).isoformat()
        return sorted(
            (p for p in self.plans if p["date"] >= since_iso and not p.get("cooked")),
            key=lambda p: (p["date"], p["title"].casefold()),
        )

    def _public(self, plan: dict[str, Any]) -> dict[str, Any]:
        devices = dr.async_get(self.hass)
        containers = []
        for cc in plan.get("ccs", []):
            device = devices.async_get_device(identifiers={(DOMAIN, cc)})
            containers.append(
                {
                    "cc": cc,
                    "device_id": device.id if device else None,
                    "name": (device.name_by_user or device.name) if device else cc,
                    "content": _state(self.hass, "text", cc, "content") or "",
                    "frozen": storage_kind(self.hass, cc) == shelf_life.FREEZER,
                    "thawed": cc in plan.get("thawed", []),
                }
            )
        return {k: v for k, v in plan.items() if k not in ("ccs", "thawed")} | {
            "containers": containers,
            "missing": self.missing_ingredients(plan),
        }

    async def async_add(
        self, day: date, title: str, ccs: list[str], recipe_id: str | None = None, ingredients: list[str] | None = None
    ) -> dict[str, Any]:
        plan = {
            "id": uuid.uuid4().hex[:12],
            "date": day.isoformat(),
            "title": title.strip()[:120],
            "ccs": list(dict.fromkeys(ccs)),
            "thawed": [],
            "created": dt_util.now().isoformat(timespec="seconds"),
        }
        if recipe_id:
            plan["recipe_id"] = recipe_id
        if ingredients:
            plan["ingredients"] = [str(i).strip()[:120] for i in ingredients if str(i).strip()][:40]
        self.plans.append(plan)
        self._save()
        await self._async_calendar_add(plan)
        return plan

    async def async_delete(self, plan_id: str) -> bool:
        plan = next((p for p in self.plans if p["id"] == plan_id), None)
        if plan is None:
            return False
        self.plans.remove(plan)
        self._save()
        await self._async_calendar_delete(plan)
        return True

    def get(self, plan_id: str) -> dict[str, Any] | None:
        return next((p for p in self.plans if p["id"] == plan_id), None)

    async def async_cooked(self, plan_id: str) -> dict[str, int] | None:
        """Gericht gekocht: benutzte Dosen leeren (gegessen) bzw. bei mehreren Portionen eine entnehmen."""
        from .history import async_get_history

        plan = self.get(plan_id)
        if plan is None:
            return None
        registry = er.async_get(self.hass)
        history = await async_get_history(self.hass)
        emptied = taken = 0
        for cc in plan.get("ccs", []):
            if not _state(self.hass, "text", cc, "content"):
                continue
            try:
                quantity = int(float(_state(self.hass, "number", cc, "portions") or 0))
            except ValueError:
                quantity = 0
            unit = _state(self.hass, "select", cc, "unit") or "portions"
            number_id = registry.async_get_entity_id("number", DOMAIN, f"{cc}_portions")
            if quantity > 1 and unit in ("portions", "pieces", "slices") and number_id:
                await self.hass.services.async_call(
                    "number", "set_value", {"entity_id": number_id, "value": quantity - 1}, blocking=True
                )
                taken += 1
                continue
            button = registry.async_get_entity_id("button", DOMAIN, f"{cc}_empty_container")
            if button:
                history.set_pending(cc, "eaten")
                try:
                    await self.hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
                    emptied += 1
                except HomeAssistantError:
                    _LOGGER.debug("Leeren von %s nicht möglich", cc, exc_info=True)
                history.pop_pending(cc)
        plan["cooked"] = dt_util.now().isoformat(timespec="seconds")
        self._save()
        return {"emptied": emptied, "taken": taken}

    def missing_ingredients(self, plan: dict[str, Any]) -> list[str]:
        """Zutaten des Plans, die in keiner der gewählten Dosen sind (grober Vergleich der Wörter)."""
        have = " ".join((_state(self.hass, "text", cc, "content") or "").casefold() for cc in plan.get("ccs", []))
        out = []
        for item in plan.get("ingredients", []):
            words = [w for w in shelf_life.norm(item).split() if len(w) > 2 and not w.isdigit()]
            if words and any(w in shelf_life.norm(have) for w in words):
                continue
            out.append(item)
        return out

    async def async_shopping(self, plan_id: str) -> dict[str, int] | None:
        """Fehlende Zutaten auf die gewählte Einkaufsliste setzen (offene Einträge nicht doppelt)."""
        from .shopping import async_add_to_shopping_list

        plan = self.get(plan_id)
        if plan is None:
            return None
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        todo = getattr(estimator, "todo_entity", None)
        if not todo:
            raise HomeAssistantError("no shopping list")
        missing = self.missing_ingredients(plan)
        added = 0
        for item in missing:
            if await async_add_to_shopping_list(self.hass, todo, item):
                added += 1
        return {"added": added, "missing": len(missing)}

    # ----- Kalender -----

    def _calendar(self) -> CalendarEntity | None:
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        entity_id = getattr(estimator, "meal_calendar", None)
        component = self.hass.data.get(ha_calendar.DATA_COMPONENT)
        if not entity_id or component is None:
            return None
        return component.get_entity(entity_id)

    async def _async_calendar_add(self, plan: dict[str, Any]) -> None:
        entity = self._calendar()
        if entity is None:
            return
        day = date.fromisoformat(plan["date"])
        try:
            await self.hass.services.async_call(
                "calendar",
                "create_event",
                {
                    "entity_id": entity.entity_id,
                    "summary": f"🍽 {plan['title']}",
                    "description": f"Larder\n{MARKER}{plan['id']}",
                    "start_date": day.isoformat(),
                    "end_date": (day + timedelta(days=1)).isoformat(),
                },
                blocking=True,
            )
        except HomeAssistantError:
            _LOGGER.warning("Termin für den Wochenplan konnte nicht in %s angelegt werden", entity.entity_id, exc_info=True)

    async def _async_calendar_delete(self, plan: dict[str, Any]) -> None:
        from .calendar_sync import backend_for

        entity = self._calendar()
        if entity is None:
            return
        backend = backend_for(self.hass, entity)
        if not backend.can_delete:
            return
        day = date.fromisoformat(plan["date"])
        start = dt_util.start_of_local_day(day) - timedelta(days=1)
        try:
            for item in await backend.async_scan(start, start + timedelta(days=3)):
                if f"{MARKER}{plan['id']}" in (item.description or ""):
                    await backend.async_delete(item)
        except HomeAssistantError:
            _LOGGER.warning("Termin des Wochenplans konnte nicht gelöscht werden", exc_info=True)

    # ----- Auftauen -----

    def thaw_items(self, today: date | None = None) -> list[dict[str, Any]]:
        """Dosen im Gefrierschrank, die für einen bald geplanten Tag aufgetaut werden müssen."""
        today = today or dt_util.now().date()
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        lead = int(getattr(estimator, "thaw_days", 1))
        devices = dr.async_get(self.hass)
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for plan in self.list(today):
            day = date.fromisoformat(plan["date"])
            until = (day - today).days
            if until > lead:
                continue
            for cc in plan.get("ccs", []):
                if cc in seen or cc in plan.get("thawed", []):
                    continue
                content = _state(self.hass, "text", cc, "content")
                if not content or storage_kind(self.hass, cc) != shelf_life.FREEZER:
                    continue
                seen.add(cc)
                device = devices.async_get_device(identifiers={(DOMAIN, cc)})
                items.append(
                    {
                        "cc": cc,
                        "device_id": device.id if device else None,
                        "name": (device.name_by_user or device.name) if device else cc,
                        "content": content,
                        "plan": plan["title"],
                        "date": plan["date"],
                        "days_until": until,
                    }
                )
        return items

    async def async_mark_thawed(self, ccs: list[str]) -> int:
        """Als aufgetaut markieren: MHD wie beim Knopf "Aufgetaut", variable Dosen in den Kühlschrank."""
        registry = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        fridge = fridge_area(self.hass)
        done = 0
        for cc in dict.fromkeys(ccs):
            date_id = registry.async_get_entity_id("date", DOMAIN, f"{cc}_best_before")
            if date_id:
                try:
                    await self.hass.services.async_call(DOMAIN, "mark_thawed", {"entity_id": date_id}, blocking=True)
                except HomeAssistantError:
                    _LOGGER.debug("Aufgetaut für %s nicht möglich", cc, exc_info=True)
            if fridge and _state(self.hass, "switch", cc, "flexible") == STATE_ON:
                device = devices.async_get_device(identifiers={(DOMAIN, cc)})
                if device is not None:
                    devices.async_update_device(device.id, area_id=fridge)
            for plan in self.plans:
                if cc in plan.get("ccs", []) and cc not in plan.setdefault("thawed", []):
                    plan["thawed"].append(cc)
            done += 1
        self._save()
        return done


_THAW_TEXT = {
    "de": {
        "head": "Zum Auftauen in den Kühlschrank:",
        "for": "für",
        "when": lambda d: "heute" if d == 0 else "morgen" if d == 1 else f"in {d} Tagen",
        "speech": lambda items: "Bitte in den Kühlschrank stellen: " + ", ".join(f"{i['content']} aus {i['name']}" for i in items) + ".",
        "button": "Aufgetaut",
    },
    "en": {
        "head": "Move to the fridge to thaw:",
        "for": "for",
        "when": lambda d: "today" if d == 0 else "tomorrow" if d == 1 else f"in {d} days",
        "speech": lambda items: "Please move to the fridge: " + ", ".join(f"{i['content']} from {i['name']}" for i in items) + ".",
        "button": "Thawed",
    },
}


def thaw_texts(items: list[dict[str, Any]], language: str) -> tuple[str, str, str]:
    """(Text für die Push-Nachricht, Sprechtext, Titel des Knopfs) für die Auftau-Erinnerung."""
    text = _THAW_TEXT["de" if language.lower().startswith("de") else "en"]
    if not items:
        return "", "", text["button"]
    lines = [text["head"]]
    for item in items:
        lines.append(f"🧊 {item['content']} ({item['name']}) {text['for']} {item['plan']}, {text['when'](item['days_until'])}")
    return "\n".join(lines), text["speech"](items), text["button"]


async def async_get_plan(hass: HomeAssistant) -> MealPlan:
    async def create() -> MealPlan:
        plan = MealPlan(hass)
        await plan.async_load()
        return plan

    return await async_singleton(hass, DATA_PLAN, create)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plan_list"})
@websocket_api.async_response
async def ws_plan_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    plan = await async_get_plan(hass)
    connection.send_result(
        msg["id"], {"plans": [plan._public(p) for p in plan.list()], "thaw": plan.thaw_items()}  # noqa: SLF001
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan_add",
        vol.Required("date"): str,
        vol.Required("title"): vol.All(str, vol.Length(min=1, max=120)),
        vol.Optional("device_ids", default=[]): [str],
        vol.Optional("recipe_id"): str,
        vol.Optional("ingredients", default=[]): [str],
    }
)
@websocket_api.async_response
async def ws_plan_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        day = date.fromisoformat(msg["date"])
    except ValueError:
        connection.send_error(msg["id"], "invalid_date", "invalid date")
        return
    ccs = [cc for d in msg["device_ids"] if (cc := _cc_of_device(hass, d))]
    plan = await async_get_plan(hass)
    added = await plan.async_add(day, msg["title"], ccs, msg.get("recipe_id"), msg["ingredients"])
    connection.send_result(msg["id"], {"plan": plan._public(added)})  # noqa: SLF001


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plan_delete", vol.Required("plan_id"): str})
@websocket_api.async_response
async def ws_plan_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    plan = await async_get_plan(hass)
    if not await plan.async_delete(msg["plan_id"]):
        connection.send_error(msg["id"], "not_found", "plan not found")
        return
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/thawed", vol.Required("device_ids"): [str]})
@websocket_api.async_response
async def ws_thawed(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    ccs = [cc for d in msg["device_ids"] if (cc := _cc_of_device(hass, d))]
    plan = await async_get_plan(hass)
    connection.send_result(msg["id"], {"thawed": await plan.async_mark_thawed(ccs)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plan_cooked", vol.Required("plan_id"): str})
@websocket_api.async_response
async def ws_plan_cooked(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    plan = await async_get_plan(hass)
    result = await plan.async_cooked(msg["plan_id"])
    if result is None:
        connection.send_error(msg["id"], "not_found", "plan not found")
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plan_shopping", vol.Required("plan_id"): str})
@websocket_api.async_response
async def ws_plan_shopping(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    plan = await async_get_plan(hass)
    try:
        result = await plan.async_shopping(msg["plan_id"])
    except HomeAssistantError:
        connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen")
        return
    if result is None:
        connection.send_error(msg["id"], "not_found", "plan not found")
        return
    connection.send_result(msg["id"], result)


def async_setup_plan_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    for command in (ws_plan_list, ws_plan_add, ws_plan_delete, ws_thawed, ws_plan_cooked, ws_plan_shopping):
        websocket_api.async_register_command(hass, command)
    domain_data[DATA_WS] = True

