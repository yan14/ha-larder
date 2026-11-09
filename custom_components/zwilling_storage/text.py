"""Entität 'Inhalt' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import ZwillingEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingContent(entry)])


class ZwillingContent(TextEntity, ZwillingEntity):
    """Freitext: was ist in der Dose?"""

    _key = "content"
    _attr_native_max = 255
    _attr_native_value: str | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_native_value = last.state

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
