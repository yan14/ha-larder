"""Tests Block 11: Vorrat (Mindestbestand, Aufteilen/Verschieben), Kassenbon, NFC für Beutel, Art im Export."""

from datetime import timedelta
from http import HTTPStatus

from custom_components.larder.const import DOMAIN
from custom_components.larder.receipt_photo import URL as RECEIPT_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipe_photo import _fake_ai, _form, ready  # noqa: F401
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo


async def _packs(hass, hass_ws_client, items, area_id=None, compartment=None):
    msg = {"type": "larder/create_items", "kind": "pack", "items": items}
    if area_id:
        msg["area_id"] = area_id
    if compartment:
        msg["compartment"] = compartment
    res = await _ws(hass, hass_ws_client, **msg)
    assert res["success"], res
    return res["result"]["items"]


def _comp(hass, cc):
    return hass.states.get(er.async_get(hass).async_get_entity_id("text", DOMAIN, f"{cc}_compartment")).state


async def test_stock_overview_sums_places_and_minimum_goes_to_shopping_list(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    cellar = await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 3, "unit": "pieces", "product": {"brand": "Heinz", "package": "500 ml"}}], pantry.id, "Keller")
    await _packs(hass, hass_ws_client, [{"content": "ketchup ", "quantity": 2, "unit": "pieces"}], pantry.id, "Schrank")
    await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 1, "unit": "pieces"}], fridge.id)
    await _packs(hass, hass_ws_client, [{"content": "Mehl", "quantity": 1000, "unit": "grams"}])  # zählt als eine Packung

    res = await _ws(hass, hass_ws_client, type="larder/stock")
    products = {p["key"]: p for p in res["result"]["products"]}
    assert products["ketchup"]["count"] == 6 and products["mehl"]["count"] == 1
    assert [(p["area"], p["compartment"], p["count"]) for p in products["ketchup"]["places"]] == [
        ("Kühlschrank", "", 1), ("Vorrat", "Keller", 3), ("Vorrat", "Schrank", 2)
    ]
    assert res["result"]["shopping_list"] is True

    res = await _ws(hass, hass_ws_client, type="larder/stock_min", content="Ketchup", min=5)
    assert res["result"]["products"][0]["min"] == 5 and res["result"]["products"][0]["low"] is False
    assert hass.states.get(_eid(hass, "text", cellar[0]["cc"])).attributes["min_stock"] == 5
    assert todo.summaries == []

    # zwei entnehmen: 4 < 5 → auf die Einkaufsliste (mit Marke und Packung, nicht doppelt)
    number = _eid(hass, "number", cellar[0]["cc"])
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 2}, blocking=True)
    await hass.async_block_till_done()
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 1}, blocking=True)
    await hass.async_block_till_done()
    assert todo.summaries == ["Ketchup (Heinz, 500 ml)"]

    # Minimum bleibt, auch wenn keine Packung mehr da ist
    res = await _ws(hass, hass_ws_client, type="larder/stock_min", content="Senf", min=2)
    senf = next(p for p in res["result"]["products"] if p["key"] == "senf")
    assert senf["count"] == 0 and senf["low"] is True
    res = await _ws(hass, hass_ws_client, type="larder/stock_min", content="Senf", min=0)
    assert "senf" not in {p["key"] for p in res["result"]["products"]}


async def test_emptying_the_last_pack_triggers_the_minimum(hass: HomeAssistant, hass_ws_client) -> None:
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    item = (await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}]))[0]
    await _ws(hass, hass_ws_client, type="larder/stock_min", content="Senf", min=1)
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", item["cc"])}, blocking=True)
    await hass.async_block_till_done()
    assert todo.summaries == ["Senf"]


async def test_move_split_and_merge_packs(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    pantry, fridge = areas.async_create("Vorrat"), areas.async_create("Kühlschrank")
    best = (dt_util.now().date() + timedelta(days=200)).isoformat()
    src = (await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 5, "unit": "pieces", "best_before": best, "product": {"brand": "Heinz"}}], pantry.id, "Keller"))[0]

    # 2 davon in den Schrank: neuer Eintrag mit denselben Daten
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=src["device_id"], count=2, area_id=pantry.id, compartment="Schrank")
    assert res["success"], res
    new = res["result"]["device_id"]
    assert res["result"] == {"moved": 2, "merged": False, "device_id": new}
    new_cc = next(i for d, i in dr.async_get(hass).async_get(new).identifiers if d == DOMAIN)
    assert hass.states.get(_eid(hass, "number", src["cc"])).state == "3.0"
    assert hass.states.get(_eid(hass, "number", new_cc)).state == "2.0"
    assert _comp(hass, new_cc) == "Schrank"
    assert hass.states.get(_eid(hass, "date", new_cc)).state == best
    assert hass.states.get(_eid(hass, "text", new_cc)).attributes["brand"] == "Heinz"

    # 1 weiterer in den Schrank: zusammenführen
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=src["device_id"], count=1, area_id=pantry.id, compartment="Schrank")
    assert res["result"] == {"moved": 1, "merged": True, "device_id": new}
    assert hass.states.get(_eid(hass, "number", new_cc)).state == "3.0"
    assert hass.states.get(_eid(hass, "number", src["cc"])).state == "2.0"

    # alle restlichen in den Kühlschrank: der Eintrag zieht um
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=src["device_id"], count=9, area_id=fridge.id)
    assert res["result"] == {"moved": 2, "merged": False, "device_id": src["device_id"]}
    assert dr.async_get(hass).async_get(src["device_id"]).area_id == fridge.id
    assert _comp(hass, src["cc"]) == ""

    # alle aus dem Schrank dazu: zusammenführen, der Schrank-Eintrag verschwindet
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=new, count=3, area_id=fridge.id)
    await hass.async_block_till_done()
    assert res["result"]["merged"] is True
    assert dr.async_get(hass).async_get(new) is None
    assert hass.states.get(_eid(hass, "number", src["cc"])).state == "5.0"

    # nur Packungen
    dose = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    res = await _ws(hass, hass_ws_client, type="larder/pack_move", device_id=dose.id, count=1, area_id=fridge.id)
    assert not res["success"]


async def test_receipt_photo(hass: HomeAssistant, hass_client, ready) -> None:  # noqa: F811
    calls = _fake_ai(hass, {"found": True, "items": [{"name": " Gehackte  Tomaten ", "count": 2}, {"name": "gehackte tomaten"}, {"name": "Milch", "count": 0}, {"name": ""}]})
    client = await hass_client()
    resp = await client.post(RECEIPT_URL, data=_form(("bon.jpg", "image/jpeg", b"\xff\xd8x")))
    assert resp.status == HTTPStatus.OK
    assert (await resp.json()) == {"items": [{"name": "Gehackte Tomaten", "count": 3}, {"name": "Milch", "count": 1}]}
    assert "receipt" in calls[0]["instructions"]
    _fake_ai(hass, {"found": False})
    resp = await client.post(RECEIPT_URL, data=_form(("bon.jpg", "image/jpeg", b"x")))
    assert (await resp.json())["error"] == "receipt_photo_none"


async def test_non_admins_may_link_stickers_to_bags_only(hass: HomeAssistant, hass_ws_client, hass_admin_user) -> None:
    await _setup(hass, "AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="bag", items=[{"content": "Reh"}])
    bag = res["result"]["items"][0]
    hass_admin_user.groups = []  # kein Administrator mehr
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "larder/nfc_link", "tag_id": "t1", "device_id": bag["device_id"]})
    assert (await client.receive_json())["success"]
    dose = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    await client.send_json({"id": 2, "type": "larder/nfc_link", "tag_id": "t2", "device_id": dose.id})
    res = await client.receive_json()
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    await client.send_json({"id": 3, "type": "larder/nfc_tags"})
    assert (await client.receive_json())["result"]["by_device"] == {bag["device_id"]: "t1"}
    # gescannte Tags kommen auch ohne Administratorrechte an
    await client.send_json({"id": 4, "type": "larder/tag_scans"})
    assert (await client.receive_json())["success"]
    hass.bus.async_fire("tag_scanned", {"tag_id": "t9"})
    msg = await client.receive_json()
    assert msg["id"] == 4 and msg["event"] == {"tag_id": "t9"}
