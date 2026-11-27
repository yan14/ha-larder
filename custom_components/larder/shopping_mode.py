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
from .stock import _known_product, async_add_known, async_find_by_code, async_get_stock, pack_entries, product_key

_LOGGER = logging.getLogger(__name__)

MAX_RECURRING = 50


def shopping_lists(hass: HomeAssistant, stock) -> list[str]:
    """Every list Larder writes to: default lists, lists of products, lists of tracked items."""
    lists = [default_list(hass), default_list(hass, "household"), default_list(hass, "medicine")]
    lists += list(stock.lists.values())
    lists += [info.get("list") for info in stock.tracked.values()]
    lists += [r.get("list") for r in stock.recurring.values()]
    # only real entity IDs (a broken value must not break the shopping mode), each once, in this order
    clean = [str(e).strip() for e in lists if isinstance(e, str) and str(e).strip().startswith("todo.")]
    return [entity for entity in dict.fromkeys(clean) if hass.states.get(entity) is not None]


def known_for(
    hass: HomeAssistant, stock, summary: str, tracked: dict[str, Any] | None = None, entries: list[dict[str, Any]] | None = None
) -> tuple[dict[str, Any] | None, int]:
    """What a list item is in Larder (content, kind, product data, usual place) and how many packs; or None."""
    if tracked is None:
        tracked = stock.tracked.get(summary.strip().casefold()) or {}
    content = tracked.get("content") or summary.split(" (", 1)[0].strip()
    key = product_key(content)
    packs = int(tracked.get("count") or 1)
    found = [p for p in (pack_entries(hass) if entries is None else entries) if product_key(p["content"]) == key]
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
    """Open items of a to-do list, through the action todo.get_items (the public way, 5.3.4)."""
    try:
        response = await hass.services.async_call(
            "todo", "get_items", {"entity_id": entity_id, "status": "needs_action"}, blocking=True, return_response=True
        )
    except Exception as err:  # noqa: BLE001 - any list (Google Tasks, Bring!, Todoist …) may fail in its own way
        raise HomeAssistantError(f"{entity_id} cannot be read: {err}") from err
    return ((response or {}).get(entity_id) or {}).get("items") or []


async def async_shopping_view(hass: HomeAssistant, store: str | None = None) -> dict[str, Any]:
    """Open items of the shopping lists by store section.

    5.9 (#140): with `store` ("I am at Rewe") every item says whether it is bought there (`here`: True, False, or None
    when no store is known for it), and the store's own order of sections applies if it has one.
    """
    from .stock import store_key  # noqa: PLC0415

    stock = await async_get_stock(hass)
    order = section_order(hass)
    skey = store_key(store)
    if skey and (own := (stock.stores.get(skey) or {}).get("order")):
        order = [*own, *(s for s in order if s not in own)]
    items: list[dict[str, Any]] = []
    # 5.3.2: which lists were read and how (the page says why it is empty instead of showing nothing)
    lists: list[dict[str, Any]] = []
    packs = pack_entries(hass)  # once for all items (5.3.3: much faster with many entries)
    for entity_id in shopping_lists(hass, stock):
        state = hass.states.get(entity_id)
        list_name = state.attributes.get("friendly_name", entity_id) if state else entity_id
        info: dict[str, Any] = {"entity_id": entity_id, "name": list_name, "open": 0}
        lists.append(info)
        try:
            open_items = await _open_items(hass, entity_id)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Einkaufsliste %s nicht lesbar: %s", entity_id, err)
            info["error"] = str(err) or type(err).__name__
            continue
        for item in open_items:
            summary = str(item.get("summary") or "").strip()
            if not summary or not item.get("uid"):
                continue
            info["open"] += 1
            try:
                known, _packs = known_for(hass, stock, summary, entries=packs)
                section = section_of(hass, known["content"] if known else summary, known["kind"] if known else None)
            except Exception:  # noqa: BLE001 - one odd item must not hide the whole list
                _LOGGER.debug("Eintrag %s nicht zuordenbar", summary, exc_info=True)
                known, section = None, "other"
            content = known["content"] if known else _base_name(summary)
            stores = [r["store"] for r in stock.prices_by_store(content)]
            entry = {
                "list": entity_id,
                "list_name": list_name,
                "uid": item["uid"],
                "summary": summary,
                "section": section,
                "known": bool(known),
                "stores": stores,  # where it was bought, cheapest first
            }
            if skey:
                entry["here"] = (skey in (stock.store_prices.get(product_key(content)) or {})) if stores else None
            items.append(entry)
    rank = {s: n for n, s in enumerate(order)}
    items.sort(key=lambda i: rank.get(i["section"], len(order)))
    chosen = default_list(hass)
    from .stock import stores_overview  # noqa: PLC0415

    return {
        "order": order,
        "items": items,
        "lists": lists,
        "store": stock.store_name(skey) if skey else None,
        "stores": stores_overview(stock),
        "configured": bool(chosen),
        # chosen in the settings but not there (renamed, integration not loaded)
        "missing": chosen if chosen and hass.states.get(str(chosen)) is None else None,
    }


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


async def async_bought_add(hass: HomeAssistant, item_id: str) -> dict[str, Any]:
    """"Bought – into stock?" (5.0, #120): a known product goes straight to its usual place, like the shopping mode.

    Unknown ones are reported (with the kind Larder knew), the dashboard opens the dialog for them.
    """
    from .const import KIND_HOUSEHOLD, KIND_MEDICINE  # noqa: PLC0415

    stock = await async_get_stock(hass)
    item = next((b for b in stock.bought if b.get("id") == item_id), None)
    if item is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    summary = str(item.get("summary") or item.get("content") or "")
    known, packs = known_for(hass, stock, summary, item)
    in_stock = known is not None and any(product_key(p["content"]) == product_key(known["content"]) for p in pack_entries(hass))
    # no usual place known (not in stock, no place remembered): the dialog asks for it
    if known is None or not (in_stock or known.get("area_id")):
        kind = item.get("kind")
        return {
            "status": "unknown",
            "name": item.get("content") or _base_name(summary),
            "kind": kind if kind in (KIND_HOUSEHOLD, KIND_MEDICINE) else "pack",
            "count": packs,
            "product": item.get("product") or {},
            "area_id": item.get("area_id"),
            "compartment": item.get("compartment") or "",
        }
    result = await async_add_known(hass, known, packs)
    stock.dismiss(item_id)
    return result


async def async_shopping_undo(
    hass: HomeAssistant, entity_id: str, uid: str, device_id: str | None, added: int
) -> dict[str, Any]:
    """6.7 (#200): undo a tick – the item is open on the list again and the packs put into stock go away."""
    from .devices import entry_of  # noqa: PLC0415
    from .disposable import async_dispose  # noqa: PLC0415 - avoids an import cycle

    await hass.services.async_call(
        "todo", "update_item", {"entity_id": entity_id, "item": uid, "status": "needs_action"}, blocking=True
    )
    if not device_id:
        return {"removed": 0}
    pack = next((p for p in pack_entries(hass) if p["device_id"] == device_id), None)
    if pack is None:
        return {"removed": 0}
    removed = max(1, min(int(added or 1), pack["count"]))
    entry = entry_of(hass, pack["cc"])
    if pack["count"] - removed <= 0:
        # a new entry only for this purchase: removed without counting as used
        await async_dispose(hass, entry.entry_id, pack["content"], remember=False)
    else:
        await entry.runtime_data.resettable["portions"].async_set_native_value(float(pack["count"] - removed))
    stock = await async_get_stock(hass)
    stock.unlog_put_away(device_id, removed)
    return {"removed": removed}


def _base_name(summary: str) -> str:
    return summary.split(" (", 1)[0].strip()


async def async_shopping_scan(hass: HomeAssistant, code: str) -> dict[str, Any]:
    """Barcode scanned in the store (4.11): tick off the matching list item and put it into stock.

    Matching by the product's own name (barcode in stock, remembered barcode → name, Open Food Facts name).
    No list item: a known product goes into stock anyway; an unknown one is reported with its name.
    """
    stock = await async_get_stock(hass)
    found = await async_find_by_code(hass, code)
    known = found.get("known")
    names = {product_key(n) for n in (found.get("name"), known and known.get("content")) if n}
    for entity_id in shopping_lists(hass, stock):
        try:
            open_items = await _open_items(hass, entity_id)
        except HomeAssistantError:
            continue
        for item in open_items:
            summary = str(item.get("summary") or "").strip()
            tracked = stock.tracked.get(summary.casefold()) or {}
            keys = {product_key(_base_name(summary)), product_key(tracked.get("content"))}
            if item.get("uid") and names & keys:
                result = await async_shopping_check(hass, entity_id, item["uid"], summary)
                return {**result, "matched": True, "uid": item["uid"], "summary": summary}
    if known:
        return {**(await async_add_known(hass, known)), "matched": False}
    return {"status": "unknown", "name": found.get("name"), "code": found.get("code"), "product": found.get("product"),
            "product_type": found.get("product_type")}


async def async_shopping_details(
    hass: HomeAssistant, device_id: str, added: int, price: float | None, best_before: date | None, store: str | None = None
) -> dict[str, Any]:
    """Price and best-before date of what was just put into stock (4.11).

    The price goes onto the entry and into the price history. With a date, the new packs get an entry of their
    own if they were added to an entry with more packs (other packs keep their date).
    """
    from homeassistant.helpers import device_registry as dr  # noqa: PLC0415

    from .const import CONF_CC, larder_id  # noqa: PLC0415
    from .disposable import async_create_items  # noqa: PLC0415

    device = dr.async_get(hass).async_get(device_id)
    cc = larder_id(device) if device else None
    entry = next((e for e in hass.config_entries.async_loaded_entries(DOMAIN) if cc and e.data.get(CONF_CC) == cc), None)
    if entry is None:
        raise HomeAssistantError("entry not found")
    ents = entry.runtime_data.resettable
    if price:
        # 5.9 (#139/#141): the store goes with the price
        await ents["content"].async_set_product(
            {"price": round(price, 2), "price_source": "own", "store": " ".join(str(store or "").split())[:60] or None},
            replace=False,
        )
    if best_before is None:
        return {"device_id": device_id}
    stock = await async_get_stock(hass)
    # 6.1 (#168): learn how long exactly this product keeps when bought (only food with a date)
    put_day = stock.put_away_day(device_id) or dt_util.now().date()
    if "best_before" in ents:
        stock.learn_buy_days(ents["content"].native_value or "", (best_before - put_day).days)
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    if source is None or source["count"] <= added:
        await ents["best_before"].async_set_value(best_before)
        return {"device_id": device_id}
    # split: the new packs with their date as an entry of their own
    await ents["portions"].async_set_native_value(float(source["count"] - added))
    item = {
        "content": source["content"], "quantity": added, "unit": "pieces", "best_before": best_before,
        "product": {k: v for k, v in ents["content"].product.items() if k != "opened"},
    }
    created = await async_create_items(hass, source["kind"], [item], source["area_id"], source["compartment"])
    stock.relink_put_away(device_id, created[0]["device_id"], added)
    return {"device_id": created[0]["device_id"]}


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


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/shopping_mode", vol.Optional("store"): vol.Any(None, vol.All(str, vol.Length(max=60)))}
)
@websocket_api.async_response
async def ws_shopping_mode(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_shopping_view(hass, msg.get("store"))
    except Exception as err:  # noqa: BLE001 - say why instead of an empty page
        _LOGGER.exception("Einkaufsmodus konnte nicht geladen werden")
        connection.send_error(msg["id"], "shopping_failed", str(err) or type(err).__name__)
        return
    connection.send_result(msg["id"], result)


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


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/shopping_add", vol.Required("item"): vol.All(str, vol.Length(min=1, max=255))}
)
@websocket_api.async_response
async def ws_shopping_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """6.7 (#200): put something onto the list right on the Shopping page (its own list, else the default)."""
    await async_get_stock(hass)
    item = " ".join(msg["item"].split())
    entity_id = shopping_list_for(hass, item)
    if not entity_id:
        connection.send_error(msg["id"], "no_list", "No shopping list set up")
        return
    created = await async_add_to_shopping_list(hass, entity_id, item)
    connection.send_result(msg["id"], {"list": entity_id, "created": created})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/shopping_list_set", vol.Required("entity_id"): vol.All(str, vol.Match(r"^todo\."))}
)
@websocket_api.async_response
async def ws_shopping_list_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """6.8 (#213): choose the shopping list right in the first steps (same setting as in Configure)."""
    from homeassistant.helpers.dispatcher import async_dispatcher_send  # noqa: PLC0415

    from .const import CONF_TODO_ENTITY, SIGNAL_SETTINGS_CHANGED  # noqa: PLC0415
    from .estimate import async_get_estimator  # noqa: PLC0415

    if hass.states.get(msg["entity_id"]) is None:
        connection.send_error(msg["id"], "not_found", "Unknown to-do list")
        return
    await (await async_get_estimator(hass)).async_update_settings({CONF_TODO_ENTITY: msg["entity_id"]})
    async_dispatcher_send(hass, SIGNAL_SETTINGS_CHANGED)
    connection.send_result(msg["id"], {"entity_id": msg["entity_id"]})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/shopping_undo",
        vol.Required("list"): vol.All(str, vol.Match(r"^todo\.")),
        vol.Required("uid"): str,
        vol.Optional("device_id"): vol.Any(None, str),
        vol.Optional("added", default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=999)),
    }
)
@websocket_api.async_response
async def ws_shopping_undo(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_shopping_undo(hass, msg["list"], msg["uid"], msg.get("device_id"), msg["added"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "undo_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/shopping_scan", vol.Required("code"): vol.All(str, vol.Length(min=1, max=64))}
)
@websocket_api.async_response
async def ws_shopping_scan(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_shopping_scan(hass, msg["code"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "scan_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/shopping_details",
        vol.Required("device_id"): str,
        vol.Optional("added", default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=999)),
        vol.Optional("price"): vol.All(vol.Coerce(float), vol.Range(min=0, max=10000)),
        vol.Optional("best_before"): vol.Date(),
        vol.Optional("store"): vol.Any(None, vol.All(str, vol.Length(max=60))),
    }
)
@websocket_api.async_response
async def ws_shopping_details(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    best = msg.get("best_before")
    if isinstance(best, str):
        best = date.fromisoformat(best)
    try:
        result = await async_shopping_details(hass, msg["device_id"], msg["added"], msg.get("price"), best, msg.get("store"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "details_failed", str(err))
        return
    connection.send_result(msg["id"], result)


async def async_receipt_add(
    hass: HomeAssistant, items: list[dict[str, Any]], area_id: str | None, compartment: str | None, store: str | None = None
) -> dict[str, Any]:
    """Rows read from a receipt (4.11.1): known products go to their usual place and join a pack there (like the
    shopping mode), with price and date; only unknown ones are created at the place chosen in the dialog."""
    from .const import KIND_HOUSEHOLD, KIND_PACK  # noqa: PLC0415
    from .disposable import async_create_items  # noqa: PLC0415

    packs = pack_entries(hass)
    added: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    unknown_household: list[dict[str, Any]] = []
    for item in items:
        key = product_key(item["content"])
        found = [p for p in packs if product_key(p["content"]) == key and p["kind"] in (KIND_PACK, KIND_HOUSEHOLD)]
        if not found:
            # 5.0 (#121): household goods from the receipt become household items, the rest food packs
            new = {k: v for k, v in item.items() if k != "household"}
            if store and (new.get("product") or {}).get("price"):
                new["product"] = {**new["product"], "store": store}  # 5.9 (#141): the price belongs to this store
            (unknown_household if item.get("household") else unknown).append(new)
            continue
        count = max(1, int(item.get("quantity") or 1))
        result = await async_add_known(hass, _known_product(found, ""), count)
        price = (item.get("product") or {}).get("price")
        best = item.get("best_before")
        if isinstance(best, str):
            best = date.fromisoformat(best)
        if price or best:
            details = await async_shopping_details(hass, result["device_id"], result.get("added") or count, price, best, store)
            result["device_id"] = details["device_id"]
        added.append(result)
        packs = pack_entries(hass)
    created = await async_create_items(hass, KIND_PACK, unknown, area_id, compartment) if unknown else []
    if unknown_household:
        created += await async_create_items(hass, KIND_HOUSEHOLD, unknown_household, area_id, compartment)
    stock = await async_get_stock(hass)
    for made, item in zip(created, [*unknown, *unknown_household], strict=False):
        stock.log_put_away(made["device_id"], item["content"], KIND_HOUSEHOLD if item in unknown_household else KIND_PACK, int(item.get("quantity") or 1))
    ticked = await async_tick_off(hass, [item["content"] for item in items])
    return {"added": added, "created": created, "ticked": ticked}


async def async_tick_off(hass: HomeAssistant, contents: list[str]) -> list[str]:
    """Complete the open list items of these products (4.12: receipt), like scanning in the shopping mode.

    One item per product; "bought – into stock?" does not offer them again. Returns the ticked summaries.
    """
    stock = await async_get_stock(hass)
    wanted = {product_key(c) for c in contents if c}
    ticked: list[str] = []
    for entity_id in shopping_lists(hass, stock):
        if not wanted:
            break
        try:
            open_items = await _open_items(hass, entity_id)
        except HomeAssistantError:
            continue
        for item in open_items:
            summary = str(item.get("summary") or "").strip()
            tracked = stock.tracked.get(summary.casefold()) or {}
            keys = {product_key(_base_name(summary)), product_key(tracked.get("content"))} & wanted
            if not item.get("uid") or not keys:
                continue
            stock.tracked.pop(summary.casefold(), None)
            try:
                await hass.services.async_call(
                    "todo", "update_item", {"entity_id": entity_id, "item": item["uid"], "status": "completed"}, blocking=True
                )
            except HomeAssistantError:
                continue
            wanted -= keys
            ticked.append(summary)
    if ticked:
        stock.save_now()
    return ticked


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/receipt_add",
        vol.Required("items"): vol.All([dict], vol.Length(min=1, max=30)),
        vol.Optional("area_id"): vol.Any(str, None),
        vol.Optional("compartment"): vol.All(str, vol.Length(max=60)),
        vol.Optional("store"): vol.Any(None, vol.All(str, vol.Length(max=60))),
    }
)
@websocket_api.async_response
async def ws_receipt_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .disposable import _ITEM  # noqa: PLC0415

    try:
        # 5.0 (#121): "household" (from the receipt) decides the kind of an unknown product
        items = [
            {**_ITEM({k: v for k, v in item.items() if k != "household"}), **({"household": True} if item.get("household") is True else {})}
            for item in msg["items"]
        ]
        result = await async_receipt_add(hass, items, msg.get("area_id"), msg.get("compartment"), msg.get("store"))
    except (vol.Invalid, HomeAssistantError) as err:
        connection.send_error(msg["id"], "receipt_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/shopping_lists"})
@websocket_api.async_response
async def ws_shopping_lists(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The shopping lists Larder uses (5.0: badge with the open items on "Shopping" in the bar)."""
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {"lists": shopping_lists(hass, stock)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/bought_add", vol.Required("item_id"): str})
@websocket_api.async_response
async def ws_bought_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        result = await async_bought_add(hass, msg["item_id"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "bought_add_failed", str(err))
        return
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {**result, "items": list(reversed(stock.bought))})


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
    for command in (ws_shopping_mode, ws_shopping_add, ws_shopping_list_set, ws_shopping_check, ws_shopping_undo, ws_shopping_scan, ws_shopping_details, ws_receipt_add, ws_bought_add, ws_shopping_lists, ws_recurring, ws_recurring_set, ws_recurring_delete):
        websocket_api.async_register_command(hass, command)
