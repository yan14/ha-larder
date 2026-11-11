"""Jede Version in manifest.json braucht einen Abschnitt in CHANGELOG.md (Text der GitHub-Releases)."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_changelog_has_a_section_for_the_current_version() -> None:
    version = json.loads((ROOT / "custom_components/larder/manifest.json").read_text())["version"]
    text = (ROOT / "CHANGELOG.md").read_text()
    match = re.search(rf"^## {re.escape(version)}\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    assert match, f"CHANGELOG.md has no section '## {version}'"
    assert match.group(1).strip().startswith("- "), "the section needs at least one bullet point"
