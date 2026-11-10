"""Entität 'Befüllt am' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.datetime import DateTimeEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .entity import ZwillingConfigEntry, ZwillingResettable


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    filled_at = ZwillingFilledAt(entry)
    entry.runtime_data.resettable[filled_at._key] = filled_at
    async_add_entities([filled_at])


class ZwillingFilledAt(DateTimeEntity, ZwillingResettable):
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

    async def async_reset(self) -> None:
        self._attr_native_value = None
        self.async_write_ha_state()
