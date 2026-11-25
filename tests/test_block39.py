"""Tests block 39 (5.5): shelf life after opening from USDA FoodKeeper, hidden features forward."""

from datetime import timedelta

import pytest

from custom_components.larder import shelf_life
from custom_components.larder.const import DOMAIN
from custom_components.larder.estimate import StorageContext, build_instructions
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def _opened(content: str, area: str) -> shelf_life.TableResult:
    return shelf_life.lookup(content, area_name=area, temperature_c=None, label_texts=(), vacuum=False, language="de", opened=True)


@pytest.mark.parametrize(
    ("content", "fridge"),
    [("Ketchup", 180), ("Curry Ketchup", 180), ("Senf", 365), ("Mayonnaise", 60), ("Sojasoße", 30), ("BBQ Sauce", 120),
     ("Sriracha", 180), ("Salatdressing", 30), ("Meerrettich", 90), ("Oliven", 14), ("Gewürzgurken", 30),
     ("Erdbeer Marmelade", 180), ("Milch", 7), ("Joghurt", 7)],
)
def test_values_after_opening_follow_foodkeeper(content: str, fridge: int) -> None:
    result = _opened(content, "Kühlschrank")
    assert result.days == fridge
    assert "USDA FoodKeeper" in result.tip and "USDA FoodKeeper" in result.basis


def test_after_opening_in_the_pantry() -> None:
    assert _opened("Ketchup", "Vorrat").days == 30
    assert _opened("Tabasco", "Vorrat").days == 180
    with pytest.raises(shelf_life.TableUnsuitable):
        _opened("Mayonnaise", "Vorrat")  # keep cold once opened
    # several items: the shortest decides
    assert _opened("Ketchup, Mayo", "Kühlschrank").days == 60
    # without a value after opening the storage value applies (fresh food)
    assert _opened("Hackfleisch", "Kühlschrank").days == 1


def test_condiments_no_longer_share_one_row() -> None:
    ids = {shelf_life.find_entry(n).id for n in ("Ketchup", "Senf", "Mayonnaise", "Sojasoße", "Worcestershire")}
    assert ids == {"ketchup", "mustard", "mayonnaise", "soy_sauce", "worcester"}
    assert shelf_life.find_entry("Tomatensoße").id == "soup"


def test_ai_is_asked_for_after_opening() -> None:
    text = build_instructions(content="Chutney", context=StorageContext("Kühlschrank", []), vacuum=False,
                              filled=dt_util.now().date(), language="de", opened=True)
    assert "AFTER OPENING" in text and "FoodKeeper" in text


async def test_opened_button_uses_the_table(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, pantry = areas.async_create("Kühlschrank"), areas.async_create("Vorrat")
    today = dt_util.now().date()
    printed = (today + timedelta(days=300)).isoformat()
    ketchup = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 1, "unit": "pieces", "best_before": printed}], fridge.id, ""))[0]
    date_id = _eid(hass, "date", ketchup["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=180)).isoformat()
    assert out["source"] == "table" and "6 Monate" in out["tip"]
    # mayonnaise in the pantry: keep cold → setting "shelf life after opening", with the reason
    mayo = (await _packs(hass, hass_ws_client, [{"content": "Mayonnaise", "quantity": 1, "unit": "pieces", "best_before": printed}], pantry.id, ""))[0]
    date_id = _eid(hass, "date", mayo["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=3)).isoformat()
    assert out["source"] == "setting" and out["reason"] == "table_unsuitable"
    # never longer than the printed date
    short = (today + timedelta(days=20)).isoformat()
    senf = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces", "best_before": short}], fridge.id, ""))[0]
    date_id = _eid(hass, "date", senf["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == short


async def test_open_pack_into_the_fridge_gets_six_months(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    today = dt_util.now().date()
    printed = (today + timedelta(days=300)).isoformat()
    src = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "best_before": printed}], pantry.id, ""))[0]
    res = await _ws(hass, hass_ws_client, type="larder/pack_open", device_id=src["device_id"], area_id=fridge.id)
    assert res["success"], res
    assert res["result"]["best_before"] == (today + timedelta(days=180)).isoformat()
    assert dr.async_get(hass).async_get(res["result"]["device_id"]).area_id == fridge.id


async def test_product_view_brings_stock_and_history_together(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Keller")
    await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces", "product": {"price": 2.49, "brand": "Heinz"}}], pantry.id, "Regal")
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Ketchup", min=3)
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="ketchup")
    product = res["result"]["product"]
    assert product["name"] == "Ketchup" and product["count"] == 2 and product["min"] == 3 and product["low"] is True
    assert product["places"][0]["area"] == "Keller" and product["price"]["price"] == 2.49
    # unknown product: history only
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="Senf")
    assert res["result"]["product"] is None


def test_every_row_names_its_source() -> None:
    """5.6 (#151): every row either has a confirmed source or says it is Larder's own estimate."""
    allowed = {shelf_life.FSIS, shelf_life.FOODKEEPER, shelf_life.EXTENSION, shelf_life.CONSUMER_DE, shelf_life.OWN, f"{shelf_life.FSIS}, Verbraucherzentrale"}
    for entry in shelf_life.ENTRIES:
        assert shelf_life.source_of(entry.id) in allowed
    assert set(shelf_life.SOURCES) <= {e.id for e in shelf_life.ENTRIES}
    result = shelf_life.lookup("Hackfleisch", area_name="Kühlschrank", temperature_c=None, label_texts=(), vacuum=False, language="de")
    assert result.days == 1 and result.tip.endswith("Quelle: USDA-FSIS Cold Food Storage Chart.")
    result = shelf_life.lookup("Kuchen", area_name="Kühlschrank", temperature_c=None, label_texts=(), vacuum=False, language="de")
    assert "vorsichtige Schätzung von Larder" in result.tip and result.basis.endswith("Larder (Schätzung)")


@pytest.mark.parametrize(
    ("content", "area", "days"),
    [("Steak", "Kühlschrank", 3), ("Steak", "Gefrierschrank", 120), ("Hähnchenbrust", "Gefrierschrank", 270),
     ("Lachs", "Gefrierschrank", 60), ("Bratwurst", "Kühlschrank", 1), ("Bacon", "Kühlschrank", 7),
     ("Aufschnitt", "Kühlschrank", 3), ("Milch", "Kühlschrank", 7), ("Joghurt", "Gefrierschrank", 30),
     ("Gouda", "Kühlschrank", 21), ("Reste", "Gefrierschrank", 60), ("Erdbeeren", "Kühlschrank", 2),
     ("Äpfel", "Vorrat", 21), ("Zitronen", "Kühlschrank", 14), ("Kartoffeln", "Vorrat", 30)],
)
def test_checked_values(content: str, area: str, days: int) -> None:
    result = shelf_life.lookup(content, area_name=area, temperature_c=None, label_texts=(), vacuum=False, language="de")
    assert result.days == days


async def test_opened_is_remembered_and_named_in_the_reminder(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    """5.6 (#152): Opened notes the day; the expiry summary says how long it has been open."""
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    today = dt_util.now().date()
    mayo = (await _packs(hass, hass_ws_client, [{"content": "Mayonnaise", "quantity": 1, "unit": "pieces", "best_before": (today + timedelta(days=200)).isoformat()}], fridge.id, ""))[0]
    date_id = _eid(hass, "date", mayo["cc"])
    await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True)
    text_id = _eid(hass, "text", mayo["cc"])
    assert hass.states.get(text_id).attributes["opened"] == today.isoformat()
    # seven weeks later: one week left, the reminder says how long it has been open
    freezer.tick(timedelta(days=49))
    res = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 14}, blocking=True, return_response=True)
    item = next(i for i in res["items"] if i["content"] == "Mayonnaise")
    assert item["opened_days"] == 49 and "seit 7 Wochen offen" in item["line"]
    # pressing Opened again keeps the first day
    await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True)
    assert hass.states.get(text_id).attributes["opened"] == today.isoformat()


@pytest.mark.parametrize(
    ("content", "area", "days", "source"),
    [("Reis", "Kühlschrank", 1, "Verbraucherzentrale / DGE"), ("Basmatireis", "Vorrat", 365, "Verbraucherzentrale / DGE"),
     ("Rehkeule", "Gefrierschrank", 180, "US Extension"), ("Eier", "Kühlschrank", 21, "Verbraucherzentrale")],
)
def test_german_and_more_sources(content: str, area: str, days: int, source: str) -> None:
    """5.7 (#153)."""
    result = shelf_life.lookup(content, area_name=area, temperature_c=None, label_texts=(), vacuum=False, language="de")
    assert result.days == days and source in result.tip


async def test_after_opening_per_product_comes_first(hass: HomeAssistant, hass_ws_client) -> None:
    """5.7 (#154): the value from the pack applies to exactly this product, before the table."""
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    today = dt_util.now().date()
    later = (today + timedelta(days=300)).isoformat()
    zero, plain = await _packs(hass, hass_ws_client, [
        {"content": "Heinz Ketchup Zero", "quantity": 1, "unit": "pieces", "best_before": later},
        {"content": "Heinz Ketchup", "quantity": 1, "unit": "pieces", "best_before": later},
    ], fridge.id, "")
    res = await _ws(hass, hass_ws_client, type="larder/opened_after", content="Heinz Ketchup Zero", days=56, source="label")
    assert res["success"], res
    assert next(p for p in res["result"]["products"] if p["name"] == "Heinz Ketchup Zero")["opened_after"] == 56
    assert "opened_after" not in next(p for p in res["result"]["products"] if p["name"] == "Heinz Ketchup")
    date_id = _eid(hass, "date", zero["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=56)).isoformat()
    assert out["source"] == "product" and "8 Wochen (laut Packung)" in out["tip"]
    # the similar product keeps the table value (never mixed)
    date_id = _eid(hass, "date", plain["cc"])
    out = (await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True))[date_id]
    assert out["best_before"] == (today + timedelta(days=180)).isoformat() and out["source"] == "table"
    # clearing it
    res = await _ws(hass, hass_ws_client, type="larder/opened_after", content="Heinz Ketchup Zero", days=0)
    assert "opened_after" not in next(p for p in res["result"]["products"] if p["name"] == "Heinz Ketchup Zero")


def test_after_opening_read_from_the_pack() -> None:
    from custom_components.larder.date_photo import parse_opened
    from custom_components.larder.estimate import EstimateError

    assert parse_opened({"found": True, "amount": 4, "unit": "weeks"}) == 28
    assert parse_opened({"found": True, "amount": 12, "unit": "months"}) == 360
    assert parse_opened({"found": True, "amount": 3, "unit": "days"}) == 3
    for bad in ({"found": False}, {"found": True, "amount": 0, "unit": "days"}, {"found": True, "amount": 2, "unit": "years"}, None):
        with pytest.raises(EstimateError):
            parse_opened(bad)


async def test_blueprint_opened_reminder(hass: HomeAssistant, hass_ws_client, freezer) -> None:
    """5.7 (#155): weekly push with the opened items that run out soon – and nothing else."""
    from pathlib import Path
    import shutil

    from homeassistant.setup import async_setup_component

    from .test_daily_summary import _at, _notify

    hass.config.language = "de"
    path = Path(__file__).parents[1] / "blueprints/automation/larder/opened_reminder.yaml"
    target = Path(hass.config.path("blueprints/automation/larder"))
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(path, target / path.name)
    await _setup(hass, "AAAA")
    fridge = ar.async_get(hass).async_create("Kühlschrank")
    calls = _notify(hass, "mobile_app_yan")
    today = dt_util.now().date()
    mayo, senf = await _packs(hass, hass_ws_client, [
        {"content": "Mayonnaise", "quantity": 1, "unit": "pieces", "best_before": (today + timedelta(days=300)).isoformat()},
        {"content": "Senf", "quantity": 1, "unit": "pieces", "best_before": (today + timedelta(days=3)).isoformat()},
    ], fridge.id, "")
    date_id = _eid(hass, "date", mayo["cc"])
    await hass.services.async_call(DOMAIN, "mark_opened", {"entity_id": date_id}, blocking=True, return_response=True)
    weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(dt_util.now() + timedelta(days=55)).weekday()]
    assert await async_setup_component(hass, "automation", {"automation": {"id": "opened", "alias": "opened", "use_blueprint": {
        "path": f"larder/{path.name}", "input": {"notify_action": "notify.mobile_app_yan", "weekday": weekday, "send_time": "10:00:00"}}}})
    await hass.async_block_till_done()
    # 55 days later the opened mayonnaise has 5 days left; the unopened mustard (expired) is not in it
    await _at(hass, freezer, "10:00:00", days=55)
    assert len(calls["mobile_app_yan"]) == 1
    message = calls["mobile_app_yan"][0]["message"]
    assert "Mayonnaise" in message and "seit 8 Wochen offen" in message and "Senf" not in message
    shutil.rmtree(Path(hass.config.path("blueprints")), ignore_errors=True)
