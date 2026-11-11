"""Entität 'Portionen': wie viele Portionen sind in der Dose? (0 = nicht angegeben)"""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import LarderConfigEntry, LarderResettable


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    portions = LarderPortions(entry)
    entry.runtime_data.resettable[portions._key] = portions
    async_add_entities([portions])


class LarderPortions(NumberEntity, LarderResettable):
    """Anzahl der Portionen im Inhalt. 0 heißt: nicht angegeben. 'Behälter leeren' setzt auf 0."""

    _key = "portions"
    _attr_native_min_value = 0
    _attr_native_max_value = 9999
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX
    _attr_native_value: float = 0

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is None:
            return
        try:
            self._attr_native_value = float(last.state)
        except ValueError:
            return

    async def async_set_native_value(self, value: float) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()

    async def async_reset(self) -> None:
        await self.async_set_native_value(0)
