"""Entity 'Best before' (best-before date, writable, kept across restarts)."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components.date import DateEntity
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import (
    AddEntitiesCallback,
    async_get_current_platform,
)
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    SERVICE_CLEAR_BEST_BEFORE,
    SERVICE_ESTIMATE_BEST_BEFORE,
    SERVICE_MARK_OPENED,
    SERVICE_MARK_THAWED,
    SIGNAL_SETTINGS_CHANGED,
    SOON_DAYS,
)
from .entity import LarderConfigEntry, LarderResettable
from .estimate import (
    DATA_ESTIMATOR,
    EstimateError,
    async_get_estimator,
    estimate_best_before,
    storage_context,
)
from .expiry import soon_days
from .shelf_life import format_duration


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    best_before = LarderBestBefore(entry)
    entry.runtime_data.resettable[best_before._key] = best_before
    async_add_entities([best_before])

    platform = async_get_current_platform()
    # The date cannot be cleared through date.set_value, that is what this service is for.
    platform.async_register_entity_service(SERVICE_CLEAR_BEST_BEFORE, None, "async_reset")
    platform.async_register_entity_service(
        SERVICE_MARK_OPENED,
        {vol.Optional("days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=365))},
        "async_mark_opened",
        supports_response=SupportsResponse.OPTIONAL,
    )
    platform.async_register_entity_service(
        SERVICE_MARK_THAWED,
        {vol.Optional("days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=365))},
        "async_mark_thawed",
        supports_response=SupportsResponse.OPTIONAL,
    )
    platform.async_register_entity_service(
        SERVICE_ESTIMATE_BEST_BEFORE,
        {
            vol.Optional("apply", default=True): cv.boolean,
            vol.Optional("overwrite", default=False): cv.boolean,
        },
        "async_estimate_best_before",
        supports_response=SupportsResponse.OPTIONAL,
    )


class LarderBestBefore(DateEntity, LarderResettable):
    """Best-before date of the content."""

    _key = "best_before"
    _attr_native_value: date | None = None

    def __init__(self, entry: LarderConfigEntry) -> None:
        super().__init__(entry)
        self._lock = asyncio.Lock()
        # (key, fill date, applied date) of the last estimate; if the user corrects the
        # estimate later, the estimator remembers the new value.
        self._pending: tuple[str, date, date] | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_SETTINGS_CHANGED, self.async_write_ha_state
            )
        )
        if (last := await self._async_last_state()) is None:
            return
        try:
            self._attr_native_value = date.fromisoformat(last.state)
        except ValueError:
            return

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        estimator = self.hass.data.get(DOMAIN, {}).get(DATA_ESTIMATOR)
        return {
            "estimates": bool(estimator and estimator.enabled),
            # for the dashboards: medicines and household items warn earlier
            "soon_days": soon_days(self.hass, self._kind) if estimator else SOON_DAYS,
        }

    async def async_set_value(self, value: date) -> None:
        if self._pending is not None:
            key, base, applied = self._pending
            self._pending = None
            if value != applied:
                estimator = await async_get_estimator(self.hass)
                estimator.learn(key, (value - base).days)
        self._attr_native_value = value
        self.async_write_ha_state()

    async def async_reset(self) -> None:
        self._pending = None
        self._attr_native_value = None
        self.async_write_ha_state()

    def _filled_date(self) -> date:
        state = self._sibling_state("datetime", "filled_at")
        if state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            try:
                return dt_util.as_local(datetime.fromisoformat(state.state)).date()
            except ValueError:
                pass
        return dt_util.now().date()

    async def async_mark_opened(self, days: int | None = None) -> dict[str, Any]:
        """The container was opened: the date is shortened to at most `days` days from today.

        Without `days` (5.5): the shelf life after opening of what is inside (table from USDA FoodKeeper,
        else AI), only then the setting "shelf life after opening". Never longer than the date so far.
        """
        info: dict[str, Any] = {}
        if days is None:
            days, info = await self.async_opened_days()
        await self._remember_opened()
        return {**self._shorten(days), **info}

    async def _remember_opened(self) -> None:
        """5.6 (#152): note the day of opening on the contents (as opening a pack does), once."""
        entry = self.hass.config_entries.async_get_entry(self._entry_id)
        content = getattr(getattr(entry, "runtime_data", None), "resettable", {}).get("content") if entry else None
        if content is None or not (content.native_value or "").strip() or content.product.get("opened"):
            return
        await content.async_set_product({"opened": dt_util.now().date().isoformat()}, replace=False)

    async def async_opened_days(self) -> tuple[int, dict[str, Any]]:
        """Days after opening for the content of this container and where they come from."""
        estimator = await async_get_estimator(self.hass)
        content_state = self._sibling_state("text", "content")
        content = (
            content_state.state
            if content_state is not None and content_state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
            else ""
        )
        # 5.7 (#154): what the pack itself says comes first – for exactly this product
        from .stock import async_get_stock, product_key  # noqa: PLC0415

        stock = await async_get_stock(self.hass)
        if content.strip() and (own := stock.opened_after.get(product_key(content))):
            de = (self.hass.config.language or "en").lower().startswith("de")
            days = int(own["days"])
            when = format_duration(days, "de" if de else "en")
            origin = ("laut Packung" if de else "from the pack") if own.get("source") == "label" else ("eigene Angabe" if de else "your own value")
            tip = f"Nach dem Öffnen: {when} ({origin})." if de else f"After opening: {when} ({origin})."
            return days, {"source": "product", "tip": tip, "basis": own.get("name", content)}
        try:
            estimate = await estimator.async_estimate_opened(
                content=content, context=storage_context(self.hass, self._cc)
            )
        except EstimateError as err:
            return estimator.opened_days, {"source": "setting", "reason": err.translation_key}
        return estimate.days, {"source": estimate.source, "tip": estimate.tip, "basis": estimate.basis}

    async def async_mark_thawed(self, days: int | None = None) -> dict[str, Any]:
        """The content was thawed: the date is shortened to at most `days` days from today."""
        if days is None:
            days = (await async_get_estimator(self.hass)).thawed_days
        return self._shorten(days)

    def _shorten(self, days: int) -> dict[str, Any]:
        limit = dt_util.now().date() + timedelta(days=days)
        current = self._attr_native_value
        new = limit if current is None else min(current, limit)
        if new != current:
            self._pending = None
            self._attr_native_value = new
            self.async_write_ha_state()
        return {"best_before": new.isoformat(), "days": days, "shortened": new != current}

    async def async_estimate_best_before(
        self, apply: bool = True, overwrite: bool = False
    ) -> dict[str, Any]:
        """Estimate the best-before date by table/AI (service `larder.estimate_best_before`)."""
        async with self._lock:
            if self._attr_native_value is not None and not overwrite:
                return {
                    "status": "already_set",
                    "best_before": self._attr_native_value.isoformat(),
                    "applied": False,
                }

            estimator = await async_get_estimator(self.hass)
            content_state = self._sibling_state("text", "content")
            vacuum_state = self._sibling_state("switch", "vacuum")
            filled = self._filled_date()
            estimate = await estimator.async_estimate(
                content=content_state.state
                if content_state is not None
                and content_state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE)
                else "",
                context=storage_context(self.hass, self._cc),
                vacuum=vacuum_state is None or vacuum_state.state != "off",
                filled=filled,
            )
            best = estimate_best_before(filled, estimate.days)
            if apply:
                self._attr_native_value = best
                self._pending = (estimate.key, filled, best)
                self.async_write_ha_state()
            return {
                "status": "estimated",
                "best_before": best.isoformat(),
                "days": estimate.days,
                "tip": estimate.tip,
                "cached": estimate.cached,
                "source": estimate.source,
                "origin": estimate.origin,
                "basis": estimate.basis,
                "applied": apply,
            }
