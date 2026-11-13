"""Auswahlen der Dose: 'Einheit' der Menge und 'Lagerort nach dem Leeren' (bei variablem Lagerort)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DEFAULT_UNIT, UNITS
from .entity import LarderConfigEntry, LarderEntity, LarderResettable

HOME_NONE = "none"  # kein fester Lagerort: die Dose bleibt beim Leeren, wo sie ist


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    unit = LarderUnit(entry)
    entry.runtime_data.resettable[unit._key] = unit
    async_add_entities([unit, LarderHomeArea(entry)])


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


class LarderHomeArea(SelectEntity, LarderEntity):
    """Bereich, in den die Dose beim Leeren zurückkommt (nur bei variablem Lagerort wirksam).

    Die Auswahl zeigt die Namen der Bereiche; gespeichert wird die Bereichs-ID (Attribut ``area_id``),
    damit ein Umbenennen des Bereichs nichts kaputt macht. "Behälter leeren" ändert den Wert nicht.
    """

    _key = "home_area"
    _attr_current_option: str | None = HOME_NONE

    def __init__(self, entry: LarderConfigEntry) -> None:
        super().__init__(entry)
        self._area_id: str | None = None
        self._attr_options = [HOME_NONE]

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._area_id = last.attributes.get("area_id") or None
        else:
            self._area_id = self._initial.get("home_area") or None
        self._refresh()
        self.async_on_remove(self.hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, self._areas_changed))

    @callback
    def _areas_changed(self, _event: Event) -> None:
        self._refresh()
        self.async_write_ha_state()

    @callback
    def _refresh(self) -> None:
        areas = sorted(ar.async_get(self.hass).async_list_areas(), key=lambda a: a.name.casefold())
        self._attr_options = [HOME_NONE, *(a.name for a in areas)]
        area = ar.async_get(self.hass).async_get_area(self._area_id) if self._area_id else None
        if area is None:
            self._area_id = None
        self._attr_current_option = area.name if area else HOME_NONE

    @property
    def area_id(self) -> str | None:
        return self._area_id

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"area_id": self._area_id}

    async def async_select_option(self, option: str) -> None:
        if option == HOME_NONE:
            self._area_id = None
        else:
            area = ar.async_get(self.hass).async_get_area_by_name(option)
            self._area_id = area.id if area else None
        self._refresh()
        self.async_write_ha_state()
