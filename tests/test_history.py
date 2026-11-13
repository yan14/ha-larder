"""Tests: Verlauf pro Dose (Leeren mit gegessen/weggeworfen, Abruf, CSV)."""

from custom_components.larder.const import DOMAIN
from custom_components.larder.export import history_csv
from custom_components.larder.history import async_get_history
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _device(hass: HomeAssistant, cc: str) -> str:
    return dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)}).id


async def test_emptying_records_history_with_outcome(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    await _setup(hass, "BBBB")
    await _fill(hass, "AAAA", "Bolognese", 3, quantity=2)
    await _fill(hass, "BBBB", "Käse", -2)
    ws = await hass_ws_client(hass)

    await ws.send_json({"id": 1, "type": "larder/empty", "device_id": _device(hass, "AAAA"), "outcome": "eaten"})
    assert (await ws.receive_json())["success"]
    assert hass.states.get(_eid(hass, "text", "AAAA")).state == ""

    # direkt über den Button (z. B. Automation): ohne Antwort
    await hass.services.async_call("button", "press", {"entity_id": _eid(hass, "button", "BBBB")}, blocking=True)

    history = await async_get_history(hass)
    newest, older = history.list()
    assert (older["cc"], older["content"], older["quantity"], older["unit"], older["outcome"], older["expired"]) == (
        "AAAA", "Bolognese", 2, "portions", "eaten", False,
    )
    assert older["name"] == "Dose AAAA" and older["emptied"]
    assert (newest["cc"], newest["content"], newest["outcome"], newest["expired"]) == ("BBBB", "Käse", None, True)

    # Abruf pro Dose und nachträglich festlegen
    await ws.send_json({"id": 2, "type": "larder/history", "device_id": _device(hass, "BBBB")})
    msg = await ws.receive_json()
    assert [r["content"] for r in msg["result"]["records"]] == ["Käse"]
    await ws.send_json({"id": 3, "type": "larder/history_outcome", "record_id": newest["id"], "outcome": "thrown"})
    assert (await ws.receive_json())["success"]
    assert history.list("BBBB")[0]["outcome"] == "thrown"
    await ws.send_json({"id": 4, "type": "larder/history_outcome", "record_id": "nope", "outcome": "eaten"})
    assert not (await ws.receive_json())["success"]

    # leere Dose leeren: kein Eintrag
    await ws.send_json({"id": 5, "type": "larder/empty", "device_id": _device(hass, "AAAA"), "outcome": "eaten"})
    await ws.receive_json()
    assert len(history.list()) == 2


async def test_unknown_device_and_history_csv(hass: HomeAssistant, hass_ws_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Lachs", 1)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "larder/empty", "device_id": "unknown", "outcome": "eaten"})
    msg = await ws.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"
    await ws.send_json({"id": 2, "type": "larder/empty", "device_id": _device(hass, "AAAA"), "outcome": "thrown"})
    await ws.receive_json()
    text = (await history_csv(hass)).decode("utf-8").lstrip("﻿")
    header, row = text.splitlines()
    assert header.startswith("Name;ID;Bereich;Inhalt")
    assert row.startswith("Dose AAAA;AAAA;;Lachs;")
    assert row.endswith(";nein;weggeworfen")
