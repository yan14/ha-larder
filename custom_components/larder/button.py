"""Button 'Empty container': resets content, best-before date and fill date."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DATA_STOCK, DISPOSABLE_KINDS, DOMAIN
from .devices import device_of
from .entity import LarderConfigEntry, LarderEntity, LarderRuntime
from .estimate import storage_context
from .history import async_get_history, build_record
from .shelf_life import split_items
from .shopping import async_add_to_shopping_list, shopping_list_for


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([LarderEmptyButton(entry)])


class LarderEmptyButton(ButtonEntity, LarderEntity):
    """Empty the container: content, best-before date and 'Filled at' are reset."""

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
        details = self._shopping_details() if item else ""  # before emptying, afterwards the product data is gone
        product = {k: v for k, v in (self._product_data() or {}).items() if k in ("brand", "package", "ean", "kcal_100g", "kcal_portion", "nutri_score", "allergens", "nutrients", "source")}
        history = await async_get_history(self.hass)
        record = self._history_record(history.pop_pending(self._cc))
        for entity in entities:
            await entity.async_reset()
        await self._async_return_home()
        if record is not None:
            history.add(record)
        if item:
            parts = split_items(item[1])  # "Salami, Leberwurst" → two entries
            for part in parts:
                # brand/package only for a single content; with "Salami, Leberwurst" they belong to neither
                text = f"{part} ({details})" if details and len(parts) == 1 else part
                if await async_add_to_shopping_list(self.hass, item[0], text) and (stock := self.hass.data.get(DOMAIN, {}).get(DATA_STOCK)):
                    stock.track(text, {"content": part, "product": product if len(parts) == 1 else {}, "area_id": None, "compartment": "", "count": 1, "source": "emptied"}, item[0])
        if self._kind in DISPOSABLE_KINDS:
            # bags and packs are gone after emptying (as a task of its own: the entity removes itself)
            from .disposable import async_dispose  # noqa: PLC0415 - avoids an import cycle

            self.hass.async_create_task(
                async_dispose(self.hass, self._entry_id, record["content"] if record else ""),
                f"{DOMAIN}_dispose_{self._cc}",
            )

    def _history_record(self, outcome: str | None) -> dict | None:
        """What is inside right now, for the history (None for an empty container)."""

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
            product=self._product_with_price(content),
            kind=self._kind,
            vacuum=None if (vac := self._sibling_state("switch", "vacuum")) is None else vac.state == STATE_ON,
        )

    def _product_data(self) -> dict | None:
        """Product data and nutrition of the content (for the history and later statistics)."""
        content = self._runtime.resettable.get("content")
        return getattr(content, "product", None) or None

    def _product_with_price(self, content: str) -> dict | None:
        """Product data for the history; without an own price the remembered price of the product (for "thrown away in €")."""
        product = dict(self._product_data() or {})
        stock = self.hass.data.get(DOMAIN, {}).get(DATA_STOCK)
        if "price" not in product and stock is not None and self._kind != "container":
            from .stock import product_key  # noqa: PLC0415 - avoids an import cycle

            if remembered := stock.prices.get(product_key(content)):
                product["price"] = remembered["price"]
                product["price_source"] = remembered.get("source")
        return product or None

    def _entry_title(self) -> str:
        device = device_of(self.hass, self._cc)
        if device is not None:
            return device.name_by_user or device.name or self._cc
        return self._cc

    async def _async_return_home(self) -> None:
        """Variable storage place with a fixed "place after emptying": put the container back there."""
        flexible = self._sibling_state("switch", "flexible")
        home = self._sibling_state("select", "home_area")
        if flexible is None or flexible.state != STATE_ON or home is None:
            return
        area_id = home.attributes.get("area_id")
        if not area_id or ar.async_get(self.hass).async_get_area(area_id) is None:
            return
        registry = dr.async_get(self.hass)
        device = device_of(self.hass, self._cc)
        if device is not None and device.area_id != area_id:
            registry.async_update_device(device.id, area_id=area_id)
            # back at its fixed place: the compartment of the previous place no longer applies
            compartment = self._sibling_state("text", "compartment")
            if compartment is not None and compartment.state not in ("", STATE_UNKNOWN, STATE_UNAVAILABLE):
                await self.hass.services.async_call(
                    "text", "set_value", {"entity_id": compartment.entity_id, "value": ""}, blocking=True
                )

    def _shopping_details(self) -> str:
        """Brand and package for the shopping list ("Kölln, 500 g"), if known and switched on."""
        estimator = self.hass.data.get(DOMAIN, {}).get("estimator")
        if not getattr(estimator, "shopping_details", True):
            return ""
        product = self._product_data() or {}
        return ", ".join(str(product[k]).strip() for k in ("brand", "package") if str(product.get(k) or "").strip())

    def _shopping_item(self) -> tuple[str, str] | None:
        """(To-do list, item) if the container should put something on the list when emptied."""
        switch = self._sibling_state("switch", "shopping")
        if switch is None or switch.state != STATE_ON:
            return None
        content = self._sibling_state("text", "content")
        if content is None or content.state in (STATE_UNKNOWN, STATE_UNAVAILABLE) or not content.state.strip():
            return None
        todo = shopping_list_for(self.hass, content.state, self._kind)
        return (todo, content.state) if todo else None
