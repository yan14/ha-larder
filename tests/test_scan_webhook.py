"""Tests für den Scan-Webhook und den Options-Dialog."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr

from custom_components.larder.const import DOMAIN

QR = "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup_entry(hass: HomeAssistant, cc: str = "34OL") -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=cc,
        title=f"Dose {cc}",
        data={"cc": cc, "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _device_id(hass: HomeAssistant, cc: str) -> str:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    assert device is not None
    return device.id


async def test_webhook_known_device_post_json(hass, hass_client_no_auth) -> None:
    await _setup_entry(hass)
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    assert len(webhook_id) == 64  # 256 Bit geheim

    client = await hass_client_no_auth()
    resp = await client.post(f"/api/webhook/{webhook_id}", json={"code": QR})
    assert resp.status == 200
    data = await resp.json()

    device_id = _device_id(hass, "34OL")
    assert data == {
        "known": True,
        "cc": "34OL",
        "name": "Dose 34OL",
        "device_id": device_id,
        "path": f"/larder?open={device_id}",
        "app_url": f"homeassistant://navigate/larder?open={device_id}",
        "device_path": f"/config/devices/device/{device_id}",
        "device_app_url": f"homeassistant://navigate/config/devices/device/{device_id}",
    }


async def test_webhook_accepts_plain_body_query_and_bare_id(
    hass, hass_client_no_auth
) -> None:
    await _setup_entry(hass)
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    device_id = _device_id(hass, "34OL")
    client = await hass_client_no_auth()
    url = f"/api/webhook/{webhook_id}"

    for resp in (
        await client.post(url, data=QR),  # Klartext-Body
        await client.post(url, json={"cc": "34ol"}),  # nur ID, Kleinschreibung
        await client.get(url, params={"code": "34OL"}),  # GET mit Query
    ):
        assert resp.status == 200
        data = await resp.json()
        assert data["known"] is True
        assert data["device_id"] == device_id


async def test_webhook_unknown_code_points_to_panel_add_dialog(
    hass, hass_client_no_auth
) -> None:
    await _setup_entry(hass)
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    client = await hass_client_no_auth()

    resp = await client.post(
        f"/api/webhook/{webhook_id}", json={"code": "tc=1&cc=NEU123"}
    )
    assert resp.status == 200
    assert await resp.json() == {
        "known": False,
        "cc": "NEU123",
        "path": "/larder?add=NEU123",
        "app_url": "homeassistant://navigate/larder?add=NEU123",
    }


@pytest.mark.parametrize("body", [{}, {"code": ""}, {"code": "zwilling://x/?tc=1"}])
async def test_webhook_invalid_code(hass, hass_client_no_auth, body) -> None:
    await _setup_entry(hass)
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    client = await hass_client_no_auth()

    resp = await client.post(f"/api/webhook/{webhook_id}", json=body)
    assert resp.status == 400
    assert await resp.json() == {"error": "invalid_code"}


async def test_webhook_renamed_device_uses_user_name(hass, hass_client_no_auth) -> None:
    await _setup_entry(hass)
    reg = dr.async_get(hass)
    reg.async_update_device(_device_id(hass, "34OL"), name_by_user="Suppendose")
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    client = await hass_client_no_auth()

    resp = await client.post(f"/api/webhook/{webhook_id}", json={"code": QR})
    assert (await resp.json())["name"] == "Suppendose"


async def test_one_webhook_for_multiple_entries_and_cleanup(
    hass, hass_client_no_auth
) -> None:
    first = await _setup_entry(hass, "34OL")
    second = await _setup_entry(hass, "77AB")
    webhook_id = hass.data[DOMAIN]["webhook_id"]
    client = await hass_client_no_auth()

    for cc in ("34OL", "77AB"):
        data = await (await client.post(f"/api/webhook/{webhook_id}", json={"code": cc})).json()
        assert data["known"] is True and data["device_id"] == _device_id(hass, cc)

    # Erste Dose entladen: Webhook bleibt für die zweite aktiv
    assert await hass.config_entries.async_unload(first.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN].get("webhook_id") == webhook_id

    # Letzte Dose entladen: Webhook wird abgemeldet
    assert await hass.config_entries.async_unload(second.entry_id)
    await hass.async_block_till_done()
    assert "webhook_id" not in hass.data[DOMAIN]
    resp = await client.post(f"/api/webhook/{webhook_id}", json={"code": QR})
    assert resp.status == 200
    assert await resp.text() == ""  # HA antwortet bei unbekannten Webhooks leer


async def test_webhook_id_is_persistent(hass) -> None:
    entry = await _setup_entry(hass)
    first_id = hass.data[DOMAIN]["webhook_id"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.data[DOMAIN]["webhook_id"] == first_id


async def test_options_flow_shows_webhook_url(hass) -> None:
    entry = await _setup_entry(hass)
    webhook_id = hass.data[DOMAIN]["webhook_id"]

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"
    placeholders = result["description_placeholders"]
    assert placeholders["webhook_path"] == f"/api/webhook/{webhook_id}"
    assert placeholders["webhook_url"].endswith(f"/api/webhook/{webhook_id}")

    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
