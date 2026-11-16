"""Entity 'QR code': PNG with a deep link to the device page (scannable with the camera app)."""

from __future__ import annotations

import io
from typing import Any

import segno

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import PACK_KINDS, scan_app_url
from .entity import LarderConfigEntry, LarderEntity, kind_of


def render_qr_png(content: str) -> bytes:
    """Create a QR code as PNG (black on white, with quiet zone)."""
    buffer = io.BytesIO()
    segno.make_qr(content, error="m").save(buffer, kind="png", scale=10, border=4)
    return buffer.getvalue()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: LarderConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    if kind_of(entry) not in PACK_KINDS:  # packs have no code
        async_add_entities([ZwillingQrCode(hass, entry)])


class ZwillingQrCode(ImageEntity, LarderEntity):
    """QR code that opens the Home Assistant app directly in the dashboard at this container.

    As with NFC tags: the dashboard opens the container (an empty one right away for filling) and fires
    `larder_dose_scanned`. The code contains the container's ID (cc), not the device ID, and
    therefore stays valid even if the container is deleted and created again.
    """

    _key = "qr_code"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, entry: LarderConfigEntry) -> None:
        ImageEntity.__init__(self, hass)
        LarderEntity.__init__(self, entry)
        self._rendered: tuple[str, bytes] | None = None

    @property
    def qr_content(self) -> str | None:
        """Content of the QR code (only known once the entity is attached to the device)."""
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
