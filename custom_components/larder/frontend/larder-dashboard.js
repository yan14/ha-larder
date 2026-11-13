/**
 * Larder-Dashboard (seit 2.0): kachelbasierte Oberfläche mit Start, Behältern, Bereichen, Kategorien und
 * Rezepten, unten eine Leiste zum Wechseln.
 *
 * Für Dialoge (Hinzufügen, Befüllen, NFC), die Karten mit allen Details und die Schätzungen bettet sie die
 * Komponente <larder-panel-embedded embedded> aus larder-panel.js ein (die frühere Oberfläche).
 * "Larder experimental" (larder-experimental.js) erbt von dieser Klasse und ist der Platz für neue Ideen.
 */
// Mit derselben Versionsangabe laden wie dieses Modul, damit nie eine ältere Kopie aus dem Cache benutzt wird.
const { collectDevices, daysUntil, isLarderLabel, soonDaysOf, SOON_DAYS } = await import(`./larder-panel.js${new URL(import.meta.url).search}`);

const DOMAIN = "larder";
const STORAGE_KEY = `${DOMAIN}.experimental`;

export const TEXTS = {
  de: {
    title: "Larder",
    views: { start: "Start", containers: "Behälter", recipes: "Rezepte", areas: "Bereiche", categories: "Kategorien" },
    hello: (name) => (name ? `Hallo ${name}` : "Hallo"),
    soonTitle: "Dieser Vorrat sollte bald verbraucht werden:",
    soonNone: (n) => (n === 0 ? "Heute läuft nichts ab." : `In den nächsten ${n} Tagen läuft nichts ab.`),
    help: "Wie kann ich helfen?",
    helpRecipes: "Rezeptvorschläge",
    helpContainers: "Behälter anzeigen",
    settings: "Einstellungen",
    add: "Hinzufügen",
    sort: "Sortieren nach",
    sortDate: "Ablaufdatum / MHD",
    sortArea: "Bereich",
    sortName: "Alphabetisch",
    sortCategory: "Kategorie",
    sortCount: "Anzahl",
    sortSoon: "Läuft bald ab",
    sortNewest: "Neueste zuerst",
    viewGrid: "Kacheln",
    viewList: "Liste",
    viewCards: "Karten mit allen Details",
    estimates: "Schätzungen",
    menuEstimates: "Gemerkte Schätzungen",
    menuLabels: "QR-Etiketten drucken",
    labelsTitle: "QR-Etiketten drucken",
    labelsFor: (n) => (n === null ? "Alle Dosen" : n === 1 ? "1 ausgewählte Dose" : `${n} ausgewählte Dosen`),
    labelsLayout: "Etikettenbogen (A4)",
    labelsSkip: "Schon benutzte Etiketten überspringen",
    labelsContent: "Inhalt und MHD mitdrucken (für Etiketten, die nicht dauerhaft bleiben)",
    labelsBorder: "Schnittlinien (für normales Papier)",
    labelsOpen: "PDF öffnen",
    labelsCreate: "PDF erstellen",
    labelsUpdate: "Neu erstellen",
    labelsFailed: "Das PDF konnte nicht geöffnet werden.",
    labelsHint: "Mit 100 % drucken (nicht „an Seite anpassen“), damit die Codes auf die Etiketten treffen.",
    selectLabels: "Etiketten",
    menuSettings: "Einstellungen der Integration",
    empty: "Leer",
    noArea: "Ohne Bereich",
    noneYet: "Noch keine Behälter. Füge den ersten über „Hinzufügen“ hinzu.",
    noMatch: "Keine passenden Behälter.",
    filterArea: (name) => `Bereich: ${name}`,
    filterCategory: (name) => `Kategorie: ${name}`,
    filterSoon: "Läuft bald ab",
    filterAll: "Alle",
    filterExpired: "Abgelaufen",
    filterFilled: "Befüllt",
    filterEmpty: "Leer",
    filterLabel: "Filter",
    search: "Suchen …",
    count: (shown, all) => (shown === all ? (all === 1 ? "1 Dose" : `${all} Dosen`) : `${shown} von ${all} Dosen`),
    servings: "Personen",
    servingsDefault: "Personen: Standard",
    servingsN: (n) => (n === 1 ? "1 Person" : `${n} Personen`),
    adminOnly: (code) => `Nur Administratoren können Dosen hinzufügen. Gescannter Code: ${code}`,
    containersCount: (n) => (n === 1 ? "1 Behälter" : `${n} Behälter`),
    expired: "abgelaufen",
    today: "heute",
    daysShort: (n) => `${n} T`,
    soonCount: (n) => `${n} bald`,
    categories: {
      fish: "Fisch",
      raw_meat: "Fleisch",
      deli: "Wurst & Aufschnitt",
      dairy: "Milchprodukte",
      egg: "Eier",
      produce: "Obst & Gemüse",
      bread: "Brot & Gebäck",
      dish: "Gerichte & Reste",
      dry: "Trockenware",
      sweet: "Süßes",
      coffee: "Kaffee & Tee",
      mixed: "Gemischt",
      other: "Sonstiges",
      empty: "Leer",
    },
    recipesEmpty: "Noch keine Rezepte gespeichert.",
    recipesGenerate: "Aus Resten",
    recipesBusy: "Die KI überlegt …",
    recipesNone: (n) => (n === 0 ? "Heute läuft nichts ab." : `In den nächsten ${n} Tagen läuft nichts ab.`),
    recipesNoneAll: "Keine befüllte Dose gefunden.",
    period: "Zeitraum für Rezeptideen",
    periodDefault: (n) => `Standard (${n === 0 ? "nur heute" : n === 1 ? "1 Tag" : `${n} Tage`})`,
    periodDays: (n) => (n === 1 ? "Läuft morgen ab" : `Läuft in ${n} Tagen ab`),
    periodAll: "Alle Dosen (kein Zeitraum)",
    recipesFailed: "Die Rezeptideen konnten nicht erstellt werden.",
    suggestions: "Vorschläge aus deinen Resten",
    save: "Speichern",
    areaAdd: "Bereich anlegen",
    areaEdit: "Bereiche bearbeiten",
    areaEditDone: "Fertig",
    areaEditHint: "Tippe auf einen Bereich, um ihn umzubenennen oder seine Lagerart zu ändern. Hier stehen alle Bereiche von Home Assistant.",
    areaEditTitle: "Bereich bearbeiten",
    areaName: "Name",
    areaKind: "Lagerart (Label)",
    areaKindNone: "kein Larder-Label",
    areaKindNew: "Neues Label …",
    areaKindNewName: "Name der Lagerart, z. B. Gefrierschrank",
    areaKindHint: "Gibt es Larder-Labels, bieten die Auswahllisten nur Bereiche mit einem davon an. Grenzen wie die max. Lagerzeit stehen in der Beschreibung des Labels.",
    areaOpenHa: "In Home Assistant öffnen",
    areaNeedName: "Bitte einen Namen eingeben.",
    areaSaveFailed: (msg) => `Speichern fehlgeschlagen: ${msg}`,
    saved: "Gespeichert",
    cancel: "Abbrechen",
    close: "Schließen",
    edit: "Bearbeiten",
    delete: "Löschen",
    confirmDelete: (title) => `„${title}“ löschen?`,
    recipeNew: "Neues Rezept",
    recipeEdit: "Rezept bearbeiten",
    recipeTitle: "Name",
    recipeMinutes: "Dauer (Minuten, optional)",
    recipeIngredients: "Zutaten (eine pro Zeile)",
    recipeSteps: "Zubereitung (ein Schritt pro Zeile)",
    recipeNeedTitle: "Bitte gib dem Rezept einen Namen.",
    recipeSaveFailed: "Das Rezept konnte nicht gespeichert werden.",
    minutes: (n) => `${n} Min.`,
    ingredients: "Zutaten",
    steps: "Zubereitung",
    fromAi: "Von der KI",
    fromPhoto: "Aus Foto",
    selectStart: "Auswählen",
    selectDone: "Fertig",
    selected: (n) => (n === 1 ? "1 ausgewählt" : `${n} ausgewählt`),
    selectHint: "Tippe Dosen an, um sie auszuwählen.",
    selectFill: (n) => `Befüllen (${n})`,
    selectRecipes: "Rezeptideen",
    selectAll: "Alle",
    selectNone: "Keine",
    scanStart: "Scannen",
    scanStop: "Scan beenden",
    scanHint: "Serien-Scan läuft: Jede gescannte Dose wird ausgewählt.",
    scanNfcHint: "Handy an den Tag halten und das Banner „In Home Assistant öffnen“ oben antippen.",
    scanQr: "QR-Code",
    scanNfc: "NFC",
    scanModeLabel: "Scannen mit",
    scanQrHint: "Der QR-Scanner der App ist offen. Über „NFC“ im Scanner oder hier wechselst du zu NFC.",
    scanToNfc: "Zu NFC wechseln",
    scanTitle: "Dosen scannen",
    scanDescription: "Scanne die QR-Codes der Dosen nacheinander. Schließen, wenn du fertig bist.",
    scanAdded: (name, n) => `✓ ${name} (${n} ausgewählt)`,
    scanUnknown: "Diese Dose ist noch nicht angelegt.",
    scanInvalid: "Kein Larder-Code.",
    scanOne: "Dose scannen",
    scanOneDescription: "Halte die Kamera auf den QR-Code einer Dose: eigener Code oder Zwilling-Code.",
    recipesPick: "Dosen wählen",
    recipesNoneChosen: "Die gewählten Dosen sind leer oder abgelaufen.",
    suggestionsChosen: (n) => `Vorschläge aus ${n === 1 ? "1 gewählten Dose" : `${n} gewählten Dosen`}`,
    photoRead: "Rezept aus Foto oder Datei lesen",
    photoBusy: "Die KI liest das Rezept …",
    photoFailed: "Das Rezept konnte nicht gelesen werden.",
    photoCheck: "Rezept aus Foto prüfen",
    photoTooMany: (n) => `Höchstens ${n} Fotos auf einmal.`,
  },
  en: {
    title: "Larder",
    views: { start: "Start", containers: "Containers", recipes: "Recipes", areas: "Areas", categories: "Categories" },
    hello: (name) => (name ? `Hello ${name}` : "Hello"),
    soonTitle: "This food should be used up soon:",
    soonNone: (n) => (n === 0 ? "Nothing expires today." : `Nothing expires in the next ${n} days.`),
    help: "How can I help?",
    helpRecipes: "Recipe suggestions",
    helpContainers: "Show containers",
    settings: "Settings",
    add: "Add",
    sort: "Sort by",
    sortDate: "Best-before date",
    sortArea: "Area",
    sortName: "Alphabetical",
    sortCategory: "Category",
    sortCount: "Count",
    sortSoon: "Expiring soon",
    sortNewest: "Newest first",
    viewGrid: "Tiles",
    viewList: "List",
    viewCards: "Cards with all details",
    estimates: "Estimates",
    menuEstimates: "Remembered estimates",
    menuLabels: "Print QR labels",
    labelsTitle: "Print QR labels",
    labelsFor: (n) => (n === null ? "All containers" : n === 1 ? "1 selected container" : `${n} selected containers`),
    labelsLayout: "Label sheet (A4)",
    labelsSkip: "Skip labels already used",
    labelsContent: "Print contents and best-before date (for labels that will not stay)",
    labelsBorder: "Cutting lines (for plain paper)",
    labelsOpen: "Open PDF",
    labelsCreate: "Create PDF",
    labelsUpdate: "Create again",
    labelsFailed: "The PDF could not be opened.",
    labelsHint: "Print at 100 % (not “fit to page”) so the codes hit the labels.",
    selectLabels: "Labels",
    menuSettings: "Integration settings",
    empty: "Empty",
    noArea: "No area",
    noneYet: "No containers yet. Add the first one with “Add”.",
    noMatch: "No matching containers.",
    filterArea: (name) => `Area: ${name}`,
    filterCategory: (name) => `Category: ${name}`,
    filterSoon: "Expiring soon",
    filterAll: "All",
    filterExpired: "Expired",
    filterFilled: "Filled",
    filterEmpty: "Empty",
    filterLabel: "Filter",
    search: "Search …",
    count: (shown, all) => (shown === all ? (all === 1 ? "1 container" : `${all} containers`) : `${shown} of ${all} containers`),
    servings: "People",
    servingsDefault: "People: default",
    servingsN: (n) => (n === 1 ? "1 person" : `${n} people`),
    adminOnly: (code) => `Only administrators can add containers. Scanned code: ${code}`,
    containersCount: (n) => (n === 1 ? "1 container" : `${n} containers`),
    expired: "expired",
    today: "today",
    daysShort: (n) => `${n} d`,
    soonCount: (n) => `${n} soon`,
    categories: {
      fish: "Fish",
      raw_meat: "Meat",
      deli: "Cold cuts",
      dairy: "Dairy",
      egg: "Eggs",
      produce: "Fruit & vegetables",
      bread: "Bread & pastry",
      dish: "Dishes & leftovers",
      dry: "Dry goods",
      sweet: "Sweets",
      coffee: "Coffee & tea",
      mixed: "Mixed",
      other: "Other",
      empty: "Empty",
    },
    recipesEmpty: "No recipes saved yet.",
    recipesGenerate: "From leftovers",
    recipesBusy: "The AI is thinking …",
    recipesNone: (n) => (n === 0 ? "Nothing expires today." : `Nothing expires in the next ${n} days.`),
    recipesNoneAll: "No filled container found.",
    period: "Period for recipe ideas",
    periodDefault: (n) => `Default (${n === 0 ? "today only" : n === 1 ? "1 day" : `${n} days`})`,
    periodDays: (n) => (n === 1 ? "Expires by tomorrow" : `Expires within ${n} days`),
    periodAll: "All containers (no period)",
    recipesFailed: "The recipe ideas could not be created.",
    suggestions: "Suggestions from your leftovers",
    save: "Save",
    areaAdd: "Add area",
    areaEdit: "Edit areas",
    areaEditDone: "Done",
    areaEditHint: "Tap an area to rename it or change its storage kind. All areas of Home Assistant are listed here.",
    areaEditTitle: "Edit area",
    areaName: "Name",
    areaKind: "Storage kind (label)",
    areaKindNone: "no Larder label",
    areaKindNew: "New label …",
    areaKindNewName: "Name of the storage kind, e.g. Freezer",
    areaKindHint: "Once Larder labels exist, the dropdowns only offer areas with one of them. Limits like the max. storage time go into the label's description.",
    areaOpenHa: "Open in Home Assistant",
    areaNeedName: "Please enter a name.",
    areaSaveFailed: (msg) => `Saving failed: ${msg}`,
    saved: "Saved",
    cancel: "Cancel",
    close: "Close",
    edit: "Edit",
    delete: "Delete",
    confirmDelete: (title) => `Delete “${title}”?`,
    recipeNew: "New recipe",
    recipeEdit: "Edit recipe",
    recipeTitle: "Name",
    recipeMinutes: "Duration (minutes, optional)",
    recipeIngredients: "Ingredients (one per line)",
    recipeSteps: "Method (one step per line)",
    recipeNeedTitle: "Please give the recipe a name.",
    recipeSaveFailed: "The recipe could not be saved.",
    minutes: (n) => `${n} min`,
    ingredients: "Ingredients",
    steps: "Method",
    fromAi: "From the AI",
    fromPhoto: "From a photo",
    selectStart: "Select",
    selectDone: "Done",
    selected: (n) => `${n} selected`,
    selectHint: "Tap containers to select them.",
    selectFill: (n) => `Fill (${n})`,
    selectRecipes: "Recipe ideas",
    selectAll: "All",
    selectNone: "None",
    scanStart: "Scan",
    scanStop: "Stop scanning",
    scanHint: "Serial scan running: every scanned container gets selected.",
    scanNfcHint: "Hold the phone to the tag and tap the “Open in Home Assistant” banner at the top.",
    scanQr: "QR code",
    scanNfc: "NFC",
    scanModeLabel: "Scan with",
    scanQrHint: "The app's QR scanner is open. Switch to NFC with “NFC” in the scanner or here.",
    scanToNfc: "Switch to NFC",
    scanTitle: "Scan containers",
    scanDescription: "Scan the QR codes of the containers one after another. Close when you are done.",
    scanAdded: (name, n) => `✓ ${name} (${n} selected)`,
    scanUnknown: "This container has not been added yet.",
    scanInvalid: "Not a Larder code.",
    scanOne: "Scan container",
    scanOneDescription: "Point the camera at the QR code of a container: your own code or a Zwilling code.",
    recipesPick: "Pick containers",
    recipesNoneChosen: "The selected containers are empty or expired.",
    suggestionsChosen: (n) => `Suggestions from ${n === 1 ? "1 selected container" : `${n} selected containers`}`,
    photoRead: "Read a recipe from a photo or file",
    photoBusy: "The AI is reading the recipe …",
    photoFailed: "The recipe could not be read.",
    photoCheck: "Check the recipe from the photo",
    photoTooMany: (n) => `At most ${n} photos at once.`,
  },
};

export const CATEGORY_ICONS = {
  fish: "🐟",
  raw_meat: "🥩",
  deli: "🥓",
  dairy: "🧀",
  egg: "🥚",
  produce: "🥦",
  bread: "🍞",
  dish: "🍲",
  dry: "🌾",
  sweet: "🍫",
  coffee: "☕",
  mixed: "🍱",
  other: "📦",
  empty: "🫙",
};

const VIEWS = ["start", "containers", "recipes", "areas", "categories"];
const ALL_VIEWS = [...VIEWS, "estimates"]; // "estimates" erreicht man über ⚙ (nur Administratoren)
const MODES = ["grid", "list", "cards"];
const VIEW_ICONS = { start: "🏠", containers: "🫙", recipes: "📖", areas: "📍", categories: "🏷️" };

export function texts(hass) {
  const lang = String((hass && hass.language) || "en").toLowerCase().split("-")[0];
  return TEXTS[lang] || TEXTS.en;
}

function isAdmin(hass) {
  return !!(hass && hass.user && hass.user.is_admin);
}

function isValid(state) {
  return !!state && state.state !== "unknown" && state.state !== "unavailable";
}

/** Eine Dose mit Inhalt, Resttagen und Kategorie, wie sie die Kacheln brauchen. */
export function describeDevices(hass, devices, now = new Date()) {
  const states = hass.states || {};
  return devices.map((dev) => {
    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    const content = isValid(text) ? text.state.trim() : "";
    const days = isValid(date) ? daysUntil(date.state, now) : null;
    const category = content ? (text.attributes && text.attributes.category) || "other" : "empty";
    return { dev, id: dev.deviceId, name: dev.name, content, days, soon: soonDaysOf(date), category, areaId: dev.areaId, areaName: dev.areaName };
  });
}

export function isSoon(row) {
  return row.content !== "" && row.days !== null && row.days <= (row.soon ?? SOON_DAYS);
}

function sortRows(rows, sort, lang) {
  const cmp = (a, b) => String(a).localeCompare(String(b), lang, { numeric: true, sensitivity: "base" });
  const byDate = (a, b) => {
    if (a.days === null && b.days !== null) return 1;
    if (a.days !== null && b.days === null) return -1;
    if (a.days !== b.days && a.days !== null) return a.days - b.days;
    return cmp(a.content || a.name, b.content || b.name);
  };
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => cmp(a.content || "￿" + a.name, b.content || "￿" + b.name));
  else if (sort === "area") out.sort((a, b) => cmp(a.areaName || "￿", b.areaName || "￿") || byDate(a, b));
  else if (sort === "category") out.sort((a, b) => cmp(a.category, b.category) || byDate(a, b));
  else out.sort(byDate);
  return out;
}

export function sortContainers(rows, sort, lang = "en") {
  return sortRows(rows, sort, lang);
}

function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function daysLabel(t, days) {
  if (days === null) return "";
  if (days < 0) return t.expired;
  if (days === 0) return t.today;
  return t.daysShort(days);
}

function dayClass(row) {
  if (row.content === "" || row.days === null) return "";
  if (row.days < 0) return "expired";
  if (row.days <= (row.soon ?? SOON_DAYS)) return "soon";
  return "";
}

function navigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
}

/** Zeitraum für Rezeptideen: Einstellung der Integration, feste Tage oder "all" (ohne Zeitraum). */
export const RECIPE_PERIODS = ["default", "1", "3", "7", "14", "30", "all"];

/** Daten für den Service `suggest_recipes` je nach gewähltem Zeitraum. */
export function recipeServiceData(period) {
  if (period === "all") return { all_containers: true };
  if (period === "default" || !RECIPE_PERIODS.includes(period)) return {};
  return { days: Number(period) };
}

export const PHOTO_MAX_FILES = 4;
const PHOTO_MAX_SIDE = 2000;

/**
 * Foto für den Upload vorbereiten: auf höchstens 2000 px verkleinern und als JPEG senden (spart
 * Datenvolumen und KI-Kosten, iPhone-Fotos werden dabei zu JPEG). PDFs und alles, was der Browser
 * nicht zeichnen kann, gehen unverändert.
 */
export async function preparePhoto(file) {
  if (!file || !String(file.type).startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], "recipe.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Etikettenbögen wie in labels.py (Felder pro Bogen für "überspringen"). */
const LABEL_LAYOUTS = { "3x8": { per: 24, size: "70 × 36 mm" }, "3x7": { per: 21, size: "70 × 42,3 mm" }, "2x4": { per: 8, size: "105 × 74 mm" } };

function loadOptions() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      mode: MODES.includes(raw.mode) ? raw.mode : "grid",
      sort: ["date", "area", "name", "category"].includes(raw.sort) ? raw.sort : "date",
      areaSort: ["name", "count", "soon"].includes(raw.areaSort) ? raw.areaSort : "name",
      recipeSort: ["newest", "name"].includes(raw.recipeSort) ? raw.recipeSort : "newest",
      recipePeriod: RECIPE_PERIODS.includes(raw.recipePeriod) ? raw.recipePeriod : "default",
      recipeServings: Number.isInteger(raw.recipeServings) && raw.recipeServings >= 0 && raw.recipeServings <= 12 ? raw.recipeServings : 0,
      labelLayout: LABEL_LAYOUTS[raw.labelLayout] ? raw.labelLayout : "3x8",
    };
  } catch {
    return { mode: "grid", sort: "date", areaSort: "name", recipeSort: "newest", recipePeriod: "default" };
  }
}

function saveOptions(opts) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* Speicher nicht verfügbar: Einstellungen gelten nur für diese Sitzung */
  }
}

const STYLE = `
  :host { position: relative; display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; background: var(--primary-background-color);
    color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  [hidden] { display: none !important; }
  header { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 56px; box-sizing: border-box;
    background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
    position: sticky; top: 0; z-index: 2; }
  header h1 { flex: 1; font-size: 20px; font-weight: 400; margin: 0; }
  header button { background: none; border: 0; color: inherit; font-size: 22px; cursor: pointer; padding: 4px 8px; }
  #menu { display: none; }
  :host([narrow]) #menu { display: inline-block; }
  main { flex: 1; padding: 12px 16px 16px; box-sizing: border-box; }
  :host([classic-view]) main { flex: none; padding-bottom: 0; }
  :host([classic-view]) larder-panel-embedded { flex: 1; }
  .menu { position: absolute; top: 52px; right: 8px; z-index: 5; display: flex; flex-direction: column; min-width: 220px;
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .2); overflow: hidden; }
  .menu button { font: inherit; font-size: 15px; text-align: left; padding: 12px 16px; border: 0; background: none;
    color: var(--primary-text-color); cursor: pointer; }
  .menu button + button { border-top: 1px solid var(--divider-color); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
  .bar .grow { flex: 1; }
  .bar.ai select { flex: 1 1 40%; min-width: 0; }
  .bar.ai button { flex: 1 1 100%; }
  .bar.search input { flex: 1; min-width: 0; font: inherit; font-size: 15px; padding: 8px 14px; border-radius: 18px;
    border: 1px solid var(--divider-color); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .notice { margin: 12px 16px 0; padding: 10px 14px; border-radius: 12px; font-size: 14px; cursor: pointer;
    background: var(--warning-color, #ffa600); color: #000; }
  p.count { margin: -4px 0 10px; font-size: 13px; color: var(--secondary-text-color); }
  .bar select, .bar button { font: inherit; font-size: 14px; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 18px; padding: 7px 12px; cursor: pointer; }
  .bar button.icon { padding: 6px 12px; font-size: 16px; line-height: 1.2; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 5px 6px 5px 12px; border-radius: 16px;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .chip button { background: none; border: 0; color: inherit; font-size: 15px; cursor: pointer; padding: 0 6px; }
  h2 { font-size: 15px; font-weight: 500; margin: 18px 0 8px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
  h2:first-child { margin-top: 0; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }
  .tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; text-align: center;
    font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff); border: 1px solid var(--divider-color);
    border-radius: 14px; padding: 12px 6px 10px; min-height: 104px; cursor: pointer; box-sizing: border-box; min-width: 0; }
  .tile .ico { font-size: 30px; line-height: 1.1; }
  .tile .name { font-size: 14px; font-weight: 500; max-width: 100%; line-height: 1.2; overflow: hidden; overflow-wrap: anywhere; hyphens: auto;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .tile .sub { font-size: 11px; color: var(--secondary-text-color); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile.empty { opacity: .65; border-style: dashed; }
  .tile.selected, .row.selected { outline: 3px solid var(--primary-color); outline-offset: -3px; opacity: 1; }
  .tile .check, .row .check { position: absolute; top: 6px; right: 8px; font-size: 16px; color: var(--primary-color); }
  .row { position: relative; }
  .selbar { position: sticky; bottom: calc(57px + env(safe-area-inset-bottom, 0px)); z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 12px -16px -16px; padding: 10px 16px; background: var(--card-background-color, #fff); border-top: 1px solid var(--divider-color); }
  .selbar .count { flex: 1; font-size: 14px; color: var(--secondary-text-color); min-width: 90px; }
  .selbar button { font: inherit; font-size: 14px; border-radius: 18px; padding: 7px 12px; cursor: pointer;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  .selbar button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .bar button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; color: #fff; white-space: nowrap; background: var(--secondary-text-color); }
  .badge.soon { background: var(--warning-color, #ffa600); }
  .badge.expired { background: var(--error-color, #db4437); }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; text-align: left; font: inherit; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 12px; cursor: pointer; width: 100%; box-sizing: border-box; }
  .row .ico { font-size: 24px; }
  .row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .row .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .sub { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.empty { opacity: .65; }
  .note { color: var(--secondary-text-color); font-size: 14px; margin: 8px 0; }
  .scanpanel { margin: 0 0 12px; }
  .scanpanel .note { margin: 6px 0 0; }
  .segment { display: flex; border: 1px solid var(--divider-color); border-radius: 20px; padding: 3px; background: var(--card-background-color, #fff); touch-action: pan-y; }
  .segment button { flex: 1; font: inherit; font-size: 14px; border: 0; border-radius: 16px; padding: 8px 10px; cursor: pointer;
    background: transparent; color: var(--primary-text-color); transition: background .15s; }
  .segment button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  div.note p { margin: 0 0 6px; }
  div.note button { font: inherit; font-size: 14px; border-radius: 18px; padding: 7px 12px; cursor: pointer; margin-top: 2px;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  .hello { font-size: 26px; font-weight: 400; margin: 4px 0 14px; }
  .lead { font-size: 16px; margin: 0 0 12px; }
  .tiles + .lead { margin-top: 22px; }
  .help { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; max-width: 420px; }
  .help button, button.primary { font: inherit; font-size: 15px; padding: 11px 14px; border-radius: 10px; cursor: pointer; text-align: left;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border: 0; text-align: center; }
  button:disabled { opacity: .5; cursor: default; }
  nav { position: sticky; bottom: 0; z-index: 2; display: flex; background: var(--card-background-color, #fff);
    border-top: 1px solid var(--divider-color); padding-bottom: env(safe-area-inset-bottom, 0); }
  nav button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 2px 7px; font: inherit; font-size: 11px;
    background: none; border: 0; color: var(--secondary-text-color); cursor: pointer; min-width: 0; }
  nav button .ico { font-size: 20px; line-height: 1.1; }
  nav button.active { color: var(--primary-color); font-weight: 500; }
  nav button span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recipe { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .recipe h3 { margin: 0; font-size: 16px; font-weight: 500; display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  .recipe h3 .meta { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .recipe .tag { font-size: 11px; color: var(--secondary-text-color); }
  .recipe .body { margin-top: 8px; font-size: 14px; }
  .recipe .body h4 { margin: 10px 0 4px; font-size: 13px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
  .recipe ul, .recipe ol { margin: 0; padding-left: 20px; }
  .recipe .actions { display: flex; gap: 8px; margin-top: 12px; }
  .recipe .actions button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer; background: none;
    color: var(--primary-color); border: 1px solid var(--primary-color); }
  .recipe .actions button.danger { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
  .error { color: var(--error-color, #db4437); font-size: 14px; margin: 8px 0; }
  .overlay { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .5); padding: 16px; }
  .dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; padding: 18px;
    width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
  .dialog h2 { margin: 0; font-size: 18px; text-transform: none; letter-spacing: 0; color: var(--primary-text-color); }
  .dialog label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  .dialog input, .dialog textarea { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; color-scheme: light dark; }
  .dialog textarea { min-height: 96px; resize: vertical; }
  .dialog select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
  .dialog .hint { margin: 0; font-size: 12px; color: var(--secondary-text-color); }
  .dialog a.pdf { align-self: stretch; text-align: center; padding: 12px; border-radius: 10px; font-size: 16px; text-decoration: none;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .dialog label.check { flex-direction: row; align-items: center; gap: 8px; font-size: 14px; color: var(--primary-text-color); }
  .dialog button.link { align-self: flex-start; font: inherit; font-size: 14px; background: none; border: 0; padding: 0;
    color: var(--primary-color); cursor: pointer; }
  .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog .buttons button { font: inherit; padding: 8px 16px; border-radius: 8px; cursor: pointer; background: none; border: 0; color: var(--primary-color); }
  .dialog .buttons button.submit { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  larder-panel-embedded[only] { flex: 1; }
`;

export class LarderDashboard extends HTMLElement {
  /** Titel auf der Startseite (Larder experimental überschreibt ihn). */
  static appTitle = "Larder";

  constructor() {
    super();
    this._hass = null;
    this._view = "start";
    this._detail = null;
    this._filter = { area: null, category: null, state: null };
    this._opts = loadOptions();
    this._recipeDays = SOON_DAYS; // bis die Einstellung geladen ist
    this._sig = "";
    this._recipes = null;
    this._recipesLoading = false;
    this._suggestions = null; // null = nicht angefordert, "busy", Liste oder { error }
    this._savedSuggestions = new Set();
    this._openRecipe = null;
    this._photo = null; // null, "busy" oder { error }
    this._selecting = false; // Auswahlmodus in der Behälter-Ansicht
    this._selected = new Set(); // Geräte-IDs
    this._scan = null; // laufender Serien-Scan
    this._chosenFor = null; // Geräte-IDs, aus denen die aktuellen Vorschläge stammen
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><button id="settings" type="button" hidden>⚙</button></header>
      <div class="menu" hidden><button type="button" data-role="menu-estimates"></button><button type="button" data-role="menu-labels"></button><button type="button" data-role="menu-settings"></button></div>
      <div class="notice" role="alert" hidden></div>
      <main></main>
      <nav></nav>
      <div class="overlay" hidden><form class="dialog" novalidate></form></div>
      <input type="file" id="photo" accept="image/*,application/pdf" multiple hidden>
      <larder-panel-embedded embedded></larder-panel-embedded>`;
    this._header = this.shadowRoot.querySelector("header");
    this._title = this.shadowRoot.querySelector("h1");
    this._main = this.shadowRoot.querySelector("main");
    this._nav = this.shadowRoot.querySelector("nav");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._form = this.shadowRoot.querySelector("form.dialog");
    this._classic = this.shadowRoot.querySelector("larder-panel-embedded");
    this._settingsBtn = this.shadowRoot.querySelector("#settings");
    this._photoInput = this.shadowRoot.querySelector("#photo");
    this._photoInput.addEventListener("change", () => {
      const files = [...(this._photoInput.files || [])];
      this._photoInput.value = "";
      if (files.length) this.readRecipePhotos(files);
    });
    this.shadowRoot.querySelector("#menu").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
    this._menu = this.shadowRoot.querySelector(".menu");
    this._notice = this.shadowRoot.querySelector(".notice");
    this._notice.addEventListener("click", () => (this._notice.hidden = true));
    this._settingsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._menu.hidden = !this._menu.hidden;
    });
    this._menu.querySelector('[data-role="menu-estimates"]').addEventListener("click", () => {
      this._menu.hidden = true;
      this.setView("estimates");
    });
    this._menu.querySelector('[data-role="menu-labels"]').addEventListener("click", () => {
      this._menu.hidden = true;
      this.openLabelDialog();
    });
    this._menu.querySelector('[data-role="menu-settings"]').addEventListener("click", () => {
      this._menu.hidden = true;
      navigate(`/config/integrations/integration/${DOMAIN}`);
    });
    this.shadowRoot.addEventListener("click", (ev) => {
      if (!this._menu.hidden && !this._menu.contains(ev.target)) this._menu.hidden = true;
    });
    // Die eingebettete klassische Ansicht steht zwischen Inhalt und Leiste (für Karten und Schätzungen)
    this._nav.before(this._classic);
    this._classic.addEventListener("larder-detail-closed", () => this._closeDetail());
    this._classic.addEventListener("larder-filled", () => {
      if (this._selecting) this.stopSelecting();
    });
    this._form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (this._submit) this._submit();
    });
    this._overlay.addEventListener("click", (ev) => {
      if (ev.target === this._overlay) this._closeDialog();
    });
  }

  /**
   * Home Assistant legt das Panel-Element beim Neuladen der Seite unter Umständen an, bevor dieses
   * Modul fertig geladen ist (es wartet auf das klassische Dashboard). Dann landen hass, narrow,
   * route und panel als einfache Eigenschaften am noch nicht aufgewerteten Element und verdecken
   * die Setter dieser Klasse; die Seite bliebe leer. Hier werden sie nachträglich übernommen.
   */
  connectedCallback() {
    for (const prop of ["narrow", "route", "panel", "hass"]) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete this[prop];
        this[prop] = value;
      }
    }
    this._update();
  }

  disconnectedCallback() {
    this.stopScan();
    if (this._scanUnsub) {
      try {
        this._scanUnsub();
      } catch {
        /* Verbindung schon weg */
      }
      this._scanUnsub = null;
    }
  }

  get hass() {
    return this._hass;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._classic.hass = hass;
    this._update();
    if (first) {
      this.loadRecipes();
      this.loadSettings();
      this._handleViewParam();
      this._subscribeScans();
    }
  }

  /**
   * Eigener QR-Code gescannt (`?cc=<ID der Dose>`): wie bei NFC die Dose öffnen (eine leere zum Befüllen)
   * und den Scan melden (Ereignis `larder_dose_scanned`); unbekannte Codes führen zum Hinzufügen.
   */
  async _openScanned(cc) {
    const hass = this._hass;
    this.setView("containers");
    let deviceId = null;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/resolve_code`, code: cc });
      deviceId = res && res.device_id;
    } catch {
      deviceId = null;
    }
    if (!deviceId) {
      if (isAdmin(hass)) this._classic.openAddDialog(cc);
      else this.showNotice(texts(hass).adminOnly(cc));
      return;
    }
    hass.callWS({ type: `${DOMAIN}/report_scan`, cc }).catch(() => {});
    const row = this._rows().find((r) => r.id === deviceId);
    if (row) this.openContainer(row);
  }

  /** Kurzer Hinweis unter der Kopfleiste (antippen schließt ihn). */
  showNotice(text) {
    this._notice.textContent = text || "";
    this._notice.hidden = !text;
  }

  /** Gescannter NFC-Tag einer Dose, während das Dashboard offen ist: Dose öffnen (leere zum Befüllen). */
  async _subscribeScans() {
    const hass = this._hass;
    if (this._scanUnsub || !isAdmin(hass) || !hass.connection || !hass.connection.subscribeEvents) return;
    try {
      this._scanUnsub = await hass.connection.subscribeEvents((ev) => {
        const id = ev && ev.data && ev.data.device_id;
        if (!id || this._scan || this._selecting || !this.isConnected) return; // Serien-Scan wählt nur aus
        const row = this._rows().find((r) => r.id === id);
        if (!row) return;
        if (this._view !== "containers") this.setView("containers");
        this.openContainer(row);
      }, `${DOMAIN}_dose_scanned`);
    } catch {
      this._scanUnsub = null;
    }
  }

  /** `?view=recipes` usw. (z. B. Knopf "Rezepte" in der täglichen Benachrichtigung). */
  _handleViewParam() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const open = params.get("open");
    const add = params.get("add");
    const cc = params.get("cc");
    if (!view && !open && !add && !cc && !params.has("recipes")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.has("recipes")) this.setView("recipes");
    else if (view && ALL_VIEWS.includes(view)) this.setView(view);
    if (cc) {
      this._openScanned(cc);
    } else if (open) {
      // Scan (Kurzbefehl, NFC-Benachrichtigung): Dose öffnen, eine leere gleich befüllen
      this.setView("containers");
      const row = this._rows().find((r) => r.id === open);
      if (row) this.openContainer(row);
    } else if (add) {
      // unbekannte Dose gescannt: Dialog "Dose hinzufügen" mit dem Code
      this.setView("containers");
      if (isAdmin(this._hass)) this._classic.openAddDialog(add);
      else this.showNotice(texts(this._hass).adminOnly(add));
    }
  }

  set narrow(value) {
    if (value) this.setAttribute("narrow", "");
    else this.removeAttribute("narrow");
  }

  set route(_value) {}
  set panel(_value) {}

  // ----- Navigation -----

  setView(view, filter = null) {
    if (!ALL_VIEWS.includes(view)) return;
    if (view === "estimates" && !isAdmin(this._hass)) return;
    if (view !== "areas") this._areaEdit = false;
    if (view !== "containers") {
      this.stopScan();
      this._selecting = false;
    }
    this._view = view;
    const { soon, ...rest } = filter || {};
    this._filter = { area: null, category: null, state: soon ? "soon" : null, ...rest };
    this._openRecipe = null;
    if (this._detail) this._closeDetail();
    this._sig = "";
    this._update();
  }

  openDetail(deviceId) {
    this._detail = deviceId;
    this._classic.removeAttribute("show");
    this.toggleAttribute("classic-view", false);
    this._classic.setAttribute("only", deviceId);
    this._sig = "";
    this._update();
  }

  _closeDetail() {
    this._detail = null;
    this._classic.removeAttribute("only");
    this._sig = "";
    this._update();
  }

  /** Antippen einer Dose: leere Dosen gleich befüllen, gefüllte in der Detailansicht öffnen. */
  openContainer(row) {
    if (this._selecting) {
      this.toggleSelected(row.id);
      return;
    }
    if (row.content === "" && isAdmin(this._hass)) this._classic.openFillDialog(row.id);
    else this.openDetail(row.id);
  }

  // ----- Daten -----

  _rows() {
    const hass = this._hass;
    if (!this._devicesCache || ![hass.entities, hass.devices, hass.areas].every((r, i) => r === this._regs[i])) {
      this._regs = [hass.entities, hass.devices, hass.areas];
      this._devicesCache = collectDevices(hass);
    }
    return describeDevices(hass, this._devicesCache);
  }

  _lang() {
    return String((this._hass && this._hass.language) || "en").toLowerCase();
  }

  _canGenerate() {
    const hass = this._hass;
    return !!(isAdmin(hass) && hass.services && hass.services.ai_task && hass.services[DOMAIN] && hass.services[DOMAIN].suggest_recipes);
  }

  // ----- Darstellung -----

  _update() {
    const hass = this._hass;
    if (!hass) return;
    const t = texts(hass);
    const detail = !!this._detail;
    this._header.hidden = detail;
    this._main.hidden = detail;
    this._nav.hidden = detail;
    if (detail) return;

    this._title.textContent =
      this._view === "start" ? this.constructor.appTitle : this._view === "estimates" ? t.estimates : t.views[this._view];
    this._settingsBtn.hidden = !isAdmin(hass);
    this._settingsBtn.setAttribute("aria-label", t.settings);
    this._menu.querySelector('[data-role="menu-estimates"]').textContent = `📋 ${t.menuEstimates}`;
    this._menu.querySelector('[data-role="menu-settings"]').textContent = `⚙ ${t.menuSettings}`;
    this._menu.querySelector('[data-role="menu-labels"]').textContent = `🖨 ${t.menuLabels}`;

    const rows = this._rows();
    const sig = JSON.stringify([
      this._view,
      this._filter,
      this._opts,
      t.title,
      rows.map((r) => [r.id, r.name, r.content, r.days, r.category, r.areaId, r.areaName]),
      hass.user && hass.user.name,
      isAdmin(hass),
      this._canGenerate(),
      this._recipes,
      this._suggestions,
      [...this._savedSuggestions],
      this._openRecipe,
      this._photo,
      this._selecting,
      [...this._selected],
      !!this._scan,
      !!(this._scan && this._scan.external),
      this._scan && this._scan.mode,
      this._chosenFor,
      this._areaEdit,
      this._view === "areas" ? this._areaSig() : null,
    ]);
    if (sig === this._sig) return;
    this._sig = sig;
    this._renderNav(t);
    this._classicShow = null;
    this._classicIds = null;
    switch (this._view) {
      case "containers":
        this._renderContainers(t, rows);
        break;
      case "areas":
        this._renderAreas(t, rows);
        break;
      case "categories":
        this._renderCategories(t, rows);
        break;
      case "recipes":
        this._renderRecipes(t);
        break;
      case "estimates":
        this._main.replaceChildren();
        break;
      default:
        this._renderStart(t, rows);
    }
    if (this._view === "estimates") this._classicShow = "estimates";
    this._syncClassic();
  }

  /** Die eingebettete klassische Ansicht zeigt Karten (alle Details) oder die Schätzungen, sonst nur ihre Dialoge. */
  _syncClassic() {
    const c = this._classic;
    const show = this._detail ? null : this._classicShow;
    if (this._classicIds !== null && show === "cards") {
      if (c.getAttribute("ids") !== this._classicIds) c.setAttribute("ids", this._classicIds);
    } else if (c.hasAttribute("ids")) {
      c.removeAttribute("ids");
    }
    if (show) {
      if (c.getAttribute("show") !== show) c.setAttribute("show", show);
    } else if (c.hasAttribute("show")) {
      c.removeAttribute("show");
    }
    this.toggleAttribute("classic-view", !!show);
  }

  _renderNav(t) {
    const buttons = VIEWS.map((view) => {
      const btn = el("button");
      btn.type = "button";
      btn.dataset.view = view;
      btn.classList.toggle("active", view === this._view);
      btn.append(el("span", "ico", VIEW_ICONS[view]), el("span", "", t.views[view]));
      btn.addEventListener("click", () => this.setView(view));
      return btn;
    });
    this._nav.replaceChildren(...buttons);
  }

  _tile(row, t, { showArea = false } = {}) {
    const empty = row.content === "";
    const tile = el("button", `tile${empty ? " empty" : ""}`);
    tile.type = "button";
    tile.dataset.id = row.id;
    tile.append(el("span", "ico", CATEGORY_ICONS[row.category] || CATEGORY_ICONS.other));
    tile.append(el("span", "name", empty ? t.empty : row.content));
    tile.append(el("span", "sub", showArea && row.areaName ? `${row.name} · ${row.areaName}` : row.name));
    if (!empty && row.days !== null) tile.append(el("span", `badge ${dayClass(row)}`, daysLabel(t, row.days)));
    this._markSelected(tile, row);
    tile.addEventListener("click", () => this.openContainer(row));
    return tile;
  }

  _listRow(row, t) {
    const empty = row.content === "";
    const btn = el("button", `row${empty ? " empty" : ""}`);
    btn.type = "button";
    btn.dataset.id = row.id;
    const text = el("span", "text");
    text.append(el("span", "name", empty ? t.empty : row.content));
    text.append(el("span", "sub", row.areaName ? `${row.name} · ${row.areaName}` : row.name));
    btn.append(el("span", "ico", CATEGORY_ICONS[row.category] || CATEGORY_ICONS.other), text);
    if (!empty && row.days !== null) btn.append(el("span", `badge ${dayClass(row)}`, daysLabel(t, row.days)));
    this._markSelected(btn, row);
    btn.addEventListener("click", () => this.openContainer(row));
    return btn;
  }

  _markSelected(node, row) {
    if (!this._selecting) return;
    const on = this._selected.has(row.id);
    node.classList.toggle("selected", on);
    node.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) node.append(el("span", "check", "✓"));
  }

  // ----- Auswahl (mehrere Dosen befüllen, Rezeptideen aus gewählten Dosen, Serien-Scan) -----

  startSelecting(preselect = []) {
    if (this._view !== "containers") this.setView("containers");
    this._selecting = true;
    for (const id of preselect) this._selected.add(id);
    this._update();
  }

  stopSelecting() {
    this.stopScan();
    this._selecting = false;
    this._selected = new Set();
    this._update();
  }

  toggleSelected(id, on = null) {
    const next = new Set(this._selected);
    if (on === true || (on === null && !next.has(id))) next.add(id);
    else next.delete(id);
    this._selected = next;
    this._update();
  }

  fillSelected() {
    const rows = this._rows().filter((r) => this._selected.has(r.id) && r.content === "");
    if (rows.length) this._classic.openFillDialog(rows.map((r) => r.id));
  }

  /** Rezeptideen aus den gewählten Dosen: zur Rezeptseite wechseln und die KI fragen. */
  recipesFromSelected() {
    const ids = this._rows().filter((r) => this._selected.has(r.id) && r.content !== "").map((r) => r.id);
    if (!ids.length) return;
    this.stopSelecting();
    this.setView("recipes");
    this.generateRecipes(ids);
  }

  /** Serien-Scan: NFC-Scans (Ereignis larder_dose_scanned) und, in der Companion-App, deren QR-Scanner. */
  async startScan() {
    const hass = this._hass;
    if (!hass || this._scan || !isAdmin(hass)) return;
    const scan = { unsub: null, external: null, mode: this._hasQrScanner() ? "qr" : "nfc" };
    this._scan = scan;
    this._update();
    const add = (id) => {
      if (id && this._scan === scan) this.toggleSelected(id, true);
    };
    try {
      if (hass.connection && hass.connection.subscribeMessage) {
        // Eigenes Abo: meldet NFC-Scans und unterdrückt solange die Benachrichtigung aufs Handy
        scan.unsub = await hass.connection.subscribeMessage((data) => add(data && data.device_id), {
          type: `${DOMAIN}/scan_session`,
        });
      } else if (hass.connection && hass.connection.subscribeEvents) {
        scan.unsub = await hass.connection.subscribeEvents((ev) => add(ev && ev.data && ev.data.device_id), `${DOMAIN}_dose_scanned`);
      }
      if (this._scan !== scan && scan.unsub) scan.unsub();
    } catch {
      /* ohne Abo bleibt der QR-Scanner der App */
    }
    if (this._scan === scan && scan.mode === "qr") this.openQrScanner();
  }

  /** Zwischen QR-Code und NFC wechseln: QR öffnet den Scanner der App, NFC schließt ihn (sonst liest das iPhone keine Tags). */
  setScanMode(mode) {
    const scan = this._scan;
    if (!scan || (mode !== "qr" && mode !== "nfc") || scan.mode === mode) return;
    if (mode === "qr" && !this._hasQrScanner()) return;
    scan.mode = mode;
    if (mode === "qr") this.openQrScanner();
    else this._closeQrScanner(scan);
    this._update();
  }

  _closeQrScanner(scan) {
    if (!scan || !scan.external) return;
    const { external, original } = scan.external;
    scan.external = null;
    external.addCommandHandler(original);
    external.fireMessage({ type: "bar_code/close" });
  }

  /** Kann die App einen QR-Scanner öffnen (Home-Assistant-App mit Kamera)? */
  _hasQrScanner() {
    const external = this._hass && this._hass.auth && this._hass.auth.external;
    return !!(external && external.config && external.config.hasBarCodeScanner && typeof external._commandHandler === "function");
  }

  openQrScanner() {
    const scan = this._scan;
    if (scan && !scan.external) this._startExternalScanner(scan);
    this._update();
  }

  /**
   * QR-Scanner der Home-Assistant-App (iOS/Android) öffnen. Er bleibt offen, bis man ihn schließt;
   * jeder Treffer wählt die Dose aus und meldet sich kurz im Scanner. Die Befehle der App laufen
   * über einen einzigen Empfänger des Frontends, der hier nur ergänzt (und danach wiederhergestellt) wird.
   */
  _startExternalScanner(scan) {
    const external = this._hass && this._hass.auth && this._hass.auth.external;
    if (!external || !external.config || !external.config.hasBarCodeScanner || typeof external.addCommandHandler !== "function") return;
    const original = external._commandHandler;
    if (typeof original !== "function") return;
    const t = texts(this._hass);
    const notify = (message) => external.fireMessage({ type: "bar_code/notify", payload: { message } });
    const handler = (msg) => {
      if (this._scan === scan && msg && msg.command === "bar_code/scan_result") {
        this._handleScannedCode(String((msg.payload && msg.payload.rawValue) || ""), notify, t);
      } else if (this._scan === scan && msg && msg.command === "bar_code/aborted") {
        // QR-Scanner geschlossen oder "NFC" im Scanner gewählt: weiter mit NFC, bis "Scan beenden"
        scan.external = null;
        scan.mode = "nfc";
        external.addCommandHandler(original);
        this._update();
      }
      return original(msg);
    };
    external.addCommandHandler(handler);
    scan.external = { external, original };
    external.fireMessage({
      type: "bar_code/scan",
      payload: { title: t.scanTitle, description: t.scanDescription, alternative_option_label: t.scanToNfc },
    });
  }

  async _handleScannedCode(code, notify, t) {
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/resolve_code`, code });
      if (!res || !res.valid) notify(t.scanInvalid);
      else if (!res.device_id) notify(t.scanUnknown);
      else {
        this.toggleSelected(res.device_id, true);
        notify(t.scanAdded(res.name || res.cc, this._selected.size));
      }
    } catch {
      notify(t.scanInvalid);
    }
  }

  /**
   * Einzel-Scan mit dem QR-Scanner der Home-Assistant-App (iOS und Android): eigene Codes und
   * Zwilling-Codes. Bekannte Dose öffnen (eine leere gleich zum Befüllen), unbekannte hinzufügen.
   */
  scanOne() {
    const external = this._hass && this._hass.auth && this._hass.auth.external;
    if (this._scan || this._single || !this._hasQrScanner() || typeof external.addCommandHandler !== "function") return;
    const t = texts(this._hass);
    const original = external._commandHandler;
    const single = { busy: false };
    this._single = single;
    const finish = () => {
      if (this._single !== single) return;
      this._single = null;
      external.addCommandHandler(original);
    };
    const handler = (msg) => {
      if (this._single === single && msg && msg.command === "bar_code/scan_result") {
        const code = String((msg.payload && msg.payload.rawValue) || "");
        if (!single.busy) {
          single.busy = true;
          this._resolveSingle(code).then((ok) => {
            single.busy = false;
            if (this._single !== single) return;
            if (ok) {
              finish();
              external.fireMessage({ type: "bar_code/close" });
            } else {
              // kein Larder-Code: Scanner bleibt offen für den nächsten Versuch
              external.fireMessage({ type: "bar_code/notify", payload: { message: t.scanInvalid } });
            }
          });
        }
      } else if (this._single === single && msg && msg.command === "bar_code/aborted") {
        finish();
      }
      return original(msg);
    };
    external.addCommandHandler(handler);
    external.fireMessage({
      type: "bar_code/scan",
      payload: { title: t.scanOne, description: t.scanOneDescription, alternative_option_label: t.cancel },
    });
  }

  /** Gescannten Code auswerten; false, wenn es kein Larder-Code ist. */
  async _resolveSingle(code) {
    const hass = this._hass;
    let res;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/resolve_code`, code });
    } catch {
      return false;
    }
    if (!res || !res.valid) return false;
    this.setView("containers");
    if (!res.device_id) {
      // unbekannt: hinzufügen, mit dem ganzen Code (Zwilling-Codes enthalten Typ und Größe)
      if (isAdmin(hass)) this._classic.openAddDialog(code.trim());
      else this.showNotice(texts(hass).adminOnly(res.cc));
      return true;
    }
    hass.callWS({ type: `${DOMAIN}/report_scan`, cc: res.cc }).catch(() => {});
    const row = this._rows().find((r) => r.id === res.device_id);
    if (row) this.openContainer(row);
    return true;
  }

  _scanOneButton(t) {
    if (!this._hasQrScanner() || this._scan) return null;
    const btn = el("button", "icon", "📷");
    btn.type = "button";
    btn.dataset.role = "scan-one";
    btn.setAttribute("aria-label", t.scanOne);
    btn.title = t.scanOne;
    btn.addEventListener("click", () => this.scanOne());
    return btn;
  }

  stopScan() {
    const scan = this._scan;
    if (!scan) return;
    this._scan = null;
    if (scan.unsub) {
      try {
        scan.unsub();
      } catch {
        /* Verbindung schon weg */
      }
    }
    this._closeQrScanner(scan);
    this._update();
  }

  /** Umschalter QR-Code / NFC (antippen oder wischen) mit kurzer Anleitung. */
  _scanPanel(t) {
    const scan = this._scan;
    const box = el("div", "scanpanel");
    if (this._hasQrScanner()) {
      const seg = el("div", "segment");
      seg.setAttribute("role", "tablist");
      seg.setAttribute("aria-label", t.scanModeLabel);
      for (const [mode, label] of [["qr", `📷 ${t.scanQr}`], ["nfc", `📶 ${t.scanNfc}`]]) {
        const b = el("button", scan.mode === mode ? "on" : "", label);
        b.type = "button";
        b.dataset.role = `scan-mode-${mode}`;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", scan.mode === mode ? "true" : "false");
        b.addEventListener("click", () => {
          if (scan.mode === mode && mode === "qr" && !scan.external) this.openQrScanner();
          else this.setScanMode(mode);
        });
        seg.append(b);
      }
      let startX = null;
      seg.addEventListener("touchstart", (ev) => (startX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : null), { passive: true });
      seg.addEventListener("touchend", (ev) => {
        const touch = ev.changedTouches && ev.changedTouches[0];
        if (startX === null || !touch) return;
        const dx = touch.clientX - startX;
        startX = null;
        if (Math.abs(dx) > 30) this.setScanMode(dx > 0 ? "nfc" : "qr");
      });
      box.append(seg);
    }
    box.append(el("p", "note", t.scanHint));
    box.append(el("p", "note", scan.mode === "qr" ? t.scanQrHint : t.scanNfcHint));
    return box;
  }

  _selectBar(t, rows) {
    const bar = el("div", "selbar");
    bar.append(el("span", "count", this._selected.size ? t.selected(this._selected.size) : t.selectHint));
    const chosen = rows.filter((r) => this._selected.has(r.id));
    const button = (role, text, onClick, { primary = false, disabled = false } = {}) => {
      const b = el("button", primary ? "primary" : "", text);
      b.type = "button";
      b.dataset.role = role;
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      bar.append(b);
      return b;
    };
    const allIds = rows.map((r) => r.id);
    const allOn = allIds.length && allIds.every((id) => this._selected.has(id));
    button("select-all", allOn ? t.selectNone : t.selectAll, () => {
      this._selected = allOn ? new Set() : new Set(allIds);
      this._update();
    });
    if (isAdmin(this._hass)) {
      const empty = chosen.filter((r) => r.content === "").length;
      button("fill-selected", t.selectFill(empty), () => this.fillSelected(), { disabled: !empty });
    }
    if (this._canGenerate()) {
      const filled = chosen.filter((r) => r.content !== "").length;
      button("recipes-selected", `✨ ${t.selectRecipes}`, () => this.recipesFromSelected(), { disabled: !filled });
    }
    button("labels-selected", `🖨 ${t.selectLabels}`, () => this.openLabelDialog([...this._selected]), { disabled: !chosen.length });
    button("select-done", t.selectDone, () => this.stopSelecting(), { primary: true });
    return bar;
  }

  _select(options, value, onChange, label) {
    const select = el("select");
    select.setAttribute("aria-label", label);
    for (const [key, text] of options) {
      const option = el("option", "", text);
      option.value = key;
      option.selected = key === value;
      select.append(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  _modeButton(t) {
    // Kacheln → Liste → Karten mit allen Details → Kacheln; der Knopf zeigt die nächste Ansicht
    const next = MODES[(MODES.indexOf(this._opts.mode) + 1) % MODES.length];
    const icons = { grid: "▦", list: "☰", cards: "🗂" };
    const labels = { grid: t.viewGrid, list: t.viewList, cards: t.viewCards };
    const btn = el("button", "icon", icons[next]);
    btn.type = "button";
    btn.dataset.role = "mode";
    btn.setAttribute("aria-label", labels[next]);
    btn.title = labels[next];
    btn.addEventListener("click", () => {
      this._opts.mode = next;
      saveOptions(this._opts);
      this._sig = "";
      this._update();
    });
    return btn;
  }

  _addButton(t) {
    if (!isAdmin(this._hass)) return null;
    const btn = el("button", "icon", "＋");
    btn.type = "button";
    btn.dataset.role = "add";
    btn.setAttribute("aria-label", t.add);
    btn.addEventListener("click", () => this._classic.openAddDialog());
    return btn;
  }

  _chips(t, rows) {
    const chips = [];
    const chip = (text, clear) => {
      const node = el("span", "chip");
      node.append(el("span", "", text));
      const btn = el("button", "", "✕");
      btn.type = "button";
      btn.setAttribute("aria-label", t.close);
      btn.addEventListener("click", () => {
        clear();
        this._sig = "";
        this._update();
      });
      node.append(btn);
      chips.push(node);
    };

    if (this._filter.area !== null) {
      const known = rows.find((r) => (r.areaId || "") === this._filter.area);
      chip(t.filterArea(known && known.areaName ? known.areaName : t.noArea), () => (this._filter.area = null));
    }
    if (this._filter.category !== null) {
      chip(t.filterCategory(t.categories[this._filter.category] || this._filter.category), () => (this._filter.category = null));
    }
    if (!chips.length) return null;
    const box = el("div", "chips");
    box.append(...chips);
    return box;
  }

  /** Dosen nach Filtern (Zustand, Bereich, Kategorie, Suche) und Sortierung. */
  _containerRows(allRows) {
    let rows = allRows;
    const state = this._filter.state;
    if (state === "soon") rows = rows.filter(isSoon);
    else if (state === "expired") rows = rows.filter((r) => r.content !== "" && r.days !== null && r.days < 0);
    else if (state === "filled") rows = rows.filter((r) => r.content !== "");
    else if (state === "empty") rows = rows.filter((r) => r.content === "");
    if (this._filter.area !== null) rows = rows.filter((r) => (r.areaId || "") === this._filter.area);
    if (this._filter.category !== null) rows = rows.filter((r) => r.category === this._filter.category);
    const q = (this._query || "").trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.name, r.content, r.areaName || ""].some((v) => v.toLowerCase().includes(q)));
    return sortRows(rows, this._opts.sort, this._lang());
  }

  /** Suchfeld und Zustands-Filter (wie im bisherigen Dashboard). */
  _searchRow(t, allRows) {
    const row = el("div", "bar search");
    if (!this._searchInput) {
      const input = el("input");
      input.type = "search";
      input.dataset.role = "search";
      input.autocomplete = "off";
      input.addEventListener("input", () => {
        this._query = input.value;
        this._refreshResults();
      });
      this._searchInput = input;
    }
    this._searchInput.placeholder = t.search;
    this._searchInput.setAttribute("aria-label", t.search);
    if (this._searchInput.value !== (this._query || "")) this._searchInput.value = this._query || "";
    const state = this._select(
      [["all", t.filterAll], ["soon", t.filterSoon], ["expired", t.filterExpired], ["filled", t.filterFilled], ["empty", t.filterEmpty]],
      this._filter.state || "all",
      (value) => {
        this._filter.state = value === "all" ? null : value;
        this._sig = "";
        this._update();
      },
      t.filterLabel,
    );
    state.dataset.role = "state";
    row.append(this._searchInput, state);
    return row;
  }

  /** Nur die Ergebnisliste neu zeichnen (beim Tippen in die Suche, ohne den Fokus zu verlieren). */
  _refreshResults() {
    if (!this._results || this._view !== "containers") return;
    const t = texts(this._hass);
    const allRows = this._rows();
    const rows = this._containerRows(allRows);
    this._classicShow = null;
    this._classicIds = null;
    this._results.replaceChildren(this._renderResults(t, allRows, rows));
    if (this._countEl) this._countEl.textContent = t.count(rows.length, allRows.length);
    this._syncClassic();
  }

  _renderContainers(t, allRows) {
    const lang = this._lang();
    const rows = this._containerRows(allRows);

    const bar = el("div", "bar");
    bar.append(
      this._select(
        [["date", t.sortDate], ["area", t.sortArea], ["name", t.sortName], ["category", t.sortCategory]],
        this._opts.sort,
        (value) => {
          this._opts.sort = value;
          saveOptions(this._opts);
          this._sig = "";
          this._update();
        },
        t.sort,
      ),
      el("span", "grow"),
    );
    const one = this._scanOneButton(t);
    if (one && !this._selecting) bar.append(one);
    const add = this._addButton(t);
    if (add && !this._selecting) bar.append(add);
    if (this._selecting && isAdmin(this._hass)) {
      const scan = el("button", this._scan ? "on" : "", this._scan ? `⏹ ${t.scanStop}` : `📡 ${t.scanStart}`);
      scan.type = "button";
      scan.dataset.role = "scan";
      scan.addEventListener("click", () => (this._scan ? this.stopScan() : this.startScan()));
      bar.append(scan);
    }
    if (!this._selecting) {
      const select = el("button", "icon", "☑");
      select.type = "button";
      select.dataset.role = "select";
      select.setAttribute("aria-label", t.selectStart);
      select.title = t.selectStart;
      select.addEventListener("click", () => this.startSelecting());
      bar.append(select, this._modeButton(t));
    }

    const frag = document.createDocumentFragment();
    frag.append(bar);
    if (this._scan) frag.append(this._scanPanel(t));
    const chips = this._chips(t, allRows);
    if (chips) frag.append(chips);

    frag.append(this._searchRow(t, allRows));
    this._countEl = el("p", "count", t.count(rows.length, allRows.length));
    frag.append(this._countEl);
    this._results = el("div", "results");
    this._results.append(this._renderResults(t, allRows, rows));
    frag.append(this._results);
    if (this._selecting) frag.append(this._selectBar(t, rows));
    this._main.replaceChildren(frag);
  }

  _renderResults(t, allRows, rows) {
    const frag = document.createDocumentFragment();
    if (!allRows.length) {
      frag.append(el("p", "note", t.noneYet));
    } else if (!rows.length) {
      frag.append(el("p", "note", t.noMatch));
    } else {
      const mode = this._selecting && this._opts.mode === "cards" ? "grid" : this._opts.mode;
      const grouped = this._opts.sort === "area" || this._opts.sort === "category";
      const container = (items) => {
        const box = el("div", mode === "grid" ? "tiles" : "list");
        for (const row of items) box.append(mode === "grid" ? this._tile(row, t) : this._listRow(row, t));
        return box;
      };
      if (mode === "cards") {
        // alle Details: die Karten der klassischen Ansicht, in dieser Sortierung und mit diesen Filtern
        this._classicShow = "cards";
        this._classicIds = rows.map((r) => r.id).join(",");
      } else if (!grouped) {
        frag.append(container(rows));
      } else {
        const keyOf = (r) => (this._opts.sort === "area" ? r.areaName || t.noArea : t.categories[r.category] || r.category);
        let current;
        let group = [];
        const flush = () => {
          if (group.length) frag.append(container(group));
          group = [];
        };
        for (const row of rows) {
          const key = keyOf(row);
          if (key !== current) {
            flush();
            current = key;
            frag.append(el("h2", "", key));
          }
          group.push(row);
        }
        flush();
      }
    }
    return frag;
  }

  _groupTile(icon, name, sub, badge, onClick) {
    const tile = el("button", "tile");
    tile.type = "button";
    tile.append(el("span", "ico", icon), el("span", "name", name), el("span", "sub", sub));
    if (badge) tile.append(el("span", "badge soon", badge));
    tile.addEventListener("click", onClick);
    return tile;
  }

  /** IDs der Larder-Labels, sobald die eingebettete Ansicht sie geladen hat (sonst null). */
  _larderLabelIds() {
    const ids = this._classic && this._classic.larderLabel;
    return Array.isArray(ids) && ids.length ? ids : null;
  }

  _areaSig() {
    const areas = Object.values((this._hass && this._hass.areas) || {}).map((a) => [a.area_id, a.name, a.labels || []]);
    return [areas, this._larderLabelIds(), this._labelNames || null];
  }

  _renderAreas(t, rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = row.areaId || "";
      const g = groups.get(key) || { key, name: row.areaName || t.noArea, count: 0, soon: 0 };
      g.count += 1;
      if (isSoon(row)) g.soon += 1;
      groups.set(key, g);
    }
    // Lagerorte ohne Dosen zeigen: mit Larder-Label, beim Bearbeiten alle Bereiche von Home Assistant
    const labelIds = this._larderLabelIds();
    const admin = isAdmin(this._hass);
    const editing = admin && this._areaEdit;
    for (const area of Object.values(this._hass.areas || {})) {
      const tagged = labelIds && (area.labels || []).some((l) => labelIds.includes(l));
      if ((editing || tagged) && !groups.has(area.area_id)) {
        groups.set(area.area_id, { key: area.area_id, name: area.name, count: 0, soon: 0 });
      }
    }
    if (editing) groups.delete("");
    const lang = this._lang();
    const list = [...groups.values()];
    const byName = (a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" });
    if (this._opts.areaSort === "count") list.sort((a, b) => b.count - a.count || byName(a, b));
    else if (this._opts.areaSort === "soon") list.sort((a, b) => b.soon - a.soon || byName(a, b));
    else list.sort((a, b) => (a.key === "") - (b.key === "") || byName(a, b));

    const bar = el("div", "bar");
    bar.append(
      this._select(
        [["name", t.sortName], ["count", t.sortCount], ["soon", t.sortSoon]],
        this._opts.areaSort,
        (value) => {
          this._opts.areaSort = value;
          saveOptions(this._opts);
          this._sig = "";
          this._update();
        },
        t.sort,
      ),
      el("span", "grow"),
    );
    if (editing) {
      const done = el("button", "on", `✓ ${t.areaEditDone}`);
      done.type = "button";
      done.dataset.role = "area-edit";
      done.addEventListener("click", () => this.setAreaEdit(false));
      bar.append(done);
    } else {
      const one = this._scanOneButton(t);
      if (one) bar.append(one);
    }
    if (admin) {
      const add = el("button", "icon", "＋");
      add.type = "button";
      add.dataset.role = "area-add";
      add.setAttribute("aria-label", t.areaAdd);
      add.title = t.areaAdd;
      add.addEventListener("click", () => this.openAreaDialog());
      bar.append(add);
      if (!editing) {
        const edit = el("button", "icon", "✏️");
        edit.type = "button";
        edit.dataset.role = "area-edit";
        edit.setAttribute("aria-label", t.areaEdit);
        edit.title = t.areaEdit;
        edit.addEventListener("click", () => this.setAreaEdit(true));
        bar.append(edit);
      }
    }
    bar.append(this._modeButton(t));
    const frag = document.createDocumentFragment();
    frag.append(bar);
    if (editing) frag.append(el("p", "note", t.areaEditHint));
    if (!list.length) {
      frag.append(el("p", "note", t.noneYet));
    } else {
      const box = el("div", this._opts.mode === "grid" ? "tiles" : "list");
      for (const g of list) {
        const open = editing ? () => this.openAreaDialog(g.key) : () => this.setView("containers", { area: g.key });
        const sub = editing ? this._areaKindText(g.key, t) : t.containersCount(g.count);
        if (this._opts.mode === "grid") {
          const tile = this._groupTile(editing ? "✏️" : "📍", g.name, sub, !editing && g.soon ? t.soonCount(g.soon) : "", open);
          tile.dataset.area = g.key;
          box.append(tile);
        } else {
          const btn = el("button", "row");
          btn.type = "button";
          btn.dataset.area = g.key;
          const text = el("span", "text");
          text.append(el("span", "name", g.name), el("span", "sub", sub));
          btn.append(el("span", "ico", editing ? "✏️" : "📍"), text);
          if (g.soon && !editing) btn.append(el("span", "badge soon", t.soonCount(g.soon)));
          btn.addEventListener("click", open);
          box.append(btn);
        }
      }
      frag.append(box);
    }
    this._main.replaceChildren(frag);
  }

  // ----- Bereiche verwalten -----

  setAreaEdit(on) {
    this._areaEdit = !!on && isAdmin(this._hass);
    if (this._areaEdit) this._loadLabels();
    this._update();
  }

  /** Alle Labels von Home Assistant laden (für Lagerart und Anzeige beim Bearbeiten). */
  async _loadLabels() {
    const hass = this._hass;
    try {
      const labels = await hass.callWS({ type: "config/label_registry/list" });
      this._labels = Array.isArray(labels) ? labels : [];
    } catch {
      this._labels = [];
    }
    this._labelNames = this._labels.filter(isLarderLabel).map((l) => [l.label_id, l.name]);
    this._update();
    return this._labels;
  }

  /** "Larder: Freezer" → "Freezer"; das schlichte "Larder" bleibt. */
  _kindName(label) {
    const name = String((label && label.name) || "").trim();
    const short = name.replace(/^larder\s*:\s*/i, "");
    return short || name;
  }

  _areaKindText(areaId, t) {
    const area = (this._hass.areas || {})[areaId];
    const larder = (this._labels || []).filter(isLarderLabel);
    const kinds = larder.filter((l) => area && (area.labels || []).includes(l.label_id)).map((l) => this._kindName(l));
    return kinds.length ? kinds.join(", ") : t.areaKindNone;
  }

  /** Bereich anlegen (ohne ID) oder bearbeiten: Name und Lagerart (Larder-Label). */
  async openAreaDialog(areaId = null) {
    const hass = this._hass;
    if (!isAdmin(hass)) return;
    const t = texts(hass);
    const area = areaId ? (hass.areas || {})[areaId] : null;
    const labels = this._labels || (await this._loadLabels());
    const larder = labels.filter(isLarderLabel);
    const form = this._form;
    this._editing = null;
    const field = (label, control) => {
      const wrap = el("label", "", label);
      wrap.append(control);
      return wrap;
    };
    const name = el("input");
    name.type = "text";
    name.maxLength = 100;
    name.dataset.f = "name";
    name.value = area ? area.name : "";
    const kind = el("select");
    kind.dataset.f = "kind";
    const option = (value, text) => {
      const o = el("option", "", text);
      o.value = value;
      return o;
    };
    kind.append(option("", t.areaKindNone), ...larder.map((l) => option(l.label_id, this._kindName(l))), option("__new", t.areaKindNew));
    const current = area ? larder.find((l) => (area.labels || []).includes(l.label_id)) : null;
    // neuer Bereich: gibt es Larder-Labels, gleich das erste vorschlagen (sonst taucht er in den Listen nicht auf)
    kind.value = current ? current.label_id : !area && larder.length ? larder[0].label_id : "";
    const newName = el("input");
    newName.type = "text";
    newName.maxLength = 60;
    newName.dataset.f = "newkind";
    newName.placeholder = t.areaKindNewName;
    const newWrap = field(t.areaKindNewName, newName);
    newWrap.dataset.w = "newkind";
    newWrap.hidden = true;
    kind.addEventListener("change", () => (newWrap.hidden = kind.value !== "__new"));
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const buttons = el("div", "buttons");
    let link = null;
    if (area) {
      const ha = el("button", "link", `${t.areaOpenHa} ›`);
      ha.type = "button";
      ha.dataset.role = "area-open-ha";
      ha.addEventListener("click", () => {
        this._closeDialog();
        window.history.pushState(null, "", `/config/areas/area/${area.area_id}`);
        window.dispatchEvent(new Event("location-changed"));
      });
      link = ha;
    }
    const cancel = el("button", "cancel", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => this._closeDialog());
    const submit = el("button", "submit", t.save);
    submit.type = "submit";
    buttons.append(cancel, submit);
    form.replaceChildren(
      el("h2", "", area ? t.areaEditTitle : t.areaAdd),
      field(t.areaName, name),
      field(t.areaKind, kind),
      newWrap,
      el("p", "hint", t.areaKindHint),
      ...(link ? [link] : []),
      error,
      buttons,
    );
    this._submit = () => this._submitArea(area, larder);
    this._overlay.hidden = false;
    name.focus();
  }

  async _submitArea(area, larder) {
    const hass = this._hass;
    const t = texts(hass);
    const form = this._form;
    const error = form.querySelector(".error");
    const name = form.querySelector('[data-f="name"]').value.trim();
    const kind = form.querySelector('[data-f="kind"]').value;
    if (!name) {
      error.textContent = t.areaNeedName;
      return;
    }
    const submit = form.querySelector("button.submit");
    submit.disabled = true;
    try {
      let labelId = kind;
      if (kind === "__new") {
        const kindName = form.querySelector('[data-f="newkind"]').value.trim();
        if (!kindName) {
          error.textContent = t.areaNeedName;
          return;
        }
        const created = await hass.callWS({ type: "config/label_registry/create", name: `Larder: ${kindName}`, icon: "mdi:fridge-outline" });
        labelId = created.label_id;
      }
      // fremde Labels bleiben, nur die Larder-Labels werden ersetzt
      const larderIds = larder.map((l) => l.label_id);
      const labels = [...((area && area.labels) || []).filter((l) => !larderIds.includes(l)), ...(labelId ? [labelId] : [])];
      if (area) {
        await hass.callWS({ type: "config/area_registry/update", area_id: area.area_id, name, labels });
      } else {
        await hass.callWS({ type: "config/area_registry/create", name, labels });
      }
      this._closeDialog();
      this._labels = null;
      await this._loadLabels();
      if (this._classic.loadAreaLabel) await this._classic.loadAreaLabel();
    } catch (err) {
      error.textContent = t.areaSaveFailed((err && err.message) || String(err));
    } finally {
      submit.disabled = false;
    }
    this._sig = "";
    this._update();
  }

  _renderCategories(t, rows) {
    const groups = new Map();
    for (const row of rows) {
      const g = groups.get(row.category) || { key: row.category, count: 0, soon: 0 };
      g.count += 1;
      if (isSoon(row)) g.soon += 1;
      groups.set(row.category, g);
    }
    const order = Object.keys(CATEGORY_ICONS);
    const list = [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const bar = el("div", "bar");
    bar.append(el("span", "grow"));
    const one = this._scanOneButton(t);
    if (one) bar.append(one);
    const add = this._addButton(t);
    if (add) bar.append(add);
    bar.append(this._modeButton(t));
    const frag = document.createDocumentFragment();
    frag.append(bar);
    if (!list.length) {
      frag.append(el("p", "note", t.noneYet));
    } else {
      const box = el("div", this._opts.mode === "grid" ? "tiles" : "list");
      for (const g of list) {
        const name = t.categories[g.key] || g.key;
        const icon = CATEGORY_ICONS[g.key] || CATEGORY_ICONS.other;
        const open = () => this.setView("containers", { category: g.key });
        if (this._opts.mode === "grid") {
          box.append(this._groupTile(icon, name, t.containersCount(g.count), g.soon ? t.soonCount(g.soon) : "", open));
        } else {
          const btn = el("button", "row");
          btn.type = "button";
          const text = el("span", "text");
          text.append(el("span", "name", name), el("span", "sub", t.containersCount(g.count)));
          btn.append(el("span", "ico", icon), text);
          if (g.soon) btn.append(el("span", "badge soon", t.soonCount(g.soon)));
          btn.addEventListener("click", open);
          box.append(btn);
        }
      }
      frag.append(box);
    }
    this._main.replaceChildren(frag);
  }

  _renderStart(t, rows) {
    const hass = this._hass;
    const frag = document.createDocumentFragment();
    frag.append(el("div", "hello", t.hello(hass.user && hass.user.name)));
    const soon = sortRows(rows.filter(isSoon), "date", this._lang());
    if (soon.length) {
      frag.append(el("p", "lead", t.soonTitle));
      const box = el("div", "tiles");
      for (const row of soon) box.append(this._tile(row, t, { showArea: true }));
      frag.append(box);
    } else {
      frag.append(el("p", "lead", t.soonNone(rows.length ? rows[0].soon : SOON_DAYS)));
    }
    frag.append(el("p", "lead", t.help));
    const help = el("div", "help");
    if (this._canGenerate()) {
      const recipes = el("button", "", t.helpRecipes);
      recipes.type = "button";
      recipes.dataset.role = "recipes";
      recipes.addEventListener("click", () => {
        this.setView("recipes");
        this.generateRecipes();
      });
      help.append(recipes);
    }
    const show = el("button", "", t.helpContainers);
    show.type = "button";
    show.dataset.role = "containers";
    show.addEventListener("click", () => this.setView("containers", { soon: soon.length > 0 }));
    help.append(show);
    if (this._hasQrScanner()) {
      const scan = el("button", "", `📷 ${t.scanOne}`);
      scan.type = "button";
      scan.dataset.role = "scan-one";
      scan.addEventListener("click", () => this.scanOne());
      help.append(scan);
    }
    frag.append(help);
    this._main.replaceChildren(frag);
  }

  // ----- Rezepte -----

  async loadRecipes() {
    const hass = this._hass;
    if (!hass || !hass.callWS || this._recipesLoading) return;
    this._recipesLoading = true;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/recipes` });
      this._recipes = Array.isArray(res && res.recipes) ? res.recipes : [];
    } catch {
      this._recipes = this._recipes || [];
    } finally {
      this._recipesLoading = false;
      this._update();
    }
  }

  /** Einstellungen der Integration lesen (Standard-Zeitraum für Rezeptideen). */
  async loadSettings() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/settings` });
      const days = Number(res && res.recipe_days);
      if (Number.isInteger(days) && days >= 0 && days !== this._recipeDays) {
        this._recipeDays = days;
        this._sig = "";
        this._update();
      }
    } catch {
      /* ältere Version der Integration: Standard bleibt */
    }
  }

  async generateRecipes(containers = null) {
    const hass = this._hass;
    if (!hass || !hass.callWS || this._suggestions === "busy") return;
    const period = this._opts.recipePeriod;
    this._chosenFor = containers && containers.length ? [...containers] : null;
    this._suggestions = "busy";
    this._savedSuggestions = new Set();
    this._update();
    try {
      const res = await hass.callWS({
        type: "call_service",
        domain: DOMAIN,
        service: "suggest_recipes",
        service_data: {
          ...(this._chosenFor ? { containers: this._chosenFor } : recipeServiceData(period)),
          ...(this._opts.recipeServings > 0 ? { servings: this._opts.recipeServings } : {}),
        },
        return_response: true,
      });
      const out = (res && res.response) || {};
      this._suggestions = Array.isArray(out.recipes) ? out.recipes : [];
      if (!this._suggestions.length) {
        const used = this._chosenFor ? "chosen" : period === "all" ? null : Number.isInteger(out.days) ? out.days : period === "default" ? this._recipeDays : Number(period);
        this._suggestions = { none: true, days: used };
      }
    } catch (err) {
      this._suggestions = { error: (err && err.message) || true };
    }
    this._update();
  }

  /** Fotos (oder ein PDF) hochladen, die KI liest das Rezept; der Entwurf öffnet sich zum Prüfen. */
  async readRecipePhotos(files) {
    const hass = this._hass;
    if (!hass || !hass.fetchWithAuth || this._photo === "busy") return;
    const t = texts(hass);
    if (files.length > PHOTO_MAX_FILES) {
      this._photo = { error: t.photoTooMany(PHOTO_MAX_FILES) };
      this._update();
      return;
    }
    this._photo = "busy";
    this._update();
    try {
      const form = new FormData();
      for (const file of await Promise.all(files.map(preparePhoto))) form.append("file", file, file.name || "recipe");
      const res = await hass.fetchWithAuth(`/api/${DOMAIN}/recipe_photo`, { method: "POST", body: form });
      let body = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      if (!res.ok || !body.recipe) throw new Error(body.message || t.photoFailed);
      this._photo = null;
      this._update();
      this.openRecipeDialog({ ...body.recipe, source: "photo" });
    } catch (err) {
      this._photo = { error: (err && err.message) || t.photoFailed };
      this._update();
    }
  }

  async _saveRecipe(payload) {
    const res = await this._hass.callWS({ type: `${DOMAIN}/recipe_save`, ...payload });
    const recipe = res && res.recipe;
    if (recipe) {
      const others = (this._recipes || []).filter((r) => r.id !== recipe.id);
      this._recipes = payload.recipe_id
        ? (this._recipes || []).map((r) => (r.id === recipe.id ? recipe : r))
        : [recipe, ...others];
    }
    return recipe;
  }

  async saveSuggestion(index) {
    const recipe = this._suggestions[index];
    if (!recipe || this._savedSuggestions.has(index)) return;
    this._savedSuggestions.add(index);
    this._update();
    try {
      await this._saveRecipe({
        title: recipe.title,
        ingredients: [...(recipe.uses || []), ...(recipe.extra_ingredients || [])],
        steps: recipe.steps || [],
        minutes: recipe.minutes || undefined,
        source: "ai",
      });
    } catch {
      this._savedSuggestions.delete(index);
    }
    this._sig = "";
    this._update();
  }

  async deleteRecipe(recipe) {
    const t = texts(this._hass);
    if (!window.confirm(t.confirmDelete(recipe.title))) return;
    try {
      await this._hass.callWS({ type: `${DOMAIN}/recipe_delete`, recipe_id: recipe.id });
      this._recipes = (this._recipes || []).filter((r) => r.id !== recipe.id);
      if (this._openRecipe === recipe.id) this._openRecipe = null;
    } catch {
      /* wurde schon gelöscht: Liste neu laden */
      this.loadRecipes();
    }
    this._sig = "";
    this._update();
  }

  _recipeNode(recipe, t, { suggestion = null } = {}) {
    const node = el("article", "recipe");
    node.dataset.id = recipe.id || "";
    const h = el("h3", "", recipe.title);
    if (recipe.minutes) h.append(el("span", "meta", t.minutes(recipe.minutes)));
    node.append(h);
    const ingredients = suggestion !== null ? [...(recipe.uses || []), ...(recipe.extra_ingredients || [])] : recipe.ingredients || [];
    const steps = recipe.steps || [];
    const expanded = suggestion !== null || this._openRecipe === recipe.id;
    if (suggestion === null && recipe.source === "ai") node.append(el("div", "tag", t.fromAi));
    if (suggestion === null && recipe.source === "photo") node.append(el("div", "tag", t.fromPhoto));
    if (suggestion === null) {
      h.addEventListener("click", () => {
        this._openRecipe = this._openRecipe === recipe.id ? null : recipe.id;
        this._sig = "";
        this._update();
      });
    }
    if (expanded) {
      const body = el("div", "body");
      if (ingredients.length) {
        body.append(el("h4", "", t.ingredients));
        const ul = el("ul");
        for (const item of ingredients) ul.append(el("li", "", item));
        body.append(ul);
      }
      if (steps.length) {
        body.append(el("h4", "", t.steps));
        const ol = el("ol");
        for (const step of steps) ol.append(el("li", "", step));
        body.append(ol);
      }
      node.append(body);
    }
    if (isAdmin(this._hass) && (suggestion !== null || expanded)) {
      const actions = el("div", "actions");
      if (suggestion !== null) {
        const done = this._savedSuggestions.has(suggestion);
        const save = el("button", "", done ? t.saved : t.save);
        save.type = "button";
        save.dataset.role = "save-suggestion";
        save.disabled = done;
        save.addEventListener("click", () => this.saveSuggestion(suggestion));
        actions.append(save);
      } else {
        const edit = el("button", "", t.edit);
        edit.type = "button";
        edit.dataset.role = "edit";
        edit.addEventListener("click", () => this.openRecipeDialog(recipe));
        const del = el("button", "danger", t.delete);
        del.type = "button";
        del.dataset.role = "delete";
        del.addEventListener("click", () => this.deleteRecipe(recipe));
        actions.append(edit, del);
      }
      node.append(actions);
    }
    return node;
  }

  _renderRecipes(t) {
    const frag = document.createDocumentFragment();
    const bar = el("div", "bar");
    bar.append(
      this._select(
        [["newest", t.sortNewest], ["name", t.sortName]],
        this._opts.recipeSort,
        (value) => {
          this._opts.recipeSort = value;
          saveOptions(this._opts);
          this._sig = "";
          this._update();
        },
        t.sort,
      ),
      el("span", "grow"),
    );
    if (this._canGenerate()) {
      const pick = el("button", "icon", "☑");
      pick.type = "button";
      pick.dataset.role = "pick";
      pick.setAttribute("aria-label", t.recipesPick);
      pick.title = t.recipesPick;
      pick.addEventListener("click", () => this.startSelecting());
      bar.append(pick);
    }
    if (this._canGenerate() && this._hass.fetchWithAuth) {
      const photo = el("button", "icon", "📷");
      photo.type = "button";
      photo.dataset.role = "photo";
      photo.setAttribute("aria-label", t.photoRead);
      photo.title = t.photoRead;
      photo.disabled = this._photo === "busy";
      photo.addEventListener("click", () => this._photoInput.click());
      bar.append(photo);
    }
    if (isAdmin(this._hass)) {
      const add = el("button", "icon", "＋");
      add.type = "button";
      add.dataset.role = "add-recipe";
      add.setAttribute("aria-label", t.recipeNew);
      add.addEventListener("click", () => this.openRecipeDialog());
      bar.append(add);
    }
    frag.append(bar);
    const ai = el("div", "bar ai");
    if (this._canGenerate()) {
      const period = this._select(
        RECIPE_PERIODS.map((key) => [
          key,
          key === "default" ? t.periodDefault(this._recipeDays) : key === "all" ? t.periodAll : t.periodDays(Number(key)),
        ]),
        this._opts.recipePeriod,
        (value) => {
          this._opts.recipePeriod = value;
          saveOptions(this._opts);
        },
        t.period,
      );
      period.dataset.role = "period";
      const servings = this._select(
        [["0", t.servingsDefault], ...[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => [String(n), t.servingsN(n)])],
        String(this._opts.recipeServings || 0),
        (value) => {
          this._opts.recipeServings = Number(value);
          saveOptions(this._opts);
        },
        t.servings,
      );
      servings.dataset.role = "servings";
      ai.append(period, servings);
      const gen = el("button", "", `✨ ${t.recipesGenerate}`);
      gen.type = "button";
      gen.dataset.role = "generate";
      gen.disabled = this._suggestions === "busy";
      gen.addEventListener("click", () => this.generateRecipes());
      ai.append(gen);
    }
    if (ai.childElementCount) frag.append(ai);

    if (this._photo === "busy") frag.append(el("p", "note", t.photoBusy));
    else if (this._photo && this._photo.error) {
      frag.append(el("p", "error", typeof this._photo.error === "string" ? this._photo.error : t.photoFailed));
    }
    const s = this._suggestions;
    if (s === "busy") {
      frag.append(el("p", "note", t.recipesBusy));
    } else if (s && s.error) {
      frag.append(el("p", "error", typeof s.error === "string" ? s.error : t.recipesFailed));
    } else if (s && s.none) {
      frag.append(el("p", "note", s.days === "chosen" ? t.recipesNoneChosen : s.days === null ? t.recipesNoneAll : t.recipesNone(s.days)));
    } else if (Array.isArray(s) && s.length) {
      frag.append(el("h2", "", this._chosenFor ? t.suggestionsChosen(this._chosenFor.length) : t.suggestions));
      s.forEach((recipe, i) => frag.append(this._recipeNode(recipe, t, { suggestion: i })));
      frag.append(el("h2", "", t.views.recipes));
    }

    const lang = this._lang();
    let list = [...(this._recipes || [])];
    if (this._opts.recipeSort === "name") list.sort((a, b) => a.title.localeCompare(b.title, lang, { sensitivity: "base" }));
    if (!list.length) frag.append(el("p", "note", t.recipesEmpty));
    for (const recipe of list) frag.append(this._recipeNode(recipe, t));
    this._main.replaceChildren(frag);
  }

  openRecipeDialog(recipe = null) {
    const t = texts(this._hass);
    this._editing = recipe;
    this._submit = () => this._submitRecipe();
    const form = this._form;
    const field = (label, control) => {
      const wrap = el("label", "", label);
      wrap.append(control);
      return wrap;
    };
    const title = el("input");
    title.type = "text";
    title.maxLength = 120;
    title.dataset.f = "title";
    title.value = recipe ? recipe.title : "";
    const minutes = el("input");
    minutes.type = "number";
    minutes.min = "1";
    minutes.max = "1440";
    minutes.inputMode = "numeric";
    minutes.dataset.f = "minutes";
    minutes.value = recipe && recipe.minutes ? String(recipe.minutes) : "";
    const ingredients = el("textarea");
    ingredients.dataset.f = "ingredients";
    ingredients.value = recipe ? (recipe.ingredients || []).join("\n") : "";
    const steps = el("textarea");
    steps.dataset.f = "steps";
    steps.value = recipe ? (recipe.steps || []).join("\n") : "";
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const buttons = el("div", "buttons");
    const cancel = el("button", "cancel", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => this._closeDialog());
    const submit = el("button", "submit", t.save);
    submit.type = "submit";
    buttons.append(cancel, submit);
    form.replaceChildren(
      el("h2", "", recipe && recipe.id ? t.recipeEdit : recipe && recipe.source === "photo" ? t.photoCheck : t.recipeNew),
      field(t.recipeTitle, title),
      field(t.recipeMinutes, minutes),
      field(t.recipeIngredients, ingredients),
      field(t.recipeSteps, steps),
      error,
      buttons,
    );
    this._overlay.hidden = false;
    title.focus();
  }

  // ----- QR-Etiketten -----

  /** Dialog für den Etikettenbogen; ohne IDs für alle Dosen. */
  openLabelDialog(deviceIds = null) {
    const hass = this._hass;
    const t = texts(hass);
    const form = this._form;
    this._editing = null;
    const field = (label, control) => {
      const wrap = el("label", "", label);
      wrap.append(control);
      return wrap;
    };
    const check = (label, name) => {
      const wrap = el("label", "check");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.f = name;
      wrap.append(box, el("span", "", label));
      return wrap;
    };
    const layout = el("select");
    layout.dataset.f = "layout";
    for (const [key, info] of Object.entries(LABEL_LAYOUTS)) {
      const o = el("option", "", `${key.replace("x", " × ")} (${info.size})`);
      o.value = key;
      layout.append(o);
    }
    layout.value = this._opts.labelLayout;
    const skip = el("input");
    skip.type = "number";
    skip.min = "0";
    skip.inputMode = "numeric";
    skip.dataset.f = "skip";
    skip.value = "0";
    const syncMax = () => (skip.max = String(LABEL_LAYOUTS[layout.value].per - 1));
    syncMax();
    layout.addEventListener("change", syncMax);
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const buttons = el("div", "buttons");
    const cancel = el("button", "cancel", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => this._closeDialog());
    const submit = el("button", "submit", t.labelsCreate);
    submit.type = "submit";
    buttons.append(cancel, submit);
    form.replaceChildren(
      el("h2", "", t.labelsTitle),
      el("p", "hint", t.labelsFor(deviceIds ? deviceIds.length : null)),
      field(t.labelsLayout, layout),
      field(t.labelsSkip, skip),
      check(t.labelsContent, "content"),
      check(t.labelsBorder, "border"),
      el("p", "hint", t.labelsHint),
      error,
      buttons,
    );
    // geänderte Optionen: alten Link verwerfen
    for (const control of form.querySelectorAll("[data-f]")) {
      control.addEventListener("change", () => {
        const link = form.querySelector("a.pdf");
        if (link) link.remove();
        submit.textContent = t.labelsCreate;
      });
    }
    this._submit = () => this._openLabels(deviceIds);
    this._overlay.hidden = false;
  }

  /** URL des PDFs (signiert, damit sie sich ohne Anmeldung im Browser der App öffnen lässt). */
  async labelUrl(deviceIds, { layout, skip, content, border }) {
    const params = new URLSearchParams();
    if (deviceIds && deviceIds.length) params.set("device", deviceIds.join(","));
    params.set("layout", layout);
    params.set("skip", String(skip));
    if (content) params.set("content", "1");
    if (border) params.set("border", "1");
    const path = `/api/${DOMAIN}/labels.pdf?${params}`;
    const signed = await this._hass.callWS({ type: "auth/sign_path", path, expires: 300 });
    return this._hass.hassUrl ? this._hass.hassUrl(signed.path) : signed.path;
  }

  /**
   * Link zum PDF erzeugen und im Dialog zeigen. Antippen öffnet es (ein echter Link funktioniert auch
   * in der App und ohne Pop-up-Sperre; in der App öffnet es sich im Browser zum Teilen und Drucken).
   */
  async _openLabels(deviceIds) {
    const t = texts(this._hass);
    const form = this._form;
    const value = (name) => form.querySelector(`[data-f="${name}"]`);
    const layout = value("layout").value;
    const per = LABEL_LAYOUTS[layout].per;
    const skip = Math.min(Math.max(parseInt(value("skip").value, 10) || 0, 0), per - 1);
    this._opts.labelLayout = layout;
    saveOptions(this._opts);
    const error = form.querySelector(".error");
    error.textContent = "";
    let url;
    try {
      url = await this.labelUrl(deviceIds, { layout, skip, content: value("content").checked, border: value("border").checked });
    } catch {
      error.textContent = t.labelsFailed;
      return;
    }
    let link = form.querySelector("a.pdf");
    if (!link) {
      link = el("a", "pdf", `📄 ${t.labelsOpen}`);
      link.target = "_blank";
      link.rel = "noopener";
      link.addEventListener("click", () => setTimeout(() => this._closeDialog(), 0));
      form.querySelector(".buttons").before(link);
    }
    link.href = url;
    form.querySelector("button.submit").textContent = t.labelsUpdate;
  }

  _closeDialog() {
    this._overlay.hidden = true;
    this._editing = null;
  }

  async _submitRecipe() {
    const t = texts(this._hass);
    const form = this._form;
    const value = (name) => form.querySelector(`[data-f="${name}"]`).value;
    const error = form.querySelector(".error");
    const title = value("title").trim();
    if (!title) {
      error.textContent = t.recipeNeedTitle;
      return;
    }
    const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
    const minutes = parseInt(value("minutes"), 10);
    const payload = { title, ingredients: lines(value("ingredients")), steps: lines(value("steps")) };
    if (minutes > 0) payload.minutes = Math.min(minutes, 1440);
    if (this._editing && this._editing.id) payload.recipe_id = this._editing.id;
    else if (this._editing && this._editing.source === "photo") payload.source = "photo";
    form.querySelector("button.submit").disabled = true;
    try {
      await this._saveRecipe(payload);
      this._closeDialog();
    } catch {
      error.textContent = t.recipeSaveFailed;
    } finally {
      form.querySelector("button.submit").disabled = false;
    }
    this._sig = "";
    this._update();
  }
}

if (!customElements.get("larder-dashboard")) {
  customElements.define("larder-dashboard", LarderDashboard);
}
