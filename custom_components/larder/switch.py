"""Switch 'Vacuum': is the container vacuumed? Deliberately NOT reset when emptying."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, KIND_BAG, PACK_KINDS, SIGNAL_SETTINGS_CHANGED
from .entity import LarderConfigEntry, LarderEntity, kind_of
from .estimate import async_get_estimator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    kind = kind_of(entry)
    if kind in PACK_KINDS:
        return  # packs have no switches
    if kind == KIND_BAG:
        async_add_entities([LarderVacuumSwitch(entry)])  # disposable: no shopping list, no fixed place
        return
    async_add_entities([LarderVacuumSwitch(entry), LarderShoppingSwitch(entry), LarderFlexibleSwitch(entry)])


class LarderVacuumSwitch(SwitchEntity, LarderEntity):
    """Property of the container (not of the content): vacuumed or normal box.

    A new container starts with the default from the settings (default: on, the
    Zwilling containers are vacuum containers). After that the value is kept across restarts and
    does not follow later changes of the default. 'Empty container' does not change it, so it is not
    registered with the resettable entities.
    """

    _key = "vacuum"
    _attr_is_on = True

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_is_on = last.state == "on"
        elif "vacuum" in self._initial:
            self._attr_is_on = bool(self._initial["vacuum"])
        else:
            self._attr_is_on = (await async_get_estimator(self.hass)).vacuum_default

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()


class LarderShoppingSwitch(SwitchEntity, LarderEntity):
    """Put the content on the shopping list when emptying? Default: off.

    Only applies if a to-do list is chosen in the settings (attribute ``list``). The value
    belongs to the container and is kept when emptying, so "rice" is always bought again, the
    "Pizza leftovers" never.
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
        else:
            self._attr_is_on = bool(self._initial.get("shopping", False))

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


class LarderFlexibleSwitch(SwitchEntity, LarderEntity):
    """Variable storage place: the container is sometimes here, sometimes there (e.g. vacuum containers). Default: off.

    If on, the fill dialog asks for the area, and "Empty container" puts the container back
    into the "place after emptying" (if one is chosen). The value belongs to the container and is kept
    when emptying.
    """

    _key = "flexible"
    _attr_is_on = False

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_is_on = last.state == "on"
        else:
            self._attr_is_on = bool(self._initial.get("flexible", False))

    async def async_turn_on(self, **kwargs) -> None:
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        self._attr_is_on = False
        self.async_write_ha_state()
