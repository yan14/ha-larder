"""Sensor 'Tage bis MHD': positive Zahl = noch haltbar, negative = abgelaufen."""

from __future__ import annotations

from datetime import date
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, UnitOfTime
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import (
    TrackStates,
    async_track_state_change_filtered,
    async_track_time_change,
)

from .const import DOMAIN
from .entity import ZwillingConfigEntry, ZwillingEntity
from .expiry import days_left, status_for


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingDaysLeftSensor(entry)])


class ZwillingDaysLeftSensor(SensorEntity, ZwillingEntity):
    """Verbleibende Tage bis zum MHD; das Attribut `status` ist ok, soon, expired oder none."""

    _key = "days_left"
    _attr_native_unit_of_measurement = UnitOfTime.DAYS
    _attr_suggested_display_precision = 0

    def __init__(self, entry: ZwillingConfigEntry) -> None:
        super().__init__(entry)
        self._best_before: date | None = None

    async def async_added_to_hass(self) -> None:
        # Der Wert ergibt sich aus der MHD-Entität, nichts muss wiederhergestellt werden.
        self.async_on_remove(
            async_track_state_change_filtered(
                self.hass, TrackStates(False, set(), {"date"}), self._date_changed
            ).async_remove
        )
        # Nach Mitternacht ändern sich die Tage, ohne dass sich das MHD ändert.
        self.async_on_remove(
            async_track_time_change(self.hass, self._midnight, hour=0, minute=0, second=5)
        )
        self._refresh()

    @property
    def _date_entity_id(self) -> str | None:
        return er.async_get(self.hass).async_get_entity_id(
            "date", DOMAIN, f"{self._cc}_best_before"
        )

    def _refresh(self) -> None:
        state = self.hass.states.get(self._date_entity_id) if self._date_entity_id else None
        best: date | None = None
        if state is not None and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            try:
                best = date.fromisoformat(state.state)
            except ValueError:
                best = None
        self._best_before = best
        if self.hass is not None and self.entity_id:
            self.async_write_ha_state()

    @callback
    def _date_changed(self, event: Event[EventStateChangedData]) -> None:
        if event.data["entity_id"] == self._date_entity_id:
            self._refresh()

    @callback
    def _midnight(self, _now: Any) -> None:
        self._refresh()

    @property
    def native_value(self) -> int | None:
        return None if self._best_before is None else days_left(self._best_before)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        value = self.native_value
        return {
            "status": status_for(value),
            "best_before": self._best_before.isoformat() if self._best_before else None,
        }
