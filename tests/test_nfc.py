"""Tests: NFC-Tags (tag_scanned) mit Dosen verknüpfen."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.util import dt as dt_util

from custom_components.larder.const import DOMAIN

from .test_ai_estimate import _eid, _setup, auto_enable_custom_integrations  # noqa: F401


async def _ws(hass, hass_ws_client, payload):
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, **payload})
    return await client.receive_json()


def _phone(hass: HomeAssistant, name="iPhone") -> str:
    entry = MockConfigEntry(domain="mobile_app", title=name)
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("mobile_app", name)}, name=name
    )
    return device.id


def _notify(hass: HomeAssistant, service="mobile_app_iphone") -> list[dict]:
    calls: list[dict] = []

    async def handler(call: ServiceCall) -> None:
        calls.append(dict(call.data))

    hass.services.async_register("notify", service, handler)
    return calls


async def _scan(hass: HomeAssistant, tag_id: str, device_id: str | None = None) -> None:
    data = {"tag_id": tag_id, "name": "x"}
    if device_id:
        data["device_id"] = device_id
    hass.bus.async_fire("tag_scanned", data)
    await hass.async_block_till_done()


async def test_link_list_unlink_and_conflicts(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "34OL")
    await _setup(hass, "56BR")
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "tag-1", "cc": "34OL"})
    assert res["success"] and res["result"]["links"] == {"34OL": "tag-1"}

    # gleicher Tag an anderer Dose: Fehler mit Name der belegten Dose
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "tag-1", "cc": "56BR"})
    assert not res["success"] and "Dose 34OL" in res["error"]["message"]

    # neuer Tag für dieselbe Dose ersetzt den alten
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "tag-2", "cc": "34OL"})
    assert res["result"]["links"] == {"34OL": "tag-2"}
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_tags"})
    assert res["result"]["links"] == {"34OL": "tag-2"}

    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_unlink", "cc": "34OL"})
    assert res["result"]["links"] == {}


async def test_link_via_entry_id_and_validation(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass, "34OL")
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "t", "entry_id": entry.entry_id})
    assert res["success"] and res["result"]["links"] == {"34OL": "t"}
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "t", "cc": "NOPE"})
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "  ", "cc": "34OL"})
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "t"})
    assert not res["success"]  # weder cc noch entry_id


async def test_scan_fires_event_and_notifies_the_scanning_phone(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "34OL")
    phone = _phone(hass)
    calls = _notify(hass)
    other = _notify(hass, "mobile_app_pixel")
    await hass.services.async_call("text", "set_value", {"entity_id": _eid(hass, "text"), "value": "Pizza"}, blocking=True)
    day = (dt_util.now().date() + timedelta(days=2)).isoformat()
    await hass.services.async_call("date", "set_value", {"entity_id": _eid(hass, "date"), "date": day}, blocking=True)
    await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "abc", "cc": "34OL"})
    events = async_capture_events(hass, "larder_dose_scanned")

    await _scan(hass, "abc", phone)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    assert len(events) == 1
    assert events[0].data == {"cc": "34OL", "device_id": device.id, "name": "Dose 34OL", "scanned_by": phone}
    (call,) = calls
    assert call["title"] == "Dose 34OL"
    assert "Pizza" in call["message"] and day in call["message"]
    assert call["data"]["url"] == f"/larder?open={device.id}" == call["data"]["clickAction"]
    assert other == []  # nur das scannende Gerät


async def test_unknown_tags_and_missing_scanner_are_handled(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "34OL")
    phone = _phone(hass)
    calls = _notify(hass)
    await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "abc", "cc": "34OL"})
    events = async_capture_events(hass, "larder_dose_scanned")

    await _scan(hass, "fremder-tag", phone)  # nicht unser Tag
    assert events == [] and calls == []

    await _scan(hass, "abc")  # kein scannendes Gerät: Ereignis ja, Benachrichtigung nein
    assert len(events) == 1 and calls == []
    await _scan(hass, "abc", "gibt-es-nicht")
    assert len(events) == 2 and calls == []


async def test_notification_can_be_switched_off(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass, "34OL")
    phone = _phone(hass)
    calls = _notify(hass)
    await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "abc", "cc": "34OL"})
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"estimate_mode": "table", "nfc_notify": False})
    events = async_capture_events(hass, "larder_dose_scanned")
    await _scan(hass, "abc", phone)
    assert len(events) == 1 and calls == []


async def test_removing_the_container_unlinks_the_tag(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass, "34OL")
    await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "abc", "cc": "34OL"})
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    await _setup(hass, "56BR")
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_tags"})
    assert res["result"]["links"] == {}


async def test_link_and_unlink_by_device_id(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "34OL")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "t1", "device_id": device.id})
    assert res["result"]["by_device"] == {device.id: "t1"} and res["result"]["links"] == {"34OL": "t1"}
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_tags"})
    assert res["result"]["by_device"] == {device.id: "t1"}
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_link", "tag_id": "t2", "device_id": "unbekannt"})
    assert not res["success"]
    res = await _ws(hass, hass_ws_client, {"type": f"{DOMAIN}/nfc_unlink", "device_id": device.id})
    assert res["result"]["by_device"] == {}


async def test_scan_session_receives_scans_and_suppresses_the_notification(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "34OL")
    phone = _phone(hass)
    calls = _notify(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/nfc_link", "tag_id": "abc", "cc": "34OL"})
    assert (await client.receive_json())["success"]
    await client.send_json({"id": 2, "type": f"{DOMAIN}/scan_session"})
    assert (await client.receive_json())["success"]
    events = async_capture_events(hass, "larder_dose_scanned")

    await _scan(hass, "abc", phone)
    msg = await client.receive_json()
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    assert msg["id"] == 2 and msg["type"] == "event"
    assert msg["event"]["device_id"] == device.id and msg["event"]["name"] == "Dose 34OL"
    assert len(events) == 1  # Automationen bekommen das Ereignis weiterhin
    assert calls == []  # keine Benachrichtigung während des Serien-Scans

    await client.send_json({"id": 3, "type": "unsubscribe_events", "subscription": 2})
    assert (await client.receive_json())["success"]
    await _scan(hass, "abc", phone)
    assert len(calls) == 1  # nach dem Ende wieder wie gewohnt
