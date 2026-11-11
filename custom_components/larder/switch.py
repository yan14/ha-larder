"""Schalter 'Vakuum': ist die Dose vakuumiert? Wird beim Leeren bewusst NICHT zurückgesetzt."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_SETTINGS_CHANGED
from .entity import LarderConfigEntry, LarderEntity
from .estimate import async_get_estimator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([LarderVacuumSwitch(entry), LarderShoppingSwitch(entry)])


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


class LarderShoppingSwitch(SwitchEntity, LarderEntity):
    """Beim Leeren den Inhalt auf die Einkaufsliste setzen? Standard: aus.

    Gilt nur, wenn in den Einstellungen eine To-do-Liste gewählt ist (Attribut ``list``). Der Wert
    gehört zur Dose und bleibt beim Leeren erhalten, damit "Reis" immer nachgekauft wird, die
    "Pizza-Reste" aber nie.
    """

    _key = "shopping"
    _attr_is_on = False

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_SETTINGS_CHANGED, self.async_write_ha_state)
        )
        if (last := await self._async_last_state()) is not None:
            self._attr_is_on = last.state == "on"

    @property
    def extra_state_attributes(self) -> dict[str, str | None]:
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        return {"list": getattr(estimator, "todo_entity", None)}

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()
