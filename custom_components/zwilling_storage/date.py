"""Entität 'MHD' (Mindesthaltbarkeitsdatum, schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from datetime import date

from homeassistant.components.date import DateEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import ZwillingConfigEntry, ZwillingResettable


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    best_before = ZwillingBestBefore(entry)
    entry.runtime_data.resettable[best_before._key] = best_before
    async_add_entities([best_before])


class ZwillingBestBefore(DateEntity, ZwillingResettable):
    """Mindesthaltbarkeitsdatum des Inhalts."""

    _key = "best_before"
    _attr_native_value: date | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is None:
            return
        try:
            self._attr_native_value = date.fromisoformat(last.state)
        except ValueError:
            return

    async def async_set_value(self, value: date) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()

    async def async_reset(self) -> None:
        self._attr_native_value = None
        self.async_write_ha_state()
