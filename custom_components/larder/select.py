"""Selects of the container: 'Unit' of the quantity and 'Place after emptying' (with a variable storage place)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DEFAULT_UNIT, KIND_CONTAINER, UNITS
from .entity import LarderConfigEntry, LarderEntity, LarderResettable, kind_of

HOME_NONE = "none"  # no fixed storage place: the container stays where it is when emptied


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    unit = LarderUnit(entry)
    entry.runtime_data.resettable[unit._key] = unit
    async_add_entities([unit, LarderHomeArea(entry)] if kind_of(entry) == KIND_CONTAINER else [unit])


class LarderUnit(SelectEntity, LarderResettable):
    """Unit of the quantity of the content. 'Empty container' resets to 'portions'."""

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
    """Area the container returns to when emptied (only effective with a variable storage place).

    The select shows the names of the areas; the area ID is stored (attribute ``area_id``),
    so renaming the area breaks nothing. "Empty container" does not change the value.
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
