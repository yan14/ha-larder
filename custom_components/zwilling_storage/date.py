"""Entität 'MHD' (Mindesthaltbarkeitsdatum, schreibbar, bleibt über Neustarts erhalten)."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
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
    SIGNAL_SETTINGS_CHANGED,
)
from .entity import ZwillingConfigEntry, ZwillingResettable
from .estimate import (
    DATA_ESTIMATOR,
    async_get_estimator,
    estimate_best_before,
    storage_context,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    best_before = ZwillingBestBefore(entry)
    entry.runtime_data.resettable[best_before._key] = best_before
    async_add_entities([best_before])

    platform = async_get_current_platform()
    # Das Datum lässt sich über date.set_value nicht leeren, dafür gibt es diesen Service.
    platform.async_register_entity_service(SERVICE_CLEAR_BEST_BEFORE, None, "async_reset")
    platform.async_register_entity_service(
        SERVICE_ESTIMATE_BEST_BEFORE,
        {
            vol.Optional("apply", default=True): cv.boolean,
            vol.Optional("overwrite", default=False): cv.boolean,
        },
        "async_estimate_best_before",
        supports_response=SupportsResponse.OPTIONAL,
    )


class ZwillingBestBefore(DateEntity, ZwillingResettable):
    """Mindesthaltbarkeitsdatum des Inhalts."""

    _key = "best_before"
    _attr_native_value: date | None = None

    def __init__(self, entry: ZwillingConfigEntry) -> None:
        super().__init__(entry)
        self._lock = asyncio.Lock()
        # (Schlüssel, Befüll-Datum, übernommenes MHD) der letzten Schätzung; wird die
        # Schätzung später vom Nutzer korrigiert, merkt sich der Schätzer den neuen Wert.
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
        return {"ai_estimates": bool(estimator and estimator.ai_enabled)}

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

    async def async_estimate_best_before(
        self, apply: bool = True, overwrite: bool = False
    ) -> dict[str, Any]:
        """MHD per KI schätzen (Service `zwilling_storage.estimate_best_before`)."""
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
                "applied": apply,
            }
