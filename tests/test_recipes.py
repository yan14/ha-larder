"""Tests: KI-Rezeptideen aus bald ablaufenden Dosen (mit simuliertem AI-Task-Dienst)."""

from datetime import timedelta

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.larder.const import DOMAIN
from custom_components.larder.recipes import build_summary, parse_recipes


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup(hass: HomeAssistant, cc: str) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=cc, title=f"Dose {cc}", data={"cc": cc, "tc": None, "size": None})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _eid(hass: HomeAssistant, domain: str, cc: str) -> str:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    return next(e.entity_id for e in er.async_entries_for_device(er.async_get(hass), device.id) if e.domain == domain)


async def _fill(hass, cc, content, days, quantity=None, unit=None):
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": content}, blocking=True)
    value = (dt_util.now().date() + timedelta(days=days)).isoformat()
    await hass.services.async_call("date", "set_value", {"entity_id": _eid(hass, "date", cc), "date": value}, blocking=True)
    if quantity:
        await hass.services.async_call("number", "set_value", {"entity_id": _eid(hass, "number", cc), "value": quantity}, blocking=True)
    if unit:
        await hass.services.async_call("select", "select_option", {"entity_id": _eid(hass, "select", cc), "option": unit}, blocking=True)


RECIPE = {
    "title": "Schinken-Omelett",
    "minutes": 15,
    "uses": ["Schinken", "Gekochte Eier"],
    "extra_ingredients": ["Butter"],
    "steps": ["Eier verquirlen.", "Alles braten."],
}


def _fake_ai(hass: HomeAssistant, data=None, error: Exception | None = None) -> list[dict]:
    calls: list[dict] = []

    async def handler(call):
        calls.append(dict(call.data))
        if error:
            raise error
        return {"conversation_id": "x", "data": data if data is not None else {"recipes": [RECIPE]}}

    hass.services.async_register("ai_task", "generate_data", handler, supports_response=SupportsResponse.ONLY)
    return calls


async def _suggest(hass: HomeAssistant, **data):
    return await hass.services.async_call(DOMAIN, "suggest_recipes", data, blocking=True, return_response=True)


async def test_nothing_expiring_does_not_call_the_ai(hass: HomeAssistant) -> None:
    await _setup(hass, "A1")
    await _fill(hass, "A1", "Reis", 20)
    calls = _fake_ai(hass)
    out = await _suggest(hass)
    assert out == {"count": 0, "ingredients": [], "recipes": [], "summary": ""}
    assert calls == []


async def test_recipes_use_only_soon_expiring_items_and_send_minimal_data(hass: HomeAssistant) -> None:
    await _setup(hass, "A1")
    await _setup(hass, "A2")
    await _setup(hass, "A3")
    await _setup(hass, "A4")
    await _fill(hass, "A1", "Schinken", 1, 5, "slices")
    await _fill(hass, "A2", "Gekochte Eier", 2, 4, "pieces")
    await _fill(hass, "A3", "Altes Brot", -1)  # abgelaufen: nie kochen
    await _fill(hass, "A4", "Reis", 30)  # noch lange haltbar
    calls = _fake_ai(hass)

    out = await _suggest(hass, servings=3)

    assert len(calls) == 1
    prompt = calls[0]["instructions"]
    assert "Schinken | 5 slices" in prompt and "Gekochte Eier | 4 pieces" in prompt
    assert "Altes Brot" not in prompt and "Reis" not in prompt
    assert "3 people" in prompt and "'en'" in prompt
    assert "Dose A1" not in prompt  # Dosennamen werden nicht gesendet
    assert "recipes" in calls[0]["structure"]
    assert out["count"] == 2
    assert [i["content"] for i in out["ingredients"]] == ["Schinken", "Gekochte Eier"]
    assert out["recipes"] == [{**RECIPE, "minutes": 15}]
    assert out["summary"] == "• Schinken-Omelett: Schinken, Gekochte Eier"


async def test_recipes_pass_the_configured_ai_entity_and_limit(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "A1")
    await _fill(hass, "A1", "Schinken", 1)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {"estimate_mode": "table", "ai_task_entity": "ai_task.mein_modell"}
    )
    calls = _fake_ai(hass, {"recipes": [RECIPE, {**RECIPE, "title": "Zwei"}, {**RECIPE, "title": "Drei"}]})
    out = await _suggest(hass, max_recipes=2)
    assert calls[0]["entity_id"] == "ai_task.mein_modell"
    assert "up to 2 different recipes" in calls[0]["instructions"]
    assert [r["title"] for r in out["recipes"]] == ["Schinken-Omelett", "Zwei"]


async def test_recipes_errors(hass: HomeAssistant) -> None:
    await _setup(hass, "A1")
    await _fill(hass, "A1", "Schinken", 1)
    with pytest.raises(HomeAssistantError):  # AI Task nicht eingerichtet
        await _suggest(hass)
    _fake_ai(hass, error=HomeAssistantError("kaputt"))
    with pytest.raises(HomeAssistantError, match="kaputt"):
        await _suggest(hass)


async def test_recipes_unexpected_answer_is_an_error(hass: HomeAssistant) -> None:
    await _setup(hass, "A1")
    await _fill(hass, "A1", "Schinken", 1)
    _fake_ai(hass, {"irgendwas": 1})
    with pytest.raises(HomeAssistantError):
        await _suggest(hass)


def test_parse_recipes_is_forgiving_about_types() -> None:
    out = parse_recipes(
        {
            "recipes": [
                {"title": "  Suppe ", "minutes": "20", "uses": "Chili", "steps": ["Kochen"]},
                {"title": ""},
                "kein Objekt",
            ]
        },
        5,
    )
    assert out == [{"title": "Suppe", "minutes": 20, "uses": ["Chili"], "extra_ingredients": [], "steps": ["Kochen"]}]
    assert build_summary(out) == "• Suppe: Chili"


def test_blueprint_message_appends_recipe_ideas_only_when_available(hass: HomeAssistant) -> None:
    from pathlib import Path

    from homeassistant.helpers.template import Template
    from homeassistant.util.yaml import load_yaml

    path = Path(__file__).parents[1] / "blueprints/automation/larder/expiry_notification.yaml"
    message = load_yaml(path)["actions"][-1]["data"]["message"]

    def render(**variables):
        return Template(message, hass).async_render(variables)

    result = {"summary": "1 läuft bald ab:\n• Schinken"}
    assert render(result=result) == "1 läuft bald ab:\n• Schinken"  # KI nicht gelaufen oder fehlgeschlagen
    assert render(result=result, ideas={"summary": ""}) == "1 läuft bald ab:\n• Schinken"
    assert render(result=result, ideas={"summary": "• Omelett"}) == "1 läuft bald ab:\n• Schinken\n\n• Omelett"
