"""Entität 'QR-Code': PNG mit Deep Link auf die Geräteseite (scanbar mit der Kamera-App)."""

from __future__ import annotations

import io
from typing import Any

import segno

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import device_app_url
from .entity import ZwillingConfigEntry, ZwillingEntity


def render_qr_png(content: str) -> bytes:
    """QR-Code als PNG (schwarz auf weiß, mit Ruhezone) erzeugen."""
    buffer = io.BytesIO()
    segno.make_qr(content, error="m").save(buffer, kind="png", scale=10, border=4)
    return buffer.getvalue()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ZwillingConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([ZwillingQrCode(hass, entry)])


class ZwillingQrCode(ImageEntity, ZwillingEntity):
    """QR-Code, der die Home-Assistant-App direkt auf dieses Gerät springen lässt."""

    _key = "qr_code"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, entry: ZwillingConfigEntry) -> None:
        ImageEntity.__init__(self, hass)
        ZwillingEntity.__init__(self, entry)
        self._rendered: tuple[str, bytes] | None = None

    @property
    def qr_content(self) -> str | None:
        """Inhalt des QR-Codes (erst bekannt, wenn die Entität am Gerät hängt)."""
        if self.registry_entry is None or self.registry_entry.device_id is None:
            return None
        return device_app_url(self.registry_entry.device_id)

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
