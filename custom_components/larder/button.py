"""Button 'Behälter leeren': setzt Inhalt, MHD und Befüllt-am der Dose zurück."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import LarderConfigEntry, LarderEntity, LarderRuntime
from .shopping import async_add_to_shopping_list


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
        item = self._shopping_item()
        for entity in entities:
            await entity.async_reset()
        if item:
            await async_add_to_shopping_list(self.hass, item[0], item[1])

    def _shopping_item(self) -> tuple[str, str] | None:
        """(To-do-Liste, Eintrag), wenn die Dose beim Leeren etwas auf die Liste setzen soll."""
        switch = self._sibling_state("switch", "shopping")
        if switch is None or switch.state != STATE_ON:
            return None
        todo = getattr(self.hass.data.get(DOMAIN, {}).get("estimator"), "todo_entity", None)
        content = self._sibling_state("text", "content")
        if not todo or content is None or content.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None
        return (todo, content.state) if content.state.strip() else None
