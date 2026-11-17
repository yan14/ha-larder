"""Shared test settings."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def no_recall_polling():
    """No scheduled fetching of recalls in tests (no network); tests call async_refresh themselves."""
    with patch("custom_components.larder.recall.Recalls.async_start"):
        yield


@pytest.fixture(autouse=True)
def main_entry(request):
    """The main entry "Larder" (4.7) exists, as in every installation; tests marked `no_main` start without it."""
    if request.node.get_closest_marker("no_main") or "hass" not in request.fixturenames:
        yield None
        return
    from pytest_homeassistant_custom_component.common import MockConfigEntry  # noqa: PLC0415

    hass = request.getfixturevalue("hass")
    entry = MockConfigEntry(domain="larder", unique_id="larder_main", title="Larder", data={"source": "main"})
    entry.add_to_hass(hass)
    yield entry
