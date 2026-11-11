"""Gemeinsame Helfer: genau eine Instanz pro Home-Assistant-Lauf, auch bei gleichzeitiger Einrichtung.

Home Assistant richtet die Dosen (Config Entries) parallel ein. Ohne Sperre könnten dabei mehrere
Instanzen z. B. des Kalender-Abgleichs entstehen, die dann alle auf Änderungen reagieren.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_singleton(hass: HomeAssistant, key: str, create: Callable[[], Awaitable[Any]]) -> Any:
    """Instanz unter `hass.data[DOMAIN][key]` liefern und beim ersten Mal (geschützt) anlegen."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if (instance := domain_data.get(key)) is not None:
        return instance
    lock: asyncio.Lock = domain_data.setdefault(f"{key}_lock", asyncio.Lock())
    async with lock:
        if (instance := domain_data.get(key)) is None:
            instance = await create()
            domain_data[key] = instance
        return instance
