"""Sidebar panel 'Larder': overview of all containers, updated live.

The panel is a small web component that reads the registries and states directly from the
Home Assistant frontend. New containers therefore appear at once, without any
configuration having to be regenerated.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN, PANEL_URL_PATH

PANEL_ELEMENT = "larder-dashboard"
STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_DIR = Path(__file__).parent / "frontend"

DATA_PANEL = "panel_registered"
DATA_STATIC = "static_registered"
DATA_CARD = "card_url"
DATA_PANEL_LOCK = "panel_lock"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the panel once (idempotent, no matter how many containers there are)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock: asyncio.Lock = domain_data.setdefault(DATA_PANEL_LOCK, asyncio.Lock())
    async with lock:
        if domain_data.get(DATA_PANEL):
            return

        if not domain_data.get(DATA_STATIC):
            await hass.http.async_register_static_paths(
                [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
            )
            domain_data[DATA_STATIC] = True

        integration = await async_get_integration(hass, DOMAIN)
        # Lovelace card "Larder: expires soon" (custom:larder-card), without having to add a resource
        if not domain_data.get(DATA_CARD):
            card_url = f"{STATIC_URL}/larder-card.js?v={integration.version}"
            frontend.add_extra_js_url(hass, card_url)
            domain_data[DATA_CARD] = card_url
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title="Larder",
            sidebar_icon="mdi:food-variant",
            module_url=f"{STATIC_URL}/{PANEL_ELEMENT}.js?v={integration.version}",
            require_admin=False,
        )
        domain_data[DATA_PANEL] = True


def async_teardown_panel(hass: HomeAssistant) -> None:
    """Remove the panels when the last container was unloaded."""
    domain_data = hass.data.get(DOMAIN, {})
    if card_url := domain_data.pop(DATA_CARD, None):
        frontend.remove_extra_js_url(hass, card_url)
    if domain_data.pop(DATA_PANEL, None):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
