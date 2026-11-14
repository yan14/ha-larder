"""Tests Block 13: NFC-Tag/QR-Etikett je Fach, Etiketten mit Schriftfarbe, invertiert und Symbol im QR-Code."""

import re

from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.larder.const import scan_app_url
from custom_components.larder.labels import Label, build_pdf
from custom_components.larder.places import place_app_url, place_path
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from .test_disposable import _ws as _ws_kw
from .test_nfc import _notify, _phone, _scan
from .test_recipes import auto_enable_custom_integrations  # noqa: F401
from .test_stock import _packs, _setup


async def _ws(hass, hass_ws_client, **msg):
    return await _ws_kw(hass, hass_ws_client, **msg)


async def test_link_scan_notify_event_and_unlink(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    cellar = ar.async_get(hass).async_create("Keller")
    await _packs(hass, hass_ws_client, [{"content": "Ketchup", "quantity": 2, "unit": "pieces"}, {"content": "Senf", "quantity": 1, "unit": "pieces"}], cellar.id, "Regal oben")
    await _packs(hass, hass_ws_client, [{"content": "Mehl", "quantity": 1, "unit": "pieces"}], cellar.id, "Regal unten")
    res = await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="fach-1", area_id=cellar.id, compartment="Regal  oben")
    assert res["success"], res
    assert res["result"]["links"] == [{"tag_id": "fach-1", "area_id": cellar.id, "compartment": "Regal oben"}]

    phone = _phone(hass)
    calls = _notify(hass)
    events = async_capture_events(hass, "larder_compartment_scanned")
    await _scan(hass, "fach-1", phone)
    (event,) = events
    assert event.data["name"] == "Keller · Regal oben" and event.data["items"] == ["Ketchup", "Senf"]
    assert event.data["place"] is True and event.data["source"] == "nfc" and event.data["scanned_by"] == phone
    (call,) = calls
    assert call["title"] == "Keller · Regal oben" and "Ketchup, Senf" in call["message"]
    assert call["data"]["url"] == place_path(cellar.id, "Regal oben") == call["data"]["clickAction"]
    assert call["data"]["url"] == f"/larder?place={cellar.id}&compartment=Regal+oben"

    # Groß-/Kleinschreibung egal; ein neuer Tag ersetzt den alten
    res = await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="fach-2", area_id=cellar.id, compartment="regal oben")
    assert [link["tag_id"] for link in res["result"]["links"]] == ["fach-2"]
    res = await _ws(hass, hass_ws_client, type="larder/place_unlink", area_id=cellar.id, compartment="Regal oben")
    assert res["result"]["links"] == []
    await _scan(hass, "fach-2", phone)
    assert len(events) == 1


async def test_tag_conflicts_with_containers(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    cellar = ar.async_get(hass).async_create("Keller")
    await _ws(hass, hass_ws_client, type="larder/nfc_link", tag_id="dose-tag", cc="AAAA")
    res = await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="dose-tag", area_id=cellar.id, compartment="A")
    assert not res["success"] and "container" in res["error"]["message"]
    await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="fach-tag", area_id=cellar.id, compartment="A")
    res = await _ws(hass, hass_ws_client, type="larder/nfc_link", tag_id="fach-tag", cc="AAAA")
    assert not res["success"] and "Keller · A" in res["error"]["message"]
    res = await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="fach-tag", area_id=cellar.id, compartment="B")
    assert not res["success"] and "Keller · A" in res["error"]["message"]
    res = await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="x", area_id="gibt-es-nicht", compartment="B")
    assert not res["success"]


async def test_scan_session_gets_the_place_and_qr_report(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    pantry = ar.async_get(hass).async_create("Vorratskammer")
    await _ws(hass, hass_ws_client, type="larder/place_link", tag_id="t", area_id=pantry.id, compartment="")
    client = await hass_ws_client(hass)
    await client.send_json({"id": 5, "type": "larder/scan_session"})
    assert (await client.receive_json())["success"]
    calls = _notify(hass)
    await _scan(hass, "t", _phone(hass))
    msg = await client.receive_json()
    assert msg["event"]["place"] is True and msg["event"]["name"] == "Vorratskammer"
    assert calls == []  # Dashboard offen: keine Benachrichtigung
    events = async_capture_events(hass, "larder_compartment_scanned")
    res = await _ws(hass, hass_ws_client, type="larder/report_place_scan", area_id=pantry.id, compartment="Schrank")
    await hass.async_block_till_done()
    assert res["result"]["name"] == "Vorratskammer · Schrank"
    assert events[0].data["source"] == "qr" and events[0].data["items"] == []


async def test_place_labels_via_http(hass: HomeAssistant, hass_client) -> None:
    await _setup(hass, "AAAA")
    cellar = ar.async_get(hass).async_create("Keller")
    client = await hass_client()
    resp = await client.get(f"/api/larder/labels.pdf?place={cellar.id}%7CRegal+oben&place=%7C&logo=1&color=green")
    assert resp.status == 200
    pdf = await resp.read()
    assert b"(Keller \\267 Regal oben) Tj" in pdf or b"Keller" in pdf
    assert re.search(rb"/Count 1", pdf)
    assert place_app_url(cellar.id, "Regal oben").startswith("homeassistant://navigate/larder?place=")


def test_label_colour_inverted_and_logo() -> None:
    label = Label("Dose 1", scan_app_url("HA-00000001"), "Gulasch")
    black = build_pdf([label])
    assert b" rg" not in black  # Standard: schwarz-weiß
    green = build_pdf([label], color="green")
    assert b"0.080 0.330 0.180 rg" in green
    inverted = build_pdf([label], inverted=True, design="frame")
    assert b"\n1 g\n" in inverted and b"1 G" in inverted  # weiße Schrift und weißer Rahmen
    plain = build_pdf([label], "2x4")
    logo = build_pdf([label], "2x4", logo=True)
    assert logo.count(b" re\n") > plain.count(b" re\n")  # höhere Fehlerkorrektur: mehr Module
    assert logo.count(b" c ") > plain.count(b" c ")  # Symbol mit Rundungen
    # sehr kleine Etiketten: kein Symbol
    small = build_pdf([label], "54x25", logo=True)
    assert small.count(b" re\n") == build_pdf([label], "54x25").count(b" re\n")


async def test_device_registry_untouched(hass: HomeAssistant) -> None:
    # Fächer sind kein Gerät in Home Assistant
    await _setup(hass, "AAAA")
    assert all(d.model != "compartment" for d in dr.async_get(hass).devices.values())
