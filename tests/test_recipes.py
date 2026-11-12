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
    return next(e.entity_id for e in er.async_entries_for_device(er.async_get(hass), device.id) if e.domain == domain and (domain != "switch" or e.unique_id.endswith("_vacuum")) and (domain != "select" or e.unique_id.endswith("_unit")))


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
    assert out == {"count": 0, "days": 3, "ingredients": [], "recipes": [], "summary": "", "speech": ""}
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
    variables = next(a["variables"] for a in load_yaml(path)["actions"] if "variables" in a)
    message = variables["message"]

    def render(**variables):
        return Template(message, hass).async_render(variables)

    result = {"summary": "1 läuft bald ab:\n• Schinken"}
    assert render(result=result) == "1 läuft bald ab:\n• Schinken"  # KI nicht gelaufen oder fehlgeschlagen
    assert render(result=result, ideas={"summary": ""}) == "1 läuft bald ab:\n• Schinken"
    assert render(result=result, ideas={"summary": "• Omelett"}) == "1 läuft bald ab:\n• Schinken\n\n• Omelett"


async def _options(hass: HomeAssistant, entry, **data) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"estimate_mode": "table", **data})
    await hass.async_block_till_done()


async def test_period_comes_from_the_settings_and_can_be_overridden(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Schinken", 2)
    await _fill(hass, "BBBB", "Suppe", 10)
    calls = _fake_ai(hass, {"recipes": [RECIPE]})

    out = await _suggest(hass)
    assert out["days"] == 3 and [i["content"] for i in out["ingredients"]] == ["Schinken"]

    await _options(hass, entry, recipe_days=14)
    out = await _suggest(hass)
    assert out["days"] == 14 and [i["content"] for i in out["ingredients"]] == ["Schinken", "Suppe"]

    out = await _suggest(hass, days=1)  # Angabe im Aufruf geht vor
    assert out["days"] == 1 and out["recipes"] == [] and len(calls) == 2


async def test_all_containers_ignores_the_period_but_never_sends_expired_or_empty(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _setup(hass, "CCCC")
    await _setup(hass, "DDDD")
    await _setup(hass, "EEEE")
    await _fill(hass, "AAAA", "Schinken", 200)
    await _fill(hass, "BBBB", "Alter Fisch", -2)  # abgelaufen
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "CCCC"), "value": "Reis"}, blocking=True)  # ohne MHD
    value = (dt_util.now().date() + timedelta(days=1)).isoformat()
    await hass.services.async_call("date", "set_value", {"entity_id": _eid(hass, "date", "DDDD"), "date": value}, blocking=True)  # MHD ohne Inhalt
    calls = _fake_ai(hass, {"recipes": [RECIPE]})

    out = await _suggest(hass, all_containers=True)
    assert out["days"] is None
    assert [i["content"] for i in out["ingredients"]] == ["Schinken", "Reis"]
    text = calls[0]["instructions"]
    assert "Alter Fisch" not in text and "Dose DDDD" not in text and "Dose EEEE" not in text
    assert "Reis | no best-before date known" in text

    # ohne "alle": weder die Dose ohne MHD noch die namenlose mit MHD gehen an die KI
    out = await _suggest(hass, days=30)
    assert out["recipes"] == [] and len(calls) == 1


def test_parse_recipes_limits_sizes() -> None:
    out = parse_recipes({"recipes": [{"title": "x" * 500, "minutes": 1e9, "uses": {"a": 1}, "steps": ["s" * 900] * 300}]}, 3)
    assert len(out[0]["title"]) == 120 and out[0]["minutes"] is None and out[0]["uses"] == []
    assert len(out[0]["steps"]) == 100 and len(out[0]["steps"][0]) == 300


async def test_settings_websocket(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass, "AAAA")
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "larder/settings"})
    assert (await client.receive_json())["result"] == {"recipe_days": 3, "soon_days": 3}
    await _options(hass, entry, recipe_days=0)
    await client.send_json({"id": 2, "type": "larder/settings"})
    assert (await client.receive_json())["result"] == {"recipe_days": 0, "soon_days": 3}


async def test_soon_days_setting_changes_status_attribute_and_overview(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Schinken", 6)
    await hass.async_block_till_done()
    sensor = _eid(hass, "sensor", "AAAA")
    assert hass.states.get(sensor).attributes["status"] == "ok"
    assert hass.states.get(_eid(hass, "date", "AAAA")).attributes["soon_days"] == 3
    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert out["count"] == 0

    await _options(hass, entry, soon_days=7)
    assert hass.states.get(sensor).attributes["status"] == "soon"
    assert hass.states.get(_eid(hass, "date", "AAAA")).attributes["soon_days"] == 7
    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert out["count"] == 1 and out["items"][0]["status"] == "soon"


async def test_recipes_from_selected_containers_ignore_the_period(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _setup(hass, "CCCC")
    await _setup(hass, "DDDD")
    await _fill(hass, "AAAA", "Schinken", 200)
    await _fill(hass, "BBBB", "Suppe", 1)
    await _fill(hass, "CCCC", "Alter Fisch", -1)  # abgelaufen: bleibt draußen, auch wenn gewählt
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "DDDD"), "value": "Reis"}, blocking=True)
    calls = _fake_ai(hass, {"recipes": [RECIPE]})
    device = lambda cc: dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}).id  # noqa: E731

    out = await _suggest(hass, containers=[device("AAAA"), device("CCCC"), device("DDDD")])
    assert [i["content"] for i in out["ingredients"]] == ["Schinken", "Reis"]
    assert "picked these containers" in calls[0]["instructions"] and "Suppe" not in calls[0]["instructions"]

    out = await _suggest(hass, containers=["BBBB"])  # cc direkt geht auch
    assert [i["content"] for i in out["ingredients"]] == ["Suppe"]

    out = await _suggest(hass, containers=[device("CCCC")])
    assert out["recipes"] == [] and len(calls) == 2


async def test_resolve_code_websocket(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "larder/resolve_code", "code": "https://example.com/x?cc=AAAA&tc=1"})
    res = (await client.receive_json())["result"]
    assert res["valid"] and res["cc"] == "AAAA" and res["device_id"] and res["name"] == "Dose AAAA"
    await client.send_json({"id": 2, "type": "larder/resolve_code", "code": "ZZZZ"})
    res = (await client.receive_json())["result"]
    assert res["valid"] and res["device_id"] is None
    await client.send_json({"id": 3, "type": "larder/resolve_code", "code": ""})
    assert (await client.receive_json())["result"] == {"valid": False}
