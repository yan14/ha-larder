"""Looking up Larder entries and their devices by the entry's ID (cc), fast.

* `entry_of`: the config entry of an ID through an index (rebuilt when entries are set up or unloaded), instead of
  walking through every entry each time (5.4).
* `device_of`: its device. `DeviceRegistry.async_get_device(identifiers=…)` is deprecated since Home Assistant 2026.8
  (identifiers are only unique per config entry) and stops working in 2027.8; every Larder entry has exactly one
  device, so it is looked up through its config entry, which works in every version.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from .const import CONF_CC, DOMAIN

DATA_BY_CC = "entries_by_cc"


@callback
def async_invalidate_entries(hass: HomeAssistant) -> None:
    """Entries were set up, unloaded or removed: the index is built anew on the next lookup."""
    hass.data.get(DOMAIN, {}).pop(DATA_BY_CC, None)


def _index(hass: HomeAssistant) -> dict[str, ConfigEntry]:
    domain_data = hass.data.setdefault(DOMAIN, {})
    index = domain_data.get(DATA_BY_CC)
    if index is None:
        index = {e.data[CONF_CC]: e for e in hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_CC)}
        domain_data[DATA_BY_CC] = index
    return index


def entry_of(hass: HomeAssistant, cc: str | None) -> ConfigEntry | None:
    """The config entry of the Larder entry with this ID, or None."""
    if not cc:
        return None
    entry = _index(hass).get(cc)
    if entry is not None and hass.config_entries.async_get_entry(entry.entry_id) is entry:
        return entry
    async_invalidate_entries(hass)  # removed or added in the meantime: once more from scratch
    return _index(hass).get(cc)


def device_of(hass: HomeAssistant, cc: str | None, entry: ConfigEntry | None = None) -> dr.DeviceEntry | None:
    """The device of the entry with this ID, or None (pass the entry when it is at hand)."""
    if not cc:
        return None
    if entry is None:
        entry = entry_of(hass, cc)
    if entry is None:
        return None
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    return next((d for d in devices if (DOMAIN, cc) in d.identifiers), devices[0] if devices else None)
