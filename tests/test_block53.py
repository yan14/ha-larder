"""Tests Block 53 (6.7): clearer for newcomers."""

from custom_components.larder import shelf_life
from custom_components.larder.area_storage import area_kind, own_kind
from custom_components.larder.config_flow import OPTION_SECTIONS, flatten_options, nest_options
from custom_components.larder.datacare import by_product
from custom_components.larder.estimate import storage_context
from custom_components.larder.freezing import freezer_area
from custom_components.larder.stock import async_get_stock, pack_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import section
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .test_block29 import _list
from .test_disposable import _ws
from .test_recipes import _options, _setup, auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs


def test_option_sections_cover_every_setting() -> None:
    """#194: every setting sits in exactly one section; nesting and flattening go both ways."""
    keys = [k for keys in OPTION_SECTIONS.values() for k in keys]
    assert len(keys) == len(set(keys))
    flat = {"estimate_mode": "table", "todo_entity": "todo.x", "supply_days": 5}
    nested = nest_options(flat)
    assert nested["shelf_life"] == {"estimate_mode": "table"} and nested["supply"] == {"supply_days": 5}
    assert flatten_options(nested) == flat


async def test_settings_form_has_sections(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    result = await hass.config_entries.options.async_init(entry.entry_id)
    schema = result["data_schema"].schema
    names = [str(k) for k in schema]
    assert names == list(OPTION_SECTIONS)
    sections = dict(zip(names, schema.values(), strict=True))
    assert all(isinstance(v, section) for v in sections.values())
    assert sections["shelf_life"].options["collapsed"] is False and sections["advanced"].options["collapsed"] is True


async def test_area_storage_kind(hass: HomeAssistant, hass_ws_client) -> None:
    """#196: recognised from the name; chosen in the dashboard when nothing is recognised."""
    await _setup(hass, "AAAA")
    areas = ar.async_get(hass)
    kitchen = areas.async_create("Küche")
    garage = areas.async_create("Garage")
    freezer = areas.async_create("Gefriertruhe")
    res = (await _ws(hass, hass_ws_client, type="larder/area_storage"))["result"]["areas"]
    by = {a["name"]: a for a in res}
    assert by["Gefriertruhe"]["recognised"] == shelf_life.FREEZER and by["Garage"]["recognised"] is None
    # the garage is the freezer here
    res = await _ws(hass, hass_ws_client, type="larder/area_storage_set", area_id=garage.id, kind="freezer")
    assert {a["name"]: a for a in res["result"]["areas"]}["Garage"]["own"] == "freezer"
    assert own_kind(hass, garage.id) == "freezer" and area_kind(hass, garage) == shelf_life.FREEZER
    # a container in it is estimated as frozen
    device = dr.async_get(hass).async_get_device(identifiers={("larder", "AAAA")})
    dr.async_get(hass).async_update_device(device.id, area_id=garage.id)
    context = storage_context(hass, "AAAA")
    assert shelf_life.classify_storage(context.area_name, None, context.label_texts, context.storage_hint).key == shelf_life.FREEZER
    # two freezer areas now: the one with the entries wins
    assert freezer_area(hass) == garage.id
    # back to automatic
    await _ws(hass, hass_ws_client, type="larder/area_storage_set", area_id=garage.id, kind=None)
    assert own_kind(hass, garage.id) is None and area_kind(hass, garage) is None
    assert area_kind(hass, kitchen) is None or area_kind(hass, kitchen) != shelf_life.FREEZER
    assert freezer.id != garage.id


def test_data_care_by_product() -> None:
    """#197: one line per product with everything missing, the entries per gap."""
    gaps = {
        "no_price": [{"device_id": "p1", "content": "Ketchup", "kind": "pack", "place": "Keller"}],
        "no_date": [{"device_id": "p1", "content": "Ketchup", "kind": "pack", "place": "Keller"},
                    {"device_id": "p2", "content": "ketchup", "kind": "pack", "place": ""}],
        "no_min": [{"device_id": "p3", "content": "Milch", "kind": "pack", "place": ""}],
    }
    products = by_product(gaps)
    assert [p["content"] for p in products] == ["Ketchup", "Milch"]
    ketchup = products[0]
    assert ketchup["missing"] == ["no_date", "no_price"]
    assert ketchup["ids"] == {"no_price": ["p1"], "no_date": ["p1", "p2"]}


async def test_data_gaps_send_products(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}], None, "")
    res = (await _ws(hass, hass_ws_client, type="larder/data_gaps"))["result"]
    senf = next(p for p in res["products"] if p["content"] == "Senf")
    assert {"no_date", "no_price", "no_place"} <= set(senf["missing"])
    assert res["counts"]["products"] == len(res["products"])


async def test_shopping_add_and_undo(hass: HomeAssistant, hass_ws_client) -> None:
    """#200: add on the Shopping page; undo a tick puts the item back and takes the pack out of stock."""
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    res = await _ws(hass, hass_ws_client, type="larder/shopping_add", item="  Milch ")
    assert res["result"] == {"list": "todo.einkaufen", "created": True}
    assert todo.open() == ["Milch"]
    res = await _ws(hass, hass_ws_client, type="larder/shopping_add", item="milch")
    assert res["result"]["created"] is False and todo.open() == ["Milch"]
    # a known product: tick off → into stock; undo → back on the list, out of stock
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 2, "unit": "pieces"}], pantry.id, "Schrank")
    await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": "Senf"}, blocking=True)
    senf = next(i for i in todo._attr_todo_items if i.summary == "Senf")  # noqa: SLF001
    checked = (await _ws(hass, hass_ws_client, type="larder/shopping_check", list="todo.einkaufen", uid=senf.uid, summary="Senf"))["result"]
    await hass.async_block_till_done()
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 3
    stock = await async_get_stock(hass)
    logged = len(stock.put_away_log)
    res = await _ws(
        hass, hass_ws_client, type="larder/shopping_undo", list="todo.einkaufen", uid=senf.uid,
        device_id=checked["device_id"], added=checked["added"],
    )
    await hass.async_block_till_done()
    assert res["result"] == {"removed": 1}
    assert sum(p["count"] for p in pack_entries(hass) if p["content"] == "Senf") == 2
    assert "Senf" in todo.open()
    assert len(stock.put_away_log) == logged - 1


async def test_shopping_undo_removes_a_new_entry(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    todo = await _list(hass)
    entry = await _setup(hass, "AAAA")
    await _options(hass, entry, todo_entity="todo.einkaufen")
    pantry = ar.async_get(hass).async_create("Vorrat")
    await _packs(hass, hass_ws_client, [{"content": "Senf", "quantity": 1, "unit": "pieces"}], pantry.id, "Schrank")
    old = next(p for p in pack_entries(hass) if p["content"] == "Senf")
    # the old pack has a date: ticking off makes a new entry, undo removes it again
    await _ws(hass, hass_ws_client, type="larder/put_away_save", rows=[{"device_id": old["device_id"], "best_before": "2027-01-01"}])
    await hass.async_block_till_done()
    old = next(p for p in pack_entries(hass) if p["content"] == "Senf")
    await hass.services.async_call("todo", "add_item", {"entity_id": "todo.einkaufen", "item": "Senf"}, blocking=True)
    senf = next(i for i in todo._attr_todo_items if i.summary == "Senf")  # noqa: SLF001
    checked = (await _ws(hass, hass_ws_client, type="larder/shopping_check", list="todo.einkaufen", uid=senf.uid, summary="Senf"))["result"]
    await hass.async_block_till_done()
    assert checked["new_entry"] is True and checked["device_id"] != old["device_id"]
    assert len([p for p in pack_entries(hass) if p["content"] == "Senf"]) == 2
    await _ws(hass, hass_ws_client, type="larder/shopping_undo", list="todo.einkaufen", uid=senf.uid, device_id=checked["device_id"], added=checked["added"])
    await hass.async_block_till_done()
    left = [p for p in pack_entries(hass) if p["content"] == "Senf"]
    assert [p["device_id"] for p in left] == [old["device_id"]]
