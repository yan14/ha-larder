"""Tests: Übernahme der früheren Integration "Zwilling Food Storage" (Domain zwilling_storage)."""

import json
from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry, mock_restore_cache

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant, State
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

from custom_components.larder.const import DOMAIN, LEGACY_DOMAIN
from custom_components.larder.migrate import legacy_entries, remove_legacy_folder

# (Plattform, unique_id-Schlüssel, bisherige Entity-ID)
ENTITIES = [
    ("text", "content", "text.dose_34ol_inhalt"),
    ("date", "best_before", "date.dose_34ol_mhd"),
    ("datetime", "filled_at", "datetime.dose_34ol_befullt_am"),
    ("button", "empty_container", "button.dose_34ol_behalter_leeren"),
    ("image", "qr_code", "image.dose_34ol_qr_code"),
    ("sensor", "days_left", "sensor.dose_34ol_tage_bis_mhd"),
    ("switch", "vacuum", "switch.dose_34ol_vakuum"),
]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


def _legacy_dose(hass: HomeAssistant, cc: str = "34OL", *, area: str | None = None, prefix: str = "dose_34ol"):
    """Eine Dose so anlegen, wie die frühere Integration sie hinterlassen hat."""
    entry = MockConfigEntry(
        domain=LEGACY_DOMAIN,
        unique_id=cc,
        title=f"Dose {cc}",
        data={"cc": cc, "tc": "42ML30", "size": "m", "source": "zwilling"},
    )
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(LEGACY_DOMAIN, cc)},
        name=f"Dose {cc}",
        manufacturer="ZWILLING",
    )
    if area:
        dr.async_get(hass).async_update_device(device.id, area_id=area)
    registry = er.async_get(hass)
    for platform, key, entity_id in ENTITIES:
        registry.async_get_or_create(
            platform,
            LEGACY_DOMAIN,
            f"{cc}_{key}",
            config_entry=entry,
            device_id=device.id,
            suggested_object_id=entity_id.split(".", 1)[1].replace("dose_34ol", prefix),
        )
    return entry, device


async def _run_migration(hass: HomeAssistant):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["migrate", "scan", "create"]
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "migrate"})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "migrate"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    return result


async def test_no_migrate_option_without_legacy_entries(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["menu_options"] == ["scan", "create"]


async def test_migration_keeps_entity_ids_device_area_and_values(hass: HomeAssistant, hass_storage) -> None:
    area = ar.async_get(hass).async_create("Kühlschrank")
    legacy, device = _legacy_dose(hass, area=area.id)
    mock_restore_cache(
        hass,
        [
            State("text.dose_34ol_inhalt", "Pizza"),
            State("date.dose_34ol_mhd", "2026-12-24"),
            State("switch.dose_34ol_vakuum", "off"),
        ],
    )

    result = await _run_migration(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "migrated"
    assert result["description_placeholders"] == {"count": "1"}

    # Alte Einträge sind weg, ein neuer Eintrag mit denselben Daten ist da
    assert legacy_entries(hass) == []
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    assert (entry.unique_id, entry.title) == ("34OL", "Dose 34OL")
    assert entry.data["cc"] == "34OL" and entry.data["tc"] == "42ML30" and entry.data["source"] == "zwilling"

    # Gerät bleibt dasselbe (Bereich, ID), nur die Zuordnung wechselt
    devices = dr.async_get(hass)
    moved = devices.async_get(device.id)
    assert moved is not None and moved.area_id == area.id
    assert moved.identifiers == {(DOMAIN, "34OL")}
    assert moved.config_entries == {entry.entry_id}

    # Entitäten behalten ihre IDs, gehören jetzt zu Larder und laufen
    registry = er.async_get(hass)
    for platform, key, entity_id in ENTITIES:
        reg = registry.async_get(entity_id)
        assert reg is not None, entity_id
        assert (reg.platform, reg.unique_id, reg.config_entry_id) == (DOMAIN, f"34OL_{key}", entry.entry_id)
        assert hass.states.get(entity_id) is not None, entity_id
    assert len(er.async_entries_for_config_entry(registry, entry.entry_id)) == len(ENTITIES)
    assert [e.entity_id for e in registry.entities.values() if e.platform == LEGACY_DOMAIN] == []

    # Letzte Werte bleiben erhalten
    assert hass.states.get("text.dose_34ol_inhalt").state == "Pizza"
    assert hass.states.get("date.dose_34ol_mhd").state == "2026-12-24"
    assert hass.states.get("switch.dose_34ol_vakuum").state == "off"


async def test_migration_copies_stores_and_webhook_id(hass: HomeAssistant, hass_storage) -> None:
    _legacy_dose(hass)
    for name, data in {
        "webhook": {"webhook_id": "geheim123"},
        "nfc": {"tag-a": "34OL"},
        "estimator": {"settings": {"mode": "table_ai", "opened_days": 5}, "cache": {}},
    }.items():
        hass_storage[f"{LEGACY_DOMAIN}.{name}"] = {
            "version": 1, "minor_version": 1, "key": f"{LEGACY_DOMAIN}.{name}", "data": data,
        }

    await _run_migration(hass)

    assert hass_storage[f"{DOMAIN}.webhook"]["data"] == {"webhook_id": "geheim123"}
    assert hass_storage[f"{DOMAIN}.nfc"]["data"] == {"tag-a": "34OL"}
    assert hass_storage[f"{DOMAIN}.estimator"]["data"]["settings"]["opened_days"] == 5
    # Der Scan-Webhook läuft unter derselben (geheimen) ID weiter
    assert "geheim123" in hass.data["webhook"]
    # Marker für die Übergangshilfen
    assert hass_storage[f"{DOMAIN}.migration"]["data"] == {"from": LEGACY_DOMAIN, "count": 1}


async def test_migration_of_several_doses(hass: HomeAssistant) -> None:
    _legacy_dose(hass, "34OL")
    entry2, device2 = _legacy_dose(hass, "HA-ABCD1234", prefix="dose_ha_abcd1234")
    # zweite Dose hat eigene Entity-IDs
    registry = er.async_get(hass)
    assert registry.async_get("text.dose_ha_abcd1234_inhalt") is not None

    result = await _run_migration(hass)
    assert result["description_placeholders"] == {"count": "2"}
    assert sorted(e.unique_id for e in hass.config_entries.async_entries(DOMAIN)) == ["34OL", "HA-ABCD1234"]
    assert legacy_entries(hass) == []
    assert registry.async_get("text.dose_ha_abcd1234_inhalt").platform == DOMAIN
    assert dr.async_get(hass).async_get(device2.id).identifiers == {(DOMAIN, "HA-ABCD1234")}


async def test_legacy_services_and_event_still_work_after_migration(hass: HomeAssistant) -> None:
    _legacy_dose(hass)
    await _run_migration(hass)

    assert hass.services.has_service(LEGACY_DOMAIN, "get_expiring")
    assert hass.services.has_service(LEGACY_DOMAIN, "estimate_best_before")
    new = await hass.services.async_call(DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    old = await hass.services.async_call(LEGACY_DOMAIN, "get_expiring", {}, blocking=True, return_response=True)
    assert old == new

    # Entity-Service über den alten Namen (hier: MHD leeren)
    hass.states.async_set("date.dose_34ol_mhd", "2026-12-24")
    await hass.services.async_call(
        LEGACY_DOMAIN, "clear_best_before", {"entity_id": "date.dose_34ol_mhd"}, blocking=True
    )
    assert hass.states.get("date.dose_34ol_mhd").state == "unknown"


async def test_compat_is_restored_after_restart_and_absent_on_fresh_installs(hass: HomeAssistant, hass_storage) -> None:
    # Neuinstallation: keine Übergangshilfen
    entry = MockConfigEntry(domain=DOMAIN, unique_id="NEU1", title="Neu", data={"cc": "NEU1", "tc": None, "size": None})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert not hass.services.has_service(LEGACY_DOMAIN, "get_expiring")

    # Nach einer früheren Übernahme (Marker vorhanden) sind sie nach dem Neustart wieder da
    hass_storage[f"{DOMAIN}.migration"] = {
        "version": 1, "minor_version": 1, "key": f"{DOMAIN}.migration", "data": {"from": LEGACY_DOMAIN, "count": 1},
    }
    await hass.config_entries.async_unload(entry.entry_id)
    hass.data.pop(DOMAIN, None)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.services.has_service(LEGACY_DOMAIN, "get_expiring")


async def test_existing_larder_dose_is_not_duplicated(hass: HomeAssistant) -> None:
    legacy, _ = _legacy_dose(hass)
    existing = MockConfigEntry(domain=DOMAIN, unique_id="34OL", title="Schon da", data={"cc": "34OL", "tc": None, "size": None})
    existing.add_to_hass(hass)

    result = await _run_migration(hass)
    assert result["reason"] == "migrated"
    entries = hass.config_entries.async_entries(DOMAIN)
    assert [e.title for e in entries] == ["Schon da"]
    assert legacy_entries(hass) == []


def test_remove_legacy_folder(tmp_path: Path) -> None:
    folder = tmp_path / "zwilling_storage"
    folder.mkdir()
    (folder / "__init__.py").write_text("")
    manifest = {"domain": "zwilling_storage", "codeowners": ["@yan14"]}
    (folder / "manifest.json").write_text(json.dumps(manifest))
    assert remove_legacy_folder(folder) is True
    assert not folder.exists()

    # fremde Integration, kaputtes oder fehlendes Manifest bleiben unberührt
    other = tmp_path / "other"
    other.mkdir()
    (other / "manifest.json").write_text(json.dumps({"domain": "zwilling_storage", "codeowners": ["@someone"]}))
    assert remove_legacy_folder(other) is False
    assert other.exists()
    assert remove_legacy_folder(tmp_path / "missing") is False
    (other / "manifest.json").write_text("{kaputt")
    assert remove_legacy_folder(other) is False


async def test_migration_unloads_a_still_running_legacy_integration(
    hass: HomeAssistant, hass_storage, tmp_path: Path
) -> None:
    """Liegt der alte Ordner noch da und läuft, wird er zuerst entladen (kein doppelter Webhook)."""
    import custom_components
    from homeassistant import loader

    stub = tmp_path / "zwilling_storage"
    stub.mkdir()
    (stub / "manifest.json").write_text(
        json.dumps(
            {
                "domain": "zwilling_storage",
                "name": "Zwilling Food Storage",
                "version": "0.10.1",
                "dependencies": ["webhook"],
                "config_flow": True,
                "codeowners": ["@yan14"],
            }
        )
    )
    (stub / "__init__.py").write_text(
        '''
from homeassistant.components import webhook

WID = "geheim123"


async def _handler(hass, webhook_id, request):
    return None


async def async_setup_entry(hass, entry):
    webhook.async_register(hass, "zwilling_storage", "Zwilling", WID, _handler)
    hass.data["legacy_removed"] = False
    return True


async def async_unload_entry(hass, entry):
    webhook.async_unregister(hass, WID)
    return True


async def async_remove_entry(hass, entry):
    hass.data["legacy_removed"] = True
'''
    )
    (stub / "config_flow.py").write_text(
        "from homeassistant.config_entries import ConfigFlow\n"
        "class Flow(ConfigFlow, domain='zwilling_storage'):\n    VERSION = 1\n"
    )
    hass_storage[f"{LEGACY_DOMAIN}.webhook"] = {
        "version": 1, "minor_version": 1, "key": f"{LEGACY_DOMAIN}.webhook", "data": {"webhook_id": "geheim123"},
    }
    custom_components.__path__.append(str(tmp_path))
    try:
        hass.data.pop(loader.DATA_CUSTOM_COMPONENTS, None)
        legacy, _ = _legacy_dose(hass)
        assert await hass.config_entries.async_setup(legacy.entry_id)
        assert "geheim123" in hass.data["webhook"]

        result = await _run_migration(hass)
        assert result["reason"] == "migrated"
        assert legacy_entries(hass) == []
        assert hass.data["legacy_removed"] is True
        assert "geheim123" in hass.data["webhook"]  # jetzt von Larder registriert
        assert hass.data["webhook"]["geheim123"]["domain"] == DOMAIN
    finally:
        custom_components.__path__ = [p for p in custom_components.__path__ if p != str(tmp_path)]
        hass.data.pop(loader.DATA_CUSTOM_COMPONENTS, None)
