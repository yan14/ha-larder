"""Stock: packs grouped by product, minimum stock and splitting/moving.

* **Product** = content of a pack (case and spaces do not matter). The same goods can be at
  several places (one pack entry per place); the stock is the sum of all entries.
* **Minimum stock** per product (stays remembered even when the last pack is gone). If the stock falls
  below it, the product (with brand and package size) goes on the shopping list of the settings.
* **Splitting/moving**: bring a part of the packs (or all) to another place; if the same goods
  with the same date are already there, the entries are merged.
"""

from __future__ import annotations

from datetime import date, timedelta
import logging
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_STATE_CHANGED, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_CC,
    CONF_SECTION_ORDER,
    DATA_STOCK,
    DOMAIN,
    KIND_BAG,
    KIND_HOUSEHOLD,
    KIND_PACK,
    NON_FOOD_KINDS,
    PACK_KINDS,
    SIGNAL_STOCK_CHANGED,
    larder_id,
)
from .consumption import async_open_prices, forecast, price_of, suggested_minimum
from .devices import device_of, entry_of
from .entity import kind_of
from .estimate import async_get_estimator, storage_context
from .sections import SECTIONS, section_of, section_order
from .shopping import any_list, async_add_to_shopping_list, shopping_list_for
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

DATA_WS = "stock_ws_registered"
STORAGE_KEY = f"{DOMAIN}.stock"
STORAGE_VERSION = 1
MAX_MIN = 999
DATA_QUIET = "stock_quiet"  # packs whose count is being rearranged right now (does not count as consumption)
TRACK_DAYS = 60  # Larder waits this long for an item on the shopping list to be ticked off
MAX_BOUGHT = 30
MAX_TAKES = 5000
MAX_TAKE_AGE = 400  # days (the longest forecast window is a year)
AGAIN_DAYS = 90  # "eaten often": within the last this many days
AGAIN_MIN = 3  # mindestens so oft
AGAIN_SNOOZE = 30  # "✕" hides a suggestion for this many days
AGAIN_MAX = 3
REORDER_SNOOZE = 7  # "✕" at "Running low" hides a product for this many days
EVENT_RUNNING_LOW = f"{DOMAIN}_running_low"
EVENT_REPLACE_DUE = f"{DOMAIN}_replace_due"
PRICE_HISTORY = 12
REPLACE_AHEAD = 7  # "replace soon": due within this many days


RECENT_MAX = 12
EVENT_AUTO_REORDER = f"{DOMAIN}_auto_reorder"
RECENT_PRODUCT_KEYS = ("brand", "package", "ean", "price", "pack_size", "piece", "kcal_100g", "kcal_portion", "nutri_score", "allergens")


def product_key(content: str | None) -> str:
    return " ".join((content or "").split()).casefold()


class Stock:
    """Minimum stocks per product (key → display name and minimum)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.minimums: dict[str, dict[str, Any]] = {}
        # put on the shopping list by Larder (item → content, product data, place) and already ticked off
        self.tracked: dict[str, dict[str, Any]] = {}
        self.bought: list[dict[str, Any]] = []
        self.snoozed: dict[str, str] = {}  # product → until when "Again …?" is not suggested
        self.takes: list[dict[str, Any]] = []  # takes of packs: {"key", "day", "n"} (for the consumption)
        self.prices: dict[str, dict[str, Any]] = {}  # product → last known price per pack
        self.reorder_snoozed: dict[str, str] = {}  # product → until when "Running low" does not show it
        self.reorder_notified: list[str] = []  # products for which "Running low" was already reported
        self.recalls_read: list[str] = []  # recall warnings that were read
        self.recalls_sent: list[str] = []  # recall warnings already reported (event only once)
        self.ean_names: dict[str, str] = {}  # barcode → own name of the product
        self.lists: dict[str, str] = {}  # product → its own shopping list (to-do entity), else the default
        # product → replacement interval (4.6): {"name", "weeks", "last": ISO date, "notified": due date reported}
        self.intervals: dict[str, dict[str, Any]] = {}
        self.sections: dict[str, str] = {}  # product → store section chosen on the card (4.7), else suggested
        # product → recurring purchase (4.10): {"name", "weekdays": [0-6] | "every_days": n, "list", "last": ISO date}
        self.recurring: dict[str, dict[str, Any]] = {}
        # product → own prices over time (4.11): [{"day", "price"}], oldest first, at most PRICE_HISTORY
        self.price_history: dict[str, list[dict[str, Any]]] = {}
        # recently added products (5.1, #125), newest first: {"content", "kind", "product", "area_id", "compartment"}
        self.recent: list[dict[str, Any]] = []
        # buy again by consumption (5.2, #128): product → {"name", "last": ISO date put on the list}
        self.auto_reorder: dict[str, dict[str, Any]] = {}
        self.opened_after: dict[str, dict[str, Any]] = {}  # 5.7: product → days after opening (from the pack)
        self._unsub = None
        self._unsub_daily = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.minimums = {k: v for k, v in (data.get("minimums") or {}).items() if isinstance(v, dict)}
        self.tracked = {k: v for k, v in (data.get("tracked") or {}).items() if isinstance(v, dict)}
        self.bought = [b for b in data.get("bought") or [] if isinstance(b, dict)]
        self.snoozed = {str(k): str(v) for k, v in (data.get("snoozed") or {}).items()}
        self.takes = [t for t in data.get("takes") or [] if isinstance(t, dict)]
        self.prices = {k: v for k, v in (data.get("prices") or {}).items() if isinstance(v, dict)}
        self.reorder_snoozed = {str(k): str(v) for k, v in (data.get("reorder_snoozed") or {}).items()}
        self.reorder_notified = [str(k) for k in data.get("reorder_notified") or []]
        self.recalls_read = [str(k) for k in data.get("recalls_read") or []]
        self.recalls_sent = [str(k) for k in data.get("recalls_sent") or []]
        self.ean_names = {str(k): str(v) for k, v in (data.get("ean_names") or {}).items()}
        self.lists = {str(k): str(v) for k, v in (data.get("lists") or {}).items() if str(v).startswith("todo.")}
        self.intervals = {k: v for k, v in (data.get("intervals") or {}).items() if isinstance(v, dict) and v.get("weeks")}
        self.sections = {str(k): str(v) for k, v in (data.get("sections") or {}).items() if v in SECTIONS}
        self.recurring = {k: v for k, v in (data.get("recurring") or {}).items() if isinstance(v, dict) and v.get("name")}
        self.price_history = {k: [p for p in v if isinstance(p, dict)] for k, v in (data.get("price_history") or {}).items() if isinstance(v, list)}
        self.recent = [r for r in data.get("recent") or [] if isinstance(r, dict) and r.get("content")]
        self.auto_reorder = {str(k): v for k, v in (data.get("auto_reorder") or {}).items() if isinstance(v, dict)}
        self.opened_after = {str(k): v for k, v in (data.get("opened_after") or {}).items() if isinstance(v, dict) and v.get("days")}

    def _data(self) -> dict[str, Any]:
        return {
            "minimums": self.minimums,
            "tracked": self.tracked,
            "bought": self.bought,
            "snoozed": self.snoozed,
            "takes": self.takes,
            "prices": self.prices,
            "reorder_snoozed": self.reorder_snoozed,
            "reorder_notified": self.reorder_notified,
            "recalls_read": self.recalls_read,
            "recalls_sent": self.recalls_sent,
            "ean_names": self.ean_names,
            "lists": self.lists,
            "intervals": self.intervals,
            "sections": self.sections,
            "recurring": self.recurring,
            "price_history": self.price_history,
            "recent": self.recent,
            "auto_reorder": self.auto_reorder,
            "opened_after": self.opened_after,
        }

    def set_opened_after(self, content: str, days: int | None, source: str = "manual") -> None:
        """5.7 (#154): "use within … after opening" of exactly this product (never shared with similar ones)."""
        key = product_key(content)
        if days:
            self.opened_after[key] = {"name": content.strip(), "days": int(days), "source": source}
        else:
            self.opened_after.pop(key, None)
        self._save()

    def set_auto_reorder(self, content: str, enabled: bool) -> None:
        key = product_key(content)
        if enabled:
            self.auto_reorder[key] = {"name": content.strip(), **{k: v for k, v in (self.auto_reorder.get(key) or {}).items() if k == "last"}}
        else:
            self.auto_reorder.pop(key, None)
        self._save()

    def remember_recent(
        self, content: str, kind: str, product: dict[str, Any] | None, area_id: str | None, compartment: str | None
    ) -> None:
        """Remember a product that was just added (＋ dialog, put away, receipt …) for "recently used"."""
        key = product_key(content)
        if not key or kind not in PACK_KINDS:
            return
        keep = {k: v for k, v in (product or {}).items() if k in RECENT_PRODUCT_KEYS and v not in (None, "")}
        entry = {"content": content.strip(), "kind": kind, "product": keep, "area_id": area_id, "compartment": compartment or ""}
        self.recent = [entry] + [r for r in self.recent if product_key(r.get("content")) != key]
        del self.recent[RECENT_MAX:]
        self._save()

    # ----- Consumption and prices -----

    def log_take(self, content: str, n: int = 1) -> None:
        """Record the take of a pack (for "lasts another …" and the suggested minimum stock)."""
        key = product_key(content)
        if not key or n <= 0:
            return
        today = dt_util.now().date()
        take: dict[str, Any] = {"key": key, "day": today.isoformat(), "n": int(n)}
        # household items: remember pack size and price per pack now, for use and spending per month
        if (info := self._household_info(key)) is not None:
            take.update(info)
        self.takes.append(take)
        cutoff = (today - timedelta(days=MAX_TAKE_AGE)).isoformat()
        self.takes = [t for t in self.takes if t.get("day", "") >= cutoff][-MAX_TAKES:]
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)
        self.hass.async_create_task(async_check_running_low(self.hass, content), f"{DOMAIN}_running_low")

    def _household_info(self, key: str) -> dict[str, Any] | None:
        """{"hh": True, "size", "price"?} if the product is a household item, else None."""
        entry = next((p for p in pack_entries(self.hass) if product_key(p["content"]) == key), None)
        known = (self.minimums.get(key) or {}).get("product") or {}
        if (entry["kind"] if entry else known.get("kind")) != KIND_HOUSEHOLD:
            return None
        info: dict[str, Any] = {"hh": True, "size": int((entry or {}).get("pack_size") or known.get("pack_size") or 1)}
        price = (entry or {}).get("price") or (self.prices.get(key) or {}).get("price")
        if price:
            info["price"] = round(float(price), 2)
        return info

    def snooze_reorder(self, content: str) -> None:
        today = dt_util.now().date()
        self.reorder_snoozed[product_key(content)] = (today + timedelta(days=REORDER_SNOOZE)).isoformat()
        self.reorder_snoozed = {k: v for k, v in self.reorder_snoozed.items() if v > today.isoformat()}
        self._save()

    def mark_recall_read(self, recall_id: str) -> None:
        if recall_id not in self.recalls_read:
            self.recalls_read = [*self.recalls_read, recall_id][-500:]
            self._save()
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)

    def remember_ean(self, ean: str, name: str) -> None:
        digits = "".join(ch for ch in ean if ch.isdigit())
        name = " ".join(name.split())
        if len(digits) >= 8 and name and self.ean_names.get(digits) != name:
            self.ean_names[digits] = name
            if len(self.ean_names) > 2000:
                self.ean_names = dict(list(self.ean_names.items())[-2000:])
            self._save()

    def recalls_notified(self) -> list[str]:
        return self.recalls_sent

    def remember_recall_notified(self, recall_id: str) -> None:
        if recall_id not in self.recalls_sent:
            self.recalls_sent = [*self.recalls_sent, recall_id][-500:]
            self._save()

    def usage(self, content: str | None) -> dict[str, Any] | None:
        key = product_key(content)
        return forecast([t for t in self.takes if t.get("key") == key], 0) if key else None

    def remember_price(self, content: str, price: float, source: str = "own") -> None:
        key = product_key(content)
        if not key or not price:
            return
        current = self.prices.get(key)
        if source == "openprices" and current and current.get("source") != "openprices":
            return  # own prices take precedence over estimates
        entry = {"price": round(float(price), 2), "source": source, "day": dt_util.now().date().isoformat()}
        if source != "openprices":
            # price history of own prices: one per day, the last one counts
            history = [p for p in self.price_history.get(key, []) if p.get("day") != entry["day"]]
            if not history or history[-1].get("price") != entry["price"]:
                history.append({"day": entry["day"], "price": entry["price"]})
            self.price_history[key] = history[-PRICE_HISTORY:]
            self._save()
        if current and {k: current.get(k) for k in ("price", "source")} == {k: entry[k] for k in ("price", "source")}:
            return
        self.prices[key] = entry
        self._save()

    def set_list(self, content: str, entity_id: str | None) -> None:
        """Own shopping list for a product (None = back to the default list)."""
        key = product_key(content)
        if not key:
            return
        if entity_id:
            self.lists[key] = entity_id
        else:
            self.lists.pop(key, None)
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)

    def set_section(self, content: str, section: str | None) -> None:
        """Store section of a product (None = suggested again)."""
        key = product_key(content)
        if not key:
            return
        if section in SECTIONS:
            self.sections[key] = section
        else:
            self.sections.pop(key, None)
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)

    # ----- Replacement interval (water filter, vacuum bags …) -----

    def set_interval(self, content: str, weeks: float | None) -> None:
        """Replace this product every `weeks` weeks (None or 0 = no interval). Starts counting today."""
        key = product_key(content)
        if not key:
            return
        if weeks:
            current = self.intervals.get(key) or {}
            self.intervals[key] = {
                "name": " ".join(content.split()),
                "weeks": round(float(weeks), 1),
                "last": current.get("last") or dt_util.now().date().isoformat(),
            }
        else:
            self.intervals.pop(key, None)
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)

    def mark_replaced(self, content: str) -> None:
        key = product_key(content)
        if key in self.intervals:
            self.intervals[key] = {**self.intervals[key], "last": dt_util.now().date().isoformat(), "notified": None}
            self._save()
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)

    def interval_info(self, content: str | None) -> dict[str, Any] | None:
        """{"weeks", "last", "due", "days"} for a product with an interval, else None."""
        info = self.intervals.get(product_key(content))
        if not info:
            return None
        last = date.fromisoformat(info["last"])
        due = last + timedelta(days=round(float(info["weeks"]) * 7))
        return {"weeks": info["weeks"], "last": info["last"], "due": due.isoformat(), "days": (due - dt_util.now().date()).days}

    def replace_due(self, ahead: int = REPLACE_AHEAD) -> list[dict[str, Any]]:
        """Products to replace within `ahead` days (or overdue), earliest first."""
        out = []
        for key, info in self.intervals.items():
            detail = self.interval_info(key)
            if detail and detail["days"] <= ahead:
                out.append({"key": key, "name": info.get("name") or key, **detail})
        return sorted(out, key=lambda i: i["days"])

    @callback
    def _check_replace_due(self, _now: Any = None) -> None:
        """Once a day: products due for replacement fire `larder_replace_due` (once per due date).

        Recurring purchases (4.10) are put onto their lists at the same time.
        """
        from .shopping_mode import async_check_recurring  # noqa: PLC0415 - avoids an import cycle

        self.hass.async_create_task(async_check_recurring(self.hass), f"{DOMAIN}_recurring")
        if self.auto_reorder:
            self.hass.async_create_task(async_check_auto_reorder(self.hass), f"{DOMAIN}_auto_reorder")
        de = (self.hass.config.language or "en").lower().startswith("de")
        changed = False
        for item in self.replace_due(0):
            info = self.intervals[item["key"]]
            if info.get("notified") == item["due"]:
                continue
            info["notified"] = item["due"]
            changed = True
            self.hass.bus.async_fire(
                EVENT_REPLACE_DUE,
                {
                    "name": item["name"],
                    "due": item["due"],
                    "weeks": item["weeks"],
                    "title": "🔁 Wechseln" if de else "🔁 Replace",
                    "message": (f"{item['name']} sollte gewechselt werden." if de else f"Time to replace {item['name']}."),
                },
            )
        if changed:
            self._save()

    def snooze(self, content: str) -> None:
        self.snoozed[product_key(content)] = (dt_util.now().date() + timedelta(days=AGAIN_SNOOZE)).isoformat()
        today = dt_util.now().date().isoformat()
        self.snoozed = {k: v for k, v in self.snoozed.items() if v > today}
        self._save()

    def _save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    def save_now(self) -> None:
        """Save soon (recurring purchases, shopping mode)."""
        self._save()

    # ----- Shopping list → stock -----

    def track(self, summary: str, info: dict[str, Any], todo: str | None = None) -> None:
        """Remember an item Larder put on a shopping list (for "bought → into the stock")."""
        now = dt_util.now()
        todo = todo or info.get("list") or shopping_list_for(self.hass, info.get("content") or summary, info.get("kind"))
        self.tracked[summary.casefold()] = {**info, "list": todo, "summary": summary, "at": now.isoformat(timespec="seconds")}
        cutoff = (now - timedelta(days=TRACK_DAYS)).isoformat()
        self.tracked = {k: v for k, v in self.tracked.items() if v.get("at", "") >= cutoff}
        self._save()

    @callback
    def async_start(self) -> None:
        """Watch the shopping list: ticked-off items of Larder are offered as "bought"."""
        if self._unsub is not None:
            return

        @callback
        def changed(event: Event) -> None:
            # every list Larder wrote to (the item remembers it), not only the default list
            if self.tracked and event.data.get("entity_id") in self._watched_lists():
                self.hass.async_create_task(self.async_poll(), f"{DOMAIN}_bought")

        self._unsub = self.hass.bus.async_listen(EVENT_STATE_CHANGED, changed)
        self._unsub_daily = async_track_time_change(self.hass, self._check_replace_due, hour=8, minute=0, second=0)

    @callback
    def async_stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        if self._unsub_daily is not None:
            self._unsub_daily()
            self._unsub_daily = None

    def _list_of(self, info: dict[str, Any]) -> str | None:
        # items tracked before 4.1 have no list: they were on the (food) default list
        return info.get("list") or shopping_list_for(self.hass, None)

    def _watched_lists(self) -> set[str]:
        return {todo for info in self.tracked.values() if (todo := self._list_of(info))}

    async def async_poll(self) -> list[dict[str, Any]]:
        """Move ticked-off items that Larder set to "bought" (on every list it wrote to)."""
        await async_get_estimator(self.hass)
        if not self.tracked:
            return []
        done: set[tuple[str, str]] = set()
        for todo in self._watched_lists():
            try:
                response = await self.hass.services.async_call(
                    "todo", "get_items", {"entity_id": todo, "status": "completed"}, blocking=True, return_response=True
                )
            except HomeAssistantError:
                _LOGGER.debug("Einkaufsliste %s nicht lesbar", todo, exc_info=True)
                continue
            items = ((response or {}).get(todo) or {}).get("items") or []
            done |= {(todo, str(i.get("summary", "")).strip().casefold()) for i in items}
        moved: list[dict[str, Any]] = []
        for key in [k for k, info in self.tracked.items() if (self._list_of(info), k) in done]:
            info = self.tracked.pop(key)
            item = {"id": uuid.uuid4().hex[:10], **info, "bought": dt_util.now().isoformat(timespec="seconds")}
            self.bought = [b for b in self.bought if b.get("summary", "").casefold() != key] + [item]
            moved.append(item)
        if moved:
            self.bought = self.bought[-MAX_BOUGHT:]
            self._save()
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)
        return moved

    def dismiss(self, item_id: str) -> bool:
        before = len(self.bought)
        self.bought = [b for b in self.bought if b.get("id") != item_id]
        if len(self.bought) != before:
            self._save()
            return True
        return False

    def dismiss_product(self, content: str) -> int:
        """Bought items of this product are taken care of (put away by scanning). Returns how many."""
        key = product_key(content)
        before = len(self.bought)
        self.bought = [b for b in self.bought if product_key(b.get("content")) != key]
        if (gone := before - len(self.bought)):
            self._save()
            async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)
        return gone

    def minimum(self, content: str | None) -> int:
        return int((self.minimums.get(product_key(content)) or {}).get("min") or 0)

    async def async_set_minimum(self, content: str, value: int) -> None:
        key = product_key(content)
        if not key:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_content")
        if value > 0:
            known = next((p for p in pack_entries(self.hass) if product_key(p["content"]) == key), None)
            product = {k: known[k] for k in ("brand", "package", "kind", "pack_size", "piece") if known and known.get(k)}
            self.minimums[key] = {"name": " ".join(content.split()), "min": min(int(value), MAX_MIN), "product": product}
        else:
            self.minimums.pop(key, None)
        await self._store.async_save(self._data())
        async_dispatcher_send(self.hass, SIGNAL_STOCK_CHANGED)
        await async_check_stock(self.hass, content)


async def async_get_stock(hass: HomeAssistant) -> Stock:
    async def create() -> Stock:
        stock = Stock(hass)
        await stock.async_load()
        return stock

    return await async_singleton(hass, DATA_STOCK, create)


def _state(hass: HomeAssistant, registry: er.EntityRegistry, platform: str, cc: str, key: str):
    entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{cc}_{key}")
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
        return None
    return state


def pack_entries(hass: HomeAssistant, exclude: set[str] | None = None) -> list[dict[str, Any]]:
    """All packs with content, count and place (leave out emptied, just removed ones via `exclude`)."""
    registry = er.async_get(hass)
    out: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc or kind_of(entry) not in PACK_KINDS or (exclude and cc in exclude):
            continue
        content_state = _state(hass, registry, "text", cc, "content")
        content = (content_state.state if content_state else "").strip()
        if not content:
            continue
        count_state = _state(hass, registry, "number", cc, "portions")
        try:
            count = int(float(count_state.state)) if count_state else 0
        except ValueError:
            count = 0
        unit_state = _state(hass, registry, "select", cc, "unit")
        # quantity in grams/millilitres or not given: counts as one pack
        if count <= 0 or (unit_state and unit_state.state not in ("pieces", "portions")):
            count = 1
        best_state = _state(hass, registry, "date", cc, "best_before")
        comp_state = _state(hass, registry, "text", cc, "compartment")
        device = device_of(hass, cc, entry)
        attrs = dict(content_state.attributes) if content_state else {}
        out.append(
            {
                "cc": cc,
                "device_id": device.id if device else None,
                "content": content,
                "count": count,
                "area_id": device.area_id if device else None,
                "area": storage_context(hass, cc).area_name,
                "compartment": (comp_state.state if comp_state else "").strip(),
                "best_before": best_state.state if best_state else None,
                "brand": attrs.get("brand"),
                "package": attrs.get("package"),
                "ean": attrs.get("ean"),
                "opened": attrs.get("opened"),
                "price": attrs.get("price"),
                "price_source": attrs.get("price_source"),
                "kind": kind_of(entry),
                "pack_size": max(1, int(attrs.get("pack_size") or 1)),
                "piece": attrs.get("piece"),
            }
        )
    return out


def stock_overview(hass: HomeAssistant, minimums: dict[str, dict[str, Any]], stock: Stock | None = None) -> list[dict[str, Any]]:
    """Products with stock (sum of all places), minimum stock and places, alphabetically.

    With `stock` also consumption ("lasts another …"), suggested minimum stock, price and value.
    """
    products: dict[str, dict[str, Any]] = {}
    value_parts: dict[str, list[tuple[float, dict[str, Any] | None]]] = {}
    for item in pack_entries(hass):
        key = product_key(item["content"])
        product = products.setdefault(
            key, {"key": key, "name": item["content"], "count": 0, "places": [], "brand": None, "package": None}
        )
        product["count"] += item["count"]
        if item["kind"] in NON_FOOD_KINDS:
            product["kind"] = item["kind"]
        if item["pack_size"] > 1:
            product["pack_size"] = item["pack_size"]
        product["piece"] = product.get("piece") or item["piece"]
        # the price is per pack: household items count pieces, so the value uses packs
        value_parts.setdefault(key, []).append(
            (
                item["count"] / item["pack_size"],
                {"price": item["price"], "price_source": item.get("price_source")} if item["price"] else None,
            )
        )
        product["ean"] = product.get("ean") or item.get("ean")
        product["brand"] = product["brand"] or item["brand"]
        product["package"] = product["package"] or item["package"]
        product["places"].append(
            {
                "device_id": item["device_id"],
                "area_id": item["area_id"],
                "area": item["area"],
                "compartment": item["compartment"],
                "count": item["count"],
                "best_before": item["best_before"],
                "opened": item["opened"],
            }
        )
    for key, info in minimums.items():
        products.setdefault(key, {"key": key, "name": info.get("name") or key, "count": 0, "places": [], "brand": None, "package": None})
    for key, info in (stock.auto_reorder if stock is not None else {}).items():
        products.setdefault(key, {"key": key, "name": info.get("name") or key, "count": 0, "places": [], "brand": None, "package": None})
    rows = []
    # 5.4: the takes grouped by product once (instead of going through all takes for every product)
    takes_by_key: dict[str, list[dict[str, Any]]] = {}
    lead = int(getattr(hass.data.get(DOMAIN, {}).get("estimator"), "stock_lead_days", 7) or 7)
    if stock is not None:
        for take in stock.takes:
            takes_by_key.setdefault(take.get("key"), []).append(take)
    for product in products.values():
        known = (minimums.get(product["key"]) or {}).get("product") or {}
        product.setdefault("kind", known.get("kind") or KIND_PACK)
        product.setdefault("pack_size", max(1, int(known.get("pack_size") or 1)))
        product["piece"] = product.get("piece") or known.get("piece")
        product["packs"] = round(product["count"] / product["pack_size"], 1)
        product["min"] = int((minimums.get(product["key"]) or {}).get("min") or 0)
        if stock is not None:
            product["auto"] = product["key"] in stock.auto_reorder
            if (after := stock.opened_after.get(product["key"])) is not None:
                product["opened_after"] = int(after["days"])
        if stock is not None and stock.lists.get(product["key"]):
            product["list"] = stock.lists[product["key"]]  # own shopping list of the product
        product["low"] = product["min"] > 0 and product["count"] < product["min"]
        # oldest first: earliest date on top, without a date last
        product["places"].sort(key=lambda p: (not p["opened"], p["best_before"] or "9999", str(p["area"] or "￿").casefold(), p["compartment"].casefold()))
        product["opened"] = sum(p["count"] for p in product["places"] if p["opened"])
        product["earliest"] = next((p["best_before"] for p in product["places"] if p["best_before"]), None)
        if stock is not None and len(history := stock.price_history.get(product["key"]) or []) > 1:
            product["price_history"] = history[-5:]  # 4.11: e.g. 1.99 → 2.49
        if stock is not None:
            usage = forecast(takes_by_key.get(product["key"], []), product["count"])
            product["usage"] = usage
            product["suggested_min"] = suggested_minimum(usage["per_week"] if usage else None, lead)
            remembered = stock.prices.get(product["key"])
            own = next((p for _, p in value_parts.get(product["key"], []) if p), None)
            product["price"] = price_of(own or {}, remembered)
            if product["price"] and product["price"]["source"] == "openprices" and remembered:
                product["price"]["count"] = remembered.get("count")
            total: float | None = 0.0 if product["count"] else None
            for count, pack_price in value_parts.get(product["key"], []):
                price = price_of(pack_price or {}, remembered)
                if price is None:
                    total = None
                    break
                total += count * price["price"]
            product["value"] = round(total, 2) if total is not None else None
        rows.append(product)
    rows.sort(key=lambda p: p["name"].casefold())
    return rows


def shopping_text(product: dict[str, Any], with_details: bool, packs: int | None = None, language: str = "en") -> str:
    """Entry for the shopping list; household items with a pack size name the number of packs."""
    parts = [str(product[k]).strip() for k in ("brand", "package") if str(product.get(k) or "").strip()] if with_details else []
    if packs and int(product.get("pack_size") or 1) > 1:
        de = language.lower().startswith("de")
        parts.append(f"{packs} {('Packung' if packs == 1 else 'Packungen') if de else ('pack' if packs == 1 else 'packs')}")
    return f"{product['name']} ({', '.join(parts)})" if parts else product["name"]


def _shopping_entry(hass: HomeAssistant, product: dict[str, Any], minimum: int, count: int, with_details: bool) -> tuple[str, int]:
    """(text, number to buy): packs for household items with a pack size, otherwise the missing count."""
    from .household import packs_needed  # noqa: PLC0415 - avoids an import cycle

    size = int(product.get("pack_size") or 1)
    if product.get("kind") == KIND_HOUSEHOLD and size > 1:
        packs = packs_needed(minimum, count, size)
        return shopping_text(product, with_details, packs, hass.config.language or "en"), packs
    return shopping_text(product, with_details), max(1, minimum - count)


_TRACKED_PRODUCT = ("brand", "package", "pack_size", "piece")


def running_low(hass: HomeAssistant, stock: Stock, include_snoozed: bool = False) -> list[dict[str, Any]]:
    """Products with a minimum stock that will soon fall below it according to the forecast (not below yet).

    "Soon" = lasts at most the lead time for the minimum stock. Only with enough takes (forecast).
    """
    lead = int(getattr(hass.data.get(DOMAIN, {}).get("estimator"), "stock_lead_days", 7) or 7)
    today = dt_util.now().date().isoformat()
    out = []
    for product in stock_overview(hass, stock.minimums, stock):
        usage = product.get("usage")
        if not product["min"] or product["low"] or not product["count"] or not usage or usage.get("lasts_days") is None:
            continue
        if usage["lasts_days"] > lead:
            continue
        if not include_snoozed and stock.reorder_snoozed.get(product["key"], "") > today:
            continue
        out.append(
            {
                "key": product["key"],
                "name": product["name"],
                "count": product["count"],
                "min": product["min"],
                "lasts_days": usage["lasts_days"],
                "brand": product["brand"],
                "package": product["package"],
                "kind": product.get("kind") or KIND_PACK,
                "piece": product.get("piece"),
            }
        )
    out.sort(key=lambda p: p["lasts_days"])
    return out


async def async_check_running_low(hass: HomeAssistant, content: str | None = None) -> list[dict[str, Any]]:
    """Report products newly "running low" (event `larder_running_low`, once per product) and, if set,
    put them on the shopping list right away. Products that last again are reset."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    if stock is None:
        return []
    estimator = await async_get_estimator(hass)
    low = running_low(hass, stock, include_snoozed=True)
    keys = {p["key"] for p in low}
    new = [p for p in low if p["key"] not in stock.reorder_notified and (content is None or p["key"] == product_key(content))]
    notified = [k for k in stock.reorder_notified if k in keys] + [p["key"] for p in new]
    if notified != stock.reorder_notified:
        stock.reorder_notified = notified
        stock._save()  # noqa: SLF001
    de = (hass.config.language or "en").lower().startswith("de")
    for product in new:
        days = product["lasts_days"]
        message = (
            f"{product['name']}: noch {product['count']}, reicht ca. {days} {'Tag' if days == 1 else 'Tage'}."
            if de
            else f"{product['name']}: {product['count']} left, lasts about {days} {'day' if days == 1 else 'days'}."
        )
        hass.bus.async_fire(
            EVENT_RUNNING_LOW,
            {
                **{k: product[k] for k in ("name", "count", "min", "lasts_days", "brand", "package")},
                "title": "🛒 Bald leer" if de else "🛒 Running low",
                "message": message,
            },
        )
        if getattr(estimator, "reorder_shopping", False) and shopping_list_for(hass, product["name"], product.get("kind")):
            await async_shop_product(hass, product["name"])
    return new


async def async_shop_product(hass: HomeAssistant, content: str) -> tuple[bool, str]:
    """Put a product of the stock (with brand and package) on the shopping list and remember it for "bought"."""
    estimator = await async_get_estimator(hass)
    stock = await async_get_stock(hass)
    key = product_key(content)
    product = next((p for p in stock_overview(hass, stock.minimums) if p["key"] == key), None) or {"name": content}
    product = {**(stock.minimums.get(key, {}).get("product") or {}), **{k: v for k, v in product.items() if v}}
    todo = shopping_list_for(hass, product["name"], product.get("kind"))
    if not todo:
        raise HomeAssistantError("no shopping list chosen in the settings")
    text, buy = _shopping_entry(
        hass, product, int(product.get("min") or 1), int(product.get("count") or 0), getattr(estimator, "shopping_details", True)
    )
    added = await async_add_to_shopping_list(hass, todo, text)
    if added:
        places = product.get("places") or []
        stock.track(text, {
            "content": product["name"],
            "product": {k: product[k] for k in _TRACKED_PRODUCT if product.get(k) and product[k] != 1},
            "kind": product.get("kind") or KIND_PACK,
            "area_id": places[0].get("area_id") if places else None,
            "compartment": places[0].get("compartment", "") if places else "",
            "count": buy,
            "source": "minimum",
        }, todo)
    return added, text


async def async_check_auto_reorder(hass: HomeAssistant) -> list[str]:
    """Buy again by consumption (5.2, #128): products switched on that run out within the lead time (forecast)
    go onto their shopping list before the minimum stock is reached – once until they were bought."""
    stock = await async_get_stock(hass)
    lead = int(getattr(hass.data.get(DOMAIN, {}).get("estimator"), "stock_lead_days", 7) or 7)
    today = dt_util.now().date()
    on_list = {product_key(info.get("content")) for info in stock.tracked.values()}
    added: list[str] = []
    for product in stock_overview(hass, stock.minimums, stock):
        info = stock.auto_reorder.get(product["key"])
        usage = product.get("usage")
        if info is None or not usage or usage.get("lasts_days") is None or usage["lasts_days"] > lead:
            continue
        if product["key"] in on_list or product["low"]:
            continue  # already on the list, or the minimum stock takes care of it
        last = info.get("last")
        if last and (today - date.fromisoformat(last)).days < lead:
            continue
        try:
            ok, text = await async_shop_product(hass, product["name"])
        except HomeAssistantError:
            continue
        info["last"] = today.isoformat()
        if ok:
            added.append(text)
            hass.bus.async_fire(EVENT_AUTO_REORDER, {"name": product["name"], "item": text, "lasts_days": usage["lasts_days"]})
    if added:
        stock.save_now()
    return added


async def async_check_stock(hass: HomeAssistant, content: str | None, exclude: set[str] | None = None) -> bool:
    """Stock of a product below the minimum: onto the shopping list (not twice). True if added."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    key = product_key(content)
    if stock is None or not key or key not in stock.minimums:
        return False
    estimator = await async_get_estimator(hass)
    count, product = 0, {"name": stock.minimums[key].get("name") or content, "brand": None, "package": None}
    seen = False
    for item in pack_entries(hass, exclude):
        if product_key(item["content"]) == key:
            seen = True
            count += item["count"]
            product["brand"] = product["brand"] or item["brand"]
            product["package"] = product["package"] or item["package"]
            product["kind"] = item["kind"]
            product["pack_size"] = item["pack_size"]
            product["piece"] = item["piece"]
    if not seen:
        # nothing left: last known brand, package, kind and pack size
        product.update({k: v for k, v in (stock.minimums[key].get("product") or {}).items() if v})
    if count >= stock.minimums[key]["min"]:
        return False
    todo = shopping_list_for(hass, product["name"], product.get("kind"))
    if not todo:
        return False
    text, buy = _shopping_entry(hass, product, stock.minimums[key]["min"], count, getattr(estimator, "shopping_details", True))
    added = await async_add_to_shopping_list(hass, todo, text)
    if added:
        place = next((p for p in stock_overview(hass, stock.minimums) if p["key"] == key), {}).get("places") or []
        stock.track(
            text,
            {
                "content": product["name"],
                "product": {k: product[k] for k in _TRACKED_PRODUCT if product.get(k) and product[k] != 1},
                "kind": product.get("kind") or KIND_PACK,
                "area_id": place[0].get("area_id") if place else None,
                "compartment": place[0].get("compartment", "") if place else "",
                "count": buy,
                "source": "minimum",
            },
            todo,
        )
    return added


# ---------- Splitting / moving ----------


async def _async_relocate(hass: HomeAssistant, cc: str, area_id: str | None, compartment: str) -> None:
    """Put an entry into another area and another compartment."""
    registry = dr.async_get(hass)
    device = device_of(hass, cc)
    if device is not None:
        registry.async_update_device(device.id, area_id=area_id or None)
    comp_id = er.async_get(hass).async_get_entity_id("text", DOMAIN, f"{cc}_compartment")
    if comp_id:
        await hass.services.async_call("text", "set_value", {"entity_id": comp_id, "value": (compartment or "").strip()}, blocking=True)


async def async_open_pack(hass: HomeAssistant, cc: str, area_id: str | None = None, compartment: str | None = None) -> dict[str, Any]:
    """Open a pack: split one off if there are several, mark as opened, date for opened goods.

    With `area_id` the opened pack goes there (e.g. ketchup into the fridge). The date is estimated for the
    new place (table/AI), else "shelf life after opening" of the settings applies; at most the
    printed date.
    """
    from .disposable import async_create_items  # noqa: PLC0415 - avoids an import cycle

    entries = {e.data.get(CONF_CC): e for e in hass.config_entries.async_loaded_entries(DOMAIN)}
    entry = entries.get(cc)
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    kind = kind_of(entry) if entry is not None else None
    if kind not in PACK_KINDS or source is None or source["opened"]:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="open_invalid")
    target_area = source["area_id"] if area_id is None else (area_id or None)
    target_comp = source["compartment"] if compartment is None else compartment.strip()
    today = dt_util.now().date().isoformat()
    ents = entry.runtime_data.resettable
    product = {**ents["content"].product, "opened": today}
    if source["count"] > 1:
        item: dict[str, Any] = {"content": source["content"], "quantity": 1, "unit": "pieces", "product": product}
        if source["best_before"]:
            item["best_before"] = date.fromisoformat(source["best_before"])
        created = await async_create_items(hass, kind, [item], target_area, target_comp)
        quiet = hass.data.setdefault(DOMAIN, {}).setdefault(DATA_QUIET, set())
        quiet.add(cc)  # opening is not consumption (yet)
        await ents["portions"].async_set_native_value(float(source["count"] - 1))
        quiet.discard(cc)
        opened_cc = created[0]["cc"]
    else:
        await ents["content"].async_set_product(product)
        if (target_area, target_comp) != (source["area_id"], source["compartment"]):
            await _async_relocate(hass, cc, target_area, target_comp)
        opened_cc = cc
    target = entries.get(opened_cc) or next(e for e in hass.config_entries.async_loaded_entries(DOMAIN) if e.data.get(CONF_CC) == opened_cc)
    best_entity = target.runtime_data.resettable["best_before"]
    printed: date | None = best_entity.native_value
    best: date | None = None
    if kind in NON_FOOD_KINDS:
        # cosmetics and medicines: the period after opening of the product (PAO, months), else the printed date
        months = float(product.get("pao") or 0)
        if months > 0:
            best = dt_util.now().date() + timedelta(days=round(months * 30.44))
            if printed is not None and printed < best:
                best = printed
            await best_entity.async_set_value(best)
        else:
            best = printed
        device = device_of(hass, opened_cc)
        return {"device_id": device.id if device else None, "best_before": best.isoformat() if best else None, "split": opened_cc != cc}
    # 5.5: shelf life after opening of the product (table from USDA FoodKeeper → AI → setting)
    days, _info = await best_entity.async_opened_days()
    best = dt_util.now().date() + timedelta(days=days)
    if printed is not None and printed < best:
        best = printed
    await best_entity.async_set_value(best)
    device = device_of(hass, opened_cc)
    return {"device_id": device.id if device else None, "best_before": best.isoformat() if best else None, "split": opened_cc != cc}


async def async_move_packs(
    hass: HomeAssistant, cc: str, count: int, area_id: str | None, compartment: str
) -> dict[str, Any]:
    """Bring `count` packs of an entry to another place (area and compartment)."""
    from .disposable import async_create_items, async_dispose  # noqa: PLC0415 - avoids an import cycle

    entries = {e.data.get(CONF_CC): e for e in hass.config_entries.async_loaded_entries(DOMAIN)}
    entry = entries.get(cc)
    if entry is None or kind_of(entry) not in (*PACK_KINDS, KIND_BAG):
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    if area_id and ar.async_get(hass).async_get_area(area_id) is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    if kind_of(entry) == KIND_BAG:
        # bags always move as a whole (stocktake: "elsewhere"), nothing is merged
        await _async_relocate(hass, cc, area_id, compartment)
        device = device_of(hass, cc)
        return {"moved": 1, "merged": False, "device_id": device.id if device else None}
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    if source is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    compartment = (compartment or "").strip()
    count = max(1, min(int(count), source["count"]))
    quiet: set[str] = hass.data.setdefault(DOMAIN, {}).setdefault(DATA_QUIET, set())
    if (source["area_id"] or None) == (area_id or None) and source["compartment"] == compartment:
        return {"moved": 0, "merged": False, "device_id": source["device_id"]}
    ents = entry.runtime_data.resettable
    # target: the same goods with the same date already there? Then merge.
    target = next(
        (
            p
            for p in pack_entries(hass, {cc})
            if product_key(p["content"]) == product_key(source["content"])
            and p["best_before"] == source["best_before"]
            and (p["area_id"] or None) == (area_id or None)
            and p["compartment"] == compartment
        ),
        None,
    )
    all_of_them = count >= source["count"]
    if target is not None:
        target_entry = entries[target["cc"]]
        await target_entry.runtime_data.resettable["portions"].async_set_native_value(float(target["count"] + count))
        await target_entry.runtime_data.resettable["unit"].async_select_option("pieces")
        if all_of_them:
            await async_dispose(hass, entry.entry_id, remember=False)
        else:
            quiet.add(cc)  # rearranging is not consumption
            await ents["portions"].async_set_native_value(float(source["count"] - count))
            quiet.discard(cc)
        return {"moved": count, "merged": True, "device_id": target["device_id"]}
    if all_of_them:
        await _async_relocate(hass, cc, area_id, compartment)
        return {"moved": count, "merged": False, "device_id": source["device_id"]}
    item: dict[str, Any] = {
        "content": source["content"],
        "quantity": count,
        "unit": "pieces",
        "product": ents["content"].product,
    }
    if source["best_before"]:
        item["best_before"] = date.fromisoformat(source["best_before"])
    created = await async_create_items(hass, kind_of(entry), [item], area_id, compartment)
    quiet.add(cc)
    await ents["portions"].async_set_native_value(float(source["count"] - count))
    quiet.discard(cc)
    return {"moved": count, "merged": False, "device_id": created[0]["device_id"]}


# ---------- Again …? ----------


def build_cook_again(
    records: list[dict[str, Any]], present: set[str], snoozed: dict[str, str], today: date | None = None
) -> list[dict[str, Any]]:
    """Eaten often (at least AGAIN_MIN× in AGAIN_DAYS days) but currently in no container and no pack."""
    from .shelf_life import split_items  # noqa: PLC0415

    today = today or dt_util.now().date()
    since = today - timedelta(days=AGAIN_DAYS)
    counts: dict[str, dict[str, Any]] = {}
    for record in records:
        if record.get("outcome") != "eaten" or record.get("kind") in NON_FOOD_KINDS:
            continue
        parsed = dt_util.parse_datetime(record.get("emptied") or "")
        day = dt_util.as_local(parsed).date() if parsed else None
        if day is None or day <= since:
            continue
        for part in split_items(record.get("content") or ""):
            key = product_key(part)
            info = counts.setdefault(key, {"content": part, "count": 0, "last": day})
            info["count"] += 1
            info["last"] = max(info["last"], day)
    out = [
        {"key": k, "content": v["content"], "count": v["count"], "last": v["last"].isoformat()}
        for k, v in counts.items()
        if v["count"] >= AGAIN_MIN and k not in present and snoozed.get(k, "") <= today.isoformat()
    ]
    out.sort(key=lambda s: (-s["count"], s["last"]))
    return out[:AGAIN_MAX]


def present_products(hass: HomeAssistant) -> set[str]:
    from .expiry import collect_expiring  # noqa: PLC0415
    from .shelf_life import split_items  # noqa: PLC0415

    keys: set[str] = set()
    for item in collect_expiring(hass, days=None, include_expired=True, include_undated=True):
        for part in split_items(item.get("content") or ""):
            keys.add(product_key(part))
    return keys


async def async_cook_again(hass: HomeAssistant) -> list[dict[str, Any]]:
    from .history import async_get_history  # noqa: PLC0415

    stock = await async_get_stock(hass)
    history = await async_get_history(hass)
    return build_cook_again(history.records, present_products(hass), stock.snoozed)


async def _async_fill_open_prices(hass: HomeAssistant, stock: Stock, products: list[dict[str, Any]]) -> None:
    changed = False
    for product in products:
        try:
            result = await async_open_prices(hass, product["ean"])
        except Exception:  # noqa: BLE001 - background: a missing estimate must not disturb anything
            _LOGGER.debug("Open Prices für %s fehlgeschlagen", product["ean"], exc_info=True)
            continue
        if result:
            stock.remember_price(product["name"], result["price"], "openprices")
            if product["key"] in stock.prices:
                stock.prices[product["key"]]["count"] = result["count"]
            changed = True
    if changed:
        async_dispatcher_send(hass, SIGNAL_STOCK_CHANGED)


# ---------- Strichcode ----------


async def async_find_by_code(hass: HomeAssistant, code: str, content: str | None = None) -> dict[str, Any]:
    """Packs for a barcode (by the EAN, else by the product name), earliest date first.

    5.0 (search, #118): with `content` the packs of that product, without a barcode.
    """
    from .product import async_lookup  # noqa: PLC0415 - avoids an import cycle

    digits = "".join(ch for ch in code if ch.isdigit())
    packs = pack_entries(hass)
    found = [p for p in packs if digits and str(p.get("ean") or "") == digits]
    if content:
        found = [p for p in packs if product_key(p["content"]) == product_key(content)]
        digits = ""
    lookup: dict[str, Any] = {}
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    own = stock.ean_names.get(digits) if stock is not None and digits else None
    if not found and own:
        # created with this barcode before (possibly renamed): by the own name
        found = [p for p in packs if product_key(p["content"]) == product_key(own)]
    if not found and digits:
        lookup = await async_lookup(hass, digits)
        if lookup.get("found"):
            key = product_key(lookup["name"])
            found = [p for p in packs if product_key(p["content"]) == key]
    # opened ones first, then the earliest date
    found.sort(key=lambda p: (not p["opened"], p["best_before"] or "9999", str(p["area"] or "￿").casefold(), p["compartment"].casefold()))
    name = found[0]["content"] if found else own or lookup.get("name") or content
    product = None if found else (lookup.get("product") if lookup.get("found") else None)
    return {
        "code": digits,
        "name": name,
        "entries": [
            {k: p[k] for k in ("device_id", "area", "area_id", "compartment", "count", "best_before", "opened", "kind")}
            for p in found
        ],
        # unknown in the stock: data for "add as a pack"
        "product": product,
        # found: what "＋ New pack" is prefilled with (product data, kind and where it already is)
        "known": _known_product(found, digits) if found else None,
        # food, beauty, product or petfood: anything but food is offered as a household item
        "product_type": lookup.get("product_type") if lookup.get("found") else None,
        "error": lookup.get("error"),
    }


def _known_product(found: list[dict[str, Any]], code: str) -> dict[str, Any]:
    first = found[0]

    def value(key: str) -> Any:
        return next((p[key] for p in found if p.get(key)), None)

    product = {k: v for k in ("brand", "package", "piece", "price") if (v := value(k))}
    if (size := max(p.get("pack_size", 1) for p in found)) > 1:
        product["pack_size"] = size
    ean = next((p["ean"] for p in found if p.get("ean")), None) or (code if len(code) >= 8 else None)
    if ean:
        product["ean"] = ean
    # the place where most of it already is
    place = max(found, key=lambda p: p["count"])
    return {
        "content": first["content"],
        "kind": first["kind"],
        "product": product,
        "area_id": place.get("area_id"),
        "compartment": place.get("compartment", ""),
    }


async def async_take_one(hass: HomeAssistant, cc: str, outcome: str) -> dict[str, Any]:
    """Take one pack (or one piece of a household item): used up ("eaten") or thrown away ("thrown").

    Both count as consumption (the stock goes down either way). Thrown away also gets a history entry for this
    one pack, so statistics and the value thrown away include it; the last one empties the entry as usual.
    """
    from .history import async_get_history, build_record  # noqa: PLC0415 - avoids an import cycle

    entry = entry_of(hass, cc)
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    if entry is None or source is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    history = await async_get_history(hass)
    if source["count"] <= 1:
        button = er.async_get(hass).async_get_entity_id("button", DOMAIN, f"{cc}_empty_container")
        history.set_pending(cc, outcome)
        try:
            await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
        finally:
            history.pop_pending(cc)
        return {"left": 0}
    if outcome == "thrown":
        product = {k: source[k] for k in ("brand", "package", "ean", "price") if source.get(k)}
        history.add(
            build_record(
                cc=cc,
                name=entry.title,
                content=source["content"],
                quantity=1,
                unit="pieces",
                area=source["area"],
                filled_at=None,
                best_before=source["best_before"],
                outcome="thrown",
                compartment=source["compartment"],
                product=product,
                kind=source["kind"],
            )
        )
    await entry.runtime_data.resettable["portions"].async_set_native_value(float(source["count"] - 1))
    return {"left": source["count"] - 1}


async def async_put_away(hass: HomeAssistant, code: str, content: str | None = None, packs: int = 1) -> dict[str, Any]:
    """Put one bought product away by its barcode (#96).

    Known product: one pack more at its usual place (where most of it is). It joins an entry there without a
    best-before date, else a new entry is made (price and date can be added right away, 5.0). The matching
    shopping list item is ticked off. Household items
    get a whole pack (pieces per pack). Bought items of the product on the start page are taken care of.
    Unknown: nothing is made, the dashboard collects it (with the name from the product databases).
    """

    found = await async_find_by_code(hass, code, content)
    known = found.get("known")
    if not known:
        return {"status": "unknown", **{k: found.get(k) for k in ("code", "name", "product", "product_type")}}
    from .shopping_mode import async_tick_off  # noqa: PLC0415 - avoids an import cycle

    result = await async_add_known(hass, known, packs)
    # 5.0 (#120): like the shopping mode and the receipt, the shopping list item is ticked off
    result["ticked"] = await async_tick_off(hass, [known["content"]])
    return result


async def async_add_known(hass: HomeAssistant, known: dict[str, Any], packs: int = 1) -> dict[str, Any]:
    """`packs` packs of a known product more, at its usual place (put away, shopping mode)."""
    from .disposable import async_create_items  # noqa: PLC0415 - avoids an import cycle

    key = product_key(known["content"])
    area_id, compartment = known.get("area_id"), known.get("compartment") or ""
    packs = max(1, int(packs or 1))
    size = (int(known["product"].get("pack_size") or 1) if known["kind"] == KIND_HOUSEHOLD else 1) * packs
    target = next(
        (
            p for p in pack_entries(hass)
            if product_key(p["content"]) == key and p["kind"] == known["kind"] and not p["best_before"] and not p["opened"]
            and (p["area_id"] or None) == (area_id or None) and p["compartment"] == compartment
        ),
        None,
    )
    if target is not None:
        entry = entry_of(hass, target["cc"])
        count = target["count"] + size
        await entry.runtime_data.resettable["portions"].async_set_native_value(float(count))
        device_id = target["device_id"]
    else:
        item = {"content": known["content"], "quantity": size, "unit": "pieces", "product": dict(known["product"])}
        created = await async_create_items(hass, known["kind"], [item], area_id, compartment)
        count, device_id = size, created[0]["device_id"]
    stock = await async_get_stock(hass)
    stock.dismiss_product(known["content"])
    stock.remember_recent(known["content"], known["kind"], known.get("product"), area_id, compartment)
    area = ar.async_get(hass).async_get_area(area_id) if area_id else None
    return {
        "status": "added",
        "content": known["content"],
        "kind": known["kind"],
        "device_id": device_id,
        "area": area.name if area else None,
        "compartment": compartment,
        "count": count,
        "added": size,
        "new_entry": target is None,
    }


# ---------- WebSocket ----------


def _cc_of(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    return larder_id(device)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/stock"})
@websocket_api.async_response
async def ws_stock(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    estimator = await async_get_estimator(hass)
    products = stock_overview(hass, stock.minimums, stock)
    valued = [p["value"] for p in products if p.get("value")]
    connection.send_result(
        msg["id"],
        {
            "products": products,
            "shopping_list": any_list(hass),
            "value": round(sum(valued), 2) if valued else None,
            "valued": len(valued),
            "lead_days": estimator.stock_lead_days,
        },
    )
    # packs with a barcode but without a price: look them up in Open Prices in the background (at most 5 per call)
    missing = [p for p in products if p.get("ean") and p["count"] and not p.get("price") and p["key"] not in stock.prices][:5]
    if missing:
        hass.async_create_task(_async_fill_open_prices(hass, stock, missing), f"{DOMAIN}_open_prices")


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/stock_min",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("min"): vol.All(vol.Coerce(int), vol.Range(min=0, max=MAX_MIN)),
    }
)
@websocket_api.async_response
async def ws_stock_min(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    try:
        await stock.async_set_minimum(msg["content"], msg["min"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "stock_failed", str(err))
        return
    connection.send_result(msg["id"], {"products": stock_overview(hass, stock.minimums, stock)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/auto_reorder",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def ws_auto_reorder(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Switch "buy again by consumption" for a product on or off (5.2)."""
    stock = await async_get_stock(hass)
    stock.set_auto_reorder(msg["content"], msg["enabled"])
    added = await async_check_auto_reorder(hass) if msg["enabled"] else []
    connection.send_result(msg["id"], {"products": stock_overview(hass, stock.minimums, stock), "added": added})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/opened_after",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("days"): vol.Any(None, vol.All(int, vol.Range(min=0, max=1095))),
        vol.Optional("source", default="manual"): vol.In(("manual", "label")),
    }
)
@websocket_api.async_response
async def ws_opened_after(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Set or clear "use within … after opening" of one product (5.7, #154); 0/None clears it."""
    stock = await async_get_stock(hass)
    stock.set_opened_after(msg["content"], msg["days"] or None, msg["source"])
    connection.send_result(msg["id"], {"products": stock_overview(hass, stock.minimums, stock)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/stock_code",
        vol.Optional("code", default=""): str,
        vol.Optional("content"): vol.All(str, vol.Length(min=1, max=255)),
    }
)
@websocket_api.async_response
async def ws_stock_code(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_find_by_code(hass, msg["code"], msg.get("content")))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/stock_code_link",
        vol.Required("code"): str,
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
    }
)
@websocket_api.async_response
async def ws_stock_code_link(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Assign a barcode to a product in the stock (packs without EAN, e.g. created under another name)."""
    from .product import _content_entity  # noqa: PLC0415 - avoids an import cycle

    digits = "".join(ch for ch in msg["code"] if ch.isdigit())
    if len(digits) < 8:
        connection.send_error(msg["id"], "invalid_code", "not a barcode")
        return
    key = product_key(msg["content"])
    linked = 0
    for pack in pack_entries(hass):
        if product_key(pack["content"]) == key and pack.get("device_id"):
            entity = _content_entity(hass, pack["device_id"])
            if entity is not None:
                await entity.async_set_product({"ean": digits}, replace=False)
                linked += 1
    stock = await async_get_stock(hass)
    stock.remember_ean(digits, msg["content"])
    connection.send_result(msg["id"], {"linked": linked, **await async_find_by_code(hass, digits)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/bought"})
@websocket_api.async_response
async def ws_bought(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    await stock.async_poll()
    connection.send_result(msg["id"], {"items": list(reversed(stock.bought))})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/bought_dismiss", vol.Required("item_id"): str}
)
@websocket_api.async_response
async def ws_bought_dismiss(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    stock.dismiss(msg["item_id"])
    connection.send_result(msg["id"], {"items": list(reversed(stock.bought))})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/pack_open",
        vol.Required("device_id"): str,
        vol.Optional("area_id"): vol.Any(str, None),
        vol.Optional("compartment"): vol.All(str, vol.Length(max=60)),
    }
)
@websocket_api.async_response
async def ws_pack_open(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    cc = _cc_of(hass, msg["device_id"])
    try:
        if not cc:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="open_invalid")
        result = await async_open_pack(hass, cc, msg.get("area_id", None) if "area_id" in msg else None, msg.get("compartment"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "open_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/stock_shop", vol.Required("content"): vol.All(str, vol.Length(min=1, max=255))}
)
@websocket_api.async_response
async def ws_stock_shop(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Put a product of the stock (with brand and package) on the shopping list, e.g. from the stock card."""
    try:
        added, text = await async_shop_product(hass, msg["content"])
    except HomeAssistantError:
        connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen in the settings")
        return
    connection.send_result(msg["id"], {"added": added, "item": text})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/product_list",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Optional("list"): vol.Any(None, vol.All(str, vol.Match(r"^todo\."))),
    }
)
@websocket_api.async_response
async def ws_product_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Own shopping list for a product (from its card); without `list` back to the default list."""
    stock = await async_get_stock(hass)
    stock.set_list(msg["content"], msg.get("list"))
    connection.send_result(msg["id"], {"list": stock.lists.get(product_key(msg["content"]))})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/pack_take",
        vol.Required("device_id"): str,
        vol.Optional("outcome", default="eaten"): vol.In(("eaten", "thrown")),
    }
)
@websocket_api.async_response
async def ws_pack_take(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """One pack used up or thrown away (barcode dialog, compartment view)."""
    cc = _cc_of(hass, msg["device_id"])
    try:
        if not cc:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        result = await async_take_one(hass, cc, msg["outcome"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "take_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/put_away",
        vol.Exclusive("code", "what"): vol.All(str, vol.Length(min=1, max=64)),
        vol.Exclusive("content", "what"): vol.All(str, vol.Length(min=1, max=255)),
        # 5.1 (#124): several packs of the product at once
        vol.Optional("packs", default=1): vol.All(int, vol.Range(min=1, max=50)),
    }
)
@websocket_api.async_response
async def ws_put_away(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Put away after shopping: one scanned product (for everyone in the household, like adding packs)."""
    try:
        if not msg.get("code") and not msg.get("content"):
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        result = await async_put_away(hass, msg.get("code", ""), msg.get("content"), msg["packs"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "put_away_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/replace_interval",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("weeks"): vol.All(vol.Coerce(float), vol.Range(min=0, max=520)),
    }
)
@websocket_api.async_response
async def ws_replace_interval(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replacement interval of a product in weeks (0 = none)."""
    stock = await async_get_stock(hass)
    stock.set_interval(msg["content"], msg["weeks"] or None)
    connection.send_result(msg["id"], {"interval": stock.interval_info(msg["content"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/replaced",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Optional("device_id"): str,
    }
)
@websocket_api.async_response
async def ws_replaced(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replaced: one piece is taken (from this entry, else the oldest of the product) and the interval starts again."""
    stock = await async_get_stock(hass)
    key = product_key(msg["content"])
    cc = _cc_of(hass, msg["device_id"]) if msg.get("device_id") else None
    if cc is None:
        entries = sorted((p for p in pack_entries(hass) if product_key(p["content"]) == key), key=lambda p: (not p["opened"], p["best_before"] or "9999"))
        cc = entries[0]["cc"] if entries else None
    taken = False
    if cc is not None:
        try:
            await async_take_one(hass, cc, "eaten")
            taken = True
        except HomeAssistantError:
            taken = False
    stock.mark_replaced(msg["content"])
    connection.send_result(msg["id"], {"taken": taken, "interval": stock.interval_info(msg["content"]), "due": stock.replace_due()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/product_section",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Optional("section"): vol.Any(None, vol.In(SECTIONS)),
    }
)
@websocket_api.async_response
async def ws_product_section(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Store section of a product (from its card); without `section` back to the suggestion."""
    stock = await async_get_stock(hass)
    stock.set_section(msg["content"], msg.get("section"))
    connection.send_result(msg["id"], {"section": section_of(hass, msg["content"])})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/sections"})
@websocket_api.async_response
async def ws_sections(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Order of the store sections (settings)."""
    connection.send_result(msg["id"], {"order": section_order(hass)})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/section_order", vol.Required("order"): [vol.In(SECTIONS)]}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_section_order(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Change the order of the store sections (administrators)."""
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({CONF_SECTION_ORDER: msg["order"]})
    connection.send_result(msg["id"], {"order": section_order(hass)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/replace_due"})
@websocket_api.async_response
async def ws_replace_due(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    connection.send_result(msg["id"], {"items": stock.replace_due()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/running_low"})
@websocket_api.async_response
async def ws_running_low(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    await async_get_estimator(hass)
    connection.send_result(msg["id"], {"items": running_low(hass, stock), "shopping_list": any_list(hass)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/running_low_action",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("action"): vol.In(("shop", "dismiss")),
    }
)
@websocket_api.async_response
async def ws_running_low_action(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """"Running low": put on the shopping list or hide (both hide it for a week)."""
    stock = await async_get_stock(hass)
    added = False
    if msg["action"] == "shop":
        try:
            added, _text = await async_shop_product(hass, msg["content"])
        except HomeAssistantError:
            connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen in the settings")
            return
    stock.snooze_reorder(msg["content"])
    connection.send_result(msg["id"], {"added": added, "items": running_low(hass, stock)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cook_again"})
@websocket_api.async_response
async def ws_cook_again(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    await async_get_estimator(hass)
    connection.send_result(msg["id"], {"items": await async_cook_again(hass), "shopping_list": any_list(hass)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/cook_again_action",
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("action"): vol.In(("shop", "dismiss")),
    }
)
@websocket_api.async_response
async def ws_cook_again_action(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Put a suggestion on the shopping list or hide it (both hide it for a while)."""
    stock = await async_get_stock(hass)
    added = False
    if msg["action"] == "shop":
        await async_get_estimator(hass)
        todo = shopping_list_for(hass, msg["content"])
        if not todo:
            connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen in the settings")
            return
        added = await async_add_to_shopping_list(hass, todo, msg["content"])
    stock.snooze(msg["content"])
    connection.send_result(msg["id"], {"added": added, "items": await async_cook_again(hass)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/pack_move",
        vol.Required("device_id"): str,
        vol.Required("count"): vol.All(vol.Coerce(int), vol.Range(min=1, max=9999)),
        vol.Optional("area_id"): vol.Any(str, None),
        vol.Optional("compartment", default=""): vol.All(str, vol.Length(max=60)),
    }
)
@websocket_api.async_response
async def ws_pack_move(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    cc = _cc_of(hass, msg["device_id"])
    try:
        if not cc:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
        result = await async_move_packs(hass, cc, msg["count"], msg.get("area_id"), msg["compartment"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "move_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@callback
def async_setup_stock_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_stock)
    websocket_api.async_register_command(hass, ws_stock_min)
    websocket_api.async_register_command(hass, ws_auto_reorder)
    websocket_api.async_register_command(hass, ws_opened_after)
    websocket_api.async_register_command(hass, ws_pack_move)
    websocket_api.async_register_command(hass, ws_stock_code)
    websocket_api.async_register_command(hass, ws_stock_code_link)
    websocket_api.async_register_command(hass, ws_bought)
    websocket_api.async_register_command(hass, ws_bought_dismiss)
    websocket_api.async_register_command(hass, ws_cook_again)
    websocket_api.async_register_command(hass, ws_pack_open)
    websocket_api.async_register_command(hass, ws_stock_shop)
    websocket_api.async_register_command(hass, ws_cook_again_action)
    websocket_api.async_register_command(hass, ws_product_list)
    websocket_api.async_register_command(hass, ws_pack_take)
    websocket_api.async_register_command(hass, ws_put_away)
    websocket_api.async_register_command(hass, ws_replace_interval)
    websocket_api.async_register_command(hass, ws_replaced)
    websocket_api.async_register_command(hass, ws_replace_due)
    websocket_api.async_register_command(hass, ws_product_section)
    websocket_api.async_register_command(hass, ws_sections)
    websocket_api.async_register_command(hass, ws_section_order)
    websocket_api.async_register_command(hass, ws_running_low)
    websocket_api.async_register_command(hass, ws_running_low_action)
    domain_data[DATA_WS] = True
