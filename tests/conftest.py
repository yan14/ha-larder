"""Shared test settings."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def no_recall_polling():
    """No scheduled fetching of recalls in tests (no network); tests call async_refresh themselves."""
    with patch("custom_components.larder.recall.Recalls.async_start"):
        yield
