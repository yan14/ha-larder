"""Vorrat: Packungen nach Produkt zusammengefasst, Mindestbestand und Aufteilen/Verschieben.

* **Produkt** = Inhalt einer Packung (Groß-/Kleinschreibung und Leerzeichen egal). Dieselbe Ware kann an
  mehreren Orten liegen (je Ort ein Packungs-Eintrag); der Bestand ist die Summe aller Einträge.
* **Mindestbestand** je Produkt (bleibt gemerkt, auch wenn die letzte Packung weg ist). Sinkt der Bestand
  darunter, kommt das Produkt (mit Marke und Packungsgröße) auf die Einkaufsliste der Einstellungen.
* **Aufteilen/Verschieben**: einen Teil der Packungen (oder alle) an einen anderen Ort bringen; liegt dort
  schon dieselbe Ware mit demselben MHD, werden die Einträge zusammengeführt.
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
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_CC, DATA_STOCK, DOMAIN, KIND_BAG, KIND_PACK, SIGNAL_STOCK_CHANGED
from .entity import kind_of
from .estimate import async_get_estimator, storage_context
from .shopping import async_add_to_shopping_list
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

DATA_WS = "stock_ws_registered"
STORAGE_KEY = f"{DOMAIN}.stock"
STORAGE_VERSION = 1
MAX_MIN = 999
TRACK_DAYS = 60  # so lange wartet Larder darauf, dass ein Eintrag auf der Einkaufsliste abgehakt wird
MAX_BOUGHT = 30
AGAIN_DAYS = 90  # "oft gegessen": in den letzten so vielen Tagen
AGAIN_MIN = 3  # mindestens so oft
AGAIN_SNOOZE = 30  # "✕" blendet einen Vorschlag so viele Tage aus
AGAIN_MAX = 3


def product_key(content: str | None) -> str:
    return " ".join((content or "").split()).casefold()


class Stock:
    """Mindestbestände je Produkt (Schlüssel → Anzeigename und Minimum)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.minimums: dict[str, dict[str, Any]] = {}
        # von Larder auf die Einkaufsliste gesetzt (Eintrag → Inhalt, Produktdaten, Ort) und schon abgehakt
        self.tracked: dict[str, dict[str, Any]] = {}
        self.bought: list[dict[str, Any]] = []
        self.snoozed: dict[str, str] = {}  # Produkt → bis wann "Mal wieder …?" nicht vorgeschlagen wird
        self._unsub = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.minimums = {k: v for k, v in (data.get("minimums") or {}).items() if isinstance(v, dict)}
        self.tracked = {k: v for k, v in (data.get("tracked") or {}).items() if isinstance(v, dict)}
        self.bought = [b for b in data.get("bought") or [] if isinstance(b, dict)]
        self.snoozed = {str(k): str(v) for k, v in (data.get("snoozed") or {}).items()}

    def _data(self) -> dict[str, Any]:
        return {"minimums": self.minimums, "tracked": self.tracked, "bought": self.bought, "snoozed": self.snoozed}

    def snooze(self, content: str) -> None:
        self.snoozed[product_key(content)] = (dt_util.now().date() + timedelta(days=AGAIN_SNOOZE)).isoformat()
        today = dt_util.now().date().isoformat()
        self.snoozed = {k: v for k, v in self.snoozed.items() if v > today}
        self._save()

    def _save(self) -> None:
        self._store.async_delay_save(self._data, 1)

    # ----- Einkaufsliste → Vorrat -----

    def track(self, summary: str, info: dict[str, Any]) -> None:
        """Eintrag, den Larder auf die Einkaufsliste gesetzt hat, merken (für "eingekauft → in den Vorrat")."""
        now = dt_util.now()
        self.tracked[summary.casefold()] = {**info, "summary": summary, "at": now.isoformat(timespec="seconds")}
        cutoff = (now - timedelta(days=TRACK_DAYS)).isoformat()
        self.tracked = {k: v for k, v in self.tracked.items() if v.get("at", "") >= cutoff}
        self._save()

    @callback
    def async_start(self) -> None:
        """Die Einkaufsliste beobachten: abgehakte Einträge von Larder werden als "eingekauft" angeboten."""
        if self._unsub is not None:
            return

        @callback
        def changed(event: Event) -> None:
            estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
            todo = getattr(estimator, "todo_entity", None)
            if todo and event.data.get("entity_id") == todo and self.tracked:
                self.hass.async_create_task(self.async_poll(), f"{DOMAIN}_bought")

        self._unsub = self.hass.bus.async_listen(EVENT_STATE_CHANGED, changed)

    @callback
    def async_stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    async def async_poll(self) -> list[dict[str, Any]]:
        """Abgehakte Einträge, die Larder gesetzt hat, nach "eingekauft" verschieben."""
        estimator = await async_get_estimator(self.hass)
        todo = estimator.todo_entity
        if not todo or not self.tracked:
            return []
        try:
            response = await self.hass.services.async_call(
                "todo", "get_items", {"entity_id": todo, "status": "completed"}, blocking=True, return_response=True
            )
        except HomeAssistantError:
            _LOGGER.debug("Einkaufsliste %s nicht lesbar", todo, exc_info=True)
            return []
        done = {str(i.get("summary", "")).strip().casefold() for i in ((response or {}).get(todo) or {}).get("items") or []}
        moved: list[dict[str, Any]] = []
        for key in [k for k in self.tracked if k in done]:
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

    def minimum(self, content: str | None) -> int:
        return int((self.minimums.get(product_key(content)) or {}).get("min") or 0)

    async def async_set_minimum(self, content: str, value: int) -> None:
        key = product_key(content)
        if not key:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="no_content")
        if value > 0:
            known = next((p for p in pack_entries(self.hass) if product_key(p["content"]) == key), None)
            product = {k: known[k] for k in ("brand", "package") if known and known.get(k)}
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
    """Alle Packungen mit Inhalt, Anzahl und Ort (geleerte, eben entfernte über `exclude` auslassen)."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    out: list[dict[str, Any]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc or kind_of(entry) != KIND_PACK or (exclude and cc in exclude):
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
        # Menge in Gramm/Milliliter oder ohne Angabe: zählt als eine Packung
        if count <= 0 or (unit_state and unit_state.state not in ("pieces", "portions")):
            count = 1
        best_state = _state(hass, registry, "date", cc, "best_before")
        comp_state = _state(hass, registry, "text", cc, "compartment")
        device = devices.async_get_device(identifiers={(DOMAIN, cc)})
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
            }
        )
    return out


def stock_overview(hass: HomeAssistant, minimums: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Produkte mit Bestand (Summe aller Orte), Mindestbestand und Orten, alphabetisch."""
    products: dict[str, dict[str, Any]] = {}
    for item in pack_entries(hass):
        key = product_key(item["content"])
        product = products.setdefault(
            key, {"key": key, "name": item["content"], "count": 0, "places": [], "brand": None, "package": None}
        )
        product["count"] += item["count"]
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
    rows = []
    for product in products.values():
        product["min"] = int((minimums.get(product["key"]) or {}).get("min") or 0)
        product["low"] = product["min"] > 0 and product["count"] < product["min"]
        # ältestes zuerst: früheste MHD oben, ohne MHD zuletzt
        product["places"].sort(key=lambda p: (not p["opened"], p["best_before"] or "9999", str(p["area"] or "￿").casefold(), p["compartment"].casefold()))
        product["opened"] = sum(p["count"] for p in product["places"] if p["opened"])
        product["earliest"] = next((p["best_before"] for p in product["places"] if p["best_before"]), None)
        rows.append(product)
    rows.sort(key=lambda p: p["name"].casefold())
    return rows


def shopping_text(product: dict[str, Any], with_details: bool) -> str:
    details = ", ".join(str(product[k]).strip() for k in ("brand", "package") if str(product.get(k) or "").strip())
    return f"{product['name']} ({details})" if details and with_details else product["name"]


async def async_check_stock(hass: HomeAssistant, content: str | None, exclude: set[str] | None = None) -> bool:
    """Bestand eines Produkts unter dem Minimum: auf die Einkaufsliste (nicht doppelt). True, wenn eingetragen."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    key = product_key(content)
    if stock is None or not key or key not in stock.minimums:
        return False
    estimator = await async_get_estimator(hass)
    if not estimator.todo_entity:
        return False
    count, product = 0, {"name": stock.minimums[key].get("name") or content, "brand": None, "package": None}
    for item in pack_entries(hass, exclude):
        if product_key(item["content"]) == key:
            count += item["count"]
            product["brand"] = product["brand"] or item["brand"]
            product["package"] = product["package"] or item["package"]
    if not (product["brand"] or product["package"]):
        product.update(stock.minimums[key].get("product") or {})  # zuletzt bekannte Marke/Packung
    if count >= stock.minimums[key]["min"]:
        return False
    text = shopping_text(product, getattr(estimator, "shopping_details", True))
    added = await async_add_to_shopping_list(hass, estimator.todo_entity, text)
    if added:
        place = next((p for p in stock_overview(hass, stock.minimums) if p["key"] == key), {}).get("places") or []
        stock.track(
            text,
            {
                "content": product["name"],
                "product": {k: product[k] for k in ("brand", "package") if product.get(k)},
                "area_id": place[0].get("area_id") if place else None,
                "compartment": place[0].get("compartment", "") if place else "",
                "count": max(1, stock.minimums[key]["min"] - count),
                "source": "minimum",
            },
        )
    return added


# ---------- Aufteilen / Verschieben ----------


async def _async_relocate(hass: HomeAssistant, cc: str, area_id: str | None, compartment: str) -> None:
    """Eintrag in einen anderen Bereich und ein anderes Fach stellen."""
    registry = dr.async_get(hass)
    device = registry.async_get_device(identifiers={(DOMAIN, cc)})
    if device is not None:
        registry.async_update_device(device.id, area_id=area_id or None)
    comp_id = er.async_get(hass).async_get_entity_id("text", DOMAIN, f"{cc}_compartment")
    if comp_id:
        await hass.services.async_call("text", "set_value", {"entity_id": comp_id, "value": (compartment or "").strip()}, blocking=True)


async def async_open_pack(hass: HomeAssistant, cc: str, area_id: str | None = None, compartment: str | None = None) -> dict[str, Any]:
    """Packung anbrechen: bei mehreren eine abtrennen, als geöffnet markieren, MHD für geöffnete Ware.

    Mit `area_id` kommt die geöffnete Packung dorthin (z. B. Ketchup in den Kühlschrank). Das MHD wird für den
    neuen Ort geschätzt (Tabelle/KI), sonst gilt "Haltbarkeit nach dem Öffnen" der Einstellungen; höchstens das
    aufgedruckte Datum.
    """
    from .disposable import async_create_items  # noqa: PLC0415 - vermeidet einen Import-Kreis

    entries = {e.data.get(CONF_CC): e for e in hass.config_entries.async_loaded_entries(DOMAIN)}
    entry = entries.get(cc)
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    if entry is None or kind_of(entry) != KIND_PACK or source is None or source["opened"]:
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
        created = await async_create_items(hass, KIND_PACK, [item], target_area, target_comp)
        await ents["portions"].async_set_native_value(float(source["count"] - 1))
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
    estimator = await async_get_estimator(hass)
    if estimator.enabled:
        try:
            await best_entity.async_estimate_best_before(overwrite=True)
            best = best_entity.native_value
        except HomeAssistantError:
            _LOGGER.debug("MHD nach dem Öffnen nicht geschätzt", exc_info=True)
    if best is None or best == printed:
        # nichts Besseres bekannt: Haltbarkeit nach dem Öffnen aus den Einstellungen
        await best_entity.async_set_value(dt_util.now().date() + timedelta(days=estimator.opened_days))
        best = best_entity.native_value
    if printed is not None and best is not None and printed < best:
        await best_entity.async_set_value(printed)
        best = printed
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, opened_cc)})
    return {"device_id": device.id if device else None, "best_before": best.isoformat() if best else None, "split": opened_cc != cc}


async def async_move_packs(
    hass: HomeAssistant, cc: str, count: int, area_id: str | None, compartment: str
) -> dict[str, Any]:
    """`count` Packungen eines Eintrags an einen anderen Ort (Bereich und Fach) bringen."""
    from .disposable import async_create_items, async_dispose  # noqa: PLC0415 - vermeidet einen Import-Kreis

    entries = {e.data.get(CONF_CC): e for e in hass.config_entries.async_loaded_entries(DOMAIN)}
    entry = entries.get(cc)
    if entry is None or kind_of(entry) not in (KIND_PACK, KIND_BAG):
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    if area_id and ar.async_get(hass).async_get_area(area_id) is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    if kind_of(entry) == KIND_BAG:
        # Beutel ziehen immer ganz um (Inventur: "woanders"), zusammengeführt wird nichts
        await _async_relocate(hass, cc, area_id, compartment)
        device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
        return {"moved": 1, "merged": False, "device_id": device.id if device else None}
    source = next((p for p in pack_entries(hass) if p["cc"] == cc), None)
    if source is None:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="move_invalid")
    compartment = (compartment or "").strip()
    count = max(1, min(int(count), source["count"]))
    if (source["area_id"] or None) == (area_id or None) and source["compartment"] == compartment:
        return {"moved": 0, "merged": False, "device_id": source["device_id"]}
    ents = entry.runtime_data.resettable
    # Ziel: dieselbe Ware mit demselben MHD schon dort? Dann zusammenführen.
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
            await ents["portions"].async_set_native_value(float(source["count"] - count))
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
    created = await async_create_items(hass, KIND_PACK, [item], area_id, compartment)
    await ents["portions"].async_set_native_value(float(source["count"] - count))
    return {"moved": count, "merged": False, "device_id": created[0]["device_id"]}


# ---------- Mal wieder …? ----------


def build_cook_again(
    records: list[dict[str, Any]], present: set[str], snoozed: dict[str, str], today: date | None = None
) -> list[dict[str, Any]]:
    """Oft gegessen (mind. AGAIN_MIN× in AGAIN_DAYS Tagen), aber gerade in keiner Dose und keiner Packung."""
    from .shelf_life import split_items  # noqa: PLC0415

    today = today or dt_util.now().date()
    since = today - timedelta(days=AGAIN_DAYS)
    counts: dict[str, dict[str, Any]] = {}
    for record in records:
        if record.get("outcome") != "eaten":
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


# ---------- Strichcode ----------


async def async_find_by_code(hass: HomeAssistant, code: str) -> dict[str, Any]:
    """Packungen zu einem Strichcode (über die EAN, sonst über den Produktnamen), früheste MHD zuerst."""
    from .product import async_lookup  # noqa: PLC0415 - vermeidet einen Import-Kreis

    digits = "".join(ch for ch in code if ch.isdigit())
    packs = pack_entries(hass)
    found = [p for p in packs if digits and str(p.get("ean") or "") == digits]
    lookup: dict[str, Any] = {}
    if not found:
        lookup = await async_lookup(hass, digits)
        if lookup.get("found"):
            key = product_key(lookup["name"])
            found = [p for p in packs if product_key(p["content"]) == key]
    # angebrochene zuerst, dann das früheste MHD
    found.sort(key=lambda p: (not p["opened"], p["best_before"] or "9999", str(p["area"] or "￿").casefold(), p["compartment"].casefold()))
    name = found[0]["content"] if found else lookup.get("name")
    return {
        "code": digits,
        "name": name,
        "entries": [
            {k: p[k] for k in ("device_id", "area", "compartment", "count", "best_before", "opened")} for p in found
        ],
        # unbekannt im Vorrat: Daten für "als Packung anlegen"
        "product": None if found else (lookup.get("product") if lookup.get("found") else None),
        "error": lookup.get("error"),
    }


# ---------- WebSocket ----------


def _cc_of(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    return next((ident for domain, ident in (device.identifiers if device else ()) if domain == DOMAIN), None)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/stock"})
@websocket_api.async_response
async def ws_stock(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    stock = await async_get_stock(hass)
    estimator = await async_get_estimator(hass)
    connection.send_result(
        msg["id"], {"products": stock_overview(hass, stock.minimums), "shopping_list": bool(estimator.todo_entity)}
    )


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
    connection.send_result(msg["id"], {"products": stock_overview(hass, stock.minimums)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/stock_code", vol.Required("code"): str})
@websocket_api.async_response
async def ws_stock_code(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await async_find_by_code(hass, msg["code"]))


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
    """Produkt des Vorrats (mit Marke und Packung) auf die Einkaufsliste setzen, z. B. aus der Vorrats-Karte."""
    estimator = await async_get_estimator(hass)
    if not estimator.todo_entity:
        connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen in the settings")
        return
    stock = await async_get_stock(hass)
    key = product_key(msg["content"])
    product = next((p for p in stock_overview(hass, stock.minimums) if p["key"] == key), None) or {"name": msg["content"]}
    product = {**(stock.minimums.get(key, {}).get("product") or {}), **{k: v for k, v in product.items() if v}}
    text = shopping_text(product, getattr(estimator, "shopping_details", True))
    added = await async_add_to_shopping_list(hass, estimator.todo_entity, text)
    if added:
        places = product.get("places") or []
        stock.track(text, {
            "content": product["name"],
            "product": {k: product[k] for k in ("brand", "package") if product.get(k)},
            "area_id": places[0].get("area_id") if places else None,
            "compartment": places[0].get("compartment", "") if places else "",
            "count": max(1, int(product.get("min") or 1) - int(product.get("count") or 0)),
            "source": "minimum",
        })
    connection.send_result(msg["id"], {"added": added, "item": text})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/cook_again"})
@websocket_api.async_response
async def ws_cook_again(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    estimator = await async_get_estimator(hass)
    connection.send_result(
        msg["id"], {"items": await async_cook_again(hass), "shopping_list": bool(estimator.todo_entity)}
    )


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
    """Vorschlag auf die Einkaufsliste setzen oder ausblenden (beides blendet ihn für eine Weile aus)."""
    stock = await async_get_stock(hass)
    added = False
    if msg["action"] == "shop":
        estimator = await async_get_estimator(hass)
        if not estimator.todo_entity:
            connection.send_error(msg["id"], "no_shopping_list", "no shopping list chosen in the settings")
            return
        added = await async_add_to_shopping_list(hass, estimator.todo_entity, msg["content"])
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
    websocket_api.async_register_command(hass, ws_pack_move)
    websocket_api.async_register_command(hass, ws_stock_code)
    websocket_api.async_register_command(hass, ws_bought)
    websocket_api.async_register_command(hass, ws_bought_dismiss)
    websocket_api.async_register_command(hass, ws_cook_again)
    websocket_api.async_register_command(hass, ws_pack_open)
    websocket_api.async_register_command(hass, ws_stock_shop)
    websocket_api.async_register_command(hass, ws_cook_again_action)
    domain_data[DATA_WS] = True
