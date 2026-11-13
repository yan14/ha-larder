"""Tests: Wochenplan, Kalendertermin und Auftau-Erinnerung."""

from datetime import timedelta

from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.plan import THAW_ACTION, async_get_plan, thaw_texts
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.util import dt as dt_util

from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _device(hass: HomeAssistant, cc: str) -> str:
    return dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}).id


def _move(hass: HomeAssistant, cc: str, area_name: str) -> str:
    area = ar.async_get(hass).async_get_or_create(area_name)
    dr.async_get(hass).async_update_device(_device(hass, cc), area_id=area.id)
    return area.id


async def test_plan_and_thaw_reminder(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    for cc in ("AAAA", "BBBB"):
        await _setup(hass, cc)
    _move(hass, "AAAA", "Gefrierschrank")
    _move(hass, "BBBB", "Kühlschrank")
    await _fill(hass, "AAAA", "Bolognese-Sauce", 90)
    await _fill(hass, "BBBB", "Parmesan", 20)
    ws = await hass_ws_client(hass)
    tomorrow = (dt_util.now().date() + timedelta(days=1)).isoformat()
    later = (dt_util.now().date() + timedelta(days=5)).isoformat()
    await ws.send_json(
        {"id": 1, "type": "larder/plan_add", "date": tomorrow, "title": "Spaghetti Bolognese",
         "device_ids": [_device(hass, "AAAA"), _device(hass, "BBBB")]}
    )
    msg = await ws.receive_json()
    assert msg["success"]
    added = msg["result"]["plan"]
    assert [c["frozen"] for c in added["containers"]] == [True, False]
    await ws.send_json({"id": 2, "type": "larder/plan_add", "date": later, "title": "Später", "device_ids": [_device(hass, "AAAA")]})
    await ws.receive_json()

    # nur die Dose aus dem Gefrierschrank, nur für den Plan innerhalb des Vorlaufs
    await ws.send_json({"id": 3, "type": "larder/plan_list"})
    msg = await ws.receive_json()
    assert [p["title"] for p in msg["result"]["plans"]] == ["Spaghetti Bolognese", "Später"]
    thaw = msg["result"]["thaw"]
    assert [(t["cc"], t["plan"], t["days_until"]) for t in thaw] == [("AAAA", "Spaghetti Bolognese", 1)]
    text, speech, button = thaw_texts(thaw, "de")
    assert text == "Zum Auftauen in den Kühlschrank:\n🧊 Bolognese-Sauce (Dose AAAA) für Spaghetti Bolognese, morgen"
    assert speech == "Bitte in den Kühlschrank stellen: Bolognese-Sauce aus Dose AAAA."
    assert button == "Aufgetaut"

    # tägliche Zusammenfassung: Auftauen zuerst, auch wenn nichts abläuft
    out = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 3}, blocking=True, return_response=True)
    assert out["count"] == 0 and len(out["thaw"]) == 1
    assert out["summary"].startswith("Zum Auftauen")
    assert out["labels"]["thawed"] == "Aufgetaut"

    # Knopf in der Push-Nachricht: aufgetaut, MHD gekürzt, Erinnerung weg
    before = hass.states.get(_eid(hass, "date", "AAAA")).state
    hass.bus.async_fire("mobile_app_notification_action", {"action": THAW_ACTION})
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass, "date", "AAAA")).state < before
    plan = await async_get_plan(hass)
    assert plan.thaw_items() == []

    # löschen
    await ws.send_json({"id": 4, "type": "larder/plan_delete", "plan_id": added["id"]})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 5, "type": "larder/plan_delete", "plan_id": added["id"]})
    assert not (await ws.receive_json())["success"]
    assert [p["title"] for p in plan.list()] == ["Später"]


async def test_thaw_days_setting_and_flexible_move(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    _move(hass, "AAAA", "Gefrierschrank")
    fridge = _move(hass, "AAAA", "Kühlschrank")  # Kühlschrank anlegen …
    _move(hass, "AAAA", "Gefrierschrank")  # … und zurück
    await _fill(hass, "AAAA", "Gulasch", 90)
    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": next(e for e in hass.states.async_entity_ids("switch") if "flexible" in e)}, blocking=True
    )
    plan = await async_get_plan(hass)
    in_three = dt_util.now().date() + timedelta(days=3)
    await plan.async_add(in_three, "Gulasch mit Knödeln", ["AAAA"])
    assert plan.thaw_items() == []  # Vorlauf 1 Tag
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({"thaw_days": 3})
    assert [t["days_until"] for t in plan.thaw_items()] == [3]

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "larder/thawed", "device_ids": [_device(hass, "AAAA")]})
    msg = await ws.receive_json()
    assert msg["result"]["thawed"] == 1
    assert dr.async_get(hass).async_get(_device(hass, "AAAA")).area_id == fridge  # variable Dose zieht um
    assert plan.thaw_items() == []


async def test_calendar_event_is_created_and_removed(hass: HomeAssistant) -> None:
    from .test_calendar_sync import _calendar

    await _setup(hass, "AAAA")
    cal = await _calendar(hass, "calendar.essen")
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({"meal_calendar": "calendar.essen"})
    plan = await async_get_plan(hass)
    day = dt_util.now().date() + timedelta(days=2)
    added = await plan.async_add(day, "Lasagne", [])
    assert [e.summary for e in cal.events] == ["🍽 Lasagne"]
    assert f"larder-plan:{added['id']}" in cal.events[0].description
    await plan.async_delete(added["id"])
    assert cal.events == []


async def test_cooked_and_shopping(hass: HomeAssistant, hass_ws_client) -> None:
    from custom_components.larder.history import async_get_history

    from .test_shopping import _todo

    for cc in ("AAAA", "BBBB"):
        await _setup(hass, cc)
    await _fill(hass, "AAAA", "Bolognese-Sauce", 60, quantity=3)
    await _fill(hass, "BBBB", "Parmesan", 20)
    todo = await _todo(hass)
    ws = await hass_ws_client(hass)
    tomorrow = (dt_util.now().date() + timedelta(days=1)).isoformat()
    await ws.send_json({
        "id": 1, "type": "larder/plan_add", "date": tomorrow, "title": "Spaghetti",
        "device_ids": [_device(hass, "AAAA"), _device(hass, "BBBB")],
        "ingredients": ["500 g Spaghetti", "Bolognese-Sauce", "Parmesan", "1 Zwiebel"],
    })
    plan = (await ws.receive_json())["result"]["plan"]
    assert plan["missing"] == ["500 g Spaghetti", "1 Zwiebel"]

    # Einkaufsliste: ohne gewählte Liste Fehler, sonst nur das Fehlende
    await ws.send_json({"id": 2, "type": "larder/plan_shopping", "plan_id": plan["id"]})
    assert (await ws.receive_json())["error"]["code"] == "no_shopping_list"
    estimator = await async_get_estimator(hass)
    await estimator.async_update_settings({"todo_entity": "todo.einkaufen"})
    await ws.send_json({"id": 3, "type": "larder/plan_shopping", "plan_id": plan["id"]})
    assert (await ws.receive_json())["result"] == {"added": 2, "missing": 2}
    assert todo.summaries == ["500 g Spaghetti", "1 Zwiebel"]

    # gekocht: Dose mit 3 Portionen → 2, Dose ohne Menge → geleert (gegessen); Plan verschwindet
    await ws.send_json({"id": 4, "type": "larder/plan_cooked", "plan_id": plan["id"]})
    assert (await ws.receive_json())["result"] == {"emptied": 1, "taken": 1}
    assert hass.states.get(_eid(hass, "number", "AAAA")).state == "2.0"
    assert hass.states.get(_eid(hass, "text", "BBBB")).state == ""
    assert (await async_get_history(hass)).list("BBBB")[0]["outcome"] == "eaten"
    assert (await async_get_plan(hass)).list() == []
