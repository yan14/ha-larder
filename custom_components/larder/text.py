"""Entität 'Inhalt' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import LarderConfigEntry, LarderResettable
from .estimate import async_get_estimator
from .shelf_life import find_entry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    content = LarderContent(entry)
    entry.runtime_data.resettable[content._key] = content
    async_add_entities([content])


class LarderContent(TextEntity, LarderResettable):
    """Freitext: was ist in der Dose?"""

    _key = "content"
    _attr_native_max = 255
    _attr_native_value: str | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_native_value = last.state

    @property
    def extra_state_attributes(self) -> dict[str, str | None]:
        """Kategorie des Inhalts laut Haltbarkeits-Tabelle (für Kategorien und Symbole im Dashboard)."""
        entry = find_entry(self._attr_native_value or "") if self._attr_native_value else None
        return {"category": entry.cat if entry else None}

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
        if value.strip():
            (await async_get_estimator(self.hass)).remember_content(value)

    async def async_reset(self) -> None:
        await self.async_set_value("")
