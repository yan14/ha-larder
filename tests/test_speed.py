"""Tests 5.4: speed – shared overview sensors, cached entry lookup, grouped takes."""

from datetime import timedelta
from unittest.mock import patch

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.larder.const import DOMAIN
from custom_components.larder.devices import DATA_BY_CC, entry_of
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .test_recipes import _fill, _setup, auto_enable_custom_integrations  # noqa: F401


async def test_overview_sensors_compute_once_per_change(hass: HomeAssistant, main_entry) -> None:
    await _setup(hass, "AAAA")
    await hass.async_block_till_done()
    from custom_components.larder import expiry

    calls = []
    real = expiry.collect_expiring

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    with patch.object(expiry, "collect_expiring", counting):
        await _fill(hass, "AAAA", "Lachs", -1)
        await _fill(hass, "AAAA", "Lachs2", -1)  # several changes within the debounce
        async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
        await hass.async_block_till_done()
    # one refresh for all five sensors instead of one per sensor and per change
    assert len(calls) == 1
    assert hass.states.get("sensor.larder_expired").state == "1"
    assert hass.states.get("sensor.larder_expiring_soon").state == "0"


async def test_entry_of_uses_index_and_follows_changes(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    assert entry_of(hass, "AAAA") is entry
    assert DATA_BY_CC in hass.data[DOMAIN]
    with patch.object(hass.config_entries, "async_entries", side_effect=AssertionError("no scan")):
        assert entry_of(hass, "AAAA") is entry  # from the index
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert entry_of(hass, "AAAA") is None
    other = await _setup(hass, "BBBB")
    assert entry_of(hass, "BBBB") is other
