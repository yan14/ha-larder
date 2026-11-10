"""Seitenleisten-Panel 'Zwilling Dosen': Übersicht aller Dosen, live aktualisiert.

Das Panel ist eine kleine Web-Komponente, die direkt die Registries und Zustände aus dem
Home-Assistant-Frontend liest. Neue Dosen erscheinen dadurch sofort, ohne dass irgendeine
Konfiguration neu erzeugt werden muss.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN

PANEL_URL_PATH = "zwilling-storage"
PANEL_ELEMENT = "zwilling-storage-panel"
STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_DIR = Path(__file__).parent / "frontend"

DATA_PANEL = "panel_registered"
DATA_STATIC = "static_registered"
DATA_PANEL_LOCK = "panel_lock"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Panel einmalig registrieren (idempotent, egal wie viele Dosen es gibt)."""
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
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title="Zwilling Dosen",
            sidebar_icon="mdi:food-variant",
            module_url=f"{STATIC_URL}/{PANEL_ELEMENT}.js?v={integration.version}",
            require_admin=False,
        )
        domain_data[DATA_PANEL] = True


def async_teardown_panel(hass: HomeAssistant) -> None:
    """Panel entfernen, wenn die letzte Dose entladen wurde."""
    domain_data = hass.data.get(DOMAIN, {})
    if domain_data.pop(DATA_PANEL, None):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
