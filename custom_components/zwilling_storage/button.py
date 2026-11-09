"""Button 'Behälter leeren': setzt das Textfeld 'Inhalt' auf leer."""

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
    """Leert die Dose: Inhalt-Textfeld wird auf einen leeren Text gesetzt."""

    _key = "empty_container"

    def __init__(self, entry: ZwillingConfigEntry) -> None:
        super().__init__(entry)
        self._runtime: ZwillingRuntime = entry.runtime_data

    async def async_press(self) -> None:
        content = self._runtime.content
        if content is None:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="content_entity_missing",
            )
        await content.async_set_value("")
