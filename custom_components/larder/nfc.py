"""NFC-Tags (und andere Home-Assistant-Tags) mit Dosen verknüpfen.

Home Assistant löst bei jedem Scan eines Tags das Ereignis `tag_scanned` aus (Daten: tag_id,
name, device_id des scannenden Geräts). Diese Integration merkt sich, welche Tag-ID zu welcher
Dose gehört. Wird ein verknüpfter Tag gescannt, passiert zweierlei:

* Das Ereignis `larder_dose_scanned` wird ausgelöst (für das Dashboard und Automationen).
* Das scannende Handy bekommt, falls es die Companion-App ist, eine Benachrichtigung, deren
  Antippen die Dose im Dashboard öffnet.

Unbekannte Tags werden ignoriert, damit andere NFC-Tags im Haus unberührt bleiben.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.storage import Store
from homeassistant.util import slugify

from .const import CONF_CC, DOMAIN, EVENT_DOSE_SCANNED, panel_path
from .estimate import async_get_estimator
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.nfc"
DATA_NFC = "nfc"
EVENT_TAG_SCANNED = "tag_scanned"


class NfcError(HomeAssistantError):
    """Verknüpfung nicht möglich; der Text kommt aus den Übersetzungen."""

    def __init__(self, key: str, **placeholders: str) -> None:
        super().__init__(
            translation_domain=DOMAIN,
            translation_key=key,
            translation_placeholders=placeholders or None,
        )


class NfcTags:
    """Zuordnung Tag-ID → Dose und Reaktion auf gescannte Tags."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, str]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._tags: dict[str, str] = {}  # tag_id -> cc
        self._unsub: CALLBACK_TYPE | None = None

    async def async_load(self) -> None:
        self._tags = (await self._store.async_load()) or {}

    @callback
    def async_start(self) -> None:
        if self._unsub is None:
            self._unsub = self.hass.bus.async_listen(EVENT_TAG_SCANNED, self._tag_scanned)

    @callback
    def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    # ----- Verknüpfungen -----

    def tag_of(self, cc: str) -> str | None:
        return next((tag for tag, linked in self._tags.items() if linked == cc), None)

    def links(self) -> dict[str, str]:
        """cc -> tag_id"""
        return {cc: tag for tag, cc in self._tags.items()}

    def links_by_device(self) -> dict[str, str]:
        """device_id der Dose -> tag_id (das Dashboard kennt Dosen nur über ihre Geräte-ID)."""
        registry = dr.async_get(self.hass)
        out: dict[str, str] = {}
        for tag, cc in self._tags.items():
            device = registry.async_get_device(identifiers={(DOMAIN, cc)})
            if device is not None:
                out[device.id] = tag
        return out

    def _entry(self, cc: str):
        return next(
            (e for e in self.hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_CC) == cc),
            None,
        )

    def resolve_cc(
        self, cc: str | None = None, entry_id: str | None = None, device_id: str | None = None
    ) -> str:
        """cc aus cc, Config-Entry-ID oder Geräte-ID bestimmen (das Dashboard kennt nur Letztere)."""
        if device_id:
            device = dr.async_get(self.hass).async_get(device_id)
            for domain, identifier in (device.identifiers if device else ()):
                if domain == DOMAIN and self._entry(identifier):
                    return identifier
        elif entry_id:
            entry = self.hass.config_entries.async_get_entry(entry_id)
            if entry and entry.domain == DOMAIN and entry.data.get(CONF_CC):
                return entry.data[CONF_CC]
        elif cc and self._entry(cc):
            return cc
        raise NfcError("nfc_unknown_container")

    async def async_link(self, tag_id: str, cc: str) -> None:
        """Tag mit einer Dose verknüpfen. Eine Dose hat höchstens einen Tag."""
        tag_id = tag_id.strip()
        if not tag_id:
            raise NfcError("nfc_no_tag")
        owner = self._tags.get(tag_id)
        if owner and owner != cc:
            entry = self._entry(owner)
            raise NfcError("nfc_tag_in_use", name=entry.title if entry else owner)
        for old in [t for t, linked in self._tags.items() if linked == cc]:
            del self._tags[old]
        self._tags[tag_id] = cc
        await self._store.async_save(self._tags)

    async def async_unlink(self, cc: str) -> None:
        before = len(self._tags)
        self._tags = {t: c for t, c in self._tags.items() if c != cc}
        if len(self._tags) != before:
            await self._store.async_save(self._tags)

    # ----- Scan -----

    def _notify_service(self, scanner_device_id: str | None) -> str | None:
        """Name des notify-Dienstes der Companion-App auf dem scannenden Gerät."""
        if not scanner_device_id:
            return None
        device = dr.async_get(self.hass).async_get(scanner_device_id)
        if device is None:
            return None
        for name in (device.name, device.name_by_user):
            if name and self.hass.services.has_service("notify", f"mobile_app_{slugify(name)}"):
                return f"mobile_app_{slugify(name)}"
        return None

    async def _tag_scanned(self, event: Event) -> None:
        cc = self._tags.get(str(event.data.get("tag_id", "")))
        if cc is None:
            return
        entry = self._entry(cc)
        device = dr.async_get(self.hass).async_get_device(identifiers={(DOMAIN, cc)})
        if entry is None or device is None:
            return
        scanner = event.data.get("device_id")
        self.hass.bus.async_fire(
            EVENT_DOSE_SCANNED,
            {"cc": cc, "device_id": device.id, "name": entry.title, "scanned_by": scanner},
        )
        estimator = await async_get_estimator(self.hass)
        service = self._notify_service(scanner) if estimator.nfc_notify else None
        if service is None:
            return
        url = panel_path(open_device=device.id)
        try:
            await self.hass.services.async_call(
                "notify",
                service,
                {
                    "title": entry.title,
                    "message": self._message(cc),
                    "data": {"url": url, "clickAction": url, "tag": f"{DOMAIN}_{cc}"},
                },
                blocking=True,
            )
        except HomeAssistantError:
            _LOGGER.debug("Benachrichtigung an %s fehlgeschlagen", service, exc_info=True)

    def _message(self, cc: str) -> str:
        from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
        from homeassistant.helpers import entity_registry as er

        registry = er.async_get(self.hass)
        parts: list[str] = []
        for domain, key in (("text", "content"), ("date", "best_before")):
            entity_id = registry.async_get_entity_id(domain, DOMAIN, f"{cc}_{key}")
            state = self.hass.states.get(entity_id) if entity_id else None
            if state and state.state not in (STATE_UNKNOWN, STATE_UNAVAILABLE, ""):
                label = ""
                if key == "best_before":
                    label = "MHD " if self.hass.config.language.lower().startswith("de") else "Best before "
                parts.append(f"{label}{state.state}")
        return " · ".join(parts) or (
            "Dose öffnen" if self.hass.config.language.lower().startswith("de") else "Open container"
        )


async def async_get_nfc(hass: HomeAssistant) -> NfcTags:
    async def create() -> NfcTags:
        nfc = NfcTags(hass)
        await nfc.async_load()
        return nfc

    return await async_singleton(hass, DATA_NFC, create)
