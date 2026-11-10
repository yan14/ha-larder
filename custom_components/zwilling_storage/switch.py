"""Schalter 'Vakuum': ist die Dose vakuumiert? Wird beim Leeren bewusst NICHT zurückgesetzt."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import ZwillingConfigEntry, ZwillingEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingVacuumSwitch(entry)])


class ZwillingVacuumSwitch(SwitchEntity, ZwillingEntity):
    """Eigenschaft der Dose (nicht des Inhalts): vakuumiert oder normale Box.

    Der Schalter ist standardmäßig an (die Zwilling-Dosen sind Vakuumdosen) und bleibt
    über Neustarts erhalten. 'Behälter leeren' ändert ihn nicht, er ist deshalb nicht
    bei den zurücksetzbaren Entitäten registriert.
    """

    _key = "vacuum"
    _attr_is_on = True

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_is_on = last.state == "on"

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()
