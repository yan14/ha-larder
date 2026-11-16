"""Tests Block 18 (4.1): several shopping lists, household statistics, recalls for household items."""

from custom_components.larder.stock import async_get_stock
from homeassistant.components import todo as ha_todo
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.setup import async_setup_component

from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock_daily import CheckableTodo


async def _lists(hass: HomeAssistant, *names: str) -> list[CheckableTodo]:
    assert await async_setup_component(hass, "todo", {})
    todos = [CheckableTodo(name) for name in names]
    await hass.data[ha_todo.DATA_COMPONENT].async_add_entities(todos)
    return todos


async def _create(hass, hass_ws_client, kind, items, area_id=None, **extra):
    msg = {"type": "larder/create_items", "kind": kind, "items": items, **extra}
    if area_id:
        msg["area_id"] = area_id
    res = await _ws(hass, hass_ws_client, **msg)
    assert res["success"], res
    return res["result"]["items"]


async def test_default_lists_per_kind_and_a_list_per_product(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    food, drug, butcher = await _lists(hass, "todo.einkaufen", "todo.drogerie", "todo.metzger")
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen", todo_household="todo.drogerie")
    area = ar.async_get(hass).async_create("Keller")
    await _create(hass, hass_ws_client, "pack", [{"content": "Senf", "quantity": 1, "unit": "pieces"}], area.id)
    await _create(hass, hass_ws_client, "household", [{"content": "Klopapier", "quantity": 8, "unit": "pieces", "product": {"pack_size": 8, "piece": "Rollen"}}], area.id)
    # chosen in the add dialog: remembered for the product
    await _create(hass, hass_ws_client, "pack", [{"content": "Leberkäse", "quantity": 1, "unit": "pieces"}], area.id, shopping_list="todo.metzger")
    for content, minimum in (("Senf", 2), ("Klopapier", 16), ("Leberkäse", 2)):
        await _ws(hass, hass_ws_client, type="larder/stock_min", content=content, min=minimum)
    await hass.async_block_till_done()
    assert food.summaries == ["Senf"]
    assert drug.summaries == ["Klopapier (1 Packung)"]
    assert butcher.summaries == ["Leberkäse"]
    stock = await async_get_stock(hass)
    assert {k: v["list"] for k, v in stock.tracked.items()} == {
        "senf": "todo.einkaufen", "klopapier (1 packung)": "todo.drogerie", "leberkäse": "todo.metzger",
    }
    # bought: every list Larder wrote to is watched
    butcher.check("Leberkäse")
    drug.check("Klopapier (1 Packung)")
    await hass.async_block_till_done()
    res = await _ws(hass, hass_ws_client, type="larder/bought")
    assert sorted(i["content"] for i in res["result"]["items"]) == ["Klopapier", "Leberkäse"]
    # the card: own list as an attribute; back to the default list
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    assert next(p for p in res["result"]["products"] if p["key"] == "leberkäse")["list"] == "todo.metzger"
    res = await _ws(hass, hass_ws_client, type="larder/product_list", content="Leberkäse")
    assert res["result"]["list"] is None and "leberkäse" not in stock.lists
    # a product of its own list that is gone falls back to the default
    await _ws(hass, hass_ws_client, type="larder/product_list", content="Senf", list="todo.gibtsnicht")
    from custom_components.larder.shopping import shopping_list_for

    assert shopping_list_for(hass, "Senf") == "todo.einkaufen"


async def test_household_falls_back_to_the_food_list(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    (food,) = await _lists(hass, "todo.einkaufen")
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    await _create(hass, hass_ws_client, "household", [{"content": "Spülmittel", "quantity": 1, "unit": "pieces"}])
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Spülmittel", min=2)
    await hass.async_block_till_done()
    assert food.summaries == ["Spülmittel"]
    # only a household list, no food list: food has no list, household does
    await _options(hass, entry, todo_household="todo.einkaufen")
    res = await _ws(hass, hass_ws_client, type="larder/settings")
    assert res["result"]["shopping_list"] is True


def test_household_statistics_per_month_and_product() -> None:
    from datetime import date

    from custom_components.larder.stats import household_statistics

    takes = [
        # toilet paper: 8 rolls per pack at 4 € → 0.50 € per roll
        {"key": "klopapier", "day": "2026-10-03", "n": 6, "hh": True, "size": 8, "price": 4.0},
        {"key": "klopapier", "day": "2026-11-02", "n": 10, "hh": True, "size": 8, "price": 4.0},
        # no price known: counted in pieces, marked incomplete
        {"key": "batterien", "day": "2026-11-05", "n": 2, "hh": True, "size": 4},
        # food packs are left out, so are takes before the window
        {"key": "senf", "day": "2026-11-05", "n": 1},
        {"key": "klopapier", "day": "2025-01-01", "n": 99, "hh": True, "size": 8, "price": 4.0},
    ]
    names = {"klopapier": {"name": "Klopapier", "piece": "Rollen"}, "batterien": {"name": "Batterien AA"}}
    res = household_statistics(takes, names, date(2026, 11, 16), months=6)
    assert [m["month"] for m in res["months"]] == ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
    nov = res["months"][-1]
    assert (nov["pieces"], nov["cost"], nov["priced"]) == (12, 5.0, False)
    paper, batteries = res["products"]
    assert paper["name"] == "Klopapier" and paper["pieces"] == 16 and paper["cost"] == 8.0
    # first take in October: averaged over 2 months, not 6
    assert paper["pieces_per_month"] == 8.0 and paper["cost_per_month"] == 4.0 and paper["complete"] is True
    assert batteries["cost"] is None and batteries["complete"] is False and batteries["pieces_per_month"] == 2.0
    assert res["cost_per_month"] == 4.0 and res["complete"] is False


async def test_household_takes_remember_pack_size_and_price(hass: HomeAssistant, hass_ws_client) -> None:
    from .test_recipes import _eid

    await _setup(hass, "AAAA")
    made = (await _create(hass, hass_ws_client, "household", [{"content": "Klopapier", "quantity": 16, "unit": "pieces", "product": {"pack_size": 8, "piece": "Rollen", "price": 4}}]))[0]
    await _create(hass, hass_ws_client, "pack", [{"content": "Senf", "quantity": 3, "unit": "pieces"}])
    number = _eid(hass, "number", made["cc"])
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 12}, blocking=True)
    await hass.async_block_till_done()
    stock = await async_get_stock(hass)
    assert stock.takes[-1] == {**stock.takes[-1], "key": "klopapier", "n": 4, "hh": True, "size": 8, "price": 4.0}
    res = await _ws(hass, hass_ws_client, type="larder/household_statistics")
    product = res["result"]["products"][0]
    assert (product["name"], product["piece"], product["pieces"], product["cost"]) == ("Klopapier", "Rollen", 4, 2.0)


async def test_recalls_for_household_items_use_the_feed_of_all_product_types(hass: HomeAssistant, hass_ws_client, aioclient_mock) -> None:
    from custom_components.larder.recall import FEED_ALL_URL, FEED_URL, async_get_recalls

    from .test_reorder_recall import KETCHUP, _rss

    toothpaste = (
        "Elmex Kariesschutz Zahnpasta 75 ml",
        "<b>Grund der Meldung:</b> Mikrobiologische Verunreinigung<br/>"
        "<b>Produktbezeichnung/ -beschreibung:</b> Zahnpasta, Marke: Elmex<br/>",
        2,
    )
    await _setup(hass, "AAAA")
    await _create(hass, hass_ws_client, "pack", [{"content": "Ketchup", "quantity": 1, "unit": "pieces", "product": {"brand": "Heinz"}}])
    recalls = await async_get_recalls(hass)
    # without household items only the food feed is fetched
    aioclient_mock.get(FEED_URL, text=_rss(KETCHUP))
    await recalls.async_refresh()
    assert [c[1].query.get("type") for c in aioclient_mock.mock_calls] == ["lebensmittel"]
    # with household items also the feed of all product types (it repeats the food warnings)
    paste = (await _create(hass, hass_ws_client, "household", [{"content": "Zahnpasta", "quantity": 1, "unit": "pieces", "product": {"brand": "Elmex"}}]))[0]
    # a household item with the brand of a food warning is not matched against food warnings
    await _create(hass, hass_ws_client, "household", [{"content": "Ketchup Flasche", "quantity": 1, "unit": "pieces", "product": {"brand": "Heinz"}}])
    aioclient_mock.clear_requests()
    aioclient_mock.get(FEED_URL, text=_rss(KETCHUP))
    aioclient_mock.get(FEED_ALL_URL, text=_rss(KETCHUP, toothpaste))
    new = await recalls.async_refresh()
    assert len(aioclient_mock.mock_calls) == 2
    found = {w["title"]: [i["content"] for i in w["items"]] for w in recalls.found}
    assert found == {KETCHUP[0]: ["Ketchup"], toothpaste[0]: ["Zahnpasta"]}
    assert [w["title"] for w in new] == [toothpaste[0]]  # the ketchup warning was reported before
    res = await _ws(hass, hass_ws_client, type="larder/recalls")
    paste_warning = next(w for w in res["result"]["items"] if w["title"] == toothpaste[0])
    assert paste_warning["items"][0]["device_id"] == paste["device_id"] and "scope" not in paste_warning
