"""Gemeinsame Test-Einstellungen."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def no_recall_polling():
    """Kein zeitgesteuerter Abruf der Rückrufwarnungen in Tests (kein Netz); Tests rufen async_refresh selbst."""
    with patch("custom_components.larder.recall.Recalls.async_start"):
        yield
