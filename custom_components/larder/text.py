"""Entity 'Content' (writable, kept across restarts)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DATA_STOCK,
    DOMAIN,
    KIND_CONTAINER,
    KIND_HOUSEHOLD,
    KIND_MEDICINE,
    KIND_VOUCHER,
    PACK_KINDS,
    SIGNAL_SETTINGS_CHANGED,
    SIGNAL_STOCK_CHANGED,
)
from .entity import LarderConfigEntry, LarderEntity, LarderResettable
from .estimate import DATA_ESTIMATOR, async_get_estimator
from .household import household_category, medicine_category
from .product import watched_allergens
from .sections import section_of
from .shelf_life import category_for
from .stock import product_key


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    content = LarderContent(entry)
    entry.runtime_data.resettable[content._key] = content
    async_add_entities([content, LarderCompartment(entry)])  # compartment also for bags and packs


# product data and nutrition of the content (from the barcode or by hand); belong to the content
PRODUCT_FIELDS: dict[str, type] = {
    "brand": str,
    "package": str,  # package size, e.g. "500 g"
    "ean": str,
    "kcal_100g": float,
    "kcal_portion": float,
    "nutrients": str,  # free text: fat, carbohydrates, sugar, protein, salt …
    "nutri_score": str,  # A–E
    "allergens": str,
    "source": str,  # "openfoodfacts" or empty (by hand)
    "opened": str,  # pack opened on (ISO date)
    "price": float,  # price per pack in euros
    "value": float,  # vouchers (4.8): remaining value
    "value_initial": float,  # vouchers: value at the start
    "price_source": str,  # "receipt", "own" or "openprices" (estimate)
    "store": str,  # 5.9 (#139): where it was bought (with the price)
    "pack_size": float,  # household items: pieces per pack (e.g. 8 rolls)
    "piece": str,  # household items: name of one piece (e.g. "Rollen")
    "pao": float,  # cosmetics and medicines: keeps this many months after opening (the jar symbol "12M")
    "table": str,  # 6.3 (#173): row of the shelf-life table from Open Food Facts (categories, labels)
}
_MAX_TEXT = 500


def clean_product(data: dict[str, Any]) -> dict[str, Any]:
    """Only known fields, numbers as numbers, empty values removed, Nutri-Score A–E."""
    out: dict[str, Any] = {}
    for key, kind in PRODUCT_FIELDS.items():
        value = data.get(key)
        if value is None or value == "":
            continue
        if kind is float:
            try:
                number = round(float(str(value).replace(",", ".")), 2 if key in ("price", "value", "value_initial") else 1)
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
    """Free text: what is in the container? Plus (optional) product data and nutrition as attributes."""

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
        # allergens in the household changed: recalculate the warning
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_SETTINGS_CHANGED, self.async_write_ha_state))
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_STOCK_CHANGED, self.async_write_ha_state))

    @property
    def product(self) -> dict[str, Any]:
        return dict(self._product)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Category (for categories and icons in the dashboard) and, if present, product data."""
        value = self._attr_native_value or ""
        stock = self.hass.data.get(DOMAIN, {}).get(DATA_STOCK)
        # 6.3 (#173/#174): the row chosen for the product (by you or from Open Food Facts) decides the category
        row = stock.table_row(value, self._product)[0] if stock is not None and value else self._product.get("table")
        category = (
            ("voucher" if self._kind == KIND_VOUCHER else household_category(value) if self._kind == KIND_HOUSEHOLD else medicine_category(value) if self._kind == KIND_MEDICINE else category_for(value, row))
            if value
            else None
        )
        attrs: dict[str, Any] = {"category": category, "kind": self._kind, **self._product}
        estimator = self.hass.data.get(DOMAIN, {}).get(DATA_ESTIMATOR)
        watched = getattr(estimator, "watch_allergens", None)
        if value and stock is not None and (own := stock.lists.get(product_key(value))):
            attrs["shopping_list"] = own  # own shopping list of the product (else the default list)
        if self._kind == KIND_VOUCHER:
            attrs.pop("code", None)  # the code is never in the state (visible to every user), see vouchers.py
        elif value:
            attrs["section"] = section_of(self.hass, value, self._kind)  # store section (4.7)
            if stock is not None and product_key(value) in stock.sections:
                attrs["section_own"] = True
        if self._kind in PACK_KINDS and stock is not None:
            attrs["min_stock"] = stock.minimum(value)  # minimum stock of the product (for the card)
            if (interval := stock.interval_info(value)) is not None:
                attrs["replace"] = interval  # replacement interval (weeks, last, due, days) for the card
            if (usage := stock.usage(value)) is not None:
                attrs["consumption_per_week"] = usage["per_week"]  # consumption of the product (for "lasts another …")
                attrs["consumption_basis"] = {"takes": usage["takes"], "days": usage["days"]}
            if "price" not in self._product and (price := stock.prices.get(product_key(value))):
                attrs["price_remembered"] = price["price"]
                attrs["price_remembered_source"] = price.get("source")
        if value and stock is not None and self._kind != KIND_VOUCHER:
            if step := stock.step_of(value):
                attrs["take_step"] = step  # 6.11 (#257): how much −1 takes
            if group := stock.group_of(value):
                attrs["group"] = group  # 6.11 (#254): parent product
        sizes = self.hass.data.get(DOMAIN, {}).get("sizes")
        if sizes is not None and self._kind == KIND_CONTAINER and (info := sizes.info(self._cc)):
            # container size: fixed at the container or (variable) that of the current filling
            attrs["size_variable"] = bool(info.get("variable"))
            if info.get("size"):
                attrs["size_fixed"] = info["size"]
            if info.get("last"):
                attrs["size_last"] = info["last"]
            if size := (info.get("current") if info.get("variable") and value.strip() else info.get("size")):
                attrs["size"] = size
        recalls = self.hass.data.get(DOMAIN, {}).get("recalls")
        stock_data = self.hass.data.get(DOMAIN, {}).get(DATA_STOCK)
        if recalls is not None and stock_data is not None and value.strip() and recalls.found:
            if warning := recalls.for_cc(self._cc, stock_data.recalls_read):
                attrs["recall"] = warning  # unread recall warning (hint on the card)
        if value.strip() and watched:
            warning = watched_allergens(value, self._product.get("allergens", ""), watched, self.hass.config.language or "en")
            if warning:
                attrs["allergen_warning"] = warning
        return attrs

    async def async_set_product(self, data: dict[str, Any], replace: bool = True) -> None:
        """Set product data (replace) or change single fields; empty values delete the field."""
        if replace:
            self._product = clean_product(data)
        else:
            merged = {**self._product, **data}
            self._product = clean_product({k: v for k, v in merged.items() if v not in (None, "")})
        self.async_write_ha_state()
        stock = self.hass.data.get(DOMAIN, {}).get(DATA_STOCK)
        self._remember_ean(stock)
        if stock is not None and self._kind in PACK_KINDS and self._product.get("price") and self._attr_native_value:
            # remember the price for the next purchase of this product (estimates from Open Prices only if there is nothing)
            stock.remember_price(
                self._attr_native_value, self._product["price"], self._product.get("price_source") or "own", self._product.get("store")
            )

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
        if value.strip():
            (await async_get_estimator(self.hass)).remember_content(value)
            self._remember_ean(self.hass.data.get(DOMAIN, {}).get(DATA_STOCK))

    def _remember_ean(self, stock) -> None:
        """Remember barcode → own name (a later scan finds the product even after renaming)."""
        if stock is not None and self._kind in PACK_KINDS and self._product.get("ean") and (self._attr_native_value or "").strip():
            stock.remember_ean(str(self._product["ean"]), self._attr_native_value)

    async def async_reset(self) -> None:
        self._product = {}
        await self.async_set_value("")


class LarderCompartment(TextEntity, LarderEntity):
    """Compartment within the area, e.g. "Drawer 2" in the freezer (optional).

    Belongs to the place of the container, not to the content: kept when emptying. If a variable container
    returns to its fixed place when emptied, the compartment is cleared.
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
