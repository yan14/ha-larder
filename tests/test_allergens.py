"""Tests Block 7: Allergene im Haushalt und Nachkaufen mit Marke und Packung."""

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.larder.const import DOMAIN
from custom_components.larder.product import watched_allergens

from .test_recipes import RECIPE, _eid, _fake_ai, _fill, _options, _setup, _suggest  # noqa: F401
from .test_ai_estimate import auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo


def test_watched_allergens_from_field_and_content() -> None:
    # Feld "Allergene" (Open Food Facts oder von Hand): Wortanfang
    assert watched_allergens("Müsli", "Gluten, Schalenfrüchte", ["gluten", "nuts"], "de") == ["Gluten", "Schalenfrüchte"]
    assert watched_allergens("Müsli", "Hafer", ["gluten"], "en") == ["Gluten"]
    # Inhalt: auch mitten im Wort, aber nur längere Begriffe
    assert watched_allergens("Haselnusscreme", "", ["nuts"], "de") == ["Schalenfrüchte"]
    assert watched_allergens("Milchreis", "", ["milk", "eggs"], "de") == ["Milch"]
    assert watched_allergens("Reis mit Ei", "", ["eggs"], "de") == []  # "ei" zu kurz für den Inhalt
    assert watched_allergens("Erdnussbutter", "", ["milk"], "de") == []
    assert watched_allergens("Gulasch", "", ["gluten", "milk"], "de") == []
    assert watched_allergens("Gulasch", "Gluten", [], "de") == []


async def test_warning_attribute_follows_the_setting(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Haselnusscreme", 30)
    attrs = hass.states.get(_eid(hass, "text", "AAAA")).attributes
    assert "allergen_warning" not in attrs
    await _options(hass, entry, watch_allergens=["nuts", "gluten"])
    assert hass.states.get(_eid(hass, "text", "AAAA")).attributes["allergen_warning"] == ["Nuts"]
    await _options(hass, entry, watch_allergens=["milk"])
    assert "allergen_warning" not in hass.states.get(_eid(hass, "text", "AAAA")).attributes


async def test_recipes_leave_out_containers_with_household_allergens(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Milchreis", 1)
    await _fill(hass, "BBBB", "Gulasch", 1)
    await _options(hass, entry, watch_allergens=["milk"])
    calls = _fake_ai(hass, {"recipes": [RECIPE]})
    out = await _suggest(hass)
    assert [i["content"] for i in out["ingredients"]] == ["Gulasch"]
    assert "avoids these allergens: Milk" in calls[0]["instructions"]
    # ausdrücklich gewählt: bleibt drin, mit Hinweis
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")}).id
    out = await _suggest(hass, containers=[device])
    assert [i["content"] for i in out["ingredients"]] == ["Milchreis"]
    assert "contains: Milk" in calls[1]["instructions"]


async def _empty_with_product(hass: HomeAssistant, cc: str, content: str, product: dict) -> None:
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": content}, blocking=True)
    entry = next(e for e in hass.config_entries.async_entries(DOMAIN) if e.data["cc"] == cc)
    await entry.runtime_data.resettable["content"].async_set_product(product)
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", cc)}, blocking=True)
    await hass.async_block_till_done()


async def test_shopping_list_gets_brand_and_package(hass: HomeAssistant) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    shopping = next(
        s.entity_id for s in hass.states.async_all("switch") if s.entity_id.endswith("shopping_list")
    )
    await hass.services.async_call("switch", "turn_on", {"entity_id": shopping}, blocking=True)

    await _empty_with_product(hass, "AAAA", "Haferflocken", {"brand": "Kölln", "package": "500 g"})
    assert todo.summaries == ["Haferflocken (Kölln, 500 g)"]
    # schon offen (auch ohne Zusatz): nicht doppelt
    await _empty_with_product(hass, "AAAA", "haferflocken", {"brand": "Kölln"})
    assert todo.summaries == ["Haferflocken (Kölln, 500 g)"]
    # mehrere Inhalte: ohne Zusatz
    await _empty_with_product(hass, "AAAA", "Salami, Leberwurst", {"brand": "Metzger"})
    assert todo.summaries[1:] == ["Salami", "Leberwurst"]
    # ausgeschaltet
    await _options(hass, entry, todo_entity="todo.einkaufen", shopping_details=False)
    await _empty_with_product(hass, "AAAA", "Nudeln", {"brand": "Barilla", "package": "1 kg"})
    assert todo.summaries[-1] == "Nudeln"
