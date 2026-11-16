"""Scan webhook: take the QR content and return a link to the matching device page.

One single, secret webhook for all containers. The shortcut on the iPhone sends
the scanned text (or only the ID), the integration looks up the device and
answers with a link that the shortcut opens in the Home Assistant app.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from aiohttp import web

from homeassistant.components import webhook
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.network import NoURLAvailableError
from homeassistant.helpers.storage import Store

from .const import DOMAIN, device_app_url, device_path, panel_app_url, panel_path
from .qr import parse_qr

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.webhook"

DATA_LOCK = "lock"
DATA_WEBHOOK_ID = "webhook_id"


async def async_get_webhook_id(hass: HomeAssistant) -> str:
    """Load the secret webhook ID, create it the first time and store it permanently."""
    store: Store[dict[str, str]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load()
    if not data or not data.get(DATA_WEBHOOK_ID):
        data = {DATA_WEBHOOK_ID: webhook.async_generate_id()}
        await store.async_save(data)
    return data[DATA_WEBHOOK_ID]


def webhook_urls(hass: HomeAssistant, webhook_id: str) -> tuple[str, str]:
    """Returns (full URL, path) for display in the options dialog."""
    path = webhook.async_generate_path(webhook_id)
    try:
        return webhook.async_generate_url(hass, webhook_id), path
    except NoURLAvailableError:
        return f"https://<DEINE-HA-URL>{path}", path


async def async_setup_webhook(hass: HomeAssistant) -> None:
    """Register the webhook once (idempotent, no matter how many containers there are)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock: asyncio.Lock = domain_data.setdefault(DATA_LOCK, asyncio.Lock())
    async with lock:
        if domain_data.get(DATA_WEBHOOK_ID):
            return
        webhook_id = await async_get_webhook_id(hass)
        webhook.async_register(
            hass,
            DOMAIN,
            "Larder",
            webhook_id,
            _async_handle_webhook,
            local_only=False,
            allowed_methods=["GET", "POST"],
        )
        domain_data[DATA_WEBHOOK_ID] = webhook_id


def async_teardown_webhook(hass: HomeAssistant) -> None:
    """Unregister the webhook when the last container was unloaded."""
    domain_data = hass.data.get(DOMAIN, {})
    if webhook_id := domain_data.pop(DATA_WEBHOOK_ID, None):
        webhook.async_unregister(hass, webhook_id)


async def _async_extract_code(request: web.Request) -> str | None:
    """Read the scanned text from the query (?code=), JSON body ({"code": ...}) or plain text."""
    if code := request.query.get("code") or request.query.get("cc"):
        return code
    if request.method != "POST" or not request.can_read_body:
        return None

    body = (await request.text()).strip()
    if not body:
        return None
    try:
        data: Any = json.loads(body)
    except ValueError:
        return body  # plain text body: the QR content itself
    if isinstance(data, dict):
        value = data.get("code") or data.get("cc") or data.get("qr_code")
        return str(value) if value is not None else None
    if isinstance(data, str):
        return data
    return None


async def _async_handle_webhook(
    hass: HomeAssistant, webhook_id: str, request: web.Request
) -> web.Response:
    """Find the matching device and return a link to the dashboard."""
    parsed = parse_qr(await _async_extract_code(request))
    if parsed is None:
        return web.json_response({"error": "invalid_code"}, status=400)

    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, parsed.cc)})
    if device is None:
        from .disposable import async_get_retired, retired_text  # noqa: PLC0415 - avoids an import cycle

        if info := (await async_get_retired(hass)).by_code(parsed.cc):
            # code of a bag that was already emptied: open nothing, only say so
            return web.json_response(
                {
                    "known": False,
                    "retired": True,
                    "cc": parsed.cc,
                    "message": retired_text(info, hass.config.language or "en"),
                    "path": panel_path(),
                    "app_url": panel_app_url(),
                }
            )
        # container not created yet: lead to the panel "Larder", where the dialog
        # "Add container" opens with the code already entered.
        return web.json_response(
            {
                "known": False,
                "cc": parsed.cc,
                "path": panel_path(parsed.cc),
                "app_url": panel_app_url(parsed.cc),
            }
        )

    return web.json_response(
        {
            "known": True,
            "cc": parsed.cc,
            "name": device.name_by_user or device.name,
            "device_id": device.id,
            # The dashboard highlights the container and opens "Fill container" for empty ones.
            "path": panel_path(open_device=device.id),
            "app_url": panel_app_url(open_device=device.id),
            "device_path": device_path(device.id),
            "device_app_url": device_app_url(device.id),
        }
    )
