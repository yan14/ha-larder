"""Tests: Bestand als CSV, Schätzungen exportieren und einlesen, Diagnose, Umbenennen (Reconfigure)."""

import json

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr

from custom_components.larder.const import DOMAIN
from custom_components.larder.diagnostics import async_get_config_entry_diagnostics
from custom_components.larder.estimate import async_get_estimator
from custom_components.larder.export import async_import_estimates, inventory_csv

from .test_recipes import _eid, _fill, _setup, auto_enable_custom_integrations  # noqa: F401


async def _kitchen(hass: HomeAssistant, cc: str) -> None:
    area = ar.async_get(hass).async_get_or_create("Kühlschrank")
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)


async def test_inventory_csv(hass: HomeAssistant, hass_client) -> None:
    hass.config.language = "de"
    await _setup(hass, "BBBB")
    await _setup(hass, "AAAA")
    await _kitchen(hass, "AAAA")
    await _fill(hass, "AAAA", "Salami, Leberwurst", 2, quantity=3, unit="slices")
    text = inventory_csv(hass).decode("utf-8")
    assert text.startswith("﻿Name;ID;Bereich;Fach;Inhalt;Menge;Einheit;Eingelagert am;MHD;Tage übrig;Status;Vakuum")
    lines = text.lstrip("﻿").splitlines()
    assert lines[1].startswith("Dose AAAA;AAAA;Kühlschrank;;Salami, Leberwurst;3;Scheiben;")
    assert lines[1].endswith(";2;läuft bald ab;ja;;;;;;;;")
    assert lines[2].startswith("Dose BBBB;BBBB;;;;;;")

    client = await hass_client()
    resp = await client.get("/api/larder/export/containers.csv")
    assert resp.status == 200
    assert resp.headers["Content-Type"].startswith("text/csv")
    assert "attachment" in resp.headers["Content-Disposition"]
    assert (await client.get("/api/larder/export/nope")).status == 404


async def test_estimates_round_trip(hass: HomeAssistant, hass_client) -> None:
    await _setup(hass, "AAAA")
    estimator = await async_get_estimator(hass)
    await estimator.async_add_entry("Lachs", "Kühlschrank", True, 3, "kühl lagern")
    await estimator.async_add_entry("Gouda", "Kühlschrank", False, 20)
    client = await hass_client()
    resp = await client.get("/api/larder/export/estimates.json")
    assert resp.status == 200
    data = json.loads(await resp.read())
    assert data["domain"] == DOMAIN and data["kind"] == "estimates"
    assert {(e["content"], e["days"]) for e in data["entries"]} == {("Lachs", 3), ("Gouda", 20)}

    # eigene Korrektur bleibt gegen einen Tabellenwert aus der Datei; neue Einträge kommen dazu
    await estimator.async_delete_entry(next(e["key"] for e in estimator.list_entries() if e["content"] == "Gouda"))
    data["entries"].append({"content": "Lachs", "area": "Kühlschrank", "vacuum": True, "days": 9, "source": "table"})
    data["entries"].append({"content": "", "area": "x", "days": 3})
    data["entries"].append({"content": "Reis", "area": "Keller", "days": 99999})
    result = await async_import_estimates(hass, data)
    assert result == {"added": 1, "updated": 0, "kept": 1, "skipped": 2}
    lachs = next(e for e in estimator.list_entries() if e["content"] == "Lachs")
    assert lachs["days"] == 3

    # ersetzen: nur noch der Inhalt der Datei
    result = await async_import_estimates(hass, {"domain": DOMAIN, "entries": [{"content": "Reis", "area": "Keller", "days": 300}]}, replace=True)
    assert result["added"] == 1
    assert [e["content"] for e in estimator.list_entries()] == ["Reis"]


async def test_import_over_websocket(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass, "AAAA")
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "larder/estimates_import", "data": {"domain": "other", "entries": []}})
    msg = await ws.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "invalid_file"
    await ws.send_json(
        {"id": 2, "type": "larder/estimates_import", "data": {"domain": DOMAIN, "entries": [{"content": "Brot", "area": "Küche", "days": 4}]}}
    )
    msg = await ws.receive_json()
    assert msg["success"] and msg["result"]["added"] == 1 and msg["result"]["entries"][0]["content"] == "Brot"


async def test_diagnostics_without_secrets(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Lachs", 2)
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["entry"]["data"]["cc"] == "AAAA"
    assert diag["containers"] == 1
    assert any(e["unique_id"] == "AAAA_content" and e["state"] == "Lachs" for e in diag["entities"])
    assert "webhook" not in json.dumps(diag).lower()


async def test_reconfigure_renames_the_container(hass: HomeAssistant) -> None:
    entry = await _setup(hass, "AAAA")
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_RECONFIGURE, "entry_id": entry.entry_id}
    )
    assert result["step_id"] == "reconfigure"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"name": " "})
    assert result["errors"] == {"name": "name_required"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"name": "Wurstdose"})
    assert result["type"] == "abort" and result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()
    assert entry.title == "Wurstdose"
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "AAAA")})
    assert device.name == "Wurstdose"
    assert entry.data["cc"] == "AAAA"
