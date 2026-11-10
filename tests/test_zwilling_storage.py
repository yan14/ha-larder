"""Tests für die Zwilling-Food-Storage-Integration."""

from datetime import datetime, timezone

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    mock_restore_cache,
)

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant, State
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er

from custom_components.zwilling_storage.const import DOMAIN
from custom_components.zwilling_storage.qr import generate_code, parse_qr

QR = "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _start_scan(hass: HomeAssistant):
    """Config Flow starten und im Menü 'Zwilling QR Code einlesen' wählen."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["scan", "create"]
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "scan"}
    )


@pytest.mark.parametrize(
    ("raw", "cc", "tc", "size"),
    [
        (QR, "34OL", "42ML30", "m"),
        (f"  {QR}\n", "34OL", "42ML30", "m"),
        ("tc=42ML30&s=m&cc=34ol", "34OL", "42ML30", "m"),
        ("?cc=34OL", "34OL", None, None),
        ("34OL", "34OL", None, None),
    ],
)
def test_parse_ok(raw, cc, tc, size):
    parsed = parse_qr(raw)
    assert parsed is not None
    assert (parsed.cc, parsed.tc, parsed.size) == (cc, tc, size)


@pytest.mark.parametrize(
    "raw",
    ["", "   ", None, "zwilling://x/?tc=1", "cc=", "a", "cc=bad id!", "x" * 40],
)
def test_parse_invalid(raw):
    assert parse_qr(raw) is None


async def test_flow_creates_device_with_entities(hass: HomeAssistant) -> None:
    result = await _start_scan(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "scan"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"qr_code": QR}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Dose 34OL"
    assert result["data"] == {
        "cc": "34OL",
        "tc": "42ML30",
        "size": "m",
        "source": "zwilling",
    }
    await hass.async_block_till_done()

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert entry.unique_id == "34OL"

    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    assert device is not None
    assert device.manufacturer == "ZWILLING"
    assert device.model == "42ML30 (M)"
    assert device.serial_number == "34OL"

    entities = er.async_entries_for_device(er.async_get(hass), device.id)
    assert {e.domain for e in entities} == {"button", "date", "datetime", "image", "sensor", "switch", "text"}
    assert {e.unique_id for e in entities} == {
        "34OL_filled_at",
        "34OL_content",
        "34OL_empty_container",
        "34OL_best_before",
        "34OL_qr_code",
        "34OL_vacuum",
        "34OL_days_left",
    }


async def test_flow_invalid_code(hass: HomeAssistant) -> None:
    result = await _start_scan(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"qr_code": "zwilling://x/?tc=1"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"qr_code": "invalid_code"}


async def test_flow_duplicate_aborts(hass: HomeAssistant) -> None:
    MockConfigEntry(
        domain=DOMAIN, unique_id="34OL", data={"cc": "34OL"}, title="x"
    ).add_to_hass(hass)

    result = await _start_scan(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"qr_code": "cc=34ol"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_flow_custom_name(hass: HomeAssistant) -> None:
    result = await _start_scan(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"qr_code": QR, "name": "Suppendose"}
    )
    assert result["title"] == "Suppendose"
    await hass.async_block_till_done()
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "34OL")})
    assert device.name == "Suppendose"


async def test_set_values_and_unload(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="34OL",
        title="Dose 34OL",
        data={"cc": "34OL", "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    dt_id = next(s.entity_id for s in hass.states.async_all("datetime"))
    text_id = next(s.entity_id for s in hass.states.async_all("text"))
    assert dt_id.startswith("datetime.dose_34ol_")
    assert text_id.startswith("text.dose_34ol_")
    assert hass.states.get(dt_id).state == "unknown"

    await hass.services.async_call(
        "datetime",
        "set_value",
        {"entity_id": dt_id, "datetime": "2026-11-09 10:00:00+00:00"},
        blocking=True,
    )
    await hass.services.async_call(
        "text",
        "set_value",
        {"entity_id": text_id, "value": "Gulasch"},
        blocking=True,
    )
    assert hass.states.get(dt_id).state == "2026-11-09T10:00:00+00:00"
    assert hass.states.get(text_id).state == "Gulasch"

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(dt_id).state == "unavailable"


async def test_restore_state(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="34OL",
        title="Dose 34OL",
        data={"cc": "34OL", "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)

    # Entity-IDs vorab über die Registry festlegen, damit der Restore-Cache greift
    ent_reg = er.async_get(hass)
    dt_entity = ent_reg.async_get_or_create(
        "datetime", DOMAIN, "34OL_filled_at", suggested_object_id="dose_a_filled",
        config_entry=entry,
    )
    text_entity = ent_reg.async_get_or_create(
        "text", DOMAIN, "34OL_content", suggested_object_id="dose_a_content",
        config_entry=entry,
    )
    mock_restore_cache(
        hass,
        (
            State(dt_entity.entity_id, "2026-11-01T08:30:00+00:00"),
            State(text_entity.entity_id, "Lasagne"),
        ),
    )

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get(dt_entity.entity_id).state == "2026-11-01T08:30:00+00:00"
    assert hass.states.get(text_entity.entity_id).state == "Lasagne"


async def test_empty_button_resets_everything_of_the_container(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="34OL",
        title="Dose 34OL",
        data={"cc": "34OL", "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    dt_id = next(s.entity_id for s in hass.states.async_all("datetime"))
    date_id = next(s.entity_id for s in hass.states.async_all("date"))
    text_id = next(s.entity_id for s in hass.states.async_all("text"))
    button_id = next(s.entity_id for s in hass.states.async_all("button"))
    assert button_id.startswith("button.dose_34ol_")

    await hass.services.async_call(
        "datetime",
        "set_value",
        {"entity_id": dt_id, "datetime": "2026-11-09 10:00:00+00:00"},
        blocking=True,
    )
    await hass.services.async_call(
        "date", "set_value", {"entity_id": date_id, "date": "2026-12-24"}, blocking=True
    )
    await hass.services.async_call(
        "text", "set_value", {"entity_id": text_id, "value": "Gulasch"}, blocking=True
    )
    assert hass.states.get(text_id).state == "Gulasch"
    assert hass.states.get(date_id).state == "2026-12-24"
    assert hass.states.get(dt_id).state == "2026-11-09T10:00:00+00:00"

    await hass.services.async_call(
        "button", "press", {"entity_id": button_id}, blocking=True
    )
    assert hass.states.get(text_id).state == ""
    assert hass.states.get(date_id).state == "unknown"
    assert hass.states.get(dt_id).state == "unknown"


async def test_empty_button_resets_only_available_entities_and_raises_if_none(
    hass: HomeAssistant,
) -> None:
    from homeassistant.exceptions import HomeAssistantError

    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="34OL",
        title="Dose 34OL",
        data={"cc": "34OL", "tc": "42ML30", "size": "m"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    text_id = next(s.entity_id for s in hass.states.async_all("text"))
    date_id = next(s.entity_id for s in hass.states.async_all("date"))
    button_id = next(s.entity_id for s in hass.states.async_all("button"))
    await hass.services.async_call(
        "text", "set_value", {"entity_id": text_id, "value": "Suppe"}, blocking=True
    )
    await hass.services.async_call(
        "date", "set_value", {"entity_id": date_id, "date": "2026-12-24"}, blocking=True
    )

    # MHD-Entität fehlt: der Rest wird trotzdem zurückgesetzt
    del entry.runtime_data.resettable["best_before"]
    await hass.services.async_call("button", "press", {"entity_id": button_id}, blocking=True)
    assert hass.states.get(text_id).state == ""
    assert hass.states.get(date_id).state == "2026-12-24"

    # gar nichts mehr zurückzusetzen: verständlicher Fehler
    entry.runtime_data.resettable.clear()
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "button", "press", {"entity_id": button_id}, blocking=True
        )
