"""Schalter 'Vakuum': ist die Dose vakuumiert? Wird beim Leeren bewusst NICHT zurückgesetzt."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import LarderConfigEntry, LarderEntity
from .estimate import async_get_estimator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([LarderVacuumSwitch(entry)])


class LarderVacuumSwitch(SwitchEntity, LarderEntity):
    """Eigenschaft der Dose (nicht des Inhalts): vakuumiert oder normale Box.

    Eine neue Dose startet mit der Vorbelegung aus den Einstellungen (Standard: an, die
    Zwilling-Dosen sind Vakuumdosen). Danach bleibt der Wert über Neustarts erhalten und
    folgt späteren Änderungen der Vorbelegung nicht. 'Behälter leeren' ändert ihn nicht, er ist deshalb nicht
    bei den zurücksetzbaren Entitäten registriert.
    """

    _key = "vacuum"
    _attr_is_on = True

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_is_on = last.state == "on"
        else:
            self._attr_is_on = (await async_get_estimator(self.hass)).vacuum_default

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()
