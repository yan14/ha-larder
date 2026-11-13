"""Tests Block 9: Einweg-Beutel und Packungen ohne Dose."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.larder.const import DOMAIN
from custom_components.larder.disposable import async_get_retired
from custom_components.larder.history import async_get_history
from custom_components.larder.nfc import async_get_nfc
from homeassistant.components import tag as ha_tag
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from .test_ai_estimate import auto_enable_custom_integrations  # noqa: F401
from .test_recipes import _eid, _setup


async def _ws(hass, hass_ws_client, **msg):
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, **msg})
    return await client.receive_json()


def _entities(hass: HomeAssistant, device_id: str) -> set[str]:
    return {e.unique_id.split("_", 1)[1] for e in er.async_entries_for_device(er.async_get(hass), device_id)}


async def test_create_bags_fills_and_estimates(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")  # lädt die Integration
    from homeassistant.helpers import area_registry as ar

    freezer = ar.async_get(hass).async_create("Gefrierschrank")
    res = await _ws(
        hass,
        hass_ws_client,
        type="larder/create_items",
        kind="bag",
        area_id=freezer.id,
        items=[{"content": "Hackfleisch", "quantity": 500, "unit": "grams"}, {"content": "Rehgulasch"}],
    )
    assert res["success"], res
    items = res["result"]["items"]
    assert [i["name"] for i in items] == ["Bag 1", "Bag 2"]
    assert all(i["cc"].startswith("HA-") for i in items)
    first = items[0]
    device = dr.async_get(hass).async_get(first["device_id"])
    assert device.area_id == freezer.id and device.model == "Bag"
    # Beutel: Code und Vakuum ja, Einkaufsliste und fester Platz nein
    assert _entities(hass, device.id) == {
        "content", "compartment", "best_before", "filled_at", "portions", "unit", "days_left", "empty_container", "qr_code", "vacuum",
    }
    content = hass.states.get(_eid(hass, "text", first["cc"]))
    assert content.state == "Hackfleisch" and content.attributes["kind"] == "bag"
    assert hass.states.get(_eid(hass, "number", first["cc"])).state == "500.0"
    assert hass.states.get(_eid(hass, "select", first["cc"])).state == "grams"
    assert hass.states.get(_eid(hass, "switch", first["cc"])).state == "on"
    best = hass.states.get(_eid(hass, "date", first["cc"])).state
    assert best > dt_util.now().date().isoformat()  # aus der Tabelle geschätzt (Gefrierschrank)
    # weitere Beutel zählen weiter
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="bag", items=[{"content": "Reh"}])
    assert res["result"]["items"][0]["name"] == "Bag 3"


async def test_emptying_a_bag_removes_it_and_its_tag(hass: HomeAssistant, hass_ws_client) -> None:
    assert await async_setup_component(hass, "tag", {})
    await _setup(hass, "AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="bag", items=[{"content": "Rehgulasch"}])
    item = res["result"]["items"][0]
    cc = item["cc"]
    await ha_tag.async_scan_tag(hass, "tag-1", None)  # Home Assistant kennt den Sticker
    await (await async_get_nfc(hass)).async_link("tag-1", cc)
    assert "tag-1" in hass.data[ha_tag.TAG_DATA].data

    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", cc)}, blocking=True)
    await hass.async_block_till_done()

    assert dr.async_get(hass).async_get(item["device_id"]) is None
    assert not [e for e in hass.config_entries.async_entries(DOMAIN) if e.data["cc"] == cc]
    assert "tag-1" not in hass.data[ha_tag.TAG_DATA].data
    assert (await async_get_nfc(hass)).tag_of(cc) is None
    record = (await async_get_history(hass)).list()[0]
    assert record["content"] == "Rehgulasch" and record["name"] == "Bag 1"

    # alter Code und alter Sticker: Hinweis statt "unbekannt"
    retired = await async_get_retired(hass)
    assert retired.by_code(cc)["content"] == "Rehgulasch" and retired.by_tag("tag-1") is not None
    res = await _ws(hass, hass_ws_client, type="larder/resolve_code", code=cc)
    assert res["result"]["device_id"] is None and "Rehgulasch" in res["result"]["retired"]
    events = []
    hass.bus.async_listen("larder_dose_scanned", lambda e: events.append(e.data))
    await ha_tag.async_scan_tag(hass, "tag-1", None)
    await hass.async_block_till_done()
    assert events and events[0]["retired"] is True and "emptied" in events[0]["message"]
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
    await hass.async_block_till_done()
    assert "tag-1" not in hass.data[ha_tag.TAG_DATA].data  # gleich wieder aufgeräumt
    # Sticker für einen neuen Beutel benutzt: gilt nicht mehr als alt
    res = await _ws(hass, hass_ws_client, type="larder/create_items", kind="bag", items=[{"content": "Hack"}])
    await (await async_get_nfc(hass)).async_link("tag-1", res["result"]["items"][0]["cc"])
    assert retired.by_tag("tag-1") is None
    assert res["result"]["items"][0]["cc"] != cc  # Codes werden nie wiederverwendet


async def test_packs_have_few_entities_and_no_code(hass: HomeAssistant, hass_ws_client, hass_client) -> None:
    await _setup(hass, "AAAA")
    day = (dt_util.now().date() + timedelta(days=2)).isoformat()
    res = await _ws(
        hass,
        hass_ws_client,
        type="larder/create_items",
        kind="pack",
        items=[{"content": "Tomaten gehackt", "quantity": 3, "unit": "pieces", "best_before": day, "product": {"brand": "Mutti", "kcal_100g": 24}}],
    )
    item = res["result"]["items"][0]
    assert item["name"] == "Pack 1"
    assert _entities(hass, item["device_id"]) == {"content", "best_before", "portions", "unit", "days_left", "empty_container"}
    attrs = hass.states.get(_eid(hass, "text", item["cc"])).attributes
    assert attrs["kind"] == "pack" and attrs["brand"] == "Mutti"
    # zählt bei "läuft bald ab" mit, aber nicht bei "alle Etiketten"
    out = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert [(i["content"], i["kind"]) for i in out["items"]] == [("Tomaten gehackt", "pack")]
    from custom_components.larder.labels import collect_labels

    assert [label.name for label in collect_labels(hass, None, False)] == ["Dose AAAA"]
    # leeren: weg, ohne dass ein alter Code gemerkt wird
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", item["cc"])}, blocking=True)
    await hass.async_block_till_done()
    assert dr.async_get(hass).async_get(item["device_id"]) is None
    assert (await async_get_retired(hass)).by_code(item["cc"]) is None


async def test_transfer_pack_into_container(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    printed = (dt_util.now().date() + timedelta(days=400)).isoformat()
    res = await _ws(
        hass,
        hass_ws_client,
        type="larder/create_items",
        kind="pack",
        items=[{"content": "Basmati", "quantity": 2, "unit": "pieces", "best_before": printed, "product": {"brand": "Tilda"}}],
    )
    pack = res["result"]["items"][0]
    device = lambda cc: dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}).id  # noqa: E731

    res = await _ws(hass, hass_ws_client, type="larder/transfer", device_id=pack["device_id"], target=device("AAAA"))
    assert res["success"], res
    assert res["result"]["left"] == 1
    target = hass.states.get(_eid(hass, "text", "AAAA"))
    assert target.state == "Basmati" and target.attributes["brand"] == "Tilda"
    assert hass.states.get(_eid(hass, "date", "AAAA")).state <= printed  # höchstens wie aufgedruckt
    assert hass.states.get(_eid(hass, "number", pack["cc"])).state == "1.0"
    # volle Dose als Ziel geht nicht
    res = await _ws(hass, hass_ws_client, type="larder/transfer", device_id=pack["device_id"], target=device("AAAA"))
    assert not res["success"]
    # letzte Packung: verschwindet
    res = await _ws(hass, hass_ws_client, type="larder/transfer", device_id=pack["device_id"], target=device("BBBB"))
    assert res["result"]["left"] == 0
    await hass.async_block_till_done()
    assert dr.async_get(hass).async_get(pack["device_id"]) is None
    assert hass.states.get(_eid(hass, "text", "BBBB")).state == "Basmati"
