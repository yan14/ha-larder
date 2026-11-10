"""Übersetzungen: Deutsch und Englisch müssen vollständig und strukturgleich sein."""

import json
from pathlib import Path
import re

import pytest

BASE = Path(__file__).parent.parent / "custom_components" / "zwilling_storage"
TRANSLATIONS = BASE / "translations"


def _load(lang: str) -> dict:
    return json.loads((TRANSLATIONS / f"{lang}.json").read_text(encoding="utf-8"))


def _paths(node, prefix=()):
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _paths(value, prefix + (key,))
    else:
        yield prefix, node


def test_de_and_en_have_identical_keys() -> None:
    de = dict(_paths(_load("de")))
    en = dict(_paths(_load("en")))
    assert set(de) == set(en)
    assert all(isinstance(v, str) and v.strip() for v in de.values())
    assert all(isinstance(v, str) and v.strip() for v in en.values())


def test_placeholders_match_between_languages() -> None:
    de = dict(_paths(_load("de")))
    en = dict(_paths(_load("en")))
    for path in de:
        assert set(re.findall(r"\{(\w+)\}", de[path])) == set(
            re.findall(r"\{(\w+)\}", en[path])
        ), path


def test_english_is_really_english() -> None:
    en = dict(_paths(_load("en")))
    # typische deutsche Wörter dürfen in der englischen Datei nicht auftauchen
    german = re.compile(r"\b(Dose|Inhalt|Befüllt|leeren|Behälter|einlesen|erstellen|Namen|oder|und|ist|nicht)\b")
    for path, text in en.items():
        assert not german.search(text), (path, text)


@pytest.mark.parametrize("lang", ["de", "en"])
def test_every_entity_key_has_name_and_icon(lang: str) -> None:
    keys = set()
    for module in ("button", "date", "datetime", "image", "text"):
        src = (BASE / f"{module}.py").read_text(encoding="utf-8")
        found = re.findall(r'_key = "(\w+)"', src)
        assert len(found) == 1, module
        keys.add((module, found[0]))
    trans = _load(lang)["entity"]
    icons = json.loads((BASE / "icons.json").read_text(encoding="utf-8"))["entity"]
    for module, key in keys:
        assert trans[module][key]["name"].strip(), (module, key)
        assert icons[module][key]["default"].startswith("mdi:"), (module, key)
