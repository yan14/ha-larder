"""Scan-Webhook: QR-Inhalt entgegennehmen und Link zur passenden Geräteseite liefern.

Ein einziger, geheimer Webhook für alle Dosen. Der Kurzbefehl auf dem iPhone schickt
den gescannten Text (oder nur die ID), die Integration sucht das Gerät dazu und
antwortet mit einem Link, den der Kurzbefehl in der Home-Assistant-App öffnet.
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

from .const import APP_URL_PREFIX, DOMAIN, device_app_url, device_path
from .qr import parse_qr

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.webhook"

DATA_LOCK = "lock"
DATA_WEBHOOK_ID = "webhook_id"

INTEGRATION_PATH = f"/config/integrations/integration/{DOMAIN}"


async def async_get_webhook_id(hass: HomeAssistant) -> str:
    """Geheime Webhook-ID laden, beim ersten Mal erzeugen und dauerhaft speichern."""
    store: Store[dict[str, str]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load()
    if not data or not data.get(DATA_WEBHOOK_ID):
        data = {DATA_WEBHOOK_ID: webhook.async_generate_id()}
        await store.async_save(data)
    return data[DATA_WEBHOOK_ID]


def webhook_urls(hass: HomeAssistant, webhook_id: str) -> tuple[str, str]:
    """Liefert (vollständige URL, Pfad) für die Anzeige im Options-Dialog."""
    path = webhook.async_generate_path(webhook_id)
    try:
        return webhook.async_generate_url(hass, webhook_id), path
    except NoURLAvailableError:
        return f"https://<DEINE-HA-URL>{path}", path


async def async_setup_webhook(hass: HomeAssistant) -> None:
    """Webhook einmalig registrieren (idempotent, egal wie viele Dosen es gibt)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock: asyncio.Lock = domain_data.setdefault(DATA_LOCK, asyncio.Lock())
    async with lock:
        if domain_data.get(DATA_WEBHOOK_ID):
            return
        webhook_id = await async_get_webhook_id(hass)
        webhook.async_register(
            hass,
            DOMAIN,
            "Zwilling Food Storage",
            webhook_id,
            _async_handle_webhook,
            local_only=False,
            allowed_methods=["GET", "POST"],
        )
        domain_data[DATA_WEBHOOK_ID] = webhook_id


def async_teardown_webhook(hass: HomeAssistant) -> None:
    """Webhook abmelden, wenn die letzte Dose entladen wurde."""
    domain_data = hass.data.get(DOMAIN, {})
    if webhook_id := domain_data.pop(DATA_WEBHOOK_ID, None):
        webhook.async_unregister(hass, webhook_id)


async def _async_extract_code(request: web.Request) -> str | None:
    """Gescannten Text aus Query (?code=), JSON-Body ({"code": ...}) oder Klartext lesen."""
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
        return body  # Klartext-Body: der QR-Inhalt selbst
    if isinstance(data, dict):
        value = data.get("code") or data.get("cc") or data.get("qr_code")
        return str(value) if value is not None else None
    if isinstance(data, str):
        return data
    return None


async def _async_handle_webhook(
    hass: HomeAssistant, webhook_id: str, request: web.Request
) -> web.Response:
    """Passendes Gerät suchen und Link darauf zurückgeben."""
    parsed = parse_qr(await _async_extract_code(request))
    if parsed is None:
        return web.json_response({"error": "invalid_code"}, status=400)

    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, parsed.cc)})
    if device is None:
        # Dose noch nicht angelegt: auf die Integrationsseite führen (dort "Eintrag hinzufügen").
        return web.json_response(
            {
                "known": False,
                "cc": parsed.cc,
                "path": INTEGRATION_PATH,
                "app_url": f"{APP_URL_PREFIX}{INTEGRATION_PATH}",
            }
        )

    return web.json_response(
        {
            "known": True,
            "cc": parsed.cc,
            "name": device.name_by_user or device.name,
            "device_id": device.id,
            "path": device_path(device.id),
            "app_url": device_app_url(device.id),
        }
    )
