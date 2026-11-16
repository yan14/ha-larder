"""Tests Block 17 (4.0): household items, pack size, area scopes via labels, sibling product databases."""

from datetime import timedelta

from custom_components.larder.const import DOMAIN
from custom_components.larder.household import (
    area_scope,
    async_assign_area_scopes,
    async_set_area_scope,
    household_category,
    packs_needed,
    plan_area_scopes,
)
from custom_components.larder.product import API, SIBLINGS, async_lookup
from custom_components.larder.repair_hints import ISSUE_AREA_SCOPES, async_get_repairs
from custom_components.larder.stock import async_get_stock
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, issue_registry as ir, label_registry as lr
from homeassistant.util import dt as dt_util

from .test_disposable import _ws
from .test_recipes import _eid, _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_shopping import _todo


async def _household(hass, hass_ws_client, items, area_id=None, compartment=None):
    msg = {"type": "larder/create_items", "kind": "household", "items": items}
    if area_id:
        msg["area_id"] = area_id
    if compartment:
        msg["compartment"] = compartment
    res = await _ws(hass, hass_ws_client, **msg)
    assert res["success"], res
    return res["result"]["items"]


def test_categories_and_packs_needed() -> None:
    assert household_category("Klopapier 3-lagig") == "hh_paper"
    assert household_category("Vollwaschmittel") == "hh_laundry"
    assert household_category("Spülmittel") == "hh_cleaning"
    assert household_category("Zahnpasta") == "hh_care"
    assert household_category("AA Batterien") == "hh_batteries"
    assert household_category("Kerzen") == "hh_other"
    assert household_category("") is None
    assert packs_needed(16, 5, 8) == 2
    assert packs_needed(8, 7, 8) == 1
    assert packs_needed(4, 4, None) == 1


async def test_household_item_pieces_packs_minimum_and_shopping_list(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _todo(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    bath = ar.async_get(hass).async_create("Bad")
    made = (await _household(
        hass, hass_ws_client,
        [{"content": "Klopapier", "quantity": 12, "unit": "pieces", "product": {"brand": "Zewa", "pack_size": 8, "piece": "Rollen", "price": 4}}],
        bath.id, "Schrank",
    ))[0]
    assert made["name"] == "Artikel 1"
    attrs = hass.states.get(_eid(hass, "text", made["cc"])).attributes
    assert attrs["kind"] == "household" and attrs["category"] == "hh_paper" and attrs["pack_size"] == 8
    stock = await async_get_stock(hass)
    await stock.async_set_minimum("Klopapier", 16)  # in pieces
    await hass.async_block_till_done()
    # 12 of 16 rolls: one pack of 8 goes onto the list
    assert todo.summaries == ["Klopapier (Zewa, 1 Packung)"]
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    paper = next(p for p in res["result"]["products"] if p["key"] == "klopapier")
    assert paper["kind"] == "household" and paper["count"] == 12 and paper["packs"] == 1.5 and paper["pack_size"] == 8
    assert paper["piece"] == "Rollen" and paper["low"] is True and paper["value"] == 6.0  # 1.5 packs × 4 €
    # taking single rolls counts as consumption
    number = _eid(hass, "number", made["cc"])
    await hass.services.async_call("number", "set_value", {"entity_id": number, "value": 11}, blocking=True)
    await hass.async_block_till_done()
    assert [t["n"] for t in stock.takes] == [1]
    # not part of expiring lists, recipes or the food statistics
    res = await hass.services.async_call(DOMAIN, "get_expiring", {"days": 365}, blocking=True, return_response=True)
    assert res["count"] == 0
    await _ws(hass, hass_ws_client, type="larder/empty", device_id=made["device_id"], outcome="eaten")
    await hass.async_block_till_done()
    stats = await hass.services.async_call(DOMAIN, "get_statistics", {}, blocking=True, return_response=True)
    assert stats["eaten"] == 0
    # nothing left: still on the list only once; the product keeps its kind and pack size
    assert todo.summaries == ["Klopapier (Zewa, 1 Packung)"]
    tracked = stock.tracked["klopapier (zewa, 1 packung)"]
    assert tracked["kind"] == "household" and tracked["count"] == 1 and tracked["product"]["pack_size"] == 8
    res = await _ws(hass, hass_ws_client, type="larder/stock")
    paper = next(p for p in res["result"]["products"] if p["key"] == "klopapier")
    assert paper["count"] == 0 and paper["kind"] == "household" and paper["pack_size"] == 8


async def test_convert_pack_to_household_and_back(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="pack", items=[{"content": "Küchenrolle", "quantity": 4, "unit": "pieces"}])
    item = res["result"]["items"][0]
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=item["device_id"], kind="household")
    assert res["success"], res
    await hass.async_block_till_done()
    state = hass.states.get(_eid(hass, "text", item["cc"]))
    assert state.state == "Küchenrolle" and state.attributes["kind"] == "household" and state.attributes["category"] == "hh_paper"
    assert hass.states.get(_eid(hass, "number", item["cc"])).state in ("4", "4.0")
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id=item["device_id"], kind="pack")
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass, "text", item["cc"])).attributes["kind"] == "pack"
    device = next(iter(hass.config_entries.async_entries(DOMAIN)))
    assert device is not None
    res = await _ws(hass, hass_ws_client, type="larder/convert_kind", device_id="nope", kind="pack")
    assert not res["success"]


async def test_area_scopes_by_label_and_automatic_assignment(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas, labels = ar.async_get(hass), lr.async_get(hass)
    freezer_label = labels.async_create("Larder: Gefrierschrank", description="Storage: freezer\nTemperature: -18 °C")
    plain = labels.async_create("Larder")
    freezer = areas.async_create("Truhe", labels={freezer_label.label_id})
    cellar = areas.async_create("Keller", labels={plain.label_id})
    bath = areas.async_create("Badezimmer")
    office = areas.async_create("Büro")
    assert area_scope(hass, freezer) == "both" and area_scope(hass, bath) is None
    plan = plan_area_scopes(hass)
    assert [(p["name"], p["scope"]) for p in plan] == [("Badezimmer", "household"), ("Truhe", "food")]
    # repair hint with a fix flow
    repairs = await async_get_repairs(hass)
    repairs.async_update()
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_AREA_SCOPES)
    assert issue is not None and issue.is_fixable and "Badezimmer" in issue.translation_placeholders["areas"]
    hass.config.language = "de"
    async_assign_area_scopes(hass)
    get = areas.async_get_area
    assert area_scope(hass, get(freezer.id)) == "food" and area_scope(hass, get(bath.id)) == "household"
    assert area_scope(hass, get(cellar.id)) == "both" and area_scope(hass, get(office.id)) is None
    # labels were only added; the storage kind label with its description is untouched
    assert freezer_label.label_id in get(freezer.id).labels
    names = {label.name for label in labels.async_list_labels()}
    assert {"Larder: Lebensmittel", "Larder: Haushalt", "Larder: Gefrierschrank", "Larder"} <= names
    repairs.async_update()
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_AREA_SCOPES) is None
    # set by hand: household → both keeps the area a Larder area
    async_set_area_scope(hass, bath.id, "both")
    assert area_scope(hass, get(bath.id)) == "both"
    res = await _ws(hass, hass_ws_client, type="larder/area_scope_set", area_id=cellar.id, scope="household")
    assert res["result"]["scopes"][cellar.id] == "household"
    res = await _ws(hass, hass_ws_client, type="larder/area_scope_set", area_id=cellar.id, scope="food")
    assert res["result"]["scopes"][cellar.id] == "food" and plain.label_id in get(cellar.id).labels


async def test_no_labels_at_all_keeps_used_areas_offered(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    fridge, pantry, bath = areas.async_create("Kühlschrank"), areas.async_create("Speisekammer"), areas.async_create("Bad")
    await _ws(hass, hass_ws_client, type="larder/create_items", kind="pack", items=[{"content": "Senf"}], area_id=fridge.id)
    await _ws(hass, hass_ws_client, type="larder/create_items", kind="pack", items=[{"content": "Mehl"}], area_id=pantry.id)
    res = await _ws(hass, hass_ws_client, type="larder/area_scopes_auto")
    scopes = res["result"]["scopes"]
    assert scopes[fridge.id] == "food" and scopes[bath.id] == "household" and scopes[pantry.id] == "both"


async def test_lookup_falls_back_to_the_sibling_databases(hass: HomeAssistant, aioclient_mock) -> None:
    code = "4000000000444"
    aioclient_mock.get(API.format(code=code), json={"status": 0})
    urls = dict(SIBLINGS)
    aioclient_mock.get(urls["beauty"].format(code=code), json={"status": 0})
    aioclient_mock.get(urls["product"].format(code=code), json={"status": 1, "product": {"product_name": "Toilettenpapier 3-lagig", "brands": "Zewa", "quantity": "8 Rollen"}})
    res = await async_lookup(hass, code)
    assert res["found"] and res["product_type"] == "product" and res["category"] == "hh_paper"
    assert res["product"] == {"ean": code, "source": "openproductfacts", "brand": "Zewa", "package": "8 Rollen"}
    # food stays food, the siblings are not asked
    aioclient_mock.get(API.format(code="4000000000555"), json={"status": 1, "product": {"product_name": "Senf"}})
    calls = aioclient_mock.call_count
    res = await async_lookup(hass, "4000000000555")
    assert res["product_type"] == "food" and aioclient_mock.call_count == calls + 1
    assert dt_util.now() - timedelta(days=1) < dt_util.now()
