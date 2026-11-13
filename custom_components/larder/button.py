"""Button 'Behälter leeren': setzt Inhalt, MHD und Befüllt-am der Dose zurück."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import LarderConfigEntry, LarderEntity, LarderRuntime
from .estimate import storage_context
from .history import async_get_history, build_record
from .shelf_life import split_items
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
        history = await async_get_history(self.hass)
        record = self._history_record(history.pop_pending(self._cc))
        for entity in entities:
            await entity.async_reset()
        await self._async_return_home()
        if record is not None:
            history.add(record)
        if item:
            for part in split_items(item[1]):  # "Salami, Leberwurst" → zwei Einträge
                await async_add_to_shopping_list(self.hass, item[0], part)

    def _history_record(self, outcome: str | None) -> dict | None:
        """Was gerade drin ist, für den Verlauf (None bei leerer Dose)."""

        def value(platform: str, key: str) -> str | None:
            state = self._sibling_state(platform, key)
            if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
                return None
            return state.state

        content = (value("text", "content") or "").strip()
        if not content:
            return None
        try:
            quantity = int(float(value("number", "portions") or 0))
        except ValueError:
            quantity = 0
        return build_record(
            cc=self._cc,
            name=self._entry_title(),
            content=content,
            quantity=quantity,
            unit=value("select", "unit"),
            area=storage_context(self.hass, self._cc).area_name,
            filled_at=value("datetime", "filled_at"),
            best_before=value("date", "best_before"),
            outcome=outcome,
            compartment=value("text", "compartment"),
            product=self._product_data(),
        )

    def _product_data(self) -> dict | None:
        """Produktdaten und Nährwerte des Inhalts (für Verlauf und spätere Statistik)."""
        content = self._runtime.resettable.get("content")
        return getattr(content, "product", None) or None

    def _entry_title(self) -> str:
        device = dr.async_get(self.hass).async_get_device(identifiers={(DOMAIN, self._cc)})
        if device is not None:
            return device.name_by_user or device.name or self._cc
        return self._cc

    async def _async_return_home(self) -> None:
        """Variabler Lagerort mit festem "Lagerort nach dem Leeren": Dose dorthin zurückstellen."""
        flexible = self._sibling_state("switch", "flexible")
        home = self._sibling_state("select", "home_area")
        if flexible is None or flexible.state != STATE_ON or home is None:
            return
        area_id = home.attributes.get("area_id")
        if not area_id or ar.async_get(self.hass).async_get_area(area_id) is None:
            return
        registry = dr.async_get(self.hass)
        device = registry.async_get_device(identifiers={(DOMAIN, self._cc)})
        if device is not None and device.area_id != area_id:
            registry.async_update_device(device.id, area_id=area_id)
            # zurück am festen Platz: das Fach vom vorigen Ort gilt nicht mehr
            compartment = self._sibling_state("text", "compartment")
            if compartment is not None and compartment.state not in ("", STATE_UNKNOWN, STATE_UNAVAILABLE):
                await self.hass.services.async_call(
                    "text", "set_value", {"entity_id": compartment.entity_id, "value": ""}, blocking=True
                )

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
