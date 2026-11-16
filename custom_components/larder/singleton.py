"""Shared helpers: exactly one instance per Home Assistant run, also with concurrent setup.

Home Assistant sets up the containers (config entries) in parallel. Without a lock several
instances of e.g. the calendar sync could appear, all of which would then react to changes.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_singleton(hass: HomeAssistant, key: str, create: Callable[[], Awaitable[Any]]) -> Any:
    """Return the instance under `hass.data[DOMAIN][key]` and create it the first time (guarded)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if (instance := domain_data.get(key)) is not None:
        return instance
    lock: asyncio.Lock = domain_data.setdefault(f"{key}_lock", asyncio.Lock())
    async with lock:
        if (instance := domain_data.get(key)) is None:
            instance = await create()
            domain_data[key] = instance
        return instance
