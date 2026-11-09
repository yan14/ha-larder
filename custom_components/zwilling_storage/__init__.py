"""Zwilling Food Storage: pro Dose ein Gerät mit Befüll-Datum und Inhalt."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import PLATFORMS


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Plattformen für eine Dose einrichten."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Dose entladen."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
