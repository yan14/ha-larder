"""Entität 'Befüllt am' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.datetime import DateTimeEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import (
    AddEntitiesCallback,
    async_get_current_platform,
)
from homeassistant.util import dt as dt_util

from .const import KIND_PACK, SERVICE_CLEAR_FILLED_AT
from .entity import LarderConfigEntry, LarderResettable, kind_of


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    if kind_of(entry) != KIND_PACK:  # Packungen: nur Inhalt, Menge und MHD
        filled_at = LarderFilledAt(entry)
        entry.runtime_data.resettable[filled_at._key] = filled_at
        async_add_entities([filled_at])
    async_get_current_platform().async_register_entity_service(
        SERVICE_CLEAR_FILLED_AT, None, "async_reset"
    )


class LarderFilledAt(DateTimeEntity, LarderResettable):
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
