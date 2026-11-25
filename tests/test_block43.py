"""Tests block 43 (5.8): freezer at a glance, short pushes, own storage time per product."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.expiry import build_speech, build_summary
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _move(hass: HomeAssistant, cc: str, area_id: str | None) -> None:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    dr.async_get(hass).async_update_device(device.id, area_id=area_id)


async def test_freezer_is_quality_not_expired(hass: HomeAssistant) -> None:
    """#156: in the freezer the date is the end of the best quality; the attribute follows a move."""
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    areas = ar.async_get(hass)
    freezer, fridge = areas.async_create("Gefrierschrank"), areas.async_create("Kühlschrank")
    _move(hass, "AAAA", freezer.id)
    _move(hass, "BBBB", fridge.id)
    await hass.async_block_till_done()
    await _fill(hass, "AAAA", "Chili", -10)
    await _fill(hass, "BBBB", "Lachs", -1)
    assert hass.states.get(_eid(hass, "date", "AAAA")).attributes["storage"] == "freezer"
    assert "storage" not in hass.states.get(_eid(hass, "date", "BBBB")).attributes
    res = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 3}, blocking=True, return_response=True)
    chili = next(i for i in res["items"] if i["content"] == "Chili")
    assert chili["frozen"] is True
    assert chili["line"].endswith("beste Qualität seit 10 Tagen vorbei, bald verbrauchen")
    assert "Lachs" in res["summary"] and "sollte geleert werden" in res["summary"]
    assert "Gefrierschrank über die beste Qualität hinaus" in res["speech"]
    # moved out of the freezer: the attribute follows right away
    _move(hass, "AAAA", fridge.id)
    await hass.async_block_till_done()
    assert "storage" not in hass.states.get(_eid(hass, "date", "AAAA")).attributes


def test_short_summary() -> None:
    """#157: one line per entry, only what and when (and how long it has been open)."""
    items = [
        {"name": "Dose 1", "cc": "A", "content": "Chili", "quantity": 2, "unit": "portions", "area": "Gefrierschrank", "days_left": -3, "status": "expired", "frozen": True},
        {"name": "Packung 1", "cc": "B", "content": "Mayo", "quantity": 1, "unit": "pieces", "area": "Kühlschrank", "days_left": 2, "status": "soon", "opened_days": 49},
    ]
    short = build_summary(items, "de", short=True)
    assert short.split("\n")[1:] == ["• Chili: beste Qualität seit 3 Tagen vorbei", "• Mayo (seit 7 Wochen offen): in 2 Tagen"]
    assert "Portionen" not in short and "Kühlschrank" not in short
    assert "Dose 1" not in build_summary(items, "de")  # frozen: no "empty container 1"
    assert "Chili in the freezer is past its best quality and should be used soon." in build_speech(items, "en")


async def test_service_responses_have_a_short_version(hass: HomeAssistant) -> None:
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Lachs", 1, quantity=2, unit="portions")
    res = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 3}, blocking=True, return_response=True)
    assert res["summary_short"].split("\n")[1] == "• Lachs: tomorrow"
    assert res["items"][0]["line_short"] == "Lachs: tomorrow"
    review = await hass.services.async_call(DOMAIN, "get_weekly_review", {}, blocking=True, return_response=True)
    assert review["summary_short"].count("\n") == 1
    report = await hass.services.async_call(DOMAIN, "get_monthly_report", {}, blocking=True, return_response=True)
    assert "\n" not in report["summary_short"]


async def test_own_storage_time_per_product(hass: HomeAssistant, hass_ws_client) -> None:
    """#158: an own storage time of exactly this product comes before the table, per place kind."""
    from datetime import timedelta

    from homeassistant.util import dt as dt_util

    from .test_disposable import _ws

    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    _move(hass, "AAAA", pantry.id)
    _move(hass, "BBBB", fridge.id)
    await hass.async_block_till_done()
    res = await _ws(hass, hass_ws_client, type="larder/storage_days", content="Omas Erdbeermarmelade", pantry=365, fridge=60)
    assert res["success"], res
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="omas erdbeermarmelade")
    assert res["result"]["own"]["storage_days"] == {"fridge": 60, "pantry": 365}
    today = dt_util.now().date()
    for cc, days in (("AAAA", 365), ("BBBB", 60)):
        await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", cc), "value": "Omas Erdbeermarmelade"}, blocking=True)
        date_id = _eid(hass, "date", cc)
        out = (await hass.services.async_call(DOMAIN, "estimate_best_before", {"entity_id": date_id, "overwrite": True}, blocking=True, return_response=True))[date_id]
        assert out["source"] == "product" and out["days"] == days
        assert out["best_before"] == (today + timedelta(days=days)).isoformat()
    assert "Eigene Lagerdauer" in out["tip"]
    # a similar product keeps the table (jam: 6 months in the fridge)
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "BBBB"), "value": "Erdbeermarmelade"}, blocking=True)
    date_id = _eid(hass, "date", "BBBB")
    out = (await hass.services.async_call(DOMAIN, "estimate_best_before", {"entity_id": date_id, "overwrite": True}, blocking=True, return_response=True))[date_id]
    assert out["source"] == "table" and out["days"] == round(180 * 1.3)  # vacuum is on by default
    # clearing one place keeps the other
    res = await _ws(hass, hass_ws_client, type="larder/storage_days", content="Omas Erdbeermarmelade", fridge=0)
    res = await _ws(hass, hass_ws_client, type="larder/product_history", content="Omas Erdbeermarmelade")
    assert res["result"]["own"]["storage_days"] == {"pantry": 365}
