"""Tests Block 8: Schätzung lernt aus dem Verlauf, Monatsbericht (Service und Blueprint), "Mal wieder …?"."""

from datetime import date, timedelta
from pathlib import Path
import shutil

import pytest

from custom_components.larder.estimate import async_get_estimator, cache_key
from custom_components.larder.history import async_get_history
from custom_components.larder.learning import build_suggestions
from custom_components.larder.stats import build_monthly_report
from custom_components.larder.stock import build_cook_again
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from .test_daily_summary import _notify
from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo

TODAY = date(2026, 11, 14)


def _rec(content, filled, best, emptied, outcome, area="Kühlschrank", vacuum=None):
    record = {
        "content": content,
        "area": area,
        "filled_at": f"{filled}T12:00:00+01:00",
        "best_before": best,
        "emptied": f"{emptied}T12:00:00+01:00",
        "outcome": outcome,
        "expired": best < emptied,
    }
    if vacuum is not None:
        record["vacuum"] = vacuum
    return record


def _d(n):
    return (TODAY - timedelta(days=n)).isoformat()


ENTRY = {"key": cache_key("Gekochte Eier", "Kühlschrank", True), "content": "Gekochte Eier", "area": "Kühlschrank", "vacuum": True, "days": 7}


def test_suggests_shorter_when_thrown_away_early() -> None:
    records = [
        _rec("Gekochte Eier", _d(40), _d(33), _d(36), "thrown"),  # nach 4 Tagen weg, MHD erst 3 Tage später
        _rec("gekochte eier", _d(20), _d(13), _d(15), "thrown", vacuum=True),  # nach 5 Tagen
        _rec("Gekochte Eier", _d(10), _d(3), _d(5), "thrown", vacuum=False),  # andere Variante: zählt nicht
    ]
    (s,) = build_suggestions([ENTRY], records, {}, TODAY)
    assert (s["direction"], s["suggested"], s["count"], s["days"]) == ("shorter", 4, 2, 7)  # Median 4,5 → 4
    assert build_suggestions([ENTRY], records, {ENTRY["key"]: 4}, TODAY) == []  # ignoriert
    assert build_suggestions([ENTRY], records[:1], {}, TODAY) == []  # einmal ist kein Muster


def test_suggests_longer_when_eaten_well_after_the_date() -> None:
    records = [
        _rec("Gekochte Eier", _d(40), _d(33), _d(28), "eaten"),  # 12 Tage, 5 nach MHD
        _rec("Gekochte Eier", _d(20), _d(13), _d(10), "eaten"),  # 10 Tage
        _rec("Gekochte Eier", _d(500), _d(493), _d(490), "eaten"),  # zu alt
    ]
    (s,) = build_suggestions([ENTRY], records, {}, TODAY)
    assert (s["direction"], s["suggested"]) == ("longer", 10)
    # einmal vor dem MHD weggeworfen: nicht verlängern
    records.append(_rec("Gekochte Eier", _d(9), _d(2), _d(4), "thrown"))
    assert build_suggestions([ENTRY], records, {}, TODAY) == []


async def test_suggestion_websocket_accept_and_ignore(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    estimator = await async_get_estimator(hass)
    key = await estimator.async_add_entry("Gekochte Eier", "Kühlschrank", True, 7)
    history = await async_get_history(hass)
    now = dt_util.now().date()
    ago = lambda n: (now - timedelta(days=n)).isoformat()  # noqa: E731
    history.records += [_rec("Gekochte Eier", ago(40), ago(33), ago(36), "thrown"), _rec("Gekochte Eier", ago(20), ago(13), ago(17), "thrown")]
    res = await _ws(hass, hass_ws_client, type="larder/estimate_suggestions")
    assert [(s["key"], s["suggested"]) for s in res["result"]["suggestions"]] == [(key, 3)]
    res = await _ws(hass, hass_ws_client, type="larder/estimate_suggestion", key=key, action="ignore")
    assert res["result"]["suggestions"] == []
    # neuer Fall ändert den Vorschlag: kommt wieder
    history.records += [_rec("Gekochte Eier", ago(9), ago(2), ago(7), "thrown"), _rec("Gekochte Eier", ago(8), ago(1), ago(6), "thrown")]
    res = await _ws(hass, hass_ws_client, type="larder/estimate_suggestions")
    assert res["result"]["suggestions"][0]["suggested"] == 2
    res = await _ws(hass, hass_ws_client, type="larder/estimate_suggestion", key=key, action="accept")
    assert res["result"]["suggestions"] == []
    assert next(e for e in res["result"]["entries"] if e["key"] == key)["days"] == 2


def test_monthly_report_compares_with_the_previous_month() -> None:
    records = [
        _rec("Lachs", "2026-10-01", "2026-10-05", "2026-10-04", "eaten"),
        _rec("Käse", "2026-10-02", "2026-10-10", "2026-10-20", "thrown"),
        _rec("Käse, Salami", "2026-10-11", "2026-10-15", "2026-10-25", None),  # abgelaufen ohne Antwort: weggeworfen
        _rec("Gulasch", "2026-09-01", "2026-09-30", "2026-10-03", "eaten"),
        _rec("Suppe", "2026-09-01", "2026-09-30", "2026-09-10", "eaten"),
        _rec("Brot", "2026-09-01", "2026-09-05", "2026-09-12", "thrown"),
        _rec("Reis", "2026-09-05", "2026-12-05", "2026-09-15", "eaten"),
        _rec("Reis", "2026-09-05", "2026-12-05", "2026-09-16", "eaten"),
    ]
    report = build_monthly_report(records, ["2026-10-30", "2026-11-02"], "2026-10", "de")
    assert (report["filled"], report["emptied"], report["eaten"], report["thrown"]) == (4, 4, 2, 2)
    assert (report["waste_percent"], report["previous_waste_percent"], report["trend"]) == (50, 25, "worse")
    assert report["top_thrown"][0] == {"content": "Käse", "count": 2}
    assert report["label"] == "Oktober 2026" and report["empty"] is False
    assert "Vormonat 25 %" in report["summary"] and "mehr als im Vormonat" in report["speech"]
    assert build_monthly_report(records, [], "2026-06", "en")["empty"] is True
    assert build_monthly_report(records, [], "2026-10", "en")["label"] == "October 2026"


BLUEPRINT = Path(__file__).parents[1] / "blueprints/automation/larder/monthly_report.yaml"


@pytest.fixture
async def blueprint(hass: HomeAssistant):
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(BLUEPRINT, target / BLUEPRINT.name)
    yield
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)


async def test_monthly_report_blueprint(hass: HomeAssistant, blueprint) -> None:
    await _setup(hass, "AAAA")
    history = await async_get_history(hass)
    month = (dt_util.now().date().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    history.records.append(_rec("Lachs", f"{month}-02", f"{month}-06", f"{month}-05", "eaten"))
    calls = _notify(hass, "mobile_app_yan", "alexa")
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": {"id": "larder_monthly", "alias": "Larder monthly", "use_blueprint": {"path": f"larder/{BLUEPRINT.name}", "input": {
            "notify_action": "notify.mobile_app_yan", "voice_action": "notify.alexa", "day": dt_util.now().day}}}},
    )
    await hass.async_block_till_done()
    await hass.services.async_call("automation", "trigger", {"entity_id": "automation.larder_monthly", "skip_condition": False}, blocking=True)
    await hass.async_block_till_done()
    (push,) = calls["mobile_app_yan"]
    assert push["title"].startswith("Larder: ") and "1 eaten" in push["message"]
    assert push["data"]["url"] == "/larder?view=stats"
    assert calls["alexa"] and "1 were eaten" in calls["alexa"][0]["message"]
    res = await hass.services.async_call("larder", "get_monthly_report", {"month": month}, blocking=True, return_response=True)
    assert res["eaten"] == 1


def test_cook_again_suggestions() -> None:
    records = [_rec("Bolognese", _d(n + 5), _d(n), _d(n), "eaten") for n in (10, 30, 60)]
    records += [_rec("Bolognese", _d(150), _d(140), _d(140), "eaten")]  # zu alt
    records += [_rec("Chili, Reis", _d(n + 5), _d(n), _d(n), "eaten") for n in (5, 15, 25, 35)]
    records += [_rec("Suppe", _d(n + 5), _d(n), _d(n), "thrown") for n in (5, 15, 25)]
    out = build_cook_again(records, {"reis"}, {}, TODAY)
    assert [(s["content"], s["count"]) for s in out] == [("Chili", 4), ("Bolognese", 3)]
    assert build_cook_again(records, set(), {"chili": "2026-12-01"}, TODAY)[0]["content"] == "Reis"


async def test_cook_again_websocket(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    history = await async_get_history(hass)
    now = dt_util.now().date()
    history.records += [_rec("Bolognese", (now - timedelta(days=n + 3)).isoformat(), (now - timedelta(days=n)).isoformat(), (now - timedelta(days=n)).isoformat(), "eaten") for n in (5, 10, 20)]
    res = await _ws(hass, hass_ws_client, type="larder/cook_again")
    assert [i["content"] for i in res["result"]["items"]] == ["Bolognese"] and res["result"]["shopping_list"]
    # gerade in einer Dose: kein Vorschlag
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "AAAA"), "value": "Bolognese"}, blocking=True)
    assert (await _ws(hass, hass_ws_client, type="larder/cook_again"))["result"]["items"] == []
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "AAAA"), "value": ""}, blocking=True)
    res = await _ws(hass, hass_ws_client, type="larder/cook_again_action", content="Bolognese", action="shop")
    assert res["result"] == {"added": True, "items": []}
    assert todo.summaries == ["Bolognese"]
