"""Entität 'QR-Code': PNG mit Deep Link auf die Geräteseite (scanbar mit der Kamera-App)."""

from __future__ import annotations

import io
from typing import Any

import segno

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import scan_app_url
from .entity import LarderConfigEntry, LarderEntity


def render_qr_png(content: str) -> bytes:
    """QR-Code als PNG (schwarz auf weiß, mit Ruhezone) erzeugen."""
    buffer = io.BytesIO()
    segno.make_qr(content, error="m").save(buffer, kind="png", scale=10, border=4)
    return buffer.getvalue()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingQrCode(hass, entry)])


class ZwillingQrCode(ImageEntity, LarderEntity):
    """QR-Code, der die Home-Assistant-App direkt im Dashboard bei dieser Dose öffnet.

    Wie bei NFC-Tags: Das Dashboard öffnet die Dose (eine leere gleich zum Befüllen) und löst
    `larder_dose_scanned` aus. Der Code enthält die ID der Dose (cc), nicht die Geräte-ID, und
    bleibt deshalb auch gültig, wenn die Dose gelöscht und neu angelegt wird.
    """

    _key = "qr_code"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, entry: LarderConfigEntry) -> None:
        ImageEntity.__init__(self, hass)
        LarderEntity.__init__(self, entry)
        self._rendered: tuple[str, bytes] | None = None

    @property
    def qr_content(self) -> str | None:
        """Inhalt des QR-Codes (erst bekannt, wenn die Entität am Gerät hängt)."""
        return scan_app_url(self._cc)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"qr_content": self.qr_content}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._attr_image_last_updated = dt_util.utcnow()

    async def async_image(self) -> bytes | None:
        content = self.qr_content
        if content is None:
            return None
        if self._rendered is None or self._rendered[0] != content:
            png = await self.hass.async_add_executor_job(render_qr_png, content)
            self._rendered = (content, png)
        return self._rendered[1]
