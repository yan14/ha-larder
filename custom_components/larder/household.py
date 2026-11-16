"""Household items (toilet paper, detergent, batteries …) and the areas they live in.

* **Kind `household`**: technically a pack without a best-before date. The count is in pieces (rolls); the
  optional pack size (pieces per pack) turns it into packs for the shopping list and the stock value.
* **Categories**: a small keyword list, enough for an icon and a group in the dashboard.
* **Area scopes via labels** (so Home Assistant itself can use them as well):
  `Larder: Household` / `Larder: Haushalt` → household only, `Larder: Food` / `Larder: Lebensmittel` → food only,
  any other Larder label (or both scope labels) → both. Scope labels are *additional*: storage kind labels such as
  `Larder: Freezer` keep their description template for the best-before estimate.
* **Automatic assignment** (upgrade to 4.0): unambiguous places get a scope label – freezer, fridge and 0 °C
  drawer food, bathroom / utility room / laundry household. Labels are only added, nothing is moved or deleted.
"""

from __future__ import annotations

import math
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, label_registry as lr

from . import shelf_life
from .const import CONF_KIND, DOMAIN, KIND_HOUSEHOLD, KIND_PACK, larder_id
from .entity import kind_of

SCOPE_FOOD = "food"
SCOPE_HOUSEHOLD = "household"
SCOPE_BOTH = "both"
SCOPES = (SCOPE_FOOD, SCOPE_HOUSEHOLD, SCOPE_BOTH)

_FOOD_NAMES = ("larder: lebensmittel", "larder: food")
_HOUSEHOLD_NAMES = ("larder: haushalt", "larder: household")
_HOUSEHOLD_AREA = re.compile(
    r"\b(bad|badezimmer|gäste-?wc|wc|bath(room)?|hauswirtschaftsraum|hwr|utility( room)?|waschküche|waschkeller|waschraum|laundry( room)?|putzkammer|putzraum)\b",
    re.IGNORECASE,
)

# category → keywords (German and English); the first match wins
_CATEGORIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("hh_paper", ("klopapier", "toilettenpapier", "küchenrolle", "küchenpapier", "taschent", "serviette", "toilet paper", "kitchen roll", "paper towel", "tissue", "napkin")),
    ("hh_laundry", ("waschmittel", "weichspüler", "waschpulver", "fleckenentferner", "detergent", "softener", "washing powder", "stain remover")),
    ("hh_cleaning", ("reiniger", "spülmittel", "spültab", "spülmaschine", "geschirrspül", "klarspüler", "schwamm", "müllbeutel", "putz", "entkalker", "cleaner", "dish", "sponge", "bin bag", "descaler")),
    ("hh_care", ("seife", "shampoo", "duschgel", "zahnpasta", "zahnbürste", "deo", "creme", "rasier", "windel", "watte", "soap", "shower gel", "toothpaste", "toothbrush", "cream", "razor", "nappy", "diaper", "cotton")),
    ("hh_batteries", ("batterie", "akku", "knopfzelle", "glühbirne", "leuchtmittel", "battery", "batteries", "light bulb")),
)
HOUSEHOLD_OTHER = "hh_other"


def household_category(content: str | None) -> str | None:
    text = " ".join((content or "").casefold().split())
    if not text:
        return None
    return next((cat for cat, words in _CATEGORIES if any(w in text for w in words)), HOUSEHOLD_OTHER)


def packs_needed(minimum: int, count: int, pack_size: int | None) -> int:
    """How many packs bring the stock (in pieces) back to the minimum; at least one."""
    return max(1, math.ceil(max(0, minimum - count) / max(1, int(pack_size or 1))))


# ---------- area scopes ----------


def _label_names(hass: HomeAssistant, area: ar.AreaEntry) -> list[str]:
    labels = lr.async_get(hass)
    return [label.name.strip().casefold() for lid in area.labels if (label := labels.async_get_label(lid))]


def _is_larder(name: str) -> bool:
    return name == "larder" or name.startswith("larder:")


def area_scope(hass: HomeAssistant, area: ar.AreaEntry) -> str | None:
    """food / household / both for an area with a Larder label; None without one."""
    names = [n for n in _label_names(hass, area) if _is_larder(n)]
    if not names:
        return None
    food = any(n in _FOOD_NAMES for n in names)
    household = any(n in _HOUSEHOLD_NAMES for n in names)
    if food != household:
        return SCOPE_FOOD if food else SCOPE_HOUSEHOLD
    return SCOPE_BOTH


def _scope_label(hass: HomeAssistant, scope: str, create: bool) -> str | None:
    """Label id of the scope label (existing in either language, otherwise created in the system language)."""
    registry = lr.async_get(hass)
    names = _FOOD_NAMES if scope == SCOPE_FOOD else _HOUSEHOLD_NAMES
    for label in registry.async_list_labels():
        if label.name.strip().casefold() in names:
            return label.label_id
    if not create:
        return None
    de = (hass.config.language or "en").lower().startswith("de")
    name = ("Larder: Lebensmittel" if de else "Larder: Food") if scope == SCOPE_FOOD else ("Larder: Haushalt" if de else "Larder: Household")
    return registry.async_create(name).label_id


def _plain_label(hass: HomeAssistant) -> str:
    registry = lr.async_get(hass)
    for label in registry.async_list_labels():
        if label.name.strip().casefold() == "larder":
            return label.label_id
    return registry.async_create("Larder").label_id


@callback
def async_set_area_scope(hass: HomeAssistant, area_id: str, scope: str) -> None:
    """Set what an area is used for by adding / removing the scope labels (other labels stay)."""
    areas = ar.async_get(hass)
    area = areas.async_get_area(area_id)
    if area is None or scope not in SCOPES:
        raise ValueError("unknown area or scope")
    labels = set(area.labels)
    for other in (SCOPE_FOOD, SCOPE_HOUSEHOLD):
        if (lid := _scope_label(hass, other, create=False)) is not None:
            labels.discard(lid)
    if scope in (SCOPE_FOOD, SCOPE_HOUSEHOLD):
        labels.add(_scope_label(hass, scope, create=True))
    else:
        registry = lr.async_get(hass)
        names = [label.name.strip().casefold() for lid in labels if (label := registry.async_get_label(lid))]
        if not any(_is_larder(n) for n in names):
            labels.add(_plain_label(hass))  # stays a Larder area, for both
    areas.async_update(area_id, labels=labels)


def _areas_in_use(hass: HomeAssistant) -> set[str]:
    devices = dr.async_get(hass)
    return {
        device.area_id
        for device in devices.devices.values()
        if device.area_id and larder_id(device)
    }


def plan_area_scopes(hass: HomeAssistant) -> list[dict[str, Any]]:
    """What the automatic assignment would do: [{area_id, name, scope}] for unambiguous areas without a scope label."""
    areas = ar.async_get(hass).async_list_areas()
    any_larder = any(area_scope(hass, area) is not None for area in areas)
    plan: list[dict[str, Any]] = []
    for area in areas:
        scope = area_scope(hass, area)
        if scope in (SCOPE_FOOD, SCOPE_HOUSEHOLD):
            continue
        words = " ".join([area.name, *[n.removeprefix("larder:").strip() for n in _label_names(hass, area) if _is_larder(n)]])
        storage = shelf_life.storage_from_words(words)
        if storage is not None and storage.key in (shelf_life.FREEZER, shelf_life.FRIDGE, shelf_life.ZERO):
            # without any Larder labels every area is offered; only label places that are used or already labelled
            if scope is not None or not any_larder or area.id in _areas_in_use(hass):
                plan.append({"area_id": area.id, "name": area.name, "scope": SCOPE_FOOD})
        elif _HOUSEHOLD_AREA.search(area.name):
            plan.append({"area_id": area.id, "name": area.name, "scope": SCOPE_HOUSEHOLD})
    return sorted(plan, key=lambda p: p["name"].casefold())


@callback
def async_assign_area_scopes(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Apply the plan. If no area had a Larder label before, areas in use get the plain label so they stay offered."""
    areas = ar.async_get(hass)
    had_labels = any(area_scope(hass, area) is not None for area in areas.async_list_areas())
    plan = plan_area_scopes(hass)
    if plan and not had_labels:
        planned = {p["area_id"] for p in plan}
        plain = _plain_label(hass)
        for area_id in _areas_in_use(hass) - planned:
            if (area := areas.async_get_area(area_id)) is not None:
                areas.async_update(area_id, labels={*area.labels, plain})
    for item in plan:
        async_set_area_scope(hass, item["area_id"], item["scope"])
    return plan


def scopes_assigned(hass: HomeAssistant) -> bool:
    return any(area_scope(hass, area) in (SCOPE_FOOD, SCOPE_HOUSEHOLD) for area in ar.async_get(hass).async_list_areas())


# ---------- WebSocket ----------


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/area_scopes"})
@callback
def ws_area_scopes(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    areas = ar.async_get(hass).async_list_areas()
    connection.send_result(
        msg["id"],
        {"scopes": {area.id: area_scope(hass, area) for area in areas}, "plan": plan_area_scopes(hass)},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/area_scope_set", vol.Required("area_id"): str, vol.Required("scope"): vol.In(SCOPES)}
)
@websocket_api.require_admin
@callback
def ws_area_scope_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        async_set_area_scope(hass, msg["area_id"], msg["scope"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    ws_area_scopes(hass, connection, msg)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/area_scopes_auto"})
@websocket_api.require_admin
@callback
def ws_area_scopes_auto(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    done = async_assign_area_scopes(hass)
    areas = ar.async_get(hass).async_list_areas()
    connection.send_result(msg["id"], {"assigned": done, "scopes": {area.id: area_scope(hass, area) for area in areas}, "plan": []})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/convert_kind", vol.Required("device_id"): str, vol.Required("kind"): vol.In((KIND_PACK, KIND_HOUSEHOLD))}
)
@websocket_api.async_response
async def ws_convert_kind(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Turn a pack into a household item (or back); the entry is reloaded with the other kind."""
    device = dr.async_get(hass).async_get(msg["device_id"])
    cc = larder_id(device)
    entry = next((e for e in hass.config_entries.async_entries(DOMAIN) if e.data.get("cc") == cc), None) if cc else None
    if entry is None or kind_of(entry) not in (KIND_PACK, KIND_HOUSEHOLD):
        connection.send_error(msg["id"], "not_found", "not a pack or household item")
        return
    if kind_of(entry) != msg["kind"]:
        hass.config_entries.async_update_entry(entry, data={**entry.data, CONF_KIND: msg["kind"]})
        await hass.config_entries.async_reload(entry.entry_id)
    connection.send_result(msg["id"], {"kind": msg["kind"]})


@callback
def async_setup_household_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("household_ws"):
        return
    hass.data[DOMAIN]["household_ws"] = True
    for command in (ws_area_scopes, ws_area_scope_set, ws_area_scopes_auto, ws_convert_kind):
        websocket_api.async_register_command(hass, command)
