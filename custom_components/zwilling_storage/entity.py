"""Gemeinsame Basis: Gerät, eindeutige IDs, Wiederherstellung des letzten Zustands."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import State
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.restore_state import RestoreEntity

from .const import CONF_CC, CONF_SIZE, CONF_TC, DOMAIN, MANUFACTURER


@dataclass
class ZwillingRuntime:
    """Laufzeitdaten einer Dose: Verweis auf die Inhalt-Entität (setzt die text-Plattform)."""

    content: ZwillingEntity | None = None


type ZwillingConfigEntry = ConfigEntry[ZwillingRuntime]


class ZwillingEntity(RestoreEntity):
    """Basis für alle Entitäten einer Dose (alle teilen sich ein Gerät)."""

    _attr_has_entity_name = True
    _key: str

    def __init__(self, entry: ConfigEntry) -> None:
        cc: str = entry.data[CONF_CC]
        tc: str | None = entry.data.get(CONF_TC)
        size: str | None = entry.data.get(CONF_SIZE)

        self._attr_unique_id = f"{cc}_{self._key}"
        self._attr_translation_key = self._key

        model = tc or "Food Storage"
        if size:
            model = f"{model} ({size.upper()})"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, cc)},
            name=entry.title,
            manufacturer=MANUFACTURER,
            model=model,
            serial_number=cc,
        )

    async def _async_last_state(self) -> State | None:
        """Letzten gespeicherten Zustand liefern, sofern brauchbar."""
        last = await self.async_get_last_state()
        if last is None or last.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None
        return last
