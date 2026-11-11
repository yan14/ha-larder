"""Auswahl 'Einheit' der Menge: Portionen, Stück, Scheiben, Gramm oder Milliliter."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DEFAULT_UNIT, UNITS
from .entity import LarderConfigEntry, LarderResettable


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    unit = LarderUnit(entry)
    entry.runtime_data.resettable[unit._key] = unit
    async_add_entities([unit])


class LarderUnit(SelectEntity, LarderResettable):
    """Einheit der Menge im Inhalt. 'Behälter leeren' setzt auf 'Portionen' zurück."""

    _key = "unit"
    _attr_options = UNITS
    _attr_current_option: str | None = DEFAULT_UNIT

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None and last.state in UNITS:
            self._attr_current_option = last.state

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self.async_write_ha_state()

    async def async_reset(self) -> None:
        await self.async_select_option(DEFAULT_UNIT)
