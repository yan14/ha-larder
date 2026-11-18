"""Shopping mode and recurring purchases (4.10).

**Shopping mode:** the dashboard shows the open items of every list Larder uses, grouped by store section.
Ticking one off completes it on its to-do list and puts it into stock right away: a known product (in stock now,
put on the list by Larder or with a minimum stock) gets one more pack – or as many as Larder asked for – at its
usual place, like *Put away* (4.3). Anything else is reported as unknown; the dashboard collects it and opens the
add dialog at the end. "Bought – into stock?" does not offer it again.

**Recurring purchases:** products you buy regularly without counting them (a crate of water every Friday, milk
twice a week) go onto their list on the chosen weekdays or every n days, once a day at 8:00 – never twice while
still open on the list.
"""

from __future__ import annotations

from datetime import date
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .const import DOMAIN, KIND_PACK, PACK_KINDS
from .sections import section_of, section_order
from .shopping import async_add_to_shopping_list, default_list, shopping_list_for
from .stock import _known_product, async_add_known, async_get_stock, pack_entries, product_key

_LOGGER = logging.getLogger(__name__)

MAX_RECURRING = 50


def shopping_lists(hass: HomeAssistant, stock) -> list[str]:
    """Every list Larder writes to: default lists, lists of products, lists of tracked items."""
    lists = [default_list(hass), default_list(hass, "household"), default_list(hass, "medicine")]
    lists += list(stock.lists.values())
    lists += [info.get("list") for info in stock.tracked.values()]
    lists += [r.get("list") for r in stock.recurring.values()]
    return [entity for entity in dict.fromkeys(lists) if entity and hass.states.get(entity) is not None]


def known_for(hass: HomeAssistant, stock, summary: str) -> tuple[dict[str, Any] | None, int]:
    """What a list item is in Larder (content, kind, product data, usual place) and how many packs; or None."""
    tracked = stock.tracked.get(summary.strip().casefold()) or {}
    content = tracked.get("content") or summary.split(" (", 1)[0].strip()
    key = product_key(content)
    packs = int(tracked.get("count") or 1)
    found = [p for p in pack_entries(hass) if product_key(p["content"]) == key]
    if found:
        return _known_product(found, ""), packs
    kind = tracked.get("kind") or ((stock.minimums.get(key) or {}).get("product") or {}).get("kind")
    if kind in PACK_KINDS or (key in stock.minimums and not kind):
        product = {**((stock.minimums.get(key) or {}).get("product") or {}), **(tracked.get("product") or {})}
        product.pop("kind", None)
        name = (stock.minimums.get(key) or {}).get("name") or content
        return {
            "content": name,
            "kind": kind or KIND_PACK,
            "product": {k: v for k, v in product.items() if v},
            "area_id": tracked.get("area_id"),
            "compartment": tracked.get("compartment") or "",
        }, packs
    return None, packs


async def _open_items(hass: HomeAssistant, entity_id: str) -> list[dict[str, Any]]:
    response = await hass.services.async_call(
        "todo", "get_items", {"entity_id": entity_id, "status": "needs_action"}, blocking=True, return_response=True
    )
    return ((response or {}).get(entity_id) or {}).get("items") or []


async def async_shopping_view(hass: HomeAssistant) -> dict[str, Any]:
    stock = await async_get_stock(hass)
    order = section_order(hass)
    items: list[dict[str, Any]] = []
    for entity_id in shopping_lists(hass, stock):
        try:
            open_items = await _open_items(hass, entity_id)
        except HomeAssistantError:
            _LOGGER.debug("Liste %s nicht lesbar", entity_id, exc_info=True)
            continue
        state = hass.states.get(entity_id)
        list_name = state.attributes.get("friendly_name", entity_id) if state else entity_id
        for item in open_items:
            summary = str(item.get("summary") or "").strip()
            if not summary or not item.get("uid"):
                continue
            known, _packs = known_for(hass, stock, summary)
            items.append({
                "list": entity_id,
                "list_name": list_name,
                "uid": item["uid"],
                "summary": summary,
                "section": section_of(hass, known["content"] if known else summary, known["kind"] if known else None),
                "known": bool(known),
            })
    rank = {s: n for n, s in enumerate(order)}
    items.sort(key=lambda i: rank.get(i["section"], len(order)))
    return {"order": order, "items": items}


async def async_shopping_check(hass: HomeAssistant, entity_id: str, uid: str, summary: str) -> dict[str, Any]:
    """Tick an item off and put it into stock (known products) – or report it as unknown."""
    stock = await async_get_stock(hass)
    known, packs = known_for(hass, stock, summary)
    # taken care of here: "bought – into stock?" must not offer it again
    stock.tracked.pop(summary.strip().casefold(), None)
    await hass.services.async_call(
        "todo", "update_item", {"entity_id": entity_id, "item": uid, "status": "completed"}, blocking=True
    )
    if known is None:
        return {"status": "unknown", "name": _base_name(summary)}
    result = await async_add_known(hass, known, packs)
    return result


def _base_name(summary: str) -> str:
    return summary.split(" (", 1)[0].strip()


# ---------- Recurring purchases ----------


def recurring_due(entry: dict[str, Any], today: date) -> bool:
    """Is a recurring purchase due today (weekdays 0 = Monday … 6 = Sunday, or every n days)?"""
    last = entry.get("last")
    if last == today.isoformat():
        return False
    weekdays = entry.get("weekdays") or []
    if weekdays:
        return today.weekday() in weekdays
    every = int(entry.get("every_days") or 0)
    if every <= 0:
        return False
    if not last:
        return True
    try:
        return (today - date.fromisoformat(last)).days >= every
    except ValueError:
        return True


async def async_check_recurring(hass: HomeAssistant, today: date | None = None) -> list[str]:
    """Put due recurring purchases onto their lists. Returns what was added."""
    stock = await async_get_stock(hass)
    today = today or dt_util.now().date()
    added: list[str] = []
    changed = False
    for entry in stock.recurring.values():
        if not recurring_due(entry, today):
            continue
        entry["last"] = today.isoformat()
        changed = True
        todo = entry.get("list") or shopping_list_for(hass, entry["name"])
        if todo and hass.states.get(todo) is not None and await async_add_to_shopping_list(hass, todo, entry["name"]):
            added.append(entry["name"])
    if changed:
        stock.save_now()
    return added


def recurring_list(stock) -> list[dict[str, Any]]:
    return sorted(({"key": k, **v} for k, v in stock.recurring.items()), key=lambda e: e["name"].casefold())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/shopping_mode"})
@websocket_api.async_response
async def ws_shopping_mode(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_shopping_view(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/shopping_check",
        vol.Required("list"): vol.All(str, vol.Match(r"^todo\.")),
        vol.Required("uid"): str,
        vol.Required("summary"): vol.All(str, vol.Length(min=1, max=255)),
    }
)
@websocket_api.async_response
async def ws_shopping_check(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_shopping_check(hass, msg["list"], msg["uid"], msg["summary"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "check_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recurring"})
@websocket_api.async_response
async def ws_recurring(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"items": recurring_list(await async_get_stock(hass))})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/recurring_set",
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=120)),
        vol.Optional("weekdays"): [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))],
        vol.Optional("every_days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=365)),
        vol.Optional("list"): vol.Any(None, vol.All(str, vol.Match(r"^todo\."))),
    }
)
@websocket_api.async_response
async def ws_recurring_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Add or change a recurring purchase (weekdays or every n days)."""
    stock = await async_get_stock(hass)
    name = " ".join(msg["name"].split())
    weekdays = sorted(set(msg.get("weekdays") or []))
    every = msg.get("every_days")
    if not weekdays and not every:
        connection.send_error(msg["id"], "invalid", "weekdays or every_days needed")
        return
    key = product_key(name)
    if key not in stock.recurring and len(stock.recurring) >= MAX_RECURRING:
        connection.send_error(msg["id"], "too_many", "too many recurring purchases")
        return
    previous = stock.recurring.get(key) or {}
    # weekdays: due on the next chosen day (today too); every n days: counted from today
    last = previous.get("last") or (None if weekdays else dt_util.now().date().isoformat())
    entry: dict[str, Any] = {"name": name, **({"last": last} if last else {})}
    if weekdays:
        entry["weekdays"] = weekdays
    else:
        entry["every_days"] = every
    if msg.get("list"):
        entry["list"] = msg["list"]
    stock.recurring[key] = entry
    stock.save_now()
    connection.send_result(msg["id"], {"items": recurring_list(stock)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/recurring_delete", vol.Required("key"): str})
@websocket_api.async_response
async def ws_recurring_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    if stock.recurring.pop(msg["key"], None) is not None:
        stock.save_now()
    connection.send_result(msg["id"], {"items": recurring_list(stock)})


def async_setup_shopping_mode_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("shopping_mode_ws"):
        return
    domain_data["shopping_mode_ws"] = True
    for command in (ws_shopping_mode, ws_shopping_check, ws_recurring, ws_recurring_set, ws_recurring_delete):
        websocket_api.async_register_command(hass, command)
