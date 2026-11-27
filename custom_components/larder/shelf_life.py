"""Built-in shelf-life table for common foods (no AI, no internet).

The values are chosen **cautiously** on purpose: every row names its source in SOURCES
(USDA-FSIS Cold Food Storage Chart, USDA FoodKeeper, USDA-based extension charts; for a range the
lower value), rows without a confirmed source are marked as Larder's own estimate (5.6).
They are guide values for home use, no guarantee of food safety.

Structure: every entry knows four storage places (fridge, 0-degree compartment, freezer,
pantry/room temperature) and gives the days the food stays good there.
`None` means: do not store there. The storage place is derived from the container's area
(temperature sensor, temperature in the name/label, else keywords in the name).
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
    "fr": {FRIDGE: "réfrigérateur", ZERO: "compartiment 0 °C", FREEZER: "congélateur", PANTRY: "garde-manger"},
    "nl": {FRIDGE: "koelkast", ZERO: "0 °C-vak", FREEZER: "vriezer", PANTRY: "voorraadkast"},
}

# How much vacuum extends the shelf life. Perishable food in the fridge
# deliberately stays at factor 1: vacuum does not make it safer.
VACUUM_FACTOR = {FRIDGE: 1.3, ZERO: 1.3, FREEZER: 1.5, PANTRY: 1.5}


def norm(text: str) -> str:
    """Lower case, without umlauts/accents (ä→ae, ß→ss), only letters, digits and spaces."""
    text = text.casefold()
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss"), ("œ", "oe"), ("æ", "ae")):
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
    perishable: bool = False  # vacuum does not extend the shelf life in the fridge
    more: tuple[str, ...] = ()  # French and Dutch keywords (6.0): only used when no German/English keyword matches


def _kw(raw: str) -> str:
    """Normalise a keyword; "~" (weak) and "+" (all parts, any order) are kept."""
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


# Short storage tips per category: (de, en); French and Dutch in TIPS_MORE (6.0)
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
    "condiment": (
        "Nach dem Öffnen gut verschlossen lagern; Ketchup, Senf und Pasten nach dem Öffnen in den Kühlschrank.",
        "Keep tightly closed once opened; ketchup, mustard and pastes go into the fridge once opened.",
    ),
    "plant": (
        "Tofu, Tempeh und Fertiges wie Falafel oder Hummus kühlen und nach dem Öffnen rasch verbrauchen; Trockenes wie Sojaschnetzel trocken lagern.",
        "Keep tofu, tempeh and ready-made food like falafel or hummus cold and use it soon after opening; store dry products like soy chunks dry.",
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

# The order does not matter: matches with a higher priority, then at the end of a word (base word of a
# compound: "Butter|kekse"), then with the longest keyword win.
# Keywords: "a+b" means both parts occur (any order, "Eier gekocht"),
# "~a" is a weak keyword that only counts if nothing else matches ("filet").
# Increase TABLE_VERSION when entries or the detection change: remembered table values
# are then calculated anew (own corrections stay).
TABLE_VERSION = 12  # 12: words of the user's language first, Pommes (chips) as a dish, Wild (6.2); 11: plant-based with a meat word (vegan salami, veggie mince …), Oatly, Cuisine, mortadella (6.1.1); 10: French/Dutch keywords only as a fallback, Preiselbeeren as jam (6.0.1); 9: French and Dutch names, keywords and places (6.0); 8: German sources (cooked rice, eggs), game (UNL); 7: values checked against sources (SOURCES), raw sausage and bacon; 6: condiments split, values after opening (OPENED); 3: several contents (comma) estimated one by one; 4: plant-based, soup pasta, bagels; 5: condiments, game, fish
ENTRIES: tuple[Entry, ...] = (
    # --- Dishes and leftovers (priority 3) ---
    _e("dish", "Gericht / Reste", "Dish / leftovers", "dish",
       "reste|leftover|gekocht|cooked|auflauf|teriyaki|dim sum|dimsum|gyoza|dumpling|lo mai|fertiggericht|ready meal|rice bowl|frühlingsrolle|fruehlingsrolle|spring roll|lasagne|gratin|gericht|meal prep|pfanne|bratkartoffel|eintopf|quiche|pizza|dal|chili|curry|bolognese|gulasch|goulash|ragout|frikadelle|bulette|knoedel|gemuesepfanne|milchreis|griessbrei|pudding|pueree|kartoffelbrei|pfannkuchen|crepe|kaiserschmarrn|risotto|paella|gebraten|fried rice|bratreis|pommes|pommes frites|fritten|french fries",
       3, 4, 60, None, pri=3, perishable=True),
    _e("soup", "Suppe / Brühe / Soße", "Soup / broth / sauce", "dish",
       "suppe|bruehe|soup|broth|sosse|sauce|stew|tomatensosse|bechamel|dressing",
       3, 4, 60, None, pri=3, perishable=True),
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
       "pesto|guacamole|tzatziki|dip|aufstrich",
       5, 7, 60, None, pri=3, perishable=True),
    # Condiments: storage = like a bottle in the fridge or a closed one in the pantry; after opening see OPENED.
    _e("ketchup", "Ketchup / Chili- / Cocktailsoße", "Ketchup / chili / cocktail sauce", "condiment",
       "ketchup|tomatenketchup|curryketchup|cocktailsosse|cocktail sauce|chilisosse|chili sauce|sweet chili",
       180, 180, None, 365, pri=4),
    _e("mustard", "Senf", "Mustard", "condiment",
       "senf|mustard|dijon",
       365, 365, None, 365, pri=4),
    _e("mayonnaise", "Mayonnaise / Remoulade", "Mayonnaise / remoulade", "condiment",
       "mayonnaise|mayo|remoulade|aioli|salatmayonnaise",
       60, 60, None, 90, pri=4),
    _e("soy_sauce", "Sojasoße", "Soy sauce", "condiment",
       "sojasosse|soy sauce|sojasauce|shoyu|tamari",
       30, 30, None, 730, pri=4),
    _e("worcester", "Worcestershiresoße", "Worcestershire sauce", "condiment",
       "worcester|worcestershire",
       365, 365, None, 365, pri=4),
    _e("bbq_sauce", "Grill- / Barbecuesoße", "Barbecue sauce", "condiment",
       "grillsosse|bbq|barbecue|steaksosse",
       120, 120, None, 365, pri=4),
    _e("hot_sauce", "Scharfe Soße (Tabasco, Sriracha)", "Hot sauce (Tabasco, sriracha)", "condiment",
       "sriracha|tabasco|hot sauce|scharfe sosse|chilisauce scharf",
       180, 180, None, 180, pri=5),
    _e("dressing", "Salatdressing (Flasche)", "Salad dressing (bottled)", "condiment",
       "salatdressing|dressing|salatsosse|vinaigrette|salad dressing",
       30, 30, None, 300, pri=4),
    _e("horseradish", "Meerrettich", "Horseradish", "condiment",
       "meerrettich|horseradish|kren|sahnemeerrettich",
       90, 90, None, None, pri=4),
    _e("hoisin", "Hoisin- / Austernsoße", "Hoisin / oyster sauce", "condiment",
       "hoisin|austernsosse|oyster sauce|fischsosse|fish sauce",
       90, 90, None, 540, pri=4),
    _e("olives", "Oliven (Glas)", "Olives (jar)", "condiment",
       "oliven|olives|kalamata",
       14, 14, None, 365, pri=4),
    _e("pickles", "Gewürzgurken / Eingelegtes (Glas)", "Pickles (jar)", "condiment",
       "gewuerzgurke|essiggurke|cornichon|pickles|eingelegte|silberzwiebel|kapern|capers|peperoni eingelegt",
       30, 30, None, 365, pri=4),
    _e("curry_paste", "Currypaste / Würzpaste", "Curry paste", "condiment",
       "currypaste|curry paste|curry+paste|harissa|miso|sambal|tom yum|gochujang|tomatenmark",
       30, 30, 90, 365, pri=4),
    _e("curry_powder", "Gewürze", "Spices", "condiment",
       "currypulver|curry powder|gewuerz|spice|paprikapulver|pfeffer|gruener pfeffer|zimt|oregano|thymian trocken|muskat|kreuzkuemmel|kurkuma|chiliflocken|bruehwuerfel|gemuesebruehe pulver",
       365, 365, 365, 365, pri=3),
    # --- Meat, fish, sausages (priority 2) ---
    _e("ground_meat", "Hackfleisch", "Ground meat", "raw_meat",
       "hackfleisch|gehacktes|mett|ground beef|ground meat|ground pork|mince|hack|rinderhack|schweinehack|gemischtes hack|hackbaellchen",
       1, 2, 90, None, pri=2, perishable=True),
    _e("poultry", "Geflügel (roh)", "Poultry (raw)", "raw_meat",
       "haehnchen|huehnchen|huhn|pute|truthahn|gefluegel|chicken|turkey|poultry|ente|gans|nuggets",
       1, 2, 270, None, pri=2, perishable=True),
    _e("marinated_meat", "Mariniertes Fleisch / Gyros", "Marinated meat / gyros", "raw_meat",
       "pfannengyros|gyros|schaschlik|grillfleisch|marinierte|mariniertes|grillspiess",
       2, 3, 90, None, pri=4, perishable=True),
    _e("game", "Wild (roh)", "Game (raw)", "raw_meat",
       "reh|hirsch|wildschwein|damwild|gams|hasen|feldhase|kaninchen|wildfleisch|venison|rabbit|rehruecken|rehkeule|rehfilet|wildbret",
       2, 3, 180, None, pri=3, perishable=True),
    _e("meat", "Fleisch (roh)", "Meat (raw)", "raw_meat",
       "fleisch|steak|schnitzel|rind|schwein|kalb|kalbs|lamm|kotelett|braten|beef|pork|lamb|~filet|roulade|gulaschfleisch|geschnetzeltes|~unterschale|~oberschale|~keule|~schenkel|~ruecken|nacken",
       3, 5, 120, None, pri=2, perishable=True),
    _e("canned_fish", "Fischkonserve", "Canned fish", "fish",
       "heringsfilet|herings filet|filets vom hering|hering in|heringe in|sardinen|sardellen|anchovis|makrelenfilet|thunfisch in|thunfischfilet|fischkonserve|lachs in",
       3, 4, 90, 365, pri=4),
    _e("fish", "Fisch / Meeresfrüchte (roh)", "Fish / seafood (raw)", "fish",
       "fisch|lachs|forelle|thunfisch|garnele|shrimp|salmon|fish|cod|kabeljau|meeresfruechte|seafood|scholle|zander|lachsfilet|fischfilet|seelachs|dorsch|tilapia|pangasius|hering|makrele|tuna|prawn|calamari|tintenfisch|muschel|rotbarsch|barsch|dorade|wolfsbarsch|heilbutt|alaska|pollack|seehecht|hecht|karpfen|saibling|wildlachs|sardine",
       1, 2, 60, None, pri=2, perishable=True),
    _e("deli", "Wurst / Aufschnitt / Schinken", "Cold cuts / sausage / ham", "deli",
       "wurst|aufschnitt|schinken|leberkaese|fleischkaese|salami|ham |cold cuts|fleischwurst|leberwurst|wiener|lunch meat|mortadella|lyoner|bierschinken",
       3, 4, 30, None, pri=2, perishable=True),
    _e("sausage_raw", "Bratwurst (roh)", "Raw sausage", "raw_meat",
       "bratwurst|rostbratwurst|nuernberger|salsiccia|grobe bratwurst|weisswurst|raw sausage|sausage",
       1, 2, 30, None, pri=3, perishable=True),
    _e("bacon", "Speck / Bacon", "Bacon", "deli",
       "speck|bacon|bauchspeck|fruehstuecksspeck|pancetta",
       7, 7, 30, None, pri=3),
    _e("hard_cheese", "Hartkäse", "Hard cheese", "dairy",
       "hartkaese|parmesan|parmigiano|gouda|edamer|emmentaler|cheddar|bergkaese|pecorino|hard cheese|gruyere|manchego",
       21, 28, 180, None, pri=2),
    _e("soft_cheese", "Käse / Frischkäse / Weichkäse", "Cheese / cream cheese / soft cheese", "dairy",
       "kaese|frischkaese|mozzarella|camembert|brie|feta|ricotta|huettenkaese|cottage|cream cheese|cheese|halloumi|schafskaese|mascarpone",
       7, 10, 90, None, pri=2, perishable=True),
    _e("yogurt", "Joghurt / Quark / Skyr", "Yogurt / quark / skyr", "dairy",
       "joghurt|yoghurt|yogurt|quark|skyr|kefir|schmand|sauerrahm|sour cream",
       7, 10, 30, None, pri=2, perishable=True),
    _e("milk", "Milch", "Milk", "dairy",
       "milch|milk|buttermilch|hafermilch|haferdrink|sojadrink|mandelmilch|pflanzendrink|oat drink|kokosmilch|oatly|alpro drink",
       7, 8, 90, None, pri=2, perishable=True),
    _e("cream", "Sahne", "Cream", "dairy",
       "sahne|schlagsahne|cream|creme fraiche|schlagobers|kochcreme|hafer cuisine|soja cuisine|cuisine",
       3, 4, 60, None, pri=2, perishable=True),
    _e("butter", "Butter / Margarine", "Butter / margarine", "dairy",
       "butter|margarine",
       30, 45, 180, 1, pri=2),
    _e("egg_boiled", "Eier (gekocht)", "Eggs (boiled)", "egg",
       "gekochte eier|hartgekochte|hard boiled|boiled egg|fruehstuecksei|gekochtes ei|eier+gekocht|ei+gekocht|eier+hart|ei+hart|egg+boiled|eggs+boiled|soleier|ostereier|eier+gefaerbt",
       7, 10, None, None, pri=3, perishable=True),
    _e("egg_cooked", "Rührei / Omelett", "Scrambled eggs / omelette", "egg",
       "ruehrei|spiegelei|omelett|omelette|scrambled|fried egg|eier+gebraten|frittata",
       3, 4, None, None, pri=3, perishable=True),
    _e("egg_separated", "Eigelb / Eiweiß (roh)", "Egg yolk / white (raw)", "egg",
       "eigelb|eiweiss|egg white|egg yolk",
       2, 3, 365, None, pri=3, perishable=True),
    _e("egg", "Eier (roh, in der Schale)", "Eggs (raw, in shell)", "egg",
       "eier|egg|eggs",
       21, 28, None, 7, pri=2),
    _e("tofu", "Tofu / Tempeh / Seitan", "Tofu / tempeh / seitan", "plant",
       "tofu|tempeh|seitan|veggie+schnitzel|vegane wurst|veganer aufschnitt|vegan+wurst|vegan+aufschnitt|vegan+burger|veggie burger|veggie+burger|plant based|plant-based|beyond meat|beyond burger|like chicken|like meat|vegetarian butcher|fleischersatz|fleischalternative",
       5, 7, 90, None, pri=3, perishable=True),
    _e("falafel_hummus", "Falafel / Hummus", "Falafel / hummus", "plant",
       "falafel|hummus|humus",
       5, 7, 60, None, pri=3, perishable=True),
    _e("dry_protein", "Sojaschnetzel / Lupinen / Erbsenprotein (trocken)", "Soy chunks / lupin / pea protein (dry)", "plant",
       "sojaschnetzel|soja+schnetzel|sojagranulat|soja+granulat|sojabrocken|soja+brocken|sojafleisch|texturiertes|tvp|lupine|lupinen|lupin|erbsenprotein|pea protein|soy chunks|soya chunks",
       3, 4, 90, 365, pri=3),
    _e("juice", "Saft / Smoothie", "Juice / smoothie", "dairy",
       "saft|juice|smoothie",
       7, 8, 240, None, pri=2, perishable=True),
    # --- Fruit, vegetables (priority 1-2) ---
    _e("leafy", "Salat / Blattgemüse", "Salad greens", "produce",
       "salat|kopfsalat|rucola|spinat|blattspinat|feldsalat|lettuce|spinach|arugula|mangold|pak choi",
       3, 5, None, None, pri=1),
    _e("root", "Kartoffeln / Zwiebeln / Knoblauch", "Potatoes / onions / garlic", "produce",
       "kartoffel|zwiebel|knoblauch|potato|onion|garlic|suesskartoffel|kuerbis|pumpkin|ingwer",
       21, 28, None, 30, pri=2),
    _e("mushroom", "Pilze", "Mushrooms", "produce",
       "pilz|champignon|mushroom|steinpilz|pfifferling",
       3, 4, 60, 1, pri=2),
    _e("herbs", "Kräuter", "Fresh herbs", "produce",
       "kraeuter|basilikum|petersilie|schnittlauch|koriander|herbs|basil|parsley|dill|minze",
       5, 7, 90, 1, pri=2),
    _e("berries", "Beeren", "Berries", "produce",
       "beere|erdbeere|himbeere|heidelbeere|blaubeere|berries|strawberr|raspberr|blueberr|kirsche|cherry",
       2, 3, 240, 1, pri=2),
    _e("apple", "Äpfel / Birnen", "Apples / pears", "produce",
       "apfel|aepfel|birne|apple|pear",
       28, 42, 240, 21, pri=2),
    _e("citrus", "Zitrusfrüchte", "Citrus fruit", "produce",
       "zitrone|orange|mandarine|clementine|lemon|lime|citrus|grapefruit|limette",
       14, 21, 120, 10, pri=2),
    _e("fruit", "Obst", "Fruit", "produce",
       "obst|banane|traube|melone|pfirsich|fruit|ananas|mango|kiwi|pflaume|nektarine",
       5, 7, 120, 3, pri=1),
    _e("vegetables", "Gemüse (frisch)", "Vegetables (fresh)", "produce",
       "gemuese|tomate|gurke|paprika|zucchini|karotte|moehre|brokkoli|blumenkohl|kohl|lauch|sellerie|spargel|aubergine|radieschen|vegetable|carrot|broccoli|cucumber|pepper|erbse|bohne|edamame|mais|rosenkohl|gruenkohl|rotkohl|wirsing|kohlrabi|fenchel|pastinake|rote bete|peas|beans|corn|sweetcorn",
       7, 12, 90, 3, pri=1),
    # --- Baked goods, sweets ---
    _e("bread", "Brot / Brötchen", "Bread / rolls", "bread",
       "brot|broetchen|semmel|toast|bread|brioche|baguette|croissant|bagel|tortilla|fladenbrot|pita|naan|wraps|brezen|breze|brezn|laugenbrezel|laugenstange|laugenbroetchen",
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
       "marmelade|konfituere|jam|gelee|preiselbeere|wildpreiselbeere|preiselbeerkompott|cranberrysauce|cranberry sauce|nutella|nussnougat|fruchtaufstrich|schwartau|zentis|bonne maman|samt erdbeer|samt marmelade",
       180, 180, 180, 30, pri=2),
    _e("stable", "Honig / Zucker / Salz / Essig", "Honey / sugar / salt / vinegar", "dry",
       "honig|honey|sirup|syrup|ahornsirup|essig|vinegar|zucker|sugar|salz|salt",
       730, 730, 730, 730, pri=2),
    # --- Dry goods and pantry ---
    _e("soup_pasta", "Suppennudeln (trocken)", "Soup pasta (dry)", "dry",
       "suppennudel|suppeneinlage|buchstabennudel|buchstaben|sternchennudel|sternchensuppe|sternchen|fadennudel|alphabet pasta|soup noodle",
       3, 4, 90, 365, pri=3),
    _e("pasta", "Nudeln (trocken) / gekocht", "Pasta (dry) / cooked", "dry",
       "nudel|pasta|spaghetti|penne|fusilli|makkaroni|macaroni|tagliatelle|spaetzle|farfalle|rigatoni|tortellini|ritornelli|orecchiette|gnocchi|lasagneplatten|ravioli|linguine|conchiglie|hoernchen|spirelli|gemelli|tortiglioni|bandnudel|eiernudel|mie nudel|glasnudel|reisnudel|udon|soba|ramen",
       3, 4, 90, 365, pri=1),
    _e("rice_raw", "Milchreis / Rundkornreis (roh)", "Pudding rice (raw)", "dry",
       "milchreis+roh|milchreis+ungekocht|milchreis+trocken|rundkornreis|milchreisreis|pudding rice",
       1, 2, 30, 365, pri=4),
    _e("brown_rice", "Vollkornreis (trocken) / gekocht", "Brown rice (dry) / cooked", "dry",
       "vollkornreis|brown rice|naturreis",
       1, 2, 30, 180, pri=2),
    _e("rice", "Reis & Getreide (trocken) / gekocht", "Rice & grains (dry) / cooked", "dry",
       "reis|rice|couscous|bulgur|quinoa|hirse|polenta|griess|risotto|basmati|jasmin",
       1, 2, 30, 365, pri=1),
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
       "nuss|nuesse|mandel|walnuss|cashew|erdnuss|haselnuss|pistazie|nuts|almond|sonnenblumenkern|kuerbiskern|samen|seeds|chia|leinsamen|sesam",
       180, 180, 365, 90, pri=2),
    _e("nut_butter", "Nussmus / Erdnussbutter", "Nut butter / peanut butter", "dry",
       "erdnussbutter|peanut butter|nussmus|mandelmus|cashewmus|haselnussmus|tahin|tahini|sesammus",
       90, 90, 180, 90, pri=4),
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
       "kaffeebohne|kaffee|coffee|espresso|coffee beans|kakao|cacao|caotina|kaba|nesquik|trinkschokolade|hot chocolate",
       14, 14, 120, 30, pri=2),
    _e("oil", "Öl", "Cooking oil", "condiment",
       "olivenoel|rapsoel|sonnenblumenoel|speiseoel|kokosoel|sesamoel|leinoel|walnussoel|bratoel|oil|olive oil|biolivum",
       180, 180, None, 180, pri=1),
)

TIPS_MORE: dict[str, dict[str, str]] = {
    "fr": {
        "dish": "Refroidir rapidement, conserver bien fermé et bien réchauffer avant de manger (au moins 70 °C).",
        "raw_meat": "Conserver séparément des autres aliments et cuisiner rapidement.",
        "fish": "Très périssable : garder au froid et consommer rapidement.",
        "deli": "Une fois ouvert, conserver bien fermé au réfrigérateur.",
        "dairy": "Une fois ouvert, conserver bien fermé et au froid. La texture peut changer après décongélation.",
        "egg": "Garder les œufs au réfrigérateur. Ne pas congeler les œufs crus dans leur coquille.",
        "produce": "Conserver au sec et aéré, retirer les morceaux abîmés.",
        "bread": "Le pain se congèle bien en tranches.",
        "condiment": "Une fois ouvert, conserver bien fermé ; ketchup, moutarde et pâtes au réfrigérateur après ouverture.",
        "plant": "Garder tofu, tempeh et plats prêts comme falafels ou houmous au froid et les consommer vite après ouverture ; conserver les produits secs comme les protéines de soja au sec.",
        "dry": "Conserver au sec, à l'abri de la lumière et bien fermé.",
        "coffee": "Conserver à l'abri de la lumière et de l'air. Pour les grains, la date de torréfaction compte plus que la date de remplissage.",
        "sweet": "Conserver au frais et au sec.",
    },
    "nl": {
        "dish": "Snel laten afkoelen, goed afgesloten bewaren en voor het eten goed verhitten (minstens 70 °C).",
        "raw_meat": "Gescheiden van ander voedsel bewaren en snel bereiden.",
        "fish": "Zeer bederfelijk: koel houden en snel opmaken.",
        "deli": "Na openen goed afgesloten in de koelkast bewaren.",
        "dairy": "Na openen goed afgesloten en koel bewaren. De structuur kan na ontdooien veranderen.",
        "egg": "Eieren in de koelkast bewaren. Rauwe eieren niet in de schaal invriezen.",
        "produce": "Droog en luchtig bewaren, beschadigde stukken weggooien.",
        "bread": "Brood is goed in plakken in te vriezen.",
        "condiment": "Na openen goed afgesloten bewaren; ketchup, mosterd en pasta's na openen in de koelkast.",
        "plant": "Tofu, tempeh en kant-en-klaar eten zoals falafel of hummus koel bewaren en na openen snel opmaken; droge producten zoals sojabrokken droog bewaren.",
        "dry": "Droog, donker en goed afgesloten bewaren.",
        "coffee": "Donker en luchtdicht bewaren. Bij koffiebonen telt de branddatum meer dan de vuldatum.",
        "sweet": "Koel en droog bewaren.",
    },
}

# Names of the rows in French and Dutch (6.0); missing ones stay English
NAMES_MORE: dict[str, dict[str, str]] = {
    "fr": {
        "dish": "Plat / restes", "soup": "Soupe / bouillon / sauce", "salad_dish": "Salade composée", "sandwich": "Sandwich",
        "smoked_fish": "Poisson fumé", "dough": "Pâte", "pesto_dip": "Pesto / dip / pâte à tartiner",
        "ketchup": "Ketchup / sauce chili / cocktail", "mustard": "Moutarde", "mayonnaise": "Mayonnaise / rémoulade",
        "soy_sauce": "Sauce soja", "worcester": "Sauce Worcestershire", "bbq_sauce": "Sauce barbecue",
        "hot_sauce": "Sauce piquante (Tabasco, sriracha)", "dressing": "Vinaigrette (en bouteille)", "horseradish": "Raifort",
        "hoisin": "Sauce hoisin / huître", "olives": "Olives (bocal)", "pickles": "Cornichons (bocal)", "curry_paste": "Pâte de curry",
        "curry_powder": "Épices", "ground_meat": "Viande hachée", "poultry": "Volaille (crue)", "marinated_meat": "Viande marinée / gyros",
        "game": "Gibier (cru)", "meat": "Viande (crue)", "canned_fish": "Conserve de poisson", "fish": "Poisson / fruits de mer (crus)",
        "deli": "Charcuterie / jambon", "sausage_raw": "Saucisse crue", "bacon": "Lard / bacon", "hard_cheese": "Fromage à pâte dure",
        "soft_cheese": "Fromage / fromage frais / pâte molle", "yogurt": "Yaourt / fromage blanc / skyr", "milk": "Lait", "cream": "Crème",
        "butter": "Beurre / margarine", "egg_boiled": "Œufs (cuits durs)", "egg_cooked": "Œufs brouillés / omelette",
        "egg_separated": "Jaune / blanc d'œuf (cru)", "egg": "Œufs (crus, en coquille)", "tofu": "Tofu / tempeh / seitan",
        "falafel_hummus": "Falafel / houmous", "dry_protein": "Protéines de soja / lupin / pois (sèches)", "juice": "Jus / smoothie",
        "leafy": "Salade / légumes-feuilles", "root": "Pommes de terre / oignons / ail", "mushroom": "Champignons", "herbs": "Herbes fraîches",
        "berries": "Baies", "apple": "Pommes / poires", "citrus": "Agrumes", "fruit": "Fruits", "vegetables": "Légumes (frais)",
        "bread": "Pain / petits pains", "cake": "Gâteau / pâtisserie", "cookies": "Biscuits / crackers", "chips": "Chips / snacks",
        "chocolate": "Chocolat / confiseries", "jam": "Confiture (ouverte)", "stable": "Miel / sucre / sel / vinaigre",
        "soup_pasta": "Pâtes à soupe (sèches)", "pasta": "Pâtes (sèches) / cuites", "rice_raw": "Riz rond (cru)",
        "brown_rice": "Riz complet (sec) / cuit", "rice": "Riz et céréales (secs) / cuits", "flour": "Farine / amidon / pâtisserie",
        "cereal": "Flocons d'avoine / muesli / céréales", "legumes": "Lentilles / pois chiches / haricots secs", "nuts": "Noix / graines",
        "nut_butter": "Purée d'oléagineux / beurre de cacahuète", "dried_fruit": "Fruits secs", "tea": "Thé", "coffee_ground": "Café (moulu)",
        "coffee": "Café en grains", "oil": "Huile",
    },
    "nl": {
        "dish": "Gerecht / restjes", "soup": "Soep / bouillon / saus", "salad_dish": "Kant-en-klare salade", "sandwich": "Belegd broodje",
        "smoked_fish": "Gerookte vis", "dough": "Deeg", "pesto_dip": "Pesto / dip / smeersel",
        "ketchup": "Ketchup / chili- / cocktailsaus", "mustard": "Mosterd", "mayonnaise": "Mayonaise / remoulade",
        "soy_sauce": "Sojasaus", "worcester": "Worcestershiresaus", "bbq_sauce": "Barbecuesaus",
        "hot_sauce": "Hete saus (Tabasco, sriracha)", "dressing": "Saladedressing (fles)", "horseradish": "Mierikswortel",
        "hoisin": "Hoisin- / oestersaus", "olives": "Olijven (pot)", "pickles": "Augurken (pot)", "curry_paste": "Currypasta",
        "curry_powder": "Kruiden", "ground_meat": "Gehakt", "poultry": "Gevogelte (rauw)", "marinated_meat": "Gemarineerd vlees / gyros",
        "game": "Wild (rauw)", "meat": "Vlees (rauw)", "canned_fish": "Visconserven", "fish": "Vis / zeevruchten (rauw)",
        "deli": "Vleeswaren / worst / ham", "sausage_raw": "Rauwe worst", "bacon": "Spek / bacon", "hard_cheese": "Harde kaas",
        "soft_cheese": "Kaas / roomkaas / zachte kaas", "yogurt": "Yoghurt / kwark / skyr", "milk": "Melk", "cream": "Room",
        "butter": "Boter / margarine", "egg_boiled": "Eieren (gekookt)", "egg_cooked": "Roerei / omelet",
        "egg_separated": "Eigeel / eiwit (rauw)", "egg": "Eieren (rauw, in de schaal)", "tofu": "Tofu / tempé / seitan",
        "falafel_hummus": "Falafel / hummus", "dry_protein": "Sojabrokken / lupine / erwteneiwit (droog)", "juice": "Sap / smoothie",
        "leafy": "Sla / bladgroente", "root": "Aardappelen / uien / knoflook", "mushroom": "Paddenstoelen", "herbs": "Verse kruiden",
        "berries": "Bessen", "apple": "Appels / peren", "citrus": "Citrusvruchten", "fruit": "Fruit", "vegetables": "Groente (vers)",
        "bread": "Brood / broodjes", "cake": "Taart / gebak", "cookies": "Koekjes / crackers", "chips": "Chips / snacks",
        "chocolate": "Chocolade / snoep", "jam": "Jam (geopend)", "stable": "Honing / suiker / zout / azijn",
        "soup_pasta": "Soepnoedels (droog)", "pasta": "Pasta (droog) / gekookt", "rice_raw": "Rijst voor rijstepap (rauw)",
        "brown_rice": "Zilvervliesrijst (droog) / gekookt", "rice": "Rijst en granen (droog) / gekookt", "flour": "Meel / zetmeel / bakken",
        "cereal": "Havermout / muesli / ontbijtgranen", "legumes": "Linzen / kikkererwten / droge bonen", "nuts": "Noten / zaden",
        "nut_butter": "Notenpasta / pindakaas", "dried_fruit": "Gedroogd fruit", "tea": "Thee", "coffee_ground": "Koffie (gemalen)",
        "coffee": "Koffiebonen", "oil": "Olie",
    },
}


def food_name(entry: Entry, language: str) -> str:
    lang = _lang(language)
    if lang == "de":
        return entry.de
    return NAMES_MORE.get(lang, {}).get(entry.id) or entry.en


def tip_text(cat: str, language: str) -> str:
    lang = _lang(language)
    de, en = TIPS[cat]
    return de if lang == "de" else TIPS_MORE.get(lang, {}).get(cat) or en

# Where the values of a row come from (5.6, #151). Ranges: the lower value. The 0 °C compartment has no
# source of its own: it is the fridge value plus a little, as before.
FSIS = "USDA-FSIS Cold Food Storage Chart"
FOODKEEPER = "USDA FoodKeeper"
EXTENSION = "USDA / US Extension (NDSU, UNL)"
CONSUMER_DE = "Verbraucherzentrale / DGE"
OWN = "own"  # no confirmed source: Larder's cautious estimate
SOURCES: dict[str, str] = {
    # FSIS chart: leftovers 3-4 days / 2-6 months, soups 3-4 days / 2-3 months, salads do not freeze well,
    # ground meat 1-2 days / 3-4 months, poultry pieces 1-2 days / 9 months, steaks, chops, roasts 3-5 days /
    # 4-12 months, fatty fish 1-3 days / 2-3 months, luncheon meat opened 3-5 days / 1-2 months, raw sausage
    # 1-2 days / 1-2 months, bacon 1 week / 1 month, eggs in shell 3-5 weeks, hard-cooked 1 week (do not
    # freeze), raw whites and yolks 2-4 days / 12 months, casseroles with eggs 3-4 days
    **dict.fromkeys(("dish", "soup", "salad_dish", "ground_meat", "poultry", "meat", "fish", "deli", "sausage_raw",
                     "bacon", "egg", "egg_boiled", "egg_cooked", "egg_separated"), FSIS),
    # FoodKeeper (cold storage chart of foodsafety.gov): milk 7 days / 3 months, yogurt 7-14 days / 1-2 months,
    # butter 1-3 months / 6-9 months, hard cheese opened 3-4 weeks / 6 months, soft cheese 1 week / 6 months,
    # half-and-half 3-4 days, juice opened 7-10 days / 8-12 months, spinach 3-7 days, mushrooms 3-7 days,
    # condiments and jam after opening (see OPENED), canned seafood opened 3-4 days
    **dict.fromkeys(("milk", "yogurt", "butter", "hard_cheese", "soft_cheese", "cream", "juice", "leafy", "mushroom",
                     "ketchup", "mustard", "mayonnaise", "soy_sauce", "worcester", "bbq_sauce", "hot_sauce", "dressing",
                     "horseradish", "hoisin", "olives", "pickles", "jam"), FOODKEEPER),
    # Extension charts based on USDA: berries 2-3 days / 8-12 months, citrus 2 weeks / 4-6 months (pantry
    # 10 days), apples pantry 3 weeks, fridge 4-6 weeks, freezer 8 months, onions and potatoes pantry 1 month,
    # dried beans and lentils 1-2 years
    # + venison (UNL): fridge 2-3 days, freezer 6-9 months (roasts, steaks)
    **dict.fromkeys(("berries", "citrus", "apple", "root", "legumes", "game"), EXTENSION),
    # 5.7 (#153), German consumer advice: cooked rice within one to two days in the fridge (Bacillus cereus;
    # DGE, Verbraucherzentrale), the dry rice in the pantry as before. Raw eggs: best before 28 days after laying,
    # keep cold from day 18 and keep them cold once they were (Verbraucherzentrale) – the fridge value stays at
    # the lower FSIS value of 3 weeks.
    **dict.fromkeys(("rice", "brown_rice", "rice_raw"), CONSUMER_DE),
    "egg": f"{FSIS}, Verbraucherzentrale",
}

SOURCE_NOTE = {
    "de": {"source": "Quelle: {source}.", OWN: "Ohne bestätigte Quelle: vorsichtige Schätzung von Larder."},
    "en": {"source": "Source: {source}.", OWN: "No confirmed source: Larder's cautious estimate."},
    "fr": {"source": "Source : {source}.", OWN: "Sans source confirmée : estimation prudente de Larder."},
    "nl": {"source": "Bron: {source}.", OWN: "Zonder bevestigde bron: voorzichtige schatting van Larder."},
}


def source_of(entry_id: str) -> str:
    """Source of a row (OWN if none is confirmed)."""
    return SOURCES.get(entry_id, OWN)


def source_note(entry_id: str, lang: str) -> str:
    source = source_of(entry_id)
    notes = SOURCE_NOTE[_lang(lang)]
    return notes[OWN] if source == OWN else notes["source"].format(source=source)


# Shelf life AFTER OPENING of bought products, from USDA FoodKeeper ("refrigerated after opening" /
# "pantry after opening"); where FoodKeeper gives a range, the lower value. (fridge, pantry) in days;
# pantry None = keep in the fridge once opened. Entries without a value here use the storage values above
# (fresh food, leftovers: they already describe food out of its package).
OPENED: dict[str, tuple[int, int | None]] = {
    "ketchup": (180, 30),  # ketchup, cocktail or chili sauce: 6 months refrigerated, 1 month pantry
    "mustard": (365, None),  # 12 months refrigerated
    "mayonnaise": (60, None),  # commercial mayonnaise: 2 months, refrigerate
    "soy_sauce": (30, None),  # 1 month refrigerated
    "worcester": (365, None),  # 1 year refrigerated
    "bbq_sauce": (120, None),  # 4 months refrigerated
    "hot_sauce": (180, 180),  # 6 months, also in the pantry after opening
    "dressing": (30, None),  # bottled dressing: 1-3 months, refrigerate
    "horseradish": (90, None),  # 3-4 months
    "hoisin": (90, None),  # hoisin / oyster sauce: 3-6 months
    "olives": (14, None),  # jarred olives: 2 weeks
    "pickles": (30, None),  # pickles: 1-3 months
    "jam": (180, None),  # jams, jellies, preserves: 6-12 months, refrigerate
    "nut_butter": (90, 60),  # peanut butter: 3-4 months refrigerated, 2-3 months pantry
    "canned_fish": (3, None),  # canned fish once opened: 3-4 days
    "milk": (7, None),  # milk after opening: 7 days
    "yogurt": (7, None),  # yogurt: 1-2 weeks
    "soft_cheese": (7, None),  # soft cheese, cream cheese after opening: about 1 week
    "hard_cheese": (21, None),  # hard cheese opened: 3-4 weeks
    "juice": (7, None),  # juice after opening: 7-10 days
    "deli": (3, None),  # cold cuts / lunch meat opened: 3-5 days
}

OPENED_NOTE = {
    "de": "Nach dem Öffnen: {days} ({place}, Quelle: {source}).",
    "en": "After opening: {days} ({place}, source: {source}).",
    "fr": "Après ouverture : {days} ({place}, source : {source}).",
    "nl": "Na openen: {days} ({place}, bron: {source}).",
}

# 6.0: French and Dutch keywords (the table recognises food written in these languages too)
KEYWORDS_MORE: dict[str, str] = {
    "dish": "restes|reste|plat cuisine|gratin|lasagnes|ragout|hachis|curry|restjes|stamppot|ovenschotel|gerecht|maaltijd|frites|pommes frites|friet|patat|patates frites",
    "soup": "soupe|bouillon|veloute|sauce tomate|soep|bouillon|tomatensaus",
    "salad_dish": "salade de pates|salade de pommes de terre|taboule|pastasalade|aardappelsalade|huzarensalade",
    "smoked_fish": "saumon fume|poisson fume|gerookte zalm|gerookte vis|makreel gerookt",
    "dough": "pate a pizza|pate brisee|pate feuilletee|deeg|pizzadeeg|bladerdeeg",
    "pesto_dip": "tartinade|houmous|tapenade|smeersel|spread",
    "ketchup": "ketchup",
    "mustard": "moutarde|mosterd",
    "mayonnaise": "mayonnaise|mayonaise|remoulade",
    "soy_sauce": "sauce soja|sojasaus|ketjap",
    "bbq_sauce": "sauce barbecue|barbecuesaus",
    "hot_sauce": "sauce piquante|hete saus",
    "dressing": "vinaigrette|saladedressing",
    "horseradish": "raifort|mierikswortel",
    "olives": "olives|olijven",
    "pickles": "cornichons|augurken|zilveruitjes",
    "curry_paste": "pate de curry|concentre de tomate|currypasta|tomatenpuree",
    "curry_powder": "epices|poivre|paprika poudre|kruiden|specerijen|peper",
    "ground_meat": "viande hachee|steak hache|hache|gehakt|rundergehakt",
    "poultry": "poulet|dinde|volaille|canard|kip|kipfilet|kippendij|kippenbout|kipgehakt|kalkoen|gevogelte|eend",
    "game": "gibier|chevreuil|sanglier|lapin|wild|hert|ree|konijn|everzwijn",
    "meat": "viande|boeuf|porc|veau|agneau|cotelette|roti|vlees|rundvlees|varkensvlees|kalfsvlees|lamsvlees|karbonade|biefstuk",
    "canned_fish": "thon en boite|sardines en boite|tonijn in blik|sardines in blik",
    "fish": "poisson|saumon|cabillaud|crevettes|thon|truite|moules|vis|zalm|kabeljauw|garnalen|tonijn|forel|mosselen|haring",
    "deli": "jambon|charcuterie|saucisson|terrine|pate de campagne|pate en croute|rillettes|ham|vleeswaren|salami|leverworst|boterhamworst",
    "sausage_raw": "saucisse|chipolata|merguez|braadworst|saucijs",
    "bacon": "lardons|bacon|lard|spek|ontbijtspek",
    "hard_cheese": "comte|emmental|gruyere|parmesan|cheddar|gouda|oude kaas|belegen kaas|jonge kaas",
    "soft_cheese": "fromage|camembert|brie|mozzarella|chevre|fromage frais|kaas|roomkaas|zachte kaas|geitenkaas",
    "yogurt": "yaourt|fromage blanc|skyr|kefir|creme fraiche epaisse|yoghurt|kwark|vla",
    "milk": "lait|lait d avoine|melk|havermelk|karnemelk",
    "cream": "creme|creme fraiche|creme liquide|room|slagroom|kookroom",
    "butter": "beurre|margarine|boter",
    "egg_boiled": "oeufs durs|oeuf dur|gekookte eieren|gekookt ei",
    "egg_cooked": "oeufs brouilles|omelette|roerei|omelet",
    "egg_separated": "jaune d oeuf|blanc d oeuf|eigeel|eiwit",
    "egg": "oeufs|oeuf|eieren|ei",
    "tofu": "tofu|tempeh|seitan",
    "juice": "jus|jus d orange|sap|sinaasappelsap",
    "leafy": "salade|laitue|epinards|roquette|mache|sla|spinazie|rucola|veldsla",
    "root": "pommes de terre|oignons|ail|patates|aardappelen|uien|knoflook",
    "mushroom": "champignons|cepes|girolles|paddenstoelen|champignon",
    "herbs": "herbes|persil|basilic|ciboulette|coriandre|kruiden vers|peterselie|basilicum|bieslook|koriander",
    "berries": "fraises|framboises|myrtilles|cerises|aardbeien|frambozen|blauwe bessen|kersen",
    "apple": "pomme|poires|appels|peren",
    "citrus": "citron|orange|mandarine|clementine|pamplemousse|citroen|sinaasappel|mandarijn|grapefruit",
    "fruit": "fruits|banane|raisin|melon|peche|ananas|fruit|banaan|druiven|meloen|perzik",
    "vegetables": "legumes|tomates|concombre|poivron|courgette|carottes|brocoli|chou|poireau|haricots verts|groente|tomaten|komkommer|paprika|courgette|wortelen|broccoli|kool|prei|sperziebonen",
    "bread": "pain|baguette|brioche|croissant|pain de mie|brood|stokbrood|broodjes|beschuit",
    "cake": "gateau|tarte|patisserie|cake|taart|gebak|cake",
    "cookies": "biscuits|crackers|koekjes|crackers|speculaas",
    "chips": "chips|snacks|chips",
    "chocolate": "chocolat|bonbons|sucreries|chocolade|snoep|hagelslag",
    "jam": "confiture|pate a tartiner|jam|pindakaas|chocopasta",
    "stable": "miel|sucre|sel|vinaigre|sirop|honing|suiker|zout|azijn|stroop",
    "pasta": "pates|spaghetti|macaroni|tagliatelle|nouilles|pasta|macaroni|noedels|mie",
    "rice": "riz|couscous|semoule|quinoa|boulgour|rijst|couscous|bulgur",
    "flour": "farine|fecule|levure|maizena|meel|bloem|bakpoeder",
    "cereal": "flocons d avoine|muesli|cereales|havermout|muesli|ontbijtgranen",
    "legumes": "lentilles|pois chiches|haricots secs|linzen|kikkererwten|bruine bonen",
    "nuts": "noix|amandes|noisettes|cacahuetes|graines|noten|amandelen|hazelnoten|pinda|zaden",
    "nut_butter": "beurre de cacahuete|puree d amande|pindakaas|notenpasta",
    "dried_fruit": "fruits secs|raisins secs|dattes|abricots secs|gedroogd fruit|rozijnen|dadels",
    "tea": "the|infusion|tisane|thee",
    "coffee_ground": "cafe moulu|gemalen koffie",
    "coffee": "cafe|cafe en grains|cacao|koffie|koffiebonen|cacao",
    "oil": "huile|huile d olive|olie|olijfolie|zonnebloemolie",
}


def _add_keywords() -> None:
    global ENTRIES  # noqa: PLW0603 - once at import
    ENTRIES = tuple(
        Entry(e.id, e.de, e.en, e.cat, e.keywords, e.days, e.priority, e.perishable,
              tuple(_kw(k) for k in KEYWORDS_MORE.get(e.id, "").split("|") if k))
        for e in ENTRIES
    )


_add_keywords()

_KEYWORD_RES: dict[str, tuple[re.Pattern[str], re.Pattern[str]]] = {}
_PLURAL = r"(?:e|en|n|s|es|er|ern)?"


def _part_match(part: str, text: str) -> tuple[bool, bool]:
    """(matches, at the end of a word). Short parts only at the start of a word or as the base word at its end
    (reis ≠ kreis, but Milch|reis), long ones also in the middle of a word (Tomaten|suppe)."""
    if (patterns := _KEYWORD_RES.get(part)) is None:
        word_start = re.compile(rf"(?<![a-z0-9]){re.escape(part)}")
        # base word: alone or after at least three letters (Milch|reis, but not K|reis)
        word_end = re.compile(rf"(?:(?<![a-z0-9])|(?<=[a-z]{{3}})){re.escape(part)}{_PLURAL}(?![a-z0-9])")
        patterns = _KEYWORD_RES[part] = (word_start, word_end)
    word_start, word_end = patterns
    if len(part) <= 2:
        # "ei" only as a word of its own (otherwise it is inside "Reis", "Brei" …)
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(part)}(?![a-z0-9])", text)), True
    at_end = len(part) >= 4 and bool(word_end.search(text))
    if at_end:
        return True, True
    if len(part) >= 5:
        return part in text, False
    return bool(word_start.search(text)), False


def _keyword_score(keyword: str, text: str) -> tuple[bool, bool, int] | None:
    """(weak, at the end of a word, length) of the match, or None."""
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


MIXED = "mixed"  # category for containers with contents of different kinds


def split_items(content: str) -> list[str]:
    """Several contents of a container: "Salami, Kochschinken; Leberwurst" → three entries (else one)."""
    # a comma separates, except between digits ("1,5 kg Reis")
    parts = [p.strip() for p in re.split(r";|,(?!\d)|(?<!\d),", content or "")]
    parts = [p for p in parts if p]
    return parts


def entry_by_id(entry_id: str | None) -> Entry | None:
    """6.3 (#173/#174): a row chosen for a product (by you or from Open Food Facts)."""
    return next((e for e in ENTRIES if e.id == entry_id), None) if entry_id else None


def category_for(content: str, entry_id: str | None = None) -> str | None:
    """Category of the container; "mixed" for contents of different kinds. `entry_id`: the row chosen for it."""
    if (chosen := entry_by_id(entry_id)) is not None:
        return chosen.cat
    cats = {e.cat for e in (find_entry(p) for p in split_items(content)) if e is not None}
    if not cats:
        return None
    return cats.pop() if len(cats) == 1 else MIXED


# 6.3 (#173): Open Food Facts categories (English taxonomy, most specific last) → row of the table
OFF_CATEGORIES: dict[str, str] = {
    "meat-analogues": "tofu", "meat-alternatives": "tofu", "plant-based-meat-alternatives": "tofu",
    "vegetarian-sausages": "tofu", "vegan-sausages": "tofu", "tofu": "tofu", "tempeh": "tofu", "seitan": "tofu",
    "falafels": "falafel_hummus", "hummus": "falafel_hummus",
    "plant-based-milk-alternatives": "milk", "plant-milks": "milk", "milks": "milk", "oat-based-drinks": "milk",
    "soy-milks": "milk", "almond-milks": "milk",
    "plant-based-yogurt-alternatives": "yogurt", "yogurts": "yogurt", "fresh-cheeses": "soft_cheese",
    "plant-based-cream-alternatives": "cream", "creams": "cream", "butters": "butter", "margarines": "butter",
    "cheeses": "soft_cheese", "hard-cheeses": "hard_cheese", "eggs": "egg",
    "ground-meats": "ground_meat", "minced-meats": "ground_meat", "poultries": "poultry", "chickens": "poultry",
    "sausages": "deli", "hams": "deli", "cold-cuts": "deli", "bacons": "bacon", "meats": "meat",
    "fishes": "fish", "smoked-fishes": "smoked_fish", "smoked-salmons": "smoked_fish", "canned-fishes": "canned_fish",
    "ketchup": "ketchup", "mayonnaises": "mayonnaise", "mustards": "mustard", "soy-sauces": "soy_sauce",
    "barbecue-sauces": "bbq_sauce", "hot-sauces": "hot_sauce", "salad-dressings": "dressing", "pestos": "pesto_dip",
    "jams": "jam", "fruit-preserves": "jam", "marmalades": "jam", "cranberry-sauces": "jam", "honeys": "stable",
    "breads": "bread", "cakes": "cake", "biscuits": "cookies", "crisps": "chips", "chocolates": "chocolate",
    "pastas": "pasta", "rices": "rice_raw", "flours": "flour", "breakfast-cereals": "cereal", "legumes": "legumes",
    "nuts": "nuts", "nut-butters": "nut_butter", "peanut-butters": "nut_butter", "dried-fruits": "dried_fruit",
    "teas": "tea", "coffees": "coffee", "fruit-juices": "juice", "juices": "juice", "vegetable-oils": "oil",
    "olive-oils": "oil", "soups": "soup", "prepared-meals": "dish", "pizzas": "dish",
}
_VEGAN_LABELS = ("en:vegan", "en:vegetarian")


def entry_from_off(categories: list[str] | None, labels: list[str] | None = None) -> str | None:
    """Row of the table from the categories and labels of Open Food Facts (None if nothing fits)."""
    entry_id = None
    for tag in reversed(list(categories or [])):
        if str(tag).startswith("en:") and (found := OFF_CATEGORIES.get(str(tag)[3:])):
            entry_id = found
            break
    if entry_id in _MEAT_LIKE and any(label in _VEGAN_LABELS for label in labels or []):
        entry_id = "tofu"  # a vegan or vegetarian "salami" keeps like tofu & co.
    return entry_id


DEFAULT_LANGUAGE: str | None = None  # 6.2: the system language, set when Larder starts


def set_default_language(language: str | None) -> None:
    global DEFAULT_LANGUAGE  # noqa: PLW0603 - one value for the whole table
    DEFAULT_LANGUAGE = language


def find_entry(content: str, language: str | None = None) -> Entry | None:
    """Find the best table entry for the content: no weak keyword, higher priority,
    base word at the end of a word, then the longest keyword."""
    text = f" {norm(content)} "
    # German and English first; the French and Dutch keywords only when none of them matches, and short
    # ones only as a word of their own – otherwise "wild" (Dutch: game) would take "Wildpreiselbeeren",
    # "sel" (French: salt) "Sellerie" and "spek" (Dutch: bacon) "Spekulatius" (6.0.1).
    # 6.2 (#172): the language of the person (sent by the dashboard), else the system language. For French and
    # Dutch their words come first ("pommes" are apples there, not chips); for German and English the French and
    # Dutch words are not used at all.
    lang = str(language or DEFAULT_LANGUAGE or "").lower()[:2]
    if lang in ("fr", "nl"):
        more_score, more_entry = _best_entry(text, more=True)
        if more_score is not None and more_score[0] == 1:
            return _plant_based(text, more_entry)
    elif lang in ("de", "en"):
        return _plant_based(text, _best_entry(text, more=False)[1])
    # A weak German keyword ("~filet") gives way to a real French/Dutch one ("kip" in "Kipfilet").
    score, entry = _best_entry(text, more=False)
    entry = _plant_based(text, entry)
    if score is None or score[0] == 0:
        more_score, more_entry = _best_entry(text, more=True)
        if more_score is not None and (score is None or more_score[0] == 1):
            return _plant_based(text, more_entry)
    return entry


# 6.1.1 (#171): "vegan", "veggie", "vegetarisch", "pflanzlich" … with a meat, sausage or fish word is plant-based
_PLANT_MARKER = re.compile(
    r"(?<![a-z])(vegan|veggie|vegetar|pflanzlich|fleischlos|plant based|plant-based|vegetal|plantaardig)"
)
_MEAT_LIKE = ("ground_meat", "poultry", "marinated_meat", "game", "meat", "sausage_raw", "deli", "bacon", "fish", "smoked_fish")


def _plant_based(text: str, entry: Entry | None) -> Entry | None:
    if entry is not None and entry.id in _MEAT_LIKE and _PLANT_MARKER.search(text):
        return next((e for e in ENTRIES if e.id == "tofu"), entry)
    return entry


def _best_entry(text: str, *, more: bool) -> tuple[tuple[int, int, int, int] | None, Entry | None]:
    best: tuple[int, int, int, int] | None = None
    best_entry: Entry | None = None
    for entry in ENTRIES:
        for keyword in entry.more if more else entry.keywords:
            if not keyword:
                continue
            found = _word_score(keyword, text) if more else _keyword_score(keyword, text)
            if found is None:
                continue
            weak, at_end, length = found
            score = (0 if weak else 1, entry.priority, 1 if at_end else 0, length)
            if best is None or score > best:
                best, best_entry = score, entry
    return best, best_entry


def _word_score(keyword: str, text: str) -> tuple[bool, bool, int] | None:
    """French/Dutch keyword: up to 5 letters only as a whole word (plural allowed), longer ones as usual."""
    parts = keyword.lstrip("~").split("+")
    for part in parts:
        if len(part) <= 5 and not re.search(rf"(?<![a-z0-9]){re.escape(part)}(?:s|en|n|x)?(?![a-z0-9])", text):
            return None
    return _keyword_score(keyword, text)


# ---------- Derive the storage place from the area ----------


@dataclass(frozen=True)
class Storage:
    key: str
    factor: float = 1.0  # < 1: e.g. freezer compartment, not quite as cold as a freezer


_TEMP_RE = re.compile(r"(?<![\w.,])([-−–]?\s?\d{1,2}(?:[.,]\d+)?)\s*(?:°|grad|degrees?)", re.IGNORECASE)

_WORDS = (
    (FREEZER, 0.5, ("gefrierfach", "freezer compartment", "eisfach", "vriesvak", "freezer du frigo")),
    (FREEZER, 1.0, ("gefrier", "tiefkuehl", "tiefkuhl", "truhe", "freezer", "frozen", "frost",
                    "congel", "surgel", "vriezer", "diepvries", "vrieskist")),
    (ZERO, 1.0, ("null grad", "zero grad", "zero degree", "frischefach", "frischhalte", "fleischfach", "fischfach", "chiller", "0 grad",
                 "zero degre", "0 degre", "nul graden", "0 graden")),
    (FRIDGE, 1.0, ("kuehlschrank", "kuehl", "fridge", "refrigerator", "icebox", "cooler",
                   "frigo", "refriger", "koelkast", "koel")),
    (PANTRY, 1.0, ("vorrat", "speis", "pantry", "keller", "cellar", "basement", "schrank", "cupboard", "regal", "shelf", "abstell", "lager", "trocken", "dry",
                   "garde manger", "placard", "cellier", "cave", "epicerie", "etagere",
                   "voorraad", "provisie", "kelder", "kast", "plank")),
)


def parse_temperature(text: str) -> float | None:
    """Read the temperature from text like 'ca. -18 °C' or '0 Grad Fach'."""
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


# ---------- Template for the description of an area label ----------
#
#   Storage: freezer
#   Temperature: -18 °C
#   Max storage: 18 months
#   Notes: meat and fish
#
# One statement per line (or separated by ";"), case-insensitive, all lines optional.
# German keys work too (Lagerort, Temperatur, Max. Lagerzeit, Hinweis). Text without a key
# stays a free note as before.

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
    (1, ("", "d", "day", "days", "t", "tag", "tage", "tagen", "jour", "jours", "dag", "dagen")),
    (365, ("an", "ans", "annee", "annees", "jaar")),
    (30, ("mois", "maand", "maanden")),
    (7, ("semaine", "semaines", "weken")),
)


def _key_pattern() -> re.Pattern[str]:
    aliases = sorted(_KEY_LOOKUP, key=len, reverse=True)  # longest first ("max storage time" before "storage")
    words = "|".join(r"\s+".join(re.escape(w) for w in alias.split()) for alias in aliases)
    return re.compile(rf"(?:^|(?<=[\s;,]))({words})\s*:", re.IGNORECASE)


_KEY_RE = _key_pattern()


def parse_label_template(text: str | None) -> dict[str, str]:
    """Read the `key: value` statements of the template, also all in one line.

    One statement per line is usual; but a value also only reaches to the next known
    key, so everything may be in one line (";" separates too). Free text without a
    key is ignored.
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
    """'3 years', '18 Monate', '6 weeks', '90' (days) → days. None if not readable."""
    match = _DURATION_RE.search(text or "")
    if not match:
        return None
    unit = match.group(2).casefold().rstrip(".")
    factor = next((f for f, names in _UNITS if unit in names), None)
    if factor is None:
        return None
    days = round(float(match.group(1).replace(",", ".")) * factor)
    return days if days >= 1 else None


_DURATION_WORDS = {
    "de": (("Jahr", "Jahre"), ("Monat", "Monate"), ("Woche", "Wochen"), ("Tag", "Tage")),
    "en": (("year", "years"), ("month", "months"), ("week", "weeks"), ("day", "days")),
    "fr": (("an", "ans"), ("mois", "mois"), ("semaine", "semaines"), ("jour", "jours")),
    "nl": (("jaar", "jaar"), ("maand", "maanden"), ("week", "weken"), ("dag", "dagen")),
}


def _lang(language: str) -> str:
    code = str(language or "en").lower()[:2]
    return code if code in _DURATION_WORDS else "en"


def format_duration(days: int, language: str) -> str:
    """Days readable: 1095 → '3 Jahre' / '3 years', 540 → '18 Monate', 42 → '6 Wochen'."""
    units = _DURATION_WORDS[_lang(language)]
    for size, (one, many) in zip((365, 30, 7, 1), units, strict=True):
        if days % size == 0:
            n = days // size
            return f"{n} {one if n == 1 else many}"
    return f"{days} {units[3][1]}"


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
    """Determine the storage place: sensor, "Storage:" of the template, temperature in the label/name, then keywords."""
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
    """There is no entry for the content."""


class TableUnknownStorage(Exception):
    """The area cannot be assigned to a storage place."""


class TableUnsuitable(Exception):
    """This food should not be stored at this storage place."""

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
    opened: bool = False,
    entry_id: str | None = None,
) -> TableResult:
    """Calculate the shelf life from the table or raise a matching exception.

    `entry_id` (6.3): the row chosen for this product (by you or from Open Food Facts) instead of the name.

    `opened`: shelf life after opening a bought product (OPENED, counted from today).

    Several contents (separated by commas) are looked up one by one; the shortest value applies.
    If the table does not know one of them, that counts as no match (otherwise exactly the
    unknown one could spoil first).
    """
    items = split_items(content)
    if len(items) <= 1 or entry_by_id(entry_id) is not None:
        return _lookup_one(content, area_name=area_name, temperature_c=temperature_c, label_texts=label_texts,
                           vacuum=vacuum, language=language, storage_hint=storage_hint, opened=opened, entry_id=entry_id)
    results = [
        (item, _lookup_one(item, area_name=area_name, temperature_c=temperature_c, label_texts=label_texts,
                           vacuum=vacuum, language=language, storage_hint=storage_hint, opened=opened))
        for item in items
    ]
    item, shortest = min(results, key=lambda r: r[1].days)
    if len({r.days for _, r in results}) == 1:
        return shortest
    note = {
        "de": f"„{item}“ bestimmt das MHD.",
        "en": f"“{item}” decides the best-before date.",
        "fr": f"« {item} » détermine la date.",
        "nl": f"„{item}” bepaalt de houdbaarheid.",
    }[_lang(language)]
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
    opened: bool = False,
    entry_id: str | None = None,
) -> TableResult:
    lang = _lang(language)
    entry = entry_by_id(entry_id) or find_entry(content, language)
    if entry is None:
        raise TableNoMatch
    storage = classify_storage(area_name, temperature_c, label_texts, storage_hint)
    if storage is None:
        raise TableUnknownStorage

    place = STORAGE_LABELS[lang][storage.key]
    food = food_name(entry, lang)
    if opened and storage.key == FREEZER:
        raise TableNoMatch  # "opened" in the freezer: no table value, the caller falls back
    if opened and entry.id in OPENED:
        return _opened_result(entry, storage, lang, place, food)
    base = entry.days[storage.key]
    if base is None:
        raise TableUnsuitable(food, place)

    days = base * storage.factor
    cold = storage.key in (FRIDGE, ZERO)
    vacuum_helps = vacuum and not (entry.perishable and cold)
    if vacuum_helps:
        days *= VACUUM_FACTOR[storage.key]
    days_int = max(1, round(days))

    tip = f"{tip_text(entry.cat, lang)} {source_note(entry.id, lang)}"
    if vacuum and entry.perishable and cold:
        tip += {
            "de": " Vakuum verlängert die Haltbarkeit leicht verderblicher Speisen im Kühlschrank kaum.",
            "en": " Vacuum hardly extends the shelf life of perishable food in the fridge.",
            "fr": " Le sous vide prolonge à peine la conservation des aliments périssables au réfrigérateur.",
            "nl": " Vacuüm verlengt de houdbaarheid van bederfelijk voedsel in de koelkast nauwelijks.",
        }[lang]
    return TableResult(days_int, tip, f"{food} · {place} · {_source_label(entry.id, lang)}")


def _opened_result(entry: Entry, storage: Storage, lang: str, place: str, food: str) -> TableResult:
    fridge, pantry = OPENED[entry.id]
    days = pantry if storage.key == PANTRY else fridge
    if days is None:
        raise TableUnsuitable(food, place)
    days_int = max(1, round(days * storage.factor))
    note = OPENED_NOTE[lang].format(days=format_duration(days_int, lang), place=place, source=FOODKEEPER)
    return TableResult(days_int, note, f"{food} · {place} · {FOODKEEPER}")


def _source_label(entry_id: str, lang: str) -> str:
    source = source_of(entry_id)
    if source != OWN:
        return source
    return {"de": "Larder (Schätzung)", "fr": "Larder (estimation)", "nl": "Larder (schatting)"}.get(_lang(lang), "Larder (estimate)")
