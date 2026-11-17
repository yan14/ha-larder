"""Tests block 25: main entry "Larder" (one-step setup, dashboard without a container, migration)."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.larder.const import DOMAIN
from homeassistant.components import frontend
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.mark.no_main
async def test_add_integration_creates_main_entry_and_dashboard(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Larder"
    assert result["data"] == {"source": "main"}
    await hass.async_block_till_done()
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    assert entry.unique_id == "larder_main"
    assert "larder" in hass.data[frontend.DATA_PANELS]
    # no device, no entities
    # second time: the menu for containers (the dashboard uses it, too)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["scan", "create"]
    # settings live on the main entry
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    # unloading the main entry removes the dashboard
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "larder" not in hass.data[frontend.DATA_PANELS]


@pytest.mark.no_main
async def test_existing_installation_gets_main_entry(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    container = MockConfigEntry(domain=DOMAIN, unique_id="34OL", title="Dose 34OL", data={"cc": "34OL", "tc": None, "size": None, "source": "generated"})
    container.add_to_hass(hass)
    assert await hass.config_entries.async_setup(container.entry_id)
    await hass.async_block_till_done()
    mains = [e for e in hass.config_entries.async_entries(DOMAIN) if e.unique_id == "larder_main"]
    assert len(mains) == 1 and mains[0].title == "Larder"
    # only once, also after a reload
    assert await hass.config_entries.async_reload(container.entry_id)
    await hass.async_block_till_done()
    assert len([e for e in hass.config_entries.async_entries(DOMAIN) if e.unique_id == "larder_main"]) == 1
