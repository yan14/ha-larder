"""Link NFC tags (and other Home Assistant tags) with containers.

Home Assistant fires the event `tag_scanned` on every scan of a tag (data: tag_id,
name, device_id of the scanning device). This integration remembers which tag ID belongs to
which container. When a linked tag is scanned, two things happen:

* The event `larder_dose_scanned` is fired (for the dashboard and automations).
* The scanning phone gets a notification, if it is the Companion app; tapping it
  opens the container in the dashboard.

Unknown tags are ignored, so other NFC tags in the house stay untouched.
"""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store
from homeassistant.util import slugify

from .const import CONF_CC, DOMAIN, EVENT_DOSE_SCANNED, larder_ids, panel_path
from .estimate import async_get_estimator
from .singleton import async_singleton

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.nfc"
DATA_NFC = "nfc"
EVENT_TAG_SCANNED = "tag_scanned"


class NfcError(HomeAssistantError):
    """Linking not possible; the text comes from the translations."""

    def __init__(self, key: str, **placeholders: str) -> None:
        super().__init__(
            translation_domain=DOMAIN,
            translation_key=key,
            translation_placeholders=placeholders or None,
        )


class NfcTags:
    """Mapping tag ID → container and reaction to scanned tags."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, str]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._tags: dict[str, str] = {}  # tag_id -> cc
        self._unsub: CALLBACK_TYPE | None = None
        # Running series scans in the dashboard: they get every scan, the phone gets no notification then
        self._sessions: list[Callable[[dict[str, Any]], None]] = []

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

    @callback
    def add_session(self, forward: Callable[[dict[str, Any]], None]) -> CALLBACK_TYPE:
        """Register a series scan; returns the unsubscribe function."""
        self._sessions.append(forward)

        @callback
        def remove() -> None:
            if forward in self._sessions:
                self._sessions.remove(forward)

        return remove

    # ----- Links -----

    def tag_of(self, cc: str) -> str | None:
        return next((tag for tag, linked in self._tags.items() if linked == cc), None)

    def links(self) -> dict[str, str]:
        """cc -> tag_id"""
        return {cc: tag for tag, cc in self._tags.items()}

    def links_by_device(self) -> dict[str, str]:
        """device_id of the container -> tag_id (the dashboard only knows containers by their device ID)."""
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
        """Find the cc from cc, config entry ID or device ID (the dashboard only knows the latter)."""
        if device_id:
            device = dr.async_get(self.hass).async_get(device_id)
            for identifier in larder_ids(device):
                if self._entry(identifier):
                    return identifier
        elif entry_id:
            entry = self.hass.config_entries.async_get_entry(entry_id)
            if entry and entry.domain == DOMAIN and entry.data.get(CONF_CC):
                return entry.data[CONF_CC]
        elif cc and self._entry(cc):
            return cc
        raise NfcError("nfc_unknown_container")

    async def async_link(self, tag_id: str, cc: str) -> None:
        """Link a tag with a container. A container has at most one tag."""
        tag_id = tag_id.strip()
        if not tag_id:
            raise NfcError("nfc_no_tag")
        places = self.hass.data.get(DOMAIN, {}).get("places")
        if places is not None and (place := places.by_tag(tag_id)):
            from .places import place_name  # noqa: PLC0415

            raise NfcError("nfc_tag_in_use", name=place_name(self.hass, place.get("area_id"), place.get("compartment")))
        owner = self._tags.get(tag_id)
        if owner and owner != cc:
            entry = self._entry(owner)
            raise NfcError("nfc_tag_in_use", name=entry.title if entry else owner)
        for old in [t for t, linked in self._tags.items() if linked == cc]:
            del self._tags[old]
        self._tags[tag_id] = cc
        from .disposable import async_get_retired  # noqa: PLC0415 - avoids an import cycle

        (await async_get_retired(self.hass)).forget_tag(tag_id)  # sticker of an old bag used again
        await self._store.async_save(self._tags)

    async def async_unlink(self, cc: str) -> None:
        before = len(self._tags)
        self._tags = {t: c for t, c in self._tags.items() if c != cc}
        if len(self._tags) != before:
            await self._store.async_save(self._tags)

    # ----- Scan -----

    def _notify_service(self, scanner_device_id: str | None) -> str | None:
        """Name of the Companion app's notify service on the scanning device."""
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
        tag_id = str(event.data.get("tag_id", ""))
        cc = self._tags.get(tag_id)
        if cc is None:
            from .places import async_get_places  # noqa: PLC0415 - avoids an import cycle

            place = (await async_get_places(self.hass)).by_tag(tag_id)
            if place is not None:
                await self._place_scanned(place, event.data.get("device_id"))
                return
            await self._retired_scanned(tag_id, event.data.get("device_id"))
            return
        entry = self._entry(cc)
        device = dr.async_get(self.hass).async_get_device(identifiers={(DOMAIN, cc)})
        if entry is None or device is None:
            return
        scanner = event.data.get("device_id")
        data = {"cc": cc, "device_id": device.id, "name": entry.title, "scanned_by": scanner}
        self.hass.bus.async_fire(EVENT_DOSE_SCANNED, data)
        if self._sessions:
            # a series scan is running in the dashboard: report there, no notification to the phone
            for forward in list(self._sessions):
                forward(data)
            return
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

    async def _place_scanned(self, place: dict[str, str], scanner: str | None) -> None:
        """Tag of a compartment: event, report to an open dashboard or notify the phone."""
        from .places import EVENT_COMPARTMENT_SCANNED, async_get_places, place_path  # noqa: PLC0415

        places = await async_get_places(self.hass)
        data = places.scan_data(place, scanner)
        self.hass.bus.async_fire(EVENT_COMPARTMENT_SCANNED, data)
        if self._sessions:
            for forward in list(self._sessions):
                forward(data)
            return
        estimator = await async_get_estimator(self.hass)
        service = self._notify_service(scanner) if estimator.nfc_notify else None
        if service is None:
            return
        url = place_path(data["area_id"], data["compartment"])
        try:
            await self.hass.services.async_call(
                "notify",
                service,
                {
                    "title": data["name"],
                    "message": places.message(data),
                    "data": {"url": url, "clickAction": url, "tag": f"{DOMAIN}_place"},
                },
                blocking=True,
            )
        except HomeAssistantError:
            _LOGGER.debug("Benachrichtigung an %s fehlgeschlagen", service, exc_info=True)

    async def _retired_scanned(self, tag_id: str, scanner: str | None) -> None:
        """Sticker of a bag that was already emptied: say so instead of doing nothing."""
        from .disposable import async_delete_ha_tag, async_get_retired, retired_text  # noqa: PLC0415

        info = (await async_get_retired(self.hass)).by_tag(tag_id)
        if info is None:
            return  # foreign tag: none of our business
        text = retired_text(info, self.hass.config.language or "en")
        data = {"retired": True, "name": info.get("name"), "message": text, "scanned_by": scanner}
        self.hass.bus.async_fire(EVENT_DOSE_SCANNED, data)
        # Home Assistant creates the tag again when scanning (shortly after this event): clean up afterwards
        async def cleanup(_now: Any) -> None:
            await async_delete_ha_tag(self.hass, tag_id)

        async_call_later(self.hass, 2, cleanup)
        if self._sessions:
            for forward in list(self._sessions):
                forward(data)
            return
        service = self._notify_service(scanner)
        if service is None:
            return
        try:
            await self.hass.services.async_call(
                "notify", service, {"title": "Larder", "message": text}, blocking=True
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
