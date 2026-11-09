"""Entität 'Befüllt am' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.datetime import DateTimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .entity import ZwillingEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingFilledAt(entry)])


class ZwillingFilledAt(DateTimeEntity, ZwillingEntity):
    """Datum/Uhrzeit, wann die Dose befüllt wurde."""

    _key = "filled_at"
    _attr_native_value: datetime | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is None:
            return
        if (value := dt_util.parse_datetime(last.state)) is None:
            return
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt_util.get_default_time_zone())
        self._attr_native_value = value

    async def async_set_value(self, value: datetime) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
