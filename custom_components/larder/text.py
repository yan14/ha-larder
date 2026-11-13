"""Entität 'Inhalt' (schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_SETTINGS_CHANGED
from .entity import LarderConfigEntry, LarderEntity, LarderResettable
from .estimate import DATA_ESTIMATOR, async_get_estimator
from .product import watched_allergens
from .shelf_life import category_for


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    content = LarderContent(entry)
    entry.runtime_data.resettable[content._key] = content
    async_add_entities([content, LarderCompartment(entry)])  # Fach auch für Beutel und Packungen


# Produktdaten und Nährwerte des Inhalts (aus dem Strichcode oder von Hand); gehören zum Inhalt
PRODUCT_FIELDS: dict[str, type] = {
    "brand": str,
    "package": str,  # Packungsgröße, z. B. "500 g"
    "ean": str,
    "kcal_100g": float,
    "kcal_portion": float,
    "nutrients": str,  # Freitext: Fett, Kohlenhydrate, Zucker, Eiweiß, Salz …
    "nutri_score": str,  # A–E
    "allergens": str,
    "source": str,  # "openfoodfacts" oder leer (von Hand)
}
_MAX_TEXT = 500


def clean_product(data: dict[str, Any]) -> dict[str, Any]:
    """Nur bekannte Felder, Zahlen als Zahl, leere Werte weg, Nutri-Score A–E."""
    out: dict[str, Any] = {}
    for key, kind in PRODUCT_FIELDS.items():
        value = data.get(key)
        if value is None or value == "":
            continue
        if kind is float:
            try:
                number = round(float(str(value).replace(",", ".")), 1)
            except ValueError:
                continue
            if 0 <= number <= 10000:
                out[key] = int(number) if number.is_integer() else number
        else:
            text = " ".join(str(value).split())[:_MAX_TEXT]
            if key == "nutri_score":
                text = text.upper()
                if text not in ("A", "B", "C", "D", "E"):
                    continue
            if text:
                out[key] = text
    return out


class LarderContent(TextEntity, LarderResettable):
    """Freitext: was ist in der Dose? Dazu (optional) Produktdaten und Nährwerte als Attribute."""

    _key = "content"
    _attr_native_max = 255
    _attr_native_value: str | None = None

    def __init__(self, entry: LarderConfigEntry) -> None:
        super().__init__(entry)
        self._product: dict[str, Any] = {}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_native_value = last.state
            self._product = clean_product(dict(last.attributes))
        # Allergene im Haushalt geändert: Warnung neu berechnen
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_SETTINGS_CHANGED, self.async_write_ha_state))

    @property
    def product(self) -> dict[str, Any]:
        return dict(self._product)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Kategorie (für Kategorien und Symbole im Dashboard) und, falls vorhanden, Produktdaten."""
        value = self._attr_native_value or ""
        attrs: dict[str, Any] = {"category": category_for(value) if value else None, "kind": self._kind, **self._product}
        estimator = self.hass.data.get(DOMAIN, {}).get(DATA_ESTIMATOR)
        watched = getattr(estimator, "watch_allergens", None)
        if value.strip() and watched:
            warning = watched_allergens(value, self._product.get("allergens", ""), watched, self.hass.config.language or "en")
            if warning:
                attrs["allergen_warning"] = warning
        return attrs

    async def async_set_product(self, data: dict[str, Any], replace: bool = True) -> None:
        """Produktdaten setzen (replace) oder einzelne Felder ändern; leere Werte löschen das Feld."""
        if replace:
            self._product = clean_product(data)
        else:
            merged = {**self._product, **data}
            self._product = clean_product({k: v for k, v in merged.items() if v not in (None, "")})
        self.async_write_ha_state()

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
        if value.strip():
            (await async_get_estimator(self.hass)).remember_content(value)

    async def async_reset(self) -> None:
        self._product = {}
        await self.async_set_value("")


class LarderCompartment(TextEntity, LarderEntity):
    """Fach innerhalb des Bereichs, z. B. "Schublade 2" im Gefrierschrank (optional).

    Gehört zum Platz der Dose, nicht zum Inhalt: bleibt beim Leeren. Kommt eine variable Dose beim
    Leeren an ihren festen Platz zurück, wird das Fach geleert.
    """

    _key = "compartment"
    _attr_native_max = 60
    _attr_native_value: str | None = ""

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self._async_last_state()) is not None:
            self._attr_native_value = last.state

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value.strip()
        self.async_write_ha_state()
