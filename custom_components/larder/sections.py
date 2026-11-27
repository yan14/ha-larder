"""Store sections (4.7): the shopping list in the order you walk through the store.

Every product has a section (fruit & vegetables, bakery, fridge …). Larder suggests it from the kind and the
category of the product and remembers a section chosen on the card by product name. When Larder writes an item
onto a to-do list that can move items (e.g. the shopping list, Local To-do), the item is moved behind the last open
item of the same or an earlier section; the order of the sections is a setting, because stores differ.
Lists that cannot move items stay as they are.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant

from .const import DATA_STOCK, DOMAIN, KIND_HOUSEHOLD, KIND_MEDICINE

_LOGGER = logging.getLogger(__name__)

# default order of a typical German supermarket
SECTIONS: tuple[str, ...] = (
    "produce", "bakery", "meat", "fridge", "dry", "pasta", "canned", "baking", "spices", "international",
    "breakfast", "sweets", "drinks", "frozen", "drugstore", "pharmacy", "other",
)
# 6.9 (#238): own sections "own_<slug>" – their names are kept in the stock
OWN_PREFIX = "own_"
_OWN_RE = re.compile(r"^own_[a-z0-9_]{1,40}$")

_BY_CATEGORY = {
    "produce": "produce",
    "bread": "bakery",
    "raw_meat": "meat",
    "fish": "meat",
    "deli": "meat",
    "plant": "fridge",
    "condiment": "dry",
    "dairy": "fridge",
    "egg": "fridge",
    "dish": "fridge",
    "dry": "dry",
    "sweet": "sweets",
    "coffee": "breakfast",
}

# 6.9 (#237): rows of the shelf-life table that have a section of their own
_BY_ROW = {
    "pasta": "pasta", "soup_pasta": "pasta", "rice_raw": "pasta", "brown_rice": "pasta", "rice": "pasta",
    "flour": "baking", "nuts": "baking", "dried_fruit": "baking",
    "cereal": "breakfast", "nut_butter": "breakfast", "jam": "breakfast", "tea": "breakfast",
    "stable": "canned", "canned_fish": "canned",
    "curry_powder": "spices",
    "soy_sauce": "international", "hoisin": "international", "curry_paste": "international",
}

# keywords that beat the row and the category (German and English); first match wins.
# A keyword matches at the start of a word ("bier" in "Bier", not "beer" in "Preiselbeeren"); "~" matches anywhere
# (for the end of compounds: "~saft" in "Orangensaft").
_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("frozen", ("tiefkühl", "tk-", "tk ", "gefroren", "eiscreme", "speiseeis", "pommes", "fischstäbchen", "frozen", "ice cream")),
    ("drinks", ("wasser ", "~mineralwasser", "~sprudel", "~saft", "schorle", "~schorle", "limo", "cola", "bier", "~bier ", "wein ",
                "~rotwein", "~weißwein", "sekt", "getränk", "eistee", "~weizen ", "radler", "water", "juice", "lemonade", "soda", "beer", "wine", "drink")),
    ("breakfast", ("~tee ", "tee ", "kaffee", "~kaffee", "müsli", "~müsli", "cornflakes", "tea ", "coffee")),
    # Asia, Eastern Europe, Turkey, Middle East …
    ("international", ("asia", "sojasauce", "sojasoße", "kokosmilch", "reisnudel", "mie-nudel", "mienudel", "glasnudel", "ramen", "sushi",
                       "wasabi", "kimchi", "nori", "miso", "teriyaki", "sriracha", "pelmeni", "pierogi", "piroggen", "wareniki",
                       "smetana", "tworog", "kwas", "ajvar", "sucuk", "bulgur", "tahin", "harissa",
                       "coconut milk", "rice noodle", "soy sauce")),
    ("spices", ("gewürz", "~gewürz", "salz ", "meersalz", "pfeffer ", "paprikapulver", "paprika edelsüß", "zimt", "muskat", "kurkuma",
                "kreuzkümmel", "kümmel", "oregano", "majoran", "chiliflocken", "currypulver", "lorbeer", "~brühe", "bouillon",
                "spice", "salt ")),
    ("baking", ("mehl", "~mehl ", "zucker ", "puderzucker", "vanillezucker", "rohrzucker", "backpulver", "hefe ", "trockenhefe",
                "natron", "speisestärke", "backkakao", "kuvertüre", "streusel", "tortenguss", "puddingpulver", "flour", "sugar ",
                "baking")),
    ("canned", ("konserve", "~konserve", "dosen", "gehackte tomaten", "passierte tomaten", "kidneybohnen", "mais ", "in der dose",
                "canned", "tinned")),
    ("sweets", ("süßigkeit", "bonbon", "gummibär", "fruchtgummi", "lakritz", "salzstangen", "popcorn", "müsliriegel",
                "schokoriegel", "praline", "candy", "sweets")),
)
_LETTER = "a-zäöüßàâçéèêëîïôûùüÿñæœ"


def _matches(text: str, word: str) -> bool:
    if word.startswith("~"):
        return word[1:] in text
    return re.search(rf"(?<![{_LETTER}]){re.escape(word)}", text) is not None


def _norm(text: str | None) -> str:
    return f" {' '.join((text or '').casefold().split())} "


def suggest_section(content: str | None, kind: str | None = None, category: str | None = None) -> str:
    """Section suggested for a product: by kind, keywords, then category; else "other"."""
    if kind == KIND_HOUSEHOLD:
        return "drugstore"
    if kind == KIND_MEDICINE:
        return "pharmacy"
    text = _norm(content)
    for section, words in _KEYWORDS:
        if any(_matches(text, w) for w in words):
            return section
    if content:
        from .shelf_life import find_entry  # noqa: PLC0415 - large table, loaded on use

        row = find_entry(content)
        if row is not None and row.id in _BY_ROW:
            return _BY_ROW[row.id]
    if category is None and content:
        from .shelf_life import category_for  # noqa: PLC0415 - large table, loaded on use

        category = category_for(content)
    return _BY_CATEGORY.get(category or "", "other")


def is_section(key: Any) -> bool:
    """A built-in section or the key of an own one (whether it still exists is checked with the stock)."""
    return isinstance(key, str) and (key in SECTIONS or bool(_OWN_RE.match(key)))


def section_key(value: Any) -> str:
    """Voluptuous validator: a built-in section or the key of an own one."""
    if not is_section(value):
        raise vol.Invalid("unknown section")
    return value


def own_sections(hass: HomeAssistant) -> dict[str, str]:
    """Own sections: key → name (6.9, #238)."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    return dict(getattr(stock, "own_sections", None) or {})


def all_sections(hass: HomeAssistant) -> list[str]:
    return [*SECTIONS, *own_sections(hass)]


# 6.9 (#237): sections added in 6.9 – in an order saved before, they go behind their old neighbour
NEW_IN_69 = frozenset(("pasta", "canned", "baking", "spices", "international", "sweets"))


def merge_order(chosen: list[str], known: list[str]) -> list[str]:
    """Chosen order first. New sections (6.9 and own ones) go right behind the one they follow by default,
    any other missing section is appended."""
    out = [s for s in dict.fromkeys(chosen) if s in known]
    rest = []
    for index, key in enumerate(known):
        if key in out:
            continue
        if key in NEW_IN_69 or key.startswith(OWN_PREFIX):
            # behind its old neighbour (or a new one placed there already) – only if that neighbour was chosen
            before = None
            for k in reversed(known[:index]):
                if k in out:
                    before = k
                    break
                if k not in NEW_IN_69 and not k.startswith(OWN_PREFIX):
                    break
            if before is not None:
                out.insert(out.index(before) + 1, key)
                continue
        rest.append(key)
    return [*out, *rest]


def section_order(hass: HomeAssistant) -> list[str]:
    """Order of the sections from the settings; unknown ones dropped, missing ones appended."""
    estimator = hass.data.get(DOMAIN, {}).get("estimator")
    known = all_sections(hass)
    # own sections that were never put in order go before "other"
    defaults = [*(k for k in known if k != "other"), "other"]
    return merge_order(list(getattr(estimator, "section_order", None) or []), defaults)


def normalize_order(value: Any, default: list[str]) -> list[str]:
    """Setting "order of the sections" (list of keys)."""
    if not isinstance(value, list | tuple):
        return list(default)
    # own sections are kept (they are checked against the stock when the order is read)
    return [*dict.fromkeys(str(v) for v in value if is_section(str(v)))]


def _base(item: str) -> str:
    return " ".join(item.split(" (", 1)[0].split()).casefold()


def section_of(hass: HomeAssistant, content: str | None, kind: str | None = None) -> str:
    """Section of a product: chosen on the card, else suggested (kind known from the stock if not given)."""
    stock = hass.data.get(DOMAIN, {}).get(DATA_STOCK)
    key = _base(content or "")
    own = (getattr(stock, "sections", None) or {}).get(key)
    if own in SECTIONS or own in (getattr(stock, "own_sections", None) or {}):
        return own
    if kind is None:
        known = (getattr(stock, "minimums", None) or {}).get(key) or {}
        kind = (known.get("product") or {}).get("kind")
    return suggest_section(content, kind)
