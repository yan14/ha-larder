"""Button 'Behälter leeren': setzt Inhalt, MHD und Befüllt-am der Dose zurück."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import ZwillingConfigEntry, ZwillingEntity, ZwillingRuntime


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingEmptyButton(entry)])


class ZwillingEmptyButton(ButtonEntity, ZwillingEntity):
    """Leert die Dose: Inhalt, MHD und 'Befüllt am' werden zurückgesetzt."""

    _key = "empty_container"

    def __init__(self, entry: ZwillingConfigEntry) -> None:
        super().__init__(entry)
        self._runtime: ZwillingRuntime = entry.runtime_data

    async def async_press(self) -> None:
        entities = list(self._runtime.resettable.values())
        if not entities:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="nothing_to_reset",
            )
        for entity in entities:
            await entity.async_reset()
