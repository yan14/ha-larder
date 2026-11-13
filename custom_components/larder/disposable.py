"""Beutel und Packungen: Einträge, die nach dem Leeren verschwinden.

* **Beutel** (z. B. Vakuumbeutel): wie eine Dose mit eigenem QR-Code und NFC-Tag, aber für den
  einmaligen Gebrauch. Nach dem Leeren wird der Eintrag samt Gerät und NFC-Tag entfernt; im Verlauf
  bleibt er stehen.
* **Packung** (Vorrat ohne Dose, z. B. Konserven): ohne Code, nur Inhalt, Menge und MHD.

Codes und Tags geleerter Beutel werden gemerkt, damit ein versehentlicher Scan eines alten
Etiketts oder Stickers nicht "unbekannte Dose" meldet, sondern sagt, wann der Beutel geleert wurde.
"""

from __future__ import annotations

from datetime import date
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import SOURCE_IMPORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_AREA,
    CONF_CC,
    CONF_INITIAL,
    CONF_KIND,
    DISPOSABLE_KINDS,
    DOMAIN,
    KIND_BAG,
    KIND_PACK,
    UNITS,
)
from .entity import kind_of
from .estimate import async_get_estimator
from .nfc import async_get_nfc
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

DATA_RETIRED = "retired"
DATA_WS = "disposable_ws_registered"
STORAGE_KEY = f"{DOMAIN}.retired"
STORAGE_VERSION = 1
MAX_RETIRED = 1000
MAX_ITEMS = 30  # so viele Beutel/Packungen auf einmal

_NAMES = {KIND_BAG: ("Beutel", "Bag"), KIND_PACK: ("Packung", "Pack")}


class Retired:
    """Codes und NFC-Tags geleerter Beutel (cc → Name, Inhalt, wann geleert)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.codes: dict[str, dict[str, Any]] = {}
        self.tags: dict[str, str] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.codes = dict(data.get("codes") or {})
        self.tags = dict(data.get("tags") or {})

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"codes": self.codes, "tags": self.tags}, 1)

    def add(self, cc: str, info: dict[str, Any], tag_id: str | None) -> None:
        self.codes[cc] = info
        if tag_id:
            self.tags[tag_id] = cc
        while len(self.codes) > MAX_RETIRED:
            old = next(iter(self.codes))
            del self.codes[old]
            self.tags = {t: c for t, c in self.tags.items() if c != old}
        self._save()

    def by_code(self, cc: str | None) -> dict[str, Any] | None:
        return self.codes.get((cc or "").upper())

    def by_tag(self, tag_id: str | None) -> dict[str, Any] | None:
        cc = self.tags.get(tag_id or "")
        return self.codes.get(cc) if cc else None

    def forget_tag(self, tag_id: str) -> None:
        """Sticker wird für etwas Neues benutzt: gilt nicht mehr als alter Beutel."""
        if self.tags.pop(tag_id, None) is not None:
            self._save()


async def async_get_retired(hass: HomeAssistant) -> Retired:
    async def create() -> Retired:
        retired = Retired(hass)
        await retired.async_load()
        return retired

    return await async_singleton(hass, DATA_RETIRED, create)


def retired_text(info: dict[str, Any], language: str) -> str:
    """"Beutel 3 (Rehgulasch) wurde am 12.11.2026 geleert." für Benachrichtigung und Dashboard."""
    de = language.lower().startswith("de")
    name = info.get("name") or ("Beutel" if de else "Bag")
    if info.get("content"):
        name = f"{name} ({info['content']})"
    try:
        day = date.fromisoformat(str(info.get("emptied", ""))[:10])
        when = day.strftime("%d.%m.%Y") if de else day.isoformat()
    except ValueError:
        when = ""
    if de:
        return f"{name} wurde {'am ' + when + ' ' if when else ''}geleert. Das Etikett oder der Sticker ist nicht mehr gültig."
    return f"{name} was emptied{' on ' + when if when else ''}. This label or sticker is no longer valid."


async def async_delete_ha_tag(hass: HomeAssistant, tag_id: str) -> None:
    """Tag aus der Tag-Liste von Home Assistant (Einstellungen → Tags) entfernen, falls vorhanden."""
    try:
        from homeassistant.components.tag import TAG_DATA  # noqa: PLC0415 - Tag-Integration ist optional

        collection = hass.data.get(TAG_DATA)
        if collection is not None and tag_id in collection.data:
            await collection.async_delete_item(tag_id)
    except Exception:  # noqa: BLE001 - Aufräumen darf das Leeren nie verhindern
        _LOGGER.debug("Tag %s konnte nicht entfernt werden", tag_id, exc_info=True)


async def async_dispose(hass: HomeAssistant, entry_id: str, content: str = "", remember: bool = True) -> None:
    """Geleerten Beutel oder leere Packung entfernen (Gerät, Entitäten, NFC-Verknüpfung, HA-Tag)."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or kind_of(entry) not in DISPOSABLE_KINDS:
        return
    cc = entry.data[CONF_CC]
    tag_id = (await async_get_nfc(hass)).tag_of(cc)
    if remember and kind_of(entry) == KIND_BAG:
        device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
        name = (device.name_by_user or device.name) if device else entry.title
        (await async_get_retired(hass)).add(
            cc,
            {"name": name, "content": content, "emptied": dt_util.now().isoformat(timespec="seconds"), "kind": KIND_BAG},
            tag_id,
        )
    if tag_id:
        await async_delete_ha_tag(hass, tag_id)
    await hass.config_entries.async_remove(entry_id)  # async_remove_entry löst NFC-Verknüpfung und Kalendertermin


def next_names(hass: HomeAssistant, kind: str, count: int) -> list[str]:
    """Fortlaufende Namen ("Beutel 4", "Beutel 5"), die es noch nicht gibt."""
    label = _NAMES[kind][0 if (hass.config.language or "en").lower().startswith("de") else 1]
    used = set()
    for entry in hass.config_entries.async_entries(DOMAIN):
        prefix, _, number = entry.title.rpartition(" ")
        if prefix == label and number.isdigit():
            used.add(int(number))
    names: list[str] = []
    n = 1
    while len(names) < count:
        if n not in used:
            names.append(f"{label} {n}")
        n += 1
    return names


async def async_create_items(
    hass: HomeAssistant,
    kind: str,
    items: list[dict[str, Any]],
    area_id: str | None = None,
    compartment: str | None = None,
) -> list[dict[str, Any]]:
    """Beutel oder Packungen anlegen und gleich befüllen. Liefert je Eintrag device_id, cc, name."""
    if kind not in DISPOSABLE_KINDS:
        raise HomeAssistantError("unsupported kind")
    estimator = await async_get_estimator(hass)
    names = next_names(hass, kind, len(items))
    registry = dr.async_get(hass)
    created: list[dict[str, Any]] = []
    for item, default_name in zip(items, names, strict=True):
        name = (item.get("name") or "").strip() or default_name
        data: dict[str, Any] = {CONF_KIND: kind, "name": name}
        if area_id:
            data[CONF_AREA] = area_id
        if kind == KIND_BAG:
            data[CONF_INITIAL] = {"vacuum": bool(item.get("vacuum", True))}
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data=data)
        entry = result.get("result")
        if entry is None:
            raise HomeAssistantError("could not create the entry")
        ents = entry.runtime_data.resettable
        await ents["content"].async_set_value(str(item["content"]).strip())
        if item.get("product"):
            await ents["content"].async_set_product(dict(item["product"]))
        if "filled_at" in ents:
            await ents["filled_at"].async_set_value(dt_util.now())
        quantity = int(item.get("quantity") or 0)
        if quantity > 0:
            await ents["portions"].async_set_native_value(float(quantity))
            if item.get("unit") in UNITS:
                await ents["unit"].async_select_option(item["unit"])
        best_before = item.get("best_before")
        if best_before:
            await ents["best_before"].async_set_value(best_before)
        elif kind == KIND_BAG and estimator.enabled:
            try:
                await ents["best_before"].async_estimate_best_before()
            except HomeAssistantError:
                _LOGGER.debug("MHD für %s nicht geschätzt", name, exc_info=True)
        if compartment and compartment.strip():
            comp_id = er.async_get(hass).async_get_entity_id("text", DOMAIN, f"{entry.data[CONF_CC]}_compartment")
            if comp_id:
                await hass.services.async_call(
                    "text", "set_value", {"entity_id": comp_id, "value": compartment.strip()}, blocking=True
                )
        device = registry.async_get_device(identifiers={(DOMAIN, entry.data[CONF_CC])})
        created.append({"device_id": device.id if device else None, "cc": entry.data[CONF_CC], "name": name})
    return created


async def async_transfer(hass: HomeAssistant, pack_cc: str, target_cc: str) -> dict[str, Any]:
    """Packung öffnen und in eine leere Dose umfüllen (Inhalt, Produktdaten; MHD neu geschätzt)."""
    entries = {e.data.get(CONF_CC): e for e in hass.config_entries.async_loaded_entries(DOMAIN)}
    pack, target = entries.get(pack_cc), entries.get(target_cc)
    if pack is None or target is None or kind_of(pack) != KIND_PACK or kind_of(target) == KIND_PACK:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="transfer_invalid")
    source, dest = pack.runtime_data.resettable, target.runtime_data.resettable
    content = (source["content"].native_value or "").strip()
    if not content or (dest["content"].native_value or "").strip():
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="transfer_invalid")
    await dest["content"].async_set_value(content)
    await dest["content"].async_set_product(source["content"].product)
    await dest["filled_at"].async_set_value(dt_util.now())
    printed: date | None = source["best_before"].native_value
    best: date | None = None
    if (await async_get_estimator(hass)).enabled:
        try:
            await dest["best_before"].async_estimate_best_before(overwrite=True)
            best = dest["best_before"].native_value
        except HomeAssistantError:
            _LOGGER.debug("MHD nach dem Umfüllen nicht geschätzt", exc_info=True)
    # geöffnet hält es höchstens so lange wie aufgedruckt
    if printed is not None and (best is None or printed < best):
        await dest["best_before"].async_set_value(printed)
        best = printed
    left = int(source["portions"].native_value or 0) - 1
    if left >= 1:
        await source["portions"].async_set_native_value(float(left))
    else:
        await async_dispose(hass, pack.entry_id, remember=False)
    return {"left": max(left, 0), "best_before": best.isoformat() if best else None}


# ---------- WebSocket ----------

_ITEM = vol.Schema(
    {
        vol.Required("content"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Optional("name"): vol.All(str, vol.Length(max=80)),
        vol.Optional("quantity"): vol.All(vol.Coerce(int), vol.Range(min=0, max=9999)),
        vol.Optional("unit"): vol.In(UNITS),
        vol.Optional("best_before"): vol.Coerce(date.fromisoformat),
        vol.Optional("vacuum"): bool,
        vol.Optional("product"): dict,
    }
)


def _cc_of(hass: HomeAssistant, device_id: str) -> str | None:
    device = dr.async_get(hass).async_get(device_id)
    return next((ident for domain, ident in (device.identifiers if device else ()) if domain == DOMAIN), None)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/create_items",
        vol.Required("kind"): vol.In(DISPOSABLE_KINDS),
        vol.Required("items"): vol.All([_ITEM], vol.Length(min=1, max=MAX_ITEMS)),
        vol.Optional("area_id"): vol.Any(str, None),
        vol.Optional("compartment"): vol.All(str, vol.Length(max=60)),
    }
)
@websocket_api.async_response
async def ws_create_items(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Beutel oder Packungen anlegen (für alle Nutzer: gehört zum Alltag wie das Befüllen)."""
    try:
        created = await async_create_items(hass, msg["kind"], msg["items"], msg.get("area_id"), msg.get("compartment"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "create_failed", str(err))
        return
    connection.send_result(msg["id"], {"items": created})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/transfer",
        vol.Required("device_id"): str,
        vol.Required("target"): str,
    }
)
@websocket_api.async_response
async def ws_transfer(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    pack, target = _cc_of(hass, msg["device_id"]), _cc_of(hass, msg["target"])
    try:
        if not pack or not target:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="transfer_invalid")
        result = await async_transfer(hass, pack, target)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "transfer_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@callback
def async_setup_disposable_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WS):
        return
    websocket_api.async_register_command(hass, ws_create_items)
    websocket_api.async_register_command(hass, ws_transfer)
    domain_data[DATA_WS] = True


