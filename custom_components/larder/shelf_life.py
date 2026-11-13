"""Eingebaute Haltbarkeits-Tabelle für gängige Lebensmittel (ohne KI, ohne Internet).

Die Werte sind bewusst **vorsichtig** gewählt und orientieren sich an den üblichen
Lagerempfehlungen (u. a. USDA Cold Food Storage Chart, FoodKeeper, Verbraucherzentralen).
Es sind Richtwerte für zu Hause, keine Garantie für Lebensmittelsicherheit.

Aufbau: Jeder Eintrag kennt vier Lagerorte (Kühlschrank, 0-Grad-Fach, Gefrierschrank,
Vorrat/Raumtemperatur) und gibt die Tage an, die das Lebensmittel dort gut bleibt.
`None` bedeutet: dort nicht lagern. Der Lagerort wird aus dem Bereich der Dose abgeleitet
(Temperatursensor, Temperatur im Namen/Label, sonst Stichwörter im Namen).
"""

from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

FRIDGE = "fridge"
ZERO = "zero"
FREEZER = "freezer"
PANTRY = "pantry"

STORAGE_LABELS = {
    "de": {FRIDGE: "Kühlschrank", ZERO: "0-Grad-Fach", FREEZER: "Gefrierschrank", PANTRY: "Vorrat"},
    "en": {FRIDGE: "fridge", ZERO: "0 °C compartment", FREEZER: "freezer", PANTRY: "pantry"},
}

# Wie stark Vakuum die Haltbarkeit verlängert. Leicht verderbliche Speisen im Kühlschrank
# bleiben bewusst bei Faktor 1: Vakuum macht sie nicht sicherer.
VACUUM_FACTOR = {FRIDGE: 1.3, ZERO: 1.3, FREEZER: 1.5, PANTRY: 1.5}


def norm(text: str) -> str:
    """Klein, ohne Umlaute/Akzente (ä→ae, ß→ss), nur Buchstaben, Ziffern und Leerzeichen."""
    text = text.casefold()
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(src, dst)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return text.strip()


@dataclass(frozen=True)
class Entry:
    id: str
    de: str
    en: str
    cat: str
    keywords: tuple[str, ...]
    days: dict[str, int | None]
    priority: int = 1
    perishable: bool = False  # Vakuum verlängert die Kühlhaltbarkeit nicht


def _kw(raw: str) -> str:
    """Stichwort normalisieren; "~" (schwach) und "+" (alle Teile, beliebige Reihenfolge) bleiben erhalten."""
    weak = raw.startswith("~")
    parts = [norm(p) for p in raw.lstrip("~").split("+")]
    return ("~" if weak else "") + "+".join(p for p in parts if p)


def _e(id_, de, en, cat, kw, fridge, zero, freezer, pantry, *, pri=1, perishable=False) -> Entry:
    return Entry(
        id_, de, en, cat,
        tuple(_kw(k) for k in kw.split("|")),
        {FRIDGE: fridge, ZERO: zero, FREEZER: freezer, PANTRY: pantry},
        pri, perishable,
    )


# Kurze Lagerhinweise je Kategorie: (de, en)
TIPS: dict[str, tuple[str, str]] = {
    "dish": (
        "Schnell abkühlen lassen, gut verschlossen lagern und vor dem Essen gut durcherhitzen (mind. 70 °C).",
        "Cool quickly, keep tightly closed and reheat thoroughly (at least 70 °C / 158 °F) before eating.",
    ),
    "raw_meat": (
        "Getrennt von anderen Lebensmitteln lagern und möglichst bald zubereiten.",
        "Store separately from other food and cook it soon.",
    ),
    "fish": (
        "Sehr leicht verderblich: gut kühlen und rasch verbrauchen.",
        "Highly perishable: keep cold and use it up quickly.",
    ),
    "deli": (
        "Nach dem Öffnen gut verschlossen im Kühlschrank lagern.",
        "Once opened, keep tightly closed in the fridge.",
    ),
    "dairy": (
        "Nach dem Öffnen gut verschlossen kühlen. Beim Auftauen kann sich die Konsistenz verändern.",
        "Keep tightly closed and cold once opened. Texture may change after thawing.",
    ),
    "egg": (
        "Eier im Kühlschrank lagern. Rohe Eier nicht in der Schale einfrieren.",
        "Keep eggs refrigerated. Do not freeze raw eggs in the shell.",
    ),
    "produce": (
        "Trocken und luftig lagern, Beschädigtes aussortieren.",
        "Store dry and airy, discard damaged pieces.",
    ),
    "bread": (
        "Brot lässt sich gut in Scheiben einfrieren.",
        "Bread freezes well in slices.",
    ),
    "dry": (
        "Trocken, dunkel und gut verschlossen lagern.",
        "Store dry, dark and tightly closed.",
    ),
    "coffee": (
        "Dunkel und luftdicht lagern. Bei Kaffeebohnen zählt das Röstdatum mehr als das Befüll-Datum.",
        "Store dark and airtight. For coffee beans the roast date matters more than the filling date.",
    ),
    "sweet": (
        "Kühl und trocken lagern.",
        "Store cool and dry.",
    ),
}

# Reihenfolge ist egal: Treffer mit höherer Priorität, dann am Wortende (Grundwort eines
# zusammengesetzten Worts: "Butter|kekse"), dann mit dem längsten Stichwort, gewinnen.
# Stichwörter: "a+b" heißt beide Teile kommen vor (beliebige Reihenfolge, "Eier gekocht"),
# "~a" ist ein schwaches Stichwort, das nur zählt, wenn sonst nichts passt ("filet").
# TABLE_VERSION erhöhen, wenn sich Einträge oder die Erkennung ändern: gemerkte Tabellenwerte
# werden dann neu berechnet (eigene Korrekturen bleiben).
TABLE_VERSION = 3  # 3: mehrere Inhalte (Komma) werden einzeln geschätzt
ENTRIES: tuple[Entry, ...] = (
    # --- Gerichte und Reste (Priorität 3) ---
    _e("dish", "Gericht / Reste", "Dish / leftovers", "dish",
       "reste|leftover|gekocht|cooked|auflauf|lasagne|gratin|gericht|meal prep|pfanne|bratkartoffel|eintopf|quiche|pizza|dal|chili|curry|bolognese|gulasch|goulash|ragout|frikadelle|bulette|knoedel|gemuesepfanne|milchreis|griessbrei|pudding|pueree|kartoffelbrei|pfannkuchen|crepe|kaiserschmarrn|risotto|paella|gebraten|fried rice|bratreis",
       3, 4, 90, None, pri=3, perishable=True),
    _e("soup", "Suppe / Brühe / Soße", "Soup / broth / sauce", "dish",
       "suppe|bruehe|soup|broth|sosse|sauce|stew|tomatensosse|bechamel|dressing",
       3, 4, 90, None, pri=3, perishable=True),
    _e("salad_dish", "Fertiger Salat", "Prepared salad", "dish",
       "nudelsalat|kartoffelsalat|fleischsalat|wurstsalat|thunfischsalat|eiersalat|krautsalat|pasta salad|potato salad|coleslaw",
       3, 4, None, None, pri=3, perishable=True),
    _e("sandwich", "Belegtes Brot", "Sandwich", "dish",
       "butterbrot|sandwich|belegtes broetchen|wrap|stulle",
       1, 2, 30, None, pri=3, perishable=True),
    _e("smoked_fish", "Räucherfisch", "Smoked fish", "fish",
       "raeucherlachs|geraeucherter|smoked salmon|smoked fish|matjes|bismarckhering",
       3, 4, 60, None, pri=3, perishable=True),
    _e("dough", "Teig", "Dough", "dish",
       "teig|dough|pizzateig|hefeteig",
       3, 5, 90, None, pri=3),
    _e("pesto_dip", "Pesto / Dip / Aufstrich", "Pesto / dip / spread", "dish",
       "pesto|hummus|guacamole|tzatziki|dip|aufstrich",
       5, 7, 60, None, pri=3, perishable=True),
    _e("soy_sauce", "Sojasoße", "Soy sauce", "sweet",
       "sojasosse|soy sauce|sojasauce|worcester|sriracha|ketchup|senf|mustard",
       180, 180, None, 90, pri=3),
    _e("curry_powder", "Gewürze", "Spices", "dry",
       "currypulver|curry powder|gewuerz|spice|paprikapulver|pfeffer|zimt|oregano|thymian trocken",
       365, 365, 365, 365, pri=3),
    # --- Fleisch, Fisch, Wurst (Priorität 2) ---
    _e("ground_meat", "Hackfleisch", "Ground meat", "raw_meat",
       "hackfleisch|gehacktes|mett|ground beef|ground meat|ground pork|mince|hack|rinderhack|schweinehack|gemischtes hack|hackbaellchen",
       1, 2, 90, None, pri=2, perishable=True),
    _e("poultry", "Geflügel (roh)", "Poultry (raw)", "raw_meat",
       "haehnchen|huehnchen|huhn|pute|truthahn|gefluegel|chicken|turkey|poultry|ente|gans",
       1, 2, 180, None, pri=2, perishable=True),
    _e("meat", "Fleisch (roh)", "Meat (raw)", "raw_meat",
       "fleisch|steak|schnitzel|rind|schwein|lamm|kotelett|braten|beef|pork|lamb|~filet|roulade|gulaschfleisch|geschnetzeltes",
       2, 4, 180, None, pri=2, perishable=True),
    _e("fish", "Fisch / Meeresfrüchte (roh)", "Fish / seafood (raw)", "fish",
       "fisch|lachs|forelle|thunfisch|garnele|shrimp|salmon|fish|cod|kabeljau|meeresfruechte|seafood|scholle|zander|lachsfilet|fischfilet|seelachs|dorsch|tilapia|pangasius|hering|makrele|tuna|prawn|calamari|tintenfisch|muschel",
       1, 2, 90, None, pri=2, perishable=True),
    _e("deli", "Wurst / Aufschnitt / Schinken", "Cold cuts / sausage / ham", "deli",
       "wurst|aufschnitt|schinken|salami|speck|bacon|ham |sausage|cold cuts|fleischwurst|leberwurst|bratwurst|wiener",
       4, 6, 60, None, pri=2, perishable=True),
    _e("hard_cheese", "Hartkäse", "Hard cheese", "dairy",
       "hartkaese|parmesan|parmigiano|gouda|edamer|emmentaler|cheddar|bergkaese|pecorino|hard cheese|gruyere|manchego",
       28, 42, 180, None, pri=2),
    _e("soft_cheese", "Käse / Frischkäse / Weichkäse", "Cheese / cream cheese / soft cheese", "dairy",
       "kaese|frischkaese|mozzarella|camembert|brie|feta|ricotta|huettenkaese|cottage|cream cheese|cheese|halloumi|schafskaese|mascarpone",
       7, 10, 90, None, pri=2, perishable=True),
    _e("yogurt", "Joghurt / Quark / Skyr", "Yogurt / quark / skyr", "dairy",
       "joghurt|yoghurt|yogurt|quark|skyr|kefir|schmand|sauerrahm|sour cream",
       5, 7, 60, None, pri=2, perishable=True),
    _e("milk", "Milch", "Milk", "dairy",
       "milch|milk|buttermilch|hafermilch|haferdrink|sojadrink|mandelmilch|pflanzendrink|oat drink|kokosmilch",
       4, 6, 90, None, pri=2, perishable=True),
    _e("cream", "Sahne", "Cream", "dairy",
       "sahne|schlagsahne|cream|creme fraiche|schlagobers",
       4, 6, 60, None, pri=2, perishable=True),
    _e("butter", "Butter / Margarine", "Butter / margarine", "dairy",
       "butter|margarine",
       30, 45, 180, 2, pri=2),
    _e("egg_boiled", "Eier (gekocht)", "Eggs (boiled)", "egg",
       "gekochte eier|hartgekochte|hard boiled|boiled egg|fruehstuecksei|gekochtes ei|eier+gekocht|ei+gekocht|eier+hart|ei+hart|egg+boiled|eggs+boiled|soleier|ostereier|eier+gefaerbt",
       7, 10, None, None, pri=3, perishable=True),
    _e("egg_cooked", "Rührei / Omelett", "Scrambled eggs / omelette", "egg",
       "ruehrei|spiegelei|omelett|omelette|scrambled|fried egg|eier+gebraten|frittata",
       3, 4, None, None, pri=3, perishable=True),
    _e("egg_separated", "Eigelb / Eiweiß (roh)", "Egg yolk / white (raw)", "egg",
       "eigelb|eiweiss|egg white|egg yolk",
       3, 4, 180, None, pri=3, perishable=True),
    _e("egg", "Eier (roh, in der Schale)", "Eggs (raw, in shell)", "egg",
       "eier|egg|eggs",
       21, 28, None, 7, pri=2),
    _e("tofu", "Tofu / Tempeh", "Tofu / tempeh", "deli",
       "tofu|tempeh|seitan",
       5, 7, 90, None, pri=2, perishable=True),
    _e("juice", "Saft / Smoothie", "Juice / smoothie", "dairy",
       "saft|juice|smoothie",
       4, 6, 90, None, pri=2, perishable=True),
    # --- Obst, Gemüse (Priorität 1-2) ---
    _e("leafy", "Salat / Blattgemüse", "Salad greens", "produce",
       "salat|kopfsalat|rucola|spinat|blattspinat|feldsalat|lettuce|spinach|arugula|mangold|pak choi",
       5, 7, None, None, pri=1),
    _e("root", "Kartoffeln / Zwiebeln / Knoblauch", "Potatoes / onions / garlic", "produce",
       "kartoffel|zwiebel|knoblauch|potato|onion|garlic|suesskartoffel|kuerbis|pumpkin|ingwer",
       21, 28, None, 21, pri=2),
    _e("mushroom", "Pilze", "Mushrooms", "produce",
       "pilz|champignon|mushroom|steinpilz|pfifferling",
       4, 6, 60, 1, pri=2),
    _e("herbs", "Kräuter", "Fresh herbs", "produce",
       "kraeuter|basilikum|petersilie|schnittlauch|koriander|herbs|basil|parsley|dill|minze",
       5, 7, 90, 1, pri=2),
    _e("berries", "Beeren", "Berries", "produce",
       "beere|erdbeere|himbeere|heidelbeere|blaubeere|berries|strawberr|raspberr|blueberr|kirsche|cherry",
       3, 5, 180, 1, pri=2),
    _e("apple", "Äpfel / Birnen", "Apples / pears", "produce",
       "apfel|aepfel|birne|apple|pear",
       28, 42, 180, 7, pri=2),
    _e("citrus", "Zitrusfrüchte", "Citrus fruit", "produce",
       "zitrone|orange|mandarine|clementine|lemon|lime|citrus|grapefruit|limette",
       21, 28, 90, 7, pri=2),
    _e("fruit", "Obst", "Fruit", "produce",
       "obst|banane|traube|melone|pfirsich|fruit|ananas|mango|kiwi|pflaume|nektarine",
       5, 7, 120, 3, pri=1),
    _e("vegetables", "Gemüse (frisch)", "Vegetables (fresh)", "produce",
       "gemuese|tomate|gurke|paprika|zucchini|karotte|moehre|brokkoli|blumenkohl|kohl|lauch|sellerie|spargel|aubergine|radieschen|vegetable|carrot|broccoli|cucumber|pepper|erbse|bohne|edamame|mais|rosenkohl|gruenkohl|rotkohl|wirsing|kohlrabi|fenchel|pastinake|rote bete|peas|beans|corn|sweetcorn",
       7, 12, 90, 3, pri=1),
    # --- Backwaren, Süßes ---
    _e("bread", "Brot / Brötchen", "Bread / rolls", "bread",
       "brot|broetchen|semmel|toast|bread|brioche|baguette|croissant",
       7, 7, 90, 4, pri=2),
    _e("cake", "Kuchen / Torte", "Cake / pastry", "bread",
       "kuchen|torte|gebaeck|muffin|cake|pastry|brownie|kaesekuchen",
       4, 5, 90, 3, pri=2),
    _e("cookies", "Kekse / Cracker", "Cookies / crackers", "sweet",
       "keks|plaetzchen|cookie|cracker|kracker|waffel|biscuit|zwieback|butterkeks|lebkuchen|spekulatius",
       30, 30, 180, 30, pri=2),
    _e("chips", "Chips / Snacks", "Chips / snacks", "sweet",
       "chips|salzstange|snack|popcorn|erdnussflips|brezel",
       14, 14, 60, 14, pri=2),
    _e("chocolate", "Schokolade / Süßigkeiten", "Chocolate / sweets", "sweet",
       "schokolade|chocolate|suessigkeit|bonbon|praline|gummibaer|candy|riegel",
       180, 180, 365, 180, pri=2),
    _e("jam", "Marmelade / Konfitüre (geöffnet)", "Jam (opened)", "sweet",
       "marmelade|konfituere|jam|gelee|nutella|nussnougat",
       60, 90, 180, 30, pri=2),
    _e("stable", "Honig / Zucker / Salz / Essig", "Honey / sugar / salt / vinegar", "dry",
       "honig|honey|sirup|syrup|ahornsirup|essig|vinegar|zucker|sugar|salz|salt",
       730, 730, 730, 730, pri=2),
    # --- Trockenware und Vorrat ---
    _e("pasta", "Nudeln (trocken) / gekocht", "Pasta (dry) / cooked", "dry",
       "nudel|pasta|spaghetti|penne|fusilli|makkaroni|macaroni|tagliatelle|spaetzle|farfalle|rigatoni|tortellini",
       3, 4, 90, 365, pri=1),
    _e("brown_rice", "Vollkornreis (trocken) / gekocht", "Brown rice (dry) / cooked", "dry",
       "vollkornreis|brown rice|naturreis",
       2, 3, 30, 180, pri=2),
    _e("rice", "Reis & Getreide (trocken) / gekocht", "Rice & grains (dry) / cooked", "dry",
       "reis|rice|couscous|bulgur|quinoa|hirse|polenta|griess|risotto|basmati|jasmin",
       2, 3, 30, 365, pri=1),
    _e("flour", "Mehl / Stärke / Backzutaten", "Flour / starch / baking", "dry",
       "mehl|flour|staerke|backpulver|speisestaerke|paniermehl|semolina|dinkelmehl|weizenmehl|roggenmehl|vollkornmehl|type 405|type 550|typ 405|typ 550|typ 630|typ 1050",
       180, 180, 365, 180, pri=1),
    _e("cereal", "Haferflocken / Müsli / Cornflakes", "Oats / muesli / cereal", "dry",
       "haferflocken|muesli|cornflakes|cereal|oats|granola|porridge",
       120, 120, 180, 90, pri=1),
    _e("legumes", "Linsen / Kichererbsen / Hülsenfrüchte (trocken)", "Lentils / chickpeas / dried beans", "dry",
       "linsen|kichererbsen|lentil|chickpea|trockenerbsen|dried beans|getrocknete bohnen",
       365, 365, 365, 365, pri=1),
    _e("nuts", "Nüsse / Samen", "Nuts / seeds", "dry",
       "nuss|nuesse|mandel|walnuss|cashew|erdnuss|haselnuss|pistazie|nuts|almond|sonnenblumenkern|kuerbiskern|samen|seeds|chia|leinsamen",
       180, 180, 365, 90, pri=1),
    _e("dried_fruit", "Trockenobst", "Dried fruit", "dry",
       "trockenobst|rosine|dattel|dried fruit|raisin|feige getrocknet|cranberries getrocknet",
       240, 240, 365, 180, pri=2),
    _e("tea", "Tee", "Tea", "dry",
       "tee|tea|kraeutertee|gruentee|schwarztee",
       365, 365, 365, 365, pri=1),
    _e("coffee_ground", "Kaffee (gemahlen)", "Coffee (ground)", "coffee",
       "kaffeepulver|gemahlen|ground coffee|filterkaffee|espressopulver",
       14, 14, 90, 14, pri=3),
    _e("coffee", "Kaffeebohnen", "Coffee beans", "coffee",
       "kaffeebohne|kaffee|coffee|espresso|coffee beans",
       14, 14, 120, 30, pri=2),
    _e("oil", "Öl", "Cooking oil", "dry",
       "olivenoel|rapsoel|sonnenblumenoel|speiseoel|kokosoel|oil",
       180, 180, None, 180, pri=1),
)

_KEYWORD_RES: dict[str, tuple[re.Pattern[str], re.Pattern[str]]] = {}
_PLURAL = r"(?:e|en|n|s|es|er|ern)?"


def _part_match(part: str, text: str) -> tuple[bool, bool]:
    """(passt, am Wortende). Kurze Teile nur am Wortanfang oder als Grundwort am Wortende
    (reis ≠ kreis, aber Milch|reis), lange auch in der Wortmitte (Tomaten|suppe)."""
    if (patterns := _KEYWORD_RES.get(part)) is None:
        word_start = re.compile(rf"(?<![a-z0-9]){re.escape(part)}")
        # Grundwort: allein oder nach mindestens drei Buchstaben (Milch|reis, aber nicht K|reis)
        word_end = re.compile(rf"(?:(?<![a-z0-9])|(?<=[a-z]{{3}})){re.escape(part)}{_PLURAL}(?![a-z0-9])")
        patterns = _KEYWORD_RES[part] = (word_start, word_end)
    word_start, word_end = patterns
    if len(part) <= 2:
        # "ei" nur als eigenes Wort (sonst steckt es in "Reis", "Brei" …)
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(part)}(?![a-z0-9])", text)), True
    at_end = len(part) >= 4 and bool(word_end.search(text))
    if at_end:
        return True, True
    if len(part) >= 5:
        return part in text, False
    return bool(word_start.search(text)), False


def _keyword_score(keyword: str, text: str) -> tuple[bool, bool, int] | None:
    """(schwach, am Wortende, Länge) des Treffers, oder None."""
    weak = keyword.startswith("~")
    parts = keyword.lstrip("~").split("+")
    at_end = False
    for part in parts:
        ok, end = _part_match(part, text)
        if not ok:
            return None
        at_end = at_end or end
    return weak, at_end, sum(len(p) for p in parts)


def _keyword_matches(keyword: str, text: str) -> bool:
    return _keyword_score(keyword, f" {norm(text)} " if text.strip() == text else text) is not None


MIXED = "mixed"  # Kategorie für Dosen mit Inhalten verschiedener Art


def split_items(content: str) -> list[str]:
    """Mehrere Inhalte einer Dose: "Salami, Kochschinken; Leberwurst" → drei Einträge (sonst einer)."""
    # Komma trennt, außer zwischen Ziffern ("1,5 kg Reis")
    parts = [p.strip() for p in re.split(r";|,(?!\d)|(?<!\d),", content or "")]
    parts = [p for p in parts if p]
    return parts


def category_for(content: str) -> str | None:
    """Kategorie der Dose; bei Inhalten verschiedener Art "mixed"."""
    cats = {e.cat for e in (find_entry(p) for p in split_items(content)) if e is not None}
    if not cats:
        return None
    return cats.pop() if len(cats) == 1 else MIXED


def find_entry(content: str) -> Entry | None:
    """Besten Tabelleneintrag zum Inhalt finden: kein schwaches Stichwort, höhere Priorität,
    Grundwort am Wortende, dann längstes Stichwort."""
    text = f" {norm(content)} "
    best: tuple[int, int, int, int] | None = None
    best_entry: Entry | None = None
    for entry in ENTRIES:
        for keyword in entry.keywords:
            if not keyword:
                continue
            found = _keyword_score(keyword, text)
            if found is None:
                continue
            weak, at_end, length = found
            score = (0 if weak else 1, entry.priority, 1 if at_end else 0, length)
            if best is None or score > best:
                best, best_entry = score, entry
    return best_entry


# ---------- Lagerort aus dem Bereich ableiten ----------


@dataclass(frozen=True)
class Storage:
    key: str
    factor: float = 1.0  # < 1: z. B. Gefrierfach, nicht ganz so kalt wie ein Gefrierschrank


_TEMP_RE = re.compile(r"(?<![\w.,])([-−–]?\s?\d{1,2}(?:[.,]\d+)?)\s*(?:°|grad|degrees?)", re.IGNORECASE)

_WORDS = (
    (FREEZER, 0.5, ("gefrierfach", "freezer compartment", "eisfach")),
    (FREEZER, 1.0, ("gefrier", "tiefkuehl", "tiefkuhl", "truhe", "freezer", "frozen", "frost")),
    (ZERO, 1.0, ("null grad", "zero grad", "zero degree", "frischefach", "frischhalte", "fleischfach", "fischfach", "chiller", "0 grad")),
    (FRIDGE, 1.0, ("kuehlschrank", "kuehl", "fridge", "refrigerator", "icebox", "cooler")),
    (PANTRY, 1.0, ("vorrat", "speis", "pantry", "keller", "cellar", "basement", "schrank", "cupboard", "regal", "shelf", "abstell", "lager", "trocken", "dry")),
)


def parse_temperature(text: str) -> float | None:
    """Temperatur aus Text wie 'ca. -18 °C' oder '0 Grad Fach' lesen."""
    if match := _TEMP_RE.search(text.replace("−", "-").replace("–", "-")):
        try:
            return float(match.group(1).replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


def storage_from_temperature(temp_c: float) -> Storage:
    if temp_c <= -15:
        return Storage(FREEZER)
    if temp_c <= -6:
        return Storage(FREEZER, 0.5)
    if temp_c <= 3.5:
        return Storage(ZERO)
    if temp_c <= 10:
        return Storage(FRIDGE)
    return Storage(PANTRY)


# ---------- Vorlage für die Beschreibung eines Bereichs-Labels ----------
#
#   Storage: freezer
#   Temperature: -18 °C
#   Max storage: 18 months
#   Notes: meat and fish
#
# Eine Angabe pro Zeile (oder durch ";" getrennt), Groß-/Kleinschreibung egal, alle Zeilen optional.
# Deutsche Schlüssel gehen auch (Lagerort, Temperatur, Max. Lagerzeit, Hinweis). Text ohne Schlüssel
# bleibt ein freier Hinweis wie bisher.

TEMPLATE_KEYS = {
    "storage": ("storage", "storage place", "lagerort", "lagerung"),
    "temperature": ("temperature", "temp", "temperatur"),
    "max_storage": (
        "max storage", "max. storage", "maximum storage", "max storage time", "max. storage time",
        "max lagerzeit", "max. lagerzeit", "maximale lagerzeit", "lagerzeit",
    ),
    "notes": ("notes", "note", "hinweis", "hinweise", "notizen"),
}
_KEY_LOOKUP = {alias: key for key, aliases in TEMPLATE_KEYS.items() for alias in aliases}

_DURATION_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*([a-zäöü]*)", re.IGNORECASE)
_UNITS = (
    (365, ("y", "yr", "yrs", "year", "years", "j", "jahr", "jahre", "jahren")),
    (30, ("mo", "mon", "month", "months", "monat", "monate", "monaten")),
    (7, ("w", "wk", "week", "weeks", "woche", "wochen")),
    (1, ("", "d", "day", "days", "t", "tag", "tage", "tagen")),
)


def _key_pattern() -> re.Pattern[str]:
    aliases = sorted(_KEY_LOOKUP, key=len, reverse=True)  # längste zuerst ("max storage time" vor "storage")
    words = "|".join(r"\s+".join(re.escape(w) for w in alias.split()) for alias in aliases)
    return re.compile(rf"(?:^|(?<=[\s;,]))({words})\s*:", re.IGNORECASE)


_KEY_RE = _key_pattern()


def parse_label_template(text: str | None) -> dict[str, str]:
    """`Schlüssel: Wert`-Angaben der Vorlage lesen, auch alle in einer Zeile.

    Üblich ist eine Angabe pro Zeile; ein Wert reicht aber auch nur bis zum nächsten bekannten
    Schlüssel, so dass alles in einer Zeile stehen darf (";" trennt ebenfalls). Freier Text ohne
    Schlüssel wird ignoriert.
    """
    text = text or ""
    matches = list(_KEY_RE.finditer(text))
    out: dict[str, str] = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        value = re.split(r"[\n;]", text[match.end():end], maxsplit=1)[0].strip(" ,")
        canon = _KEY_LOOKUP[re.sub(r"\s+", " ", match.group(1).casefold())]
        if value and canon not in out:
            out[canon] = value
    return out


def parse_duration(text: str | None) -> int | None:
    """'3 years', '18 Monate', '6 weeks', '90' (Tage) → Tage. None, wenn nicht lesbar."""
    match = _DURATION_RE.search(text or "")
    if not match:
        return None
    unit = match.group(2).casefold().rstrip(".")
    factor = next((f for f, names in _UNITS if unit in names), None)
    if factor is None:
        return None
    days = round(float(match.group(1).replace(",", ".")) * factor)
    return days if days >= 1 else None


def format_duration(days: int, language: str) -> str:
    """Tage lesbar: 1095 → '3 Jahre' / '3 years', 540 → '18 Monate', 42 → '6 Wochen'."""
    de = language.lower().startswith("de")
    for size, one, many in (
        (365, ("Jahr", "year"), ("Jahre", "years")),
        (30, ("Monat", "month"), ("Monate", "months")),
        (7, ("Woche", "week"), ("Wochen", "weeks")),
        (1, ("Tag", "day"), ("Tage", "days")),
    ):
        if days % size == 0:
            n = days // size
            word = (one if n == 1 else many)[0 if de else 1]
            return f"{n} {word}"
    return f"{days} {'Tage' if de else 'days'}"


def storage_from_words(text: str) -> Storage | None:
    words = norm(text)
    for key, factor, candidates in _WORDS:
        if any(norm(c) in words for c in candidates):
            return Storage(key, factor)
    return None


def classify_storage(
    area_name: str | None,
    temperature_c: float | None = None,
    label_texts: tuple[str, ...] | list[str] = (),
    storage_hint: str | None = None,
) -> Storage | None:
    """Lagerort bestimmen: Sensor, "Storage:" der Vorlage, Temperatur im Label/Namen, dann Stichwörter."""
    if temperature_c is not None:
        return storage_from_temperature(temperature_c)
    if storage_hint:
        if (temp := parse_temperature(storage_hint)) is not None:
            return storage_from_temperature(temp)
        if (storage := storage_from_words(storage_hint)) is not None:
            return storage
    for text in (*label_texts, area_name or ""):
        if (temp := parse_temperature(text)) is not None:
            return storage_from_temperature(temp)
    for text in (area_name or "", *label_texts):
        if (storage := storage_from_words(text)) is not None:
            return storage
    return None


# ---------- Ergebnis ----------


class TableNoMatch(Exception):
    """Zum Inhalt gibt es keinen Eintrag."""


class TableUnknownStorage(Exception):
    """Der Bereich lässt sich keinem Lagerort zuordnen."""


class TableUnsuitable(Exception):
    """Dieses Lebensmittel sollte an diesem Lagerort nicht gelagert werden."""

    def __init__(self, food: str, place: str) -> None:
        super().__init__(f"{food} / {place}")
        self.food = food
        self.place = place


@dataclass(frozen=True)
class TableResult:
    days: int
    tip: str
    basis: str


def lookup(
    content: str,
    *,
    area_name: str | None,
    temperature_c: float | None,
    label_texts: tuple[str, ...] | list[str],
    vacuum: bool,
    language: str,
    storage_hint: str | None = None,
) -> TableResult:
    """Haltbarkeit aus der Tabelle berechnen oder eine passende Ausnahme auslösen.

    Mehrere Inhalte (mit Komma getrennt) werden einzeln nachgeschlagen; es gilt der kürzeste Wert.
    Kennt die Tabelle einen davon nicht, gilt das als kein Treffer (sonst könnte gerade das
    Unbekannte zuerst verderben).
    """
    items = split_items(content)
    if len(items) <= 1:
        return _lookup_one(content, area_name=area_name, temperature_c=temperature_c, label_texts=label_texts,
                           vacuum=vacuum, language=language, storage_hint=storage_hint)
    results = [
        (item, _lookup_one(item, area_name=area_name, temperature_c=temperature_c, label_texts=label_texts,
                           vacuum=vacuum, language=language, storage_hint=storage_hint))
        for item in items
    ]
    item, shortest = min(results, key=lambda r: r[1].days)
    if len({r.days for _, r in results}) == 1:
        return shortest
    lang = "de" if language.lower().startswith("de") else "en"
    note = f"„{item}“ bestimmt das MHD." if lang == "de" else f"“{item}” decides the best-before date."
    return TableResult(shortest.days, f"{note} {shortest.tip}".strip(), shortest.basis)


def _lookup_one(
    content: str,
    *,
    area_name: str | None,
    temperature_c: float | None,
    label_texts: tuple[str, ...] | list[str],
    vacuum: bool,
    language: str,
    storage_hint: str | None = None,
) -> TableResult:
    lang = "de" if language.lower().startswith("de") else "en"
    entry = find_entry(content)
    if entry is None:
        raise TableNoMatch
    storage = classify_storage(area_name, temperature_c, label_texts, storage_hint)
    if storage is None:
        raise TableUnknownStorage

    place = STORAGE_LABELS[lang][storage.key]
    food = entry.de if lang == "de" else entry.en
    base = entry.days[storage.key]
    if base is None:
        raise TableUnsuitable(food, place)

    days = base * storage.factor
    cold = storage.key in (FRIDGE, ZERO)
    vacuum_helps = vacuum and not (entry.perishable and cold)
    if vacuum_helps:
        days *= VACUUM_FACTOR[storage.key]
    days_int = max(1, round(days))

    tip_de, tip_en = TIPS[entry.cat]
    tip = tip_de if lang == "de" else tip_en
    if vacuum and entry.perishable and cold:
        tip += (
            " Vakuum verlängert die Haltbarkeit leicht verderblicher Speisen im Kühlschrank kaum."
            if lang == "de"
            else " Vacuum hardly extends the shelf life of perishable food in the fridge."
        )
    return TableResult(days_int, tip, f"{food} · {place}")
