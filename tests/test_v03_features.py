"""Tests: MHD, QR-Bild, 'Neuen QR Code erstellen' und das Dosen-Panel."""

from datetime import date
import re

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.components import frontend
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er

from custom_components.larder.const import DOMAIN
from custom_components.larder.qr import generate_code, parse_qr


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _setup(hass: HomeAssistant, cc: str = "34OL") -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=cc,
        title=f"Dose {cc}",
        data={"cc": cc, "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _entity_id(hass: HomeAssistant, domain: str, cc: str = "34OL") -> str:
    reg = er.async_get(hass)
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    return next(
        e.entity_id
        for e in er.async_entries_for_device(reg, device.id)
        if e.domain == domain and (domain != "switch" or e.unique_id.endswith("_vacuum")) and (domain != "text" or e.unique_id.endswith("_content"))
    )


# ---------- MHD ----------


async def test_best_before_set_and_restore(hass: HomeAssistant) -> None:
    from pytest_homeassistant_custom_component.common import mock_restore_cache
    from homeassistant.core import State

    entry = await _setup(hass)
    mhd = _entity_id(hass, "date")
    assert hass.states.get(mhd).state == "unknown"

    await hass.services.async_call(
        "date", "set_value", {"entity_id": mhd, "date": "2026-12-24"}, blocking=True
    )
    assert hass.states.get(mhd).state == "2026-12-24"

    # Wiederherstellung nach Neustart
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    mock_restore_cache(hass, (State(mhd, "2027-01-15"),))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(mhd).state == "2027-01-15"
    assert date.fromisoformat(hass.states.get(mhd).state) == date(2027, 1, 15)


async def test_empty_button_resets_best_before_too(hass: HomeAssistant) -> None:
    await _setup(hass)
    mhd, text, filled, button = (
        _entity_id(hass, d) for d in ("date", "text", "datetime", "button")
    )
    await hass.services.async_call(
        "date", "set_value", {"entity_id": mhd, "date": "2026-12-24"}, blocking=True
    )
    await hass.services.async_call(
        "text", "set_value", {"entity_id": text, "value": "Suppe"}, blocking=True
    )
    await hass.services.async_call(
        "datetime",
        "set_value",
        {"entity_id": filled, "datetime": "2026-11-09 10:00:00+00:00"},
        blocking=True,
    )
    await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
    assert hass.states.get(text).state == ""
    assert hass.states.get(mhd).state == "unknown"
    assert hass.states.get(filled).state == "unknown"


async def test_two_containers_are_reset_independently(hass: HomeAssistant) -> None:
    await _setup(hass, "34OL")
    await _setup(hass, "77AB")
    texts = {cc: _entity_id(hass, "text", cc) for cc in ("34OL", "77AB")}
    for cc, eid in texts.items():
        await hass.services.async_call(
            "text", "set_value", {"entity_id": eid, "value": cc}, blocking=True
        )
    await hass.services.async_call(
        "button", "press", {"entity_id": _entity_id(hass, "button", "34OL")}, blocking=True
    )
    assert hass.states.get(texts["34OL"]).state == ""
    assert hass.states.get(texts["77AB"]).state == "77AB"


# ---------- QR-Bild ----------


async def test_qr_image_opens_the_dashboard_at_the_container(hass: HomeAssistant, hass_client) -> None:
    await _setup(hass)
    image_id = _entity_id(hass, "image")
    expected = "homeassistant://navigate/larder?cc=34OL"

    state = hass.states.get(image_id)
    assert state.attributes["qr_content"] == expected

    client = await hass_client()
    resp = await client.get(state.attributes["entity_picture"])
    assert resp.status == 200
    assert resp.content_type == "image/png"
    body = await resp.read()
    assert body.startswith(b"\x89PNG\r\n\x1a\n")

    # PNG zurücklesen und mit dem erwarteten Inhalt vergleichen
    from io import BytesIO

    import segno

    expected_png = BytesIO()
    segno.make_qr(expected, error="m").save(expected_png, kind="png", scale=10, border=4)
    assert body == expected_png.getvalue()


def test_qr_png_decodes_to_deep_link() -> None:
    """Das erzeugte PNG enthält exakt den Deep Link (per OpenCV zurückgelesen, falls vorhanden)."""
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    from custom_components.larder.image import render_qr_png

    content = "homeassistant://navigate/config/devices/device/0123456789abcdef0123456789abcdef"
    png = render_qr_png(content)
    img = cv2.imdecode(np.frombuffer(png, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    assert decoded == content


# ---------- Neuen QR Code erstellen ----------


async def test_flow_create_generates_unique_id(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "create"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "create"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "Gefrierdose"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Gefrierdose"
    cc = result["data"]["cc"]
    assert re.fullmatch(r"HA-[2-9A-HJ-NP-Z]{8}", cc)
    assert result["data"]["source"] == "generated"
    assert result["data"]["tc"] is None
    await hass.async_block_till_done()

    # Gerät existiert mit allen fünf Entitäten und das Webhook-Parsing erkennt die ID
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, cc)})
    assert device is not None
    entities = er.async_entries_for_device(er.async_get(hass), device.id)
    assert {e.domain for e in entities} == {"button", "date", "datetime", "image", "number", "select", "sensor", "switch", "text"}
    assert parse_qr(cc).cc == cc


async def test_flow_create_default_name_and_two_distinct_ids(hass: HomeAssistant) -> None:
    codes = []
    for _ in range(2):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"next_step_id": "create"}
        )
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        assert result["type"] is FlowResultType.CREATE_ENTRY
        assert result["title"] == f"Dose {result['data']['cc']}"
        codes.append(result["data"]["cc"])
        await hass.async_block_till_done()
    assert codes[0] != codes[1]


def test_generate_code_never_collides() -> None:
    first = generate_code()
    assert first.startswith("HA-") and len(first) == 11
    # Kollisionen mit bestehenden IDs werden übersprungen (hier: Alphabet-Trick mit festem Zufall)
    taken = {generate_code() for _ in range(200)}
    fresh = generate_code(taken)
    assert fresh not in taken
    # Zwilling-IDs haben kein "HA-"-Präfix, die Formate überschneiden sich nicht
    assert not re.fullmatch(r"HA-[A-Z0-9]{8}", "34OL")
    assert generate_code(["34OL", None]).startswith("HA-")


# ---------- Panel ----------


async def test_panel_registered_and_static_js_served(hass: HomeAssistant, hass_client) -> None:
    entry = await _setup(hass)
    panels = hass.data[frontend.DATA_PANELS]
    assert "larder" in panels
    panel = panels["larder"]
    assert panel.sidebar_title == "Larder"
    assert panel.require_admin is False
    module_url = panel.config["_panel_custom"]["module_url"]
    # seit 2.0: das neue Dashboard (früher "Larder experimental"); es lädt larder-panel.js für Dialoge und Karten
    assert re.fullmatch(r"/larder_static/larder-dashboard\.js\?v=\d+\.\d+\.\d+", module_url)
    assert panel.config["_panel_custom"]["name"] == "larder-dashboard"

    client = await hass_client()
    for name in ("larder-dashboard.js", "larder-panel.js", "larder-experimental.js"):
        resp = await client.get(f"/larder_static/{name}")
        assert resp.status == 200
        assert "customElements.define" in await resp.text()

    # Zweite Dose: Panel bleibt, nur eine Registrierung
    second = await _setup(hass, "77AB")
    assert "larder" in hass.data[frontend.DATA_PANELS]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder" in hass.data[frontend.DATA_PANELS]

    assert await hass.config_entries.async_unload(second.entry_id)
    await hass.async_block_till_done()
    assert "larder" not in hass.data[frontend.DATA_PANELS]

    # Neu laden: Panel wird wieder registriert (statischer Pfad nur einmal)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder" in hass.data[frontend.DATA_PANELS]


async def _create_via_flow(hass: HomeAssistant, step: str, user_input: dict):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": step}
    )
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], user_input
    )


async def test_flow_create_applies_selected_area_once(hass: HomeAssistant) -> None:
    """Bereich aus dem Anlegen landet am Gerät und überschreibt später keine Änderung."""
    from homeassistant.helpers import area_registry as ar

    kitchen = ar.async_get(hass).async_create("Küche")
    cellar = ar.async_get(hass).async_create("Keller")

    result = await _create_via_flow(
        hass, "create", {"name": "Suppe", "area_id": kitchen.id}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert "area_id" not in entry.data  # nur einmalig angewendet
    device = dr.async_get(hass).async_get_device(
        identifiers={(DOMAIN, entry.data["cc"])}
    )
    assert device.area_id == kitchen.id

    # Nutzer ändert den Bereich später; ein Neuladen darf ihn nicht zurücksetzen
    dr.async_get(hass).async_update_device(device.id, area_id=cellar.id)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert dr.async_get(hass).async_get_device(
        identifiers={(DOMAIN, entry.data["cc"])}
    ).area_id == cellar.id


async def test_flow_scan_with_area(hass: HomeAssistant) -> None:
    from homeassistant.helpers import area_registry as ar

    cellar = ar.async_get(hass).async_create("Keller")
    result = await _create_via_flow(
        hass,
        "scan",
        {"qr_code": "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL", "area_id": cellar.id},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    assert device.area_id == cellar.id


async def test_flow_without_area_leaves_device_unassigned(hass: HomeAssistant) -> None:
    result = await _create_via_flow(hass, "create", {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    device = dr.async_get(hass).async_get_device(
        identifiers={(DOMAIN, entry.data["cc"])}
    )
    assert device.area_id is None


async def test_flow_works_via_rest_api_for_the_panel(hass: HomeAssistant, hass_client) -> None:
    """Das Panel nutzt die REST-API des Config Flows: Menü → create → Eintrag."""
    from homeassistant.setup import async_setup_component

    # Erst Integration und Config-API einrichten, dann den HTTP-Client holen
    # (danach ist der Router eingefroren und es lassen sich keine Routen mehr anmelden).
    await _setup(hass)
    assert await async_setup_component(hass, "config", {})
    client = await hass_client()
    resp = await client.post(
        "/api/config/config_entries/flow", json={"handler": DOMAIN, "show_advanced_options": False}
    )
    assert resp.status == 200
    flow = await resp.json()
    assert flow["type"] == "menu"

    resp = await client.post(
        f"/api/config/config_entries/flow/{flow['flow_id']}", json={"next_step_id": "create"}
    )
    assert (await resp.json())["step_id"] == "create"

    resp = await client.post(
        f"/api/config/config_entries/flow/{flow['flow_id']}", json={"name": "Aus Panel"}
    )
    data = await resp.json()
    assert data["type"] == "create_entry"
    assert data["title"] == "Aus Panel"
