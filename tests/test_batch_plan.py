"""Tests Block 10: Behältergrößen (fest/variabel, lose Behälter, frei) und Wochenplan-Vorschlag."""

from datetime import timedelta

from custom_components.larder.const import DOMAIN
from custom_components.larder.recipe_book import async_get_recipe_book
from custom_components.larder.week_plan import async_suggest_week, uses_content
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _fake_ai, _fill, _options, _setup, auto_enable_custom_integrations  # noqa: F401


def _dev(hass, cc):
    return dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}).id


async def test_fixed_and_variable_sizes_and_free_boxes(hass: HomeAssistant, hass_ws_client) -> None:
    for cc in ("AAAA", "BBBB", "CCCC", "DDDD"):
        await _setup(hass, cc)
    # zwei feste 1-l-Dosen (eine befüllt), eine feste 0,5 l, ein variabler Deckel
    for cc, size in (("AAAA", "1 l"), ("BBBB", "1L"), ("CCCC", "0,5 l")):
        res = await _ws(hass, hass_ws_client, type="larder/size_set", device_id=_dev(hass, cc), size=size)
        assert res["success"], res
    await _ws(hass, hass_ws_client, type="larder/size_set", device_id=_dev(hass, "DDDD"), variable=True)
    res = await _ws(hass, hass_ws_client, type="larder/loose_set", loose={"1 l": 3, "2 l": 2, "3 l": 0})
    assert res["result"]["loose"] == {"1 l": 3, "2 l": 2}
    await _fill(hass, "AAAA", "Chili", 30)
    await _fill(hass, "DDDD", "Suppe", 30)
    res = await _ws(hass, hass_ws_client, type="larder/size_fill", device_id=_dev(hass, "DDDD"), size="2 l")
    overview = {r["size"]: (r["total"], r["filled"], r["free"]) for r in res["result"]["overview"]}
    # 1 l: 3 lose + 2 feste, davon 1 befüllt; 2 l: 2 lose, einer mit dem variablen Deckel befüllt
    assert overview == {"0,5 l": (1, 0, 1), "1 l": (5, 1, 4), "2 l": (2, 1, 1)}
    assert [r["size"] for r in res["result"]["overview"]] == ["0,5 l", "1 l", "2 l"]
    assert set(res["result"]["known"]) >= {"0,5 l", "1 l", "2 l"}
    await hass.async_block_till_done()
    attrs = hass.states.get(_eid(hass, "text", "DDDD")).attributes
    assert attrs["size"] == "2 l" and attrs["size_variable"] is True and attrs["size_last"] == "2 l"
    assert hass.states.get(_eid(hass, "text", "AAAA")).attributes["size"] == "1 l"
    # leere variable Dose: keine aktuelle Größe, aber der Vorschlag bleibt
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text", "DDDD"), "value": ""}, blocking=True)
    attrs = hass.states.get(_eid(hass, "text", "DDDD")).attributes
    assert "size" not in attrs and attrs["size_last"] == "2 l"
    res = await _ws(hass, hass_ws_client, type="larder/sizes")
    assert {r["size"]: r["free"] for r in res["result"]["overview"]}["2 l"] == 2
    res = await _ws(hass, hass_ws_client, type="larder/size_set", device_id="nope", size="1 l")
    assert not res["success"]


def test_ingredient_lines_match_contents() -> None:
    assert uses_content("500 g Rinderhack", "Hack")
    assert uses_content("1 Dose gehackte Tomaten", "Tomaten gehackt")
    assert uses_content("Chili con Carne (Rest)", "Chili")
    assert not uses_content("2 Zwiebeln", "Chili")
    assert not uses_content("Salz", "")


async def test_week_plan_from_recipe_book_then_ai(hass: HomeAssistant) -> None:
    for cc in ("AAAA", "BBBB", "CCCC", "DDDD"):
        await _setup(hass, cc)
    await _fill(hass, "AAAA", "Hackfleisch", 1)
    await _fill(hass, "BBBB", "Tomatensoße", 2)
    await _fill(hass, "CCCC", "Gekochte Eier", 3)
    await _fill(hass, "DDDD", "Schinken", 6)
    book = await async_get_recipe_book(hass)
    await book.async_save(title="Bolognese", ingredients=["500 g Hackfleisch", "1 Glas Tomatensoße", "Nudeln"], steps=["Kochen"])
    await book.async_save(title="Nudelauflauf", ingredients=["Tomatensoße", "Käse"], steps=["Backen"])
    calls = _fake_ai(hass)  # liefert "Schinken-Omelett" (Schinken, Gekochte Eier)

    # nur Rezeptbuch: Bolognese verbraucht Hack und Soße; der Auflauf hat dann nichts Neues mehr
    res = await async_suggest_week(hass, days=5, source="book")
    assert [d["title"] for d in res["days"]] == ["Bolognese"] and calls == []
    assert {u["content"] for u in res["days"][0]["uses"]} == {"Hackfleisch", "Tomatensoße"}
    assert res["days"][0]["date"] == dt_util.now().date().isoformat() and res["days"][0]["recipe_id"]

    # Rezeptbuch, sonst KI: die übrigen Dosen gehen an die KI
    res = await async_suggest_week(hass, days=5, source="book_ai")
    assert [d["title"] for d in res["days"]] == ["Bolognese", "Schinken-Omelett"]
    assert res["days"][1]["source"] == "ai" and res["days"][1]["date"] == (dt_util.now().date() + timedelta(days=1)).isoformat()
    assert {u["content"] for u in res["days"][1]["uses"]} == {"Schinken", "Gekochte Eier"}
    assert len(calls) == 1 and "Hackfleisch" not in str(calls[0]["instructions"])


async def test_week_plan_skips_planned_days_and_containers(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Hackfleisch", 1)
    await _fill(hass, "BBBB", "Linsen", 2)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    await _options(hass, entry, plan_source="book", plan_days=3)
    book = await async_get_recipe_book(hass)
    await book.async_save(title="Frikadellen", ingredients=["Hackfleisch"], steps=["Braten"])
    await book.async_save(title="Linsensuppe", ingredients=["Linsen"], steps=["Kochen"])
    today = dt_util.now().date()
    await _ws(hass, hass_ws_client, type="larder/plan_add", date=today.isoformat(), title="Pizza", device_ids=[_dev(hass, "AAAA")])
    res = await _ws(hass, hass_ws_client, type="larder/plan_suggest")
    days = res["result"]["days"]
    # heute ist schon geplant, Hackfleisch ist dafür eingeplant: nur die Linsensuppe ab morgen
    assert [(d["title"], d["date"]) for d in days] == [("Linsensuppe", (today + timedelta(days=1)).isoformat())]
    assert res["result"]["source"] == "book"
