"""Compartments with their own NFC tag or QR label: scan → what is there, take or stocktake.

A *place* is area + compartment (e.g. "Basement · Top shelf"); without a compartment the whole area. Compartments are
not objects of their own in Home Assistant but the text in the "Compartment" field of the entries. Only the
tag that belongs to a place is remembered here. A scan fires `larder_compartment_scanned`, reports to an
open dashboard (series scan) or sends the scanning phone a notification that opens the compartment.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store

from .const import APP_URL_PREFIX, CONF_CC, DOMAIN, PANEL_URL_PATH
from .singleton import async_singleton

if TYPE_CHECKING:
    from .nfc import NfcTags

STORAGE_KEY = f"{DOMAIN}.places"
STORAGE_VERSION = 1
DATA_PLACES = "places"
EVENT_COMPARTMENT_SCANNED = f"{DOMAIN}_compartment_scanned"
MAX_COMPARTMENT = 60


def norm_compartment(value: str | None) -> str:
    return " ".join((value or "").split())[:MAX_COMPARTMENT]


def place_key(area_id: str | None, compartment: str | None) -> str:
    return f"{area_id or ''}|{norm_compartment(compartment).casefold()}"


def place_path(area_id: str | None, compartment: str | None) -> str:
    """Open the dashboard at the compartment."""
    return f"/{PANEL_URL_PATH}?" + urlencode({"place": area_id or "-", "compartment": norm_compartment(compartment)})


def place_app_url(area_id: str | None, compartment: str | None) -> str:
    """Content of a compartment's QR label (opens the compartment in the Home Assistant app)."""
    return f"{APP_URL_PREFIX}{place_path(area_id, compartment)}"


def place_name(hass: HomeAssistant, area_id: str | None, compartment: str | None) -> str:
    area = ar.async_get(hass).async_get_area(area_id) if area_id else None
    parts = [area.name if area else None, norm_compartment(compartment) or None]
    name = " · ".join(p for p in parts if p)
    if name:
        return name
    return "Ohne Bereich" if (hass.config.language or "en").lower().startswith("de") else "No area"


def items_at(hass: HomeAssistant, area_id: str | None, compartment: str | None) -> list[str]:
    """Contents of all filled entries at this place (without a compartment: the whole area)."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    wanted = norm_compartment(compartment).casefold()
    out = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        device = devices.async_get_device(identifiers={(DOMAIN, cc)}) if cc else None
        if device is None or (device.area_id or None) != (area_id or None):
            continue
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        content = hass.states.get(content_id) if content_id else None
        if content is None or content.state in (STATE_UNKNOWN, STATE_UNAVAILABLE) or not content.state.strip():
            continue
        if wanted:
            comp_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_compartment")
            comp = hass.states.get(comp_id) if comp_id else None
            if comp is None or norm_compartment(comp.state).casefold() != wanted:
                continue
        out.append(content.state.strip())
    return sorted(out, key=str.casefold)


class PlaceError(HomeAssistantError):
    def __init__(self, key: str, **placeholders: str) -> None:
        super().__init__(translation_domain=DOMAIN, translation_key=key, translation_placeholders=placeholders or None)


class PlaceTags:
    """Mapping tag ID → place (area + compartment)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, dict[str, str]]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._tags: dict[str, dict[str, str]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._tags = {str(k): v for k, v in data.items() if isinstance(v, dict)}

    def by_tag(self, tag_id: str) -> dict[str, str] | None:
        return self._tags.get(tag_id)

    def links(self) -> list[dict[str, str]]:
        return [{"tag_id": tag, "area_id": p.get("area_id") or "", "compartment": p.get("compartment", "")} for tag, p in self._tags.items()]

    def tag_of(self, area_id: str | None, compartment: str | None) -> str | None:
        key = place_key(area_id, compartment)
        return next((t for t, p in self._tags.items() if place_key(p.get("area_id"), p.get("compartment")) == key), None)

    async def async_link(self, tag_id: str, area_id: str | None, compartment: str | None, nfc: NfcTags) -> None:
        """Link a tag with a place (one tag per place; a container's tag stays with the container)."""
        tag_id = tag_id.strip()
        if not tag_id:
            raise PlaceError("nfc_no_tag")
        if area_id and ar.async_get(self.hass).async_get_area(area_id) is None:
            raise PlaceError("place_unknown_area")
        if tag_id in nfc.links().values():
            raise PlaceError("place_tag_container")
        other = self._tags.get(tag_id)
        if other and place_key(other.get("area_id"), other.get("compartment")) != place_key(area_id, compartment):
            raise PlaceError("place_tag_in_use", name=place_name(self.hass, other.get("area_id"), other.get("compartment")))
        key = place_key(area_id, compartment)
        self._tags = {t: p for t, p in self._tags.items() if place_key(p.get("area_id"), p.get("compartment")) != key}
        self._tags[tag_id] = {"area_id": area_id or "", "compartment": norm_compartment(compartment)}
        await self._store.async_save(self._tags)

    async def async_unlink(self, area_id: str | None, compartment: str | None) -> None:
        key = place_key(area_id, compartment)
        before = len(self._tags)
        self._tags = {t: p for t, p in self._tags.items() if place_key(p.get("area_id"), p.get("compartment")) != key}
        if len(self._tags) != before:
            await self._store.async_save(self._tags)

    def scan_data(self, place: dict[str, str], scanner: str | None, source: str = "nfc") -> dict[str, Any]:
        area_id = place.get("area_id") or None
        compartment = place.get("compartment", "")
        return {
            "place": True,
            "area_id": area_id,
            "compartment": compartment,
            "name": place_name(self.hass, area_id, compartment),
            "items": items_at(self.hass, area_id, compartment),
            "scanned_by": scanner,
            "source": source,
        }

    def message(self, data: dict[str, Any]) -> str:
        de = (self.hass.config.language or "en").lower().startswith("de")
        items = data["items"]
        if not items:
            return "Hier liegt laut Larder nichts." if de else "Nothing here according to Larder."
        shown = ", ".join(items[:5]) + (" …" if len(items) > 5 else "")
        return f"{len(items)} {'Einträge' if de else 'entries'}: {shown}"


async def async_get_places(hass: HomeAssistant) -> PlaceTags:
    async def create() -> PlaceTags:
        places = PlaceTags(hass)
        await places.async_load()
        return places

    return await async_singleton(hass, DATA_PLACES, create)


# ---------- WebSocket ----------

_PLACE = {
    vol.Optional("area_id", default=""): vol.Any(str, None),
    vol.Optional("compartment", default=""): vol.All(str, vol.Length(max=MAX_COMPARTMENT)),
}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/place_tags"})
@websocket_api.async_response
async def ws_place_tags(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"links": (await async_get_places(hass)).links()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/place_link", vol.Required("tag_id"): str, **_PLACE})
@websocket_api.async_response
async def ws_place_link(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Link a compartment with a tag (anyone in the household, as with bags)."""
    from .nfc import async_get_nfc  # noqa: PLC0415 - avoids an import cycle

    places = await async_get_places(hass)
    try:
        await places.async_link(msg["tag_id"], msg["area_id"] or None, msg["compartment"], await async_get_nfc(hass))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "place_failed", str(err))
        return
    connection.send_result(msg["id"], {"links": places.links()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/place_unlink", **_PLACE})
@websocket_api.async_response
async def ws_place_unlink(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    places = await async_get_places(hass)
    await places.async_unlink(msg["area_id"] or None, msg["compartment"])
    connection.send_result(msg["id"], {"links": places.links()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/report_place_scan", **_PLACE})
@websocket_api.async_response
async def ws_report_place_scan(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A compartment's QR label was scanned (the dashboard reports it): event as with NFC."""
    places = await async_get_places(hass)
    data = places.scan_data({"area_id": msg["area_id"] or "", "compartment": msg["compartment"]}, None, "qr")
    data["user_id"] = connection.user.id if connection.user else None
    hass.bus.async_fire(EVENT_COMPARTMENT_SCANNED, data)
    connection.send_result(msg["id"], {"name": data["name"]})


@callback
def async_setup_place_websocket(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("place_ws"):
        return
    hass.data[DOMAIN]["place_ws"] = True
    for command in (ws_place_tags, ws_place_link, ws_place_unlink, ws_report_place_scan):
        websocket_api.async_register_command(hass, command)
