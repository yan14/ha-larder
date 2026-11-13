"""Tests: Barcode → Produktname über Open Food Facts."""

from homeassistant.core import HomeAssistant

from custom_components.larder.product import API, async_lookup

from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401

URL = API.format(code="4000417025005")


async def test_lookup_found_cached_and_not_found(hass: HomeAssistant, aioclient_mock, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    aioclient_mock.get(
        URL,
        json={"status": 1, "product": {"product_name": "Haferflocken", "product_name_de": "Zarte Haferflocken", "brands": "Kölln, X", "quantity": "500 g"}},
    )
    result = await async_lookup(hass, "4000417025005")
    assert result == {
        "found": True, "code": "4000417025005", "name": "Zarte Haferflocken", "brand": "Kölln", "quantity": "500 g",
        "category": result["category"],
    }
    await async_lookup(hass, "4000-4170-25005")  # gleiche Ziffern: aus dem Zwischenspeicher
    assert aioclient_mock.call_count == 1

    aioclient_mock.get(API.format(code="12345678"), status=404, json={"status": 0})
    assert (await async_lookup(hass, "12345678"))["found"] is False
    assert (await async_lookup(hass, "abc"))["error"] == "invalid_code"

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "larder/product", "code": "4000417025005"})
    msg = await ws.receive_json()
    assert msg["result"]["name"] == "Zarte Haferflocken"


async def test_lookup_offline(hass: HomeAssistant, aioclient_mock) -> None:
    import aiohttp

    aioclient_mock.get(URL, exc=aiohttp.ClientError())
    assert (await async_lookup(hass, "4000417025005"))["error"] == "unavailable"
