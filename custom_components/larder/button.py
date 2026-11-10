"""Button 'Behälter leeren': setzt Inhalt, MHD und Befüllt-am der Dose zurück."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import LarderConfigEntry, LarderEntity, LarderRuntime


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([LarderEmptyButton(entry)])


class LarderEmptyButton(ButtonEntity, LarderEntity):
    """Leert die Dose: Inhalt, MHD und 'Befüllt am' werden zurückgesetzt."""

    _key = "empty_container"

    def __init__(self, entry: LarderConfigEntry) -> None:
        super().__init__(entry)
        self._runtime: LarderRuntime = entry.runtime_data

    async def async_press(self) -> None:
        entities = list(self._runtime.resettable.values())
        if not entities:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="nothing_to_reset",
            )
        for entity in entities:
            await entity.async_reset()
