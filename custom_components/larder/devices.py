"""The device of a Larder entry (container, bag, pack …) by its ID (cc).

`DeviceRegistry.async_get_device(identifiers=…)` is deprecated since Home Assistant 2026.8 (identifiers are only
unique per config entry) and stops working in 2027.8. Every Larder entry has exactly one device, so the device
is looked up through its config entry, which works in every version.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .const import CONF_CC, DOMAIN


def device_of(hass: HomeAssistant, cc: str | None, entry: ConfigEntry | None = None) -> dr.DeviceEntry | None:
    """The device of the entry with this ID, or None (pass the entry when it is at hand: faster in loops)."""
    if not cc:
        return None
    if entry is None:
        entry = next((e for e in hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_CC) == cc), None)
    if entry is None:
        return None
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    return next((d for d in devices if (DOMAIN, cc) in d.identifiers), devices[0] if devices else None)
