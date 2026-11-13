"""Tests: Blueprint „tägliche Zusammenfassung“ als echte Automation (Push, Sprache, Bewegung, Anwesenheit)."""

from datetime import timedelta
from pathlib import Path
import shutil

from freezegun.api import FrozenDateTimeFactory
import pytest
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.larder.expiry import build_speech
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from .test_recipes import RECIPE, _fake_ai, _fill, _setup, auto_enable_custom_integrations  # noqa: F401

BLUEPRINT = Path(__file__).parents[1] / "blueprints/automation/larder/expiry_notification.yaml"


def _notify(hass: HomeAssistant, *names: str) -> dict[str, list[dict]]:
    calls: dict[str, list[dict]] = {}
    for name in names:
        calls[name] = []

        async def handler(call: ServiceCall, name=name) -> None:
            calls[name].append(dict(call.data))

        hass.services.async_register("notify", name, handler)
    return calls


@pytest.fixture
async def blueprint(hass: HomeAssistant):
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(BLUEPRINT, target / BLUEPRINT.name)
    yield
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)


async def _automation(hass: HomeAssistant, **inputs) -> None:
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "id": "larder_daily",
                "alias": "Larder daily",
                "use_blueprint": {"path": f"larder/{BLUEPRINT.name}", "input": inputs},
            }
        },
    )
    await hass.async_block_till_done()
    assert hass.states.get("automation.larder_daily").state == "on"


async def _at(hass: HomeAssistant, freezer: FrozenDateTimeFactory, hhmmss: str, days: int = 0) -> None:
    target = dt_util.parse_datetime(f"{(dt_util.now().date() + timedelta(days=days)).isoformat()}T{hhmmss}")
    target = target.replace(tzinfo=dt_util.get_default_time_zone())
    freezer.move_to(target)
    async_fire_time_changed(hass, target)
    await hass.async_block_till_done()


async def test_push_to_several_targets_with_buttons_and_voice(hass: HomeAssistant, blueprint, freezer) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Lachs", 0)
    await _fill(hass, "BBBB", "Gouda", 1)
    _fake_ai(hass, {"recipes": [RECIPE]})
    calls = _notify(hass, "mobile_app_yan", "mobile_app_partner", "alexa_media_kueche")
    await _at(hass, freezer, "06:00:00", days=1)
    await _fill(hass, "AAAA", "Lachs", 0)
    await _fill(hass, "BBBB", "Gouda", 1)
    await _automation(
        hass,
        notify_action="notify.mobile_app_yan, notify.mobile_app_partner",
        voice_action="notify.alexa_media_kueche",
        voice_data={"type": "announce"},
        recipes=True,
    )
    await _at(hass, freezer, "08:00:00")
    for target in ("mobile_app_yan", "mobile_app_partner"):
        (push,) = calls[target]
        assert push["title"] == "Larder"
        assert "Lachs" in push["message"] and "Schinken-Omelett" in push["message"]
        assert push["data"]["actions"][0] == {"action": "URI", "title": "Recipes", "uri": "/larder?view=recipes"}
        assert push["data"]["actions"][1]["uri"] == "/larder" and push["data"]["url"] == "/larder"
    (voice,) = calls["alexa_media_kueche"]
    assert voice["data"] == {"type": "announce"}
    assert voice["message"] == "Lachs expires today. Gouda expires tomorrow. Idea: Schinken-Omelett."

    # nur einmal am Tag
    await _at(hass, freezer, "08:00:00", days=0)
    hass.bus.async_fire("x")
    assert len(calls["mobile_app_yan"]) == 1


async def test_motion_window_fallback_and_presence(hass: HomeAssistant, blueprint, freezer) -> None:
    await _setup(hass, "AAAA")
    calls = _notify(hass, "mobile_app_yan", "alexa_media_kueche")
    hass.states.async_set("binary_sensor.kueche", "off")
    hass.states.async_set("person.yan", "not_home")
    await _at(hass, freezer, "05:00:00", days=1)
    await _fill(hass, "AAAA", "Lachs", 0)
    await _automation(
        hass,
        notify_action="notify.mobile_app_yan",
        voice_action="notify.alexa_media_kueche",
        motion_sensors=["binary_sensor.kueche"],
        presence=["person.yan"],
        send_time="07:00:00",
        latest_time="11:00:00",
        buttons=False,
        recipes_page="classic",
    )
    # 07:00 ohne Bewegung: nichts; Bewegung vor 07:00: nichts
    await _at(hass, freezer, "06:30:00")
    hass.states.async_set("binary_sensor.kueche", "on")
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.kueche", "off")
    await _at(hass, freezer, "07:00:00")
    assert calls["mobile_app_yan"] == []

    # Bewegung um 07:30: Push, aber keine Sprache (niemand zu Hause)
    await _at(hass, freezer, "07:30:00")
    hass.states.async_set("binary_sensor.kueche", "on")
    await hass.async_block_till_done()
    (push,) = calls["mobile_app_yan"]
    assert push["data"] == {}
    assert calls["alexa_media_kueche"] == []

    # zweite Bewegung am selben Tag und 11:00: nichts mehr
    hass.states.async_set("binary_sensor.kueche", "off")
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.kueche", "on")
    await _at(hass, freezer, "11:00:00")
    assert len(calls["mobile_app_yan"]) == 1

    # nächster Tag ohne Bewegung: spätestens 11:00, jetzt mit jemandem zu Hause
    hass.states.async_set("binary_sensor.kueche", "off")
    hass.states.async_set("person.yan", "home")
    await _fill(hass, "AAAA", "Lachs", 1)
    await _at(hass, freezer, "11:00:00", days=1)
    assert len(calls["mobile_app_yan"]) == 2
    assert calls["alexa_media_kueche"][0]["message"] == "Lachs expires today."


async def test_nothing_expiring_sends_nothing(hass: HomeAssistant, blueprint, freezer) -> None:
    await _setup(hass, "AAAA")
    calls = _notify(hass, "mobile_app_yan")
    await _at(hass, freezer, "06:00:00", days=1)
    await _fill(hass, "AAAA", "Reis", 200)
    await _automation(hass, notify_action="notify.mobile_app_yan")
    await _at(hass, freezer, "08:00:00")
    assert calls["mobile_app_yan"] == []


def test_speech_text() -> None:
    item = lambda content, days: {"content": content, "name": "Dose", "days_left": days}  # noqa: E731
    items = [item("Lachs", 0), item("Gouda", 1), item("Chili", 3), item("Reis", 3), item("Pizza", -2)]
    assert build_speech(items, "de") == "Heute läuft Lachs ab. Morgen läuft Gouda ab. In 3 Tagen laufen Chili und Reis ab. Pizza in Dose ist abgelaufen und sollte geleert werden."
    assert build_speech(items, "en") == "Lachs expires today. Gouda expires tomorrow. Chili and Reis expire in 3 days. Pizza in Dose has expired and should be emptied."
    many = [item(f"X{i}", i % 2) for i in range(8)]
    assert build_speech(many, "de") == "Heute laufen X0, X2, X4 und X6 ab. Morgen laufen X1 und X3 ab. Dazu 2 weitere."
    assert build_speech([], "de") == "Nichts läuft bald ab."
    two = [item("Pizza", -1), {"content": "", "name": "Dose 7", "days_left": -3}]
    assert build_speech(two, "de") == "Pizza in Dose und Dose 7 sind abgelaufen und sollten geleert werden."


async def test_thaw_reminder_is_sent_even_without_expiring(hass: HomeAssistant, blueprint, freezer) -> None:
    from custom_components.larder.const import DOMAIN
    from custom_components.larder.plan import async_get_plan
    from homeassistant.helpers import area_registry as ar, device_registry as dr

    await _setup(hass, "AAAA")
    calls = _notify(hass, "mobile_app_yan")
    await _at(hass, freezer, "06:00:00", days=1)
    area = ar.async_get(hass).async_get_or_create("Gefrierschrank")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await _fill(hass, "AAAA", "Gulasch", 120)
    plan = await async_get_plan(hass)
    await plan.async_add(dt_util.now().date() + timedelta(days=1), "Gulasch mit Knödeln", ["AAAA"])
    await _automation(hass, notify_action="notify.mobile_app_yan")
    await _at(hass, freezer, "08:00:00")
    (push,) = calls["mobile_app_yan"]
    assert "Gulasch (Dose AAAA)" in push["message"]
    assert push["data"]["actions"][0] == {"action": "LARDER_THAWED", "title": "Thawed"}
