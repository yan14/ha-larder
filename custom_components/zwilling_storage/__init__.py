"""Zwilling Food Storage: pro Dose ein Gerät mit Befüll-Datum, Inhalt und Leeren-Button."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .const import DOMAIN, PLATFORMS
from .entity import ZwillingConfigEntry, ZwillingRuntime
from .scan import async_setup_webhook, async_teardown_webhook


async def async_setup_entry(hass: HomeAssistant, entry: ZwillingConfigEntry) -> bool:
    """Dose einrichten (der Scan-Webhook wird einmalig für alle Dosen registriert)."""
    entry.runtime_data = ZwillingRuntime()
    await async_setup_webhook(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ZwillingConfigEntry) -> bool:
    """Dose entladen; beim Entladen der letzten Dose wird der Webhook abgemeldet."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded and not any(
        other.entry_id != entry.entry_id
        for other in hass.config_entries.async_loaded_entries(DOMAIN)
    ):
        async_teardown_webhook(hass)
    return unloaded
