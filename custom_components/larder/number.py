"""Entität 'Portionen': wie viele Portionen sind in der Dose? (0 = nicht angegeben)"""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, KIND_PACK
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
        before = self._attr_native_value
        self._attr_native_value = value
        self.async_write_ha_state()
        if self._kind == KIND_PACK and 0 < value < (before or 0):
            # Packung entnommen: Mindestbestand prüfen (Einkaufsliste)
            from .stock import async_check_stock  # noqa: PLC0415 - vermeidet einen Import-Kreis

            content = self._sibling_state("text", "content")
            if content is not None:
                self.hass.async_create_task(async_check_stock(self.hass, content.state), f"{DOMAIN}_stock_{self._cc}")

    async def async_reset(self) -> None:
        await self.async_set_native_value(0)
