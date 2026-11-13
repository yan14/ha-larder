"""Tests: Barcode → Produktname über Open Food Facts."""

from custom_components.larder.product import API, async_lookup
from homeassistant.core import HomeAssistant

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
    assert (result["found"], result["name"], result["brand"], result["quantity"]) == (True, "Zarte Haferflocken", "Kölln", "500 g")
    assert result["product"] == {"ean": "4000417025005", "source": "openfoodfacts", "brand": "Kölln", "package": "500 g"}
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


def test_nutrition_from_open_food_facts() -> None:
    from custom_components.larder.product import nutrition

    product = {
        "nutriments": {
            "energy-kcal_100g": 372, "energy-kcal_serving": 149.2, "fat_100g": 7, "saturated-fat_100g": 1.3,
            "carbohydrates_100g": 58.7, "sugars_100g": 0.7, "fiber_100g": 10, "proteins_100g": 13.5, "salt_100g": 0.02,
        },
        "nutriscore_grade": "a",
        "allergens_tags": ["en:gluten", "en:milk", "en:something-else"],
    }
    de = nutrition(product, "de")
    assert de["kcal_100g"] == 372 and de["kcal_portion"] == 149
    assert de["nutri_score"] == "A"
    assert de["allergens"] == "Gluten, Milch, Something else"
    assert de["nutrients"] == (
        "Fett 7 g, davon gesättigte Fettsäuren 1,3 g, Kohlenhydrate 59 g, davon Zucker 0,7 g, "
        "Ballaststoffe 10 g, Eiweiß 14 g, Salz 0,02 g (pro 100 g)"
    )
    assert nutrition(product, "en")["allergens"] == "Gluten, Milk, Something else"
    # nur kJ: in kcal umgerechnet; unbekannter Nutri-Score fehlt
    only_kj = nutrition({"nutriments": {"energy-kj_100g": 1000}, "nutriscore_grade": "unknown"}, "de")
    assert only_kj == {"kcal_100g": 239}


async def test_product_data_on_the_container(hass: HomeAssistant, hass_ws_client) -> None:
    from custom_components.larder.const import DOMAIN
    from homeassistant.helpers import device_registry as dr

    from .test_recipes import _eid, _fill

    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Haferflocken", 200)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    ws = await hass_ws_client(hass)
    await ws.send_json({
        "id": 1, "type": "larder/product_set", "device_id": device.id, "replace": True,
        "product": {"brand": "Kölln", "kcal_100g": "372", "kcal_portion": 149.2, "nutri_score": "a", "allergens": "Gluten", "bogus": 1},
    })
    msg = await ws.receive_json()
    assert msg["result"]["product"] == {"brand": "Kölln", "kcal_100g": 372, "kcal_portion": 149.2, "nutri_score": "A", "allergens": "Gluten"}
    attrs = hass.states.get(_eid(hass, "text", "AAAA")).attributes
    assert attrs["kcal_100g"] == 372 and attrs["brand"] == "Kölln"
    # einzelnes Feld ändern, leeres löscht
    await ws.send_json({"id": 2, "type": "larder/product_set", "device_id": device.id, "product": {"kcal_100g": "380,5", "allergens": ""}})
    msg = await ws.receive_json()
    assert msg["result"]["product"]["kcal_100g"] == 380.5 and "allergens" not in msg["result"]["product"]
    # Leeren: Produktdaten weg
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", "AAAA")}, blocking=True)
    attrs = hass.states.get(_eid(hass, "text", "AAAA")).attributes
    assert "kcal_100g" not in attrs and "brand" not in attrs
    await ws.send_json({"id": 3, "type": "larder/product_set", "device_id": "nope", "product": {}})
    assert not (await ws.receive_json())["success"]
