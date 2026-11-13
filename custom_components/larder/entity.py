"""Gemeinsame Basis: Gerät, eindeutige IDs, Wiederherstellung des letzten Zustands."""

from __future__ import annotations

from dataclasses import dataclass, field

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import State
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.restore_state import RestoreEntity

from .const import CONF_CC, CONF_INITIAL, CONF_KIND, CONF_SIZE, CONF_TC, DOMAIN, KIND_CONTAINER, KINDS, MANUFACTURER


@dataclass
class LarderRuntime:
    """Laufzeitdaten einer Dose: die Entitäten, die 'Behälter leeren' zurücksetzt."""

    resettable: dict[str, LarderResettable] = field(default_factory=dict)


type LarderConfigEntry = ConfigEntry[LarderRuntime]

_MODELS = {"bag": "Bag", "pack": "Pack"}


def kind_of(entry: ConfigEntry) -> str:
    """Art des Eintrags: Dose (Vorgabe, auch für alle älteren Einträge), Beutel oder Packung."""
    kind = entry.data.get(CONF_KIND)
    return kind if kind in KINDS else KIND_CONTAINER


class LarderEntity(RestoreEntity):
    """Basis für alle Entitäten einer Dose (alle teilen sich ein Gerät)."""

    _attr_has_entity_name = True
    _key: str

    def __init__(self, entry: ConfigEntry) -> None:
        cc: str = entry.data[CONF_CC]
        self._cc = cc
        self._kind = kind_of(entry)
        self._entry_id = entry.entry_id
        # Vorgaben aus dem Anlegen-Dialog (Vakuum, Einkaufsliste, variabler Lagerort), nur beim ersten Start
        self._initial: dict = dict(entry.data.get(CONF_INITIAL) or {})
        tc: str | None = entry.data.get(CONF_TC)
        size: str | None = entry.data.get(CONF_SIZE)

        self._attr_unique_id = f"{cc}_{self._key}"
        self._attr_translation_key = self._key

        model = tc or _MODELS.get(self._kind, "Food Storage")
        if size:
            model = f"{model} ({size.upper()})"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, cc)},
            name=entry.title,
            manufacturer=MANUFACTURER if self._kind == KIND_CONTAINER and tc else "Larder",
            model=model,
            serial_number=cc,
        )

    def _sibling_state(self, domain: str, key: str) -> State | None:
        """Zustand einer anderen Entität derselben Dose (z. B. Inhalt, Vakuum)."""
        entity_id = er.async_get(self.hass).async_get_entity_id(
            domain, DOMAIN, f"{self._cc}_{key}"
        )
        return self.hass.states.get(entity_id) if entity_id else None

    async def _async_last_state(self) -> State | None:
        """Letzten gespeicherten Zustand liefern, sofern brauchbar."""
        last = await self.async_get_last_state()
        if last is None or last.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None
        return last


class LarderResettable(LarderEntity):
    """Entität, deren Wert 'Behälter leeren' zurücksetzt (Inhalt, MHD, Befüllt am)."""

    async def async_reset(self) -> None:
        raise NotImplementedError
