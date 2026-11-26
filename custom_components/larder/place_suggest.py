"""Where should it go? Compartment suggestion when filling, freezing or putting away (6.2, #160).

Order:
1. where exactly this product already is (the place with most of it),
2. else where it was last time (recently added, then the history of emptied entries),
3. only then – in the chosen area – the compartment with the least in it (Larder knows no sizes, so "most room"
   means the fewest entries).

Products are never merged: only the same product (case and spaces do not matter) counts.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er

from .const import CONF_CC, DOMAIN
from .devices import device_of
from .history import async_get_history
from .places import norm_compartment
from .stock import async_get_stock, product_key


def filled_places(hass: HomeAssistant, exclude_cc: str | None = None) -> list[tuple[str, str | None, str]]:
    """(content, area ID, compartment) of every filled entry."""
    registry = er.async_get(hass)
    out: list[tuple[str, str | None, str]] = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        cc = entry.data.get(CONF_CC)
        if not cc or cc == exclude_cc:
            continue
        content_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_content")
        content = hass.states.get(content_id) if content_id else None
        if content is None or content.state in (STATE_UNKNOWN, STATE_UNAVAILABLE) or not content.state.strip():
            continue
        device = device_of(hass, cc)
        comp_id = registry.async_get_entity_id("text", DOMAIN, f"{cc}_compartment")
        comp = hass.states.get(comp_id) if comp_id else None
        compartment = norm_compartment(comp.state if comp is not None and comp.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE) else "")
        out.append((content.state.strip(), device.area_id if device else None, compartment))
    return out


async def async_suggest_place(
    hass: HomeAssistant, content: str, area_id: str | None = None, exclude_cc: str | None = None
) -> dict[str, Any] | None:
    """{"area_id", "compartment", "reason": "same" | "before" | "free"} or None."""
    key = product_key(content)
    places = filled_places(hass, exclude_cc)
    if key:
        # 1. where the same product is now
        same = Counter(
            (a, c) for text, a, c in places if product_key(text) == key and a and (area_id is None or a == area_id)
        )
        if same:
            (a, c), _ = same.most_common(1)[0]
            return {"area_id": a, "compartment": c, "reason": "same"}
        # 2. where it was last time: recently added, then emptied entries
        stock = await async_get_stock(hass)
        for recent in stock.recent:
            if product_key(recent.get("content")) == key and recent.get("area_id") and area_id in (None, recent["area_id"]):
                return {"area_id": recent["area_id"], "compartment": norm_compartment(recent.get("compartment")), "reason": "before"}
        areas = ar.async_get(hass)
        by_name = {a.name.casefold(): a.id for a in areas.async_list_areas()}
        for record in reversed((await async_get_history(hass)).records):
            if product_key(record.get("content")) != key:
                continue
            found = by_name.get(str(record.get("area") or "").casefold())
            if found and area_id in (None, found):
                return {"area_id": found, "compartment": norm_compartment(record.get("compartment")), "reason": "before"}
    # 3. in the chosen area: the compartment with the least in it
    if area_id:
        counts = Counter(c for _, a, c in places if a == area_id and c)
        if counts:
            fewest = min(counts.items(), key=lambda kv: (kv[1], kv[0].casefold()))[0]
            return {"area_id": area_id, "compartment": fewest, "reason": "free"}
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/place_suggest",
        vol.Optional("content", default=""): vol.All(str, vol.Length(max=120)),
        vol.Optional("area_id"): vol.Any(None, str),
        vol.Optional("device_id"): str,
    }
)
@websocket_api.async_response
async def ws_place_suggest(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    exclude = None
    if msg.get("device_id"):
        from homeassistant.helpers import device_registry as dr  # noqa: PLC0415

        from .const import larder_id  # noqa: PLC0415

        device = dr.async_get(hass).async_get(msg["device_id"])
        exclude = larder_id(device) if device else None
    suggestion = await async_suggest_place(hass, msg["content"], msg.get("area_id") or None, exclude)
    connection.send_result(msg["id"], {"suggestion": suggestion})


def async_setup_place_suggest_websocket(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("place_suggest_ws"):
        return
    domain_data["place_suggest_ws"] = True
    websocket_api.async_register_command(hass, ws_place_suggest)
