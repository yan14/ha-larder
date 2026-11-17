"""Every version in manifest.json needs a section in CHANGELOG.md (text of the GitHub releases)."""

import json
from pathlib import Path
import re

ROOT = Path(__file__).parents[1]


def test_changelog_has_a_section_for_the_current_version() -> None:
    version = json.loads((ROOT / "custom_components/larder/manifest.json").read_text())["version"]
    text = (ROOT / "CHANGELOG.md").read_text()
    match = re.search(rf"^## {re.escape(version)}\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    assert match, f"CHANGELOG.md has no section '## {version}'"
    assert any(line.startswith("- ") for line in match.group(1).splitlines()), "the section needs at least one bullet point"
