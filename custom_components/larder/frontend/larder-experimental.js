/**
 * Larder experimental: zweite, kachelbasierte Oberfläche (Start, Behälter, Bereiche, Kategorien, Rezepte).
 *
 * Sie nutzt dieselben Entitäten wie das normale Larder-Dashboard und bettet dessen Komponente
 * <larder-panel-embedded embedded> für Dialoge (Hinzufügen, Befüllen, NFC) und die Detailansicht einer Dose ein.
 * Eingeschaltet wird sie in den Einstellungen der Integration.
 */
// Mit derselben Versionsangabe laden wie dieses Modul, damit nie eine ältere Kopie aus dem Cache benutzt wird.
const { collectDevices, daysUntil, soonDaysOf, SOON_DAYS } = await import(`./larder-panel.js${new URL(import.meta.url).search}`);

const DOMAIN = "larder";
const STORAGE_KEY = `${DOMAIN}.experimental`;

export const TEXTS = {
  de: {
    title: "Larder experimental",
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
    empty: "Leer",
    noArea: "Ohne Bereich",
    noneYet: "Noch keine Behälter. Füge den ersten über „Hinzufügen“ hinzu.",
    noMatch: "Keine passenden Behälter.",
    filterArea: (name) => `Bereich: ${name}`,
    filterCategory: (name) => `Kategorie: ${name}`,
    filterSoon: "Läuft bald ab",
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
  },
  en: {
    title: "Larder experimental",
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
    empty: "Empty",
    noArea: "No area",
    noneYet: "No containers yet. Add the first one with “Add”.",
    noMatch: "No matching containers.",
    filterArea: (name) => `Area: ${name}`,
    filterCategory: (name) => `Category: ${name}`,
    filterSoon: "Expiring soon",
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
  other: "📦",
  empty: "🫙",
};

const VIEWS = ["start", "containers", "recipes", "areas", "categories"];
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

function loadOptions() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      mode: raw.mode === "list" ? "list" : "grid",
      sort: ["date", "area", "name", "category"].includes(raw.sort) ? raw.sort : "date",
      areaSort: ["name", "count", "soon"].includes(raw.areaSort) ? raw.areaSort : "name",
      recipeSort: ["newest", "name"].includes(raw.recipeSort) ? raw.recipeSort : "newest",
      recipePeriod: RECIPE_PERIODS.includes(raw.recipePeriod) ? raw.recipePeriod : "default",
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
  :host { display: flex; flex-direction: column; min-height: 100%; background: var(--primary-background-color);
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
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
  .bar .grow { flex: 1; }
  .bar.ai select { flex: 1; min-width: 0; }
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
  .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog .buttons button { font: inherit; padding: 8px 16px; border-radius: 8px; cursor: pointer; background: none; border: 0; color: var(--primary-color); }
  .dialog .buttons button.submit { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  larder-panel-embedded[only] { flex: 1; }
`;

class LarderExperimental extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._view = "start";
    this._detail = null;
    this._filter = { area: null, category: null, soon: false };
    this._opts = loadOptions();
    this._recipeDays = SOON_DAYS; // bis die Einstellung geladen ist
    this._sig = "";
    this._recipes = null;
    this._recipesLoading = false;
    this._suggestions = null; // null = nicht angefordert, "busy", Liste oder { error }
    this._savedSuggestions = new Set();
    this._openRecipe = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><button id="settings" type="button" hidden>⚙</button></header>
      <main></main>
      <nav></nav>
      <div class="overlay" hidden><form class="dialog" novalidate></form></div>
      <larder-panel-embedded embedded></larder-panel-embedded>`;
    this._header = this.shadowRoot.querySelector("header");
    this._title = this.shadowRoot.querySelector("h1");
    this._main = this.shadowRoot.querySelector("main");
    this._nav = this.shadowRoot.querySelector("nav");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._form = this.shadowRoot.querySelector("form.dialog");
    this._classic = this.shadowRoot.querySelector("larder-panel-embedded");
    this._settingsBtn = this.shadowRoot.querySelector("#settings");
    this.shadowRoot.querySelector("#menu").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
    this._settingsBtn.addEventListener("click", () => navigate(`/config/integrations/integration/${DOMAIN}`));
    this._classic.addEventListener("larder-detail-closed", () => this._closeDetail());
    this._form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this._submitRecipe();
    });
    this._overlay.addEventListener("click", (ev) => {
      if (ev.target === this._overlay) this._closeDialog();
    });
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
    if (!VIEWS.includes(view)) return;
    this._view = view;
    this._filter = { area: null, category: null, soon: false, ...(filter || {}) };
    this._openRecipe = null;
    if (this._detail) this._closeDetail();
    this._sig = "";
    this._update();
  }

  openDetail(deviceId) {
    this._detail = deviceId;
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

    this._title.textContent = this._view === "start" ? t.title : t.views[this._view];
    this._settingsBtn.hidden = !isAdmin(hass);
    this._settingsBtn.setAttribute("aria-label", t.settings);

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
    ]);
    if (sig === this._sig) return;
    this._sig = sig;
    this._renderNav(t);
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
      default:
        this._renderStart(t, rows);
    }
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
    btn.addEventListener("click", () => this.openContainer(row));
    return btn;
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
    const btn = el("button", "icon", this._opts.mode === "grid" ? "☰" : "▦");
    btn.type = "button";
    btn.dataset.role = "mode";
    btn.setAttribute("aria-label", this._opts.mode === "grid" ? t.viewList : t.viewGrid);
    btn.addEventListener("click", () => {
      this._opts.mode = this._opts.mode === "grid" ? "list" : "grid";
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
    if (this._filter.soon) chip(t.filterSoon, () => (this._filter.soon = false));
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

  _renderContainers(t, allRows) {
    const lang = this._lang();
    let rows = allRows;
    if (this._filter.soon) rows = rows.filter(isSoon);
    if (this._filter.area !== null) rows = rows.filter((r) => (r.areaId || "") === this._filter.area);
    if (this._filter.category !== null) rows = rows.filter((r) => r.category === this._filter.category);
    rows = sortRows(rows, this._opts.sort, lang);

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
    const add = this._addButton(t);
    if (add) bar.append(add);
    bar.append(this._modeButton(t));

    const frag = document.createDocumentFragment();
    frag.append(bar);
    const chips = this._chips(t, allRows);
    if (chips) frag.append(chips);

    if (!allRows.length) {
      frag.append(el("p", "note", t.noneYet));
    } else if (!rows.length) {
      frag.append(el("p", "note", t.noMatch));
    } else {
      const grouped = this._opts.sort === "area" || this._opts.sort === "category";
      const container = (items) => {
        const box = el("div", this._opts.mode === "grid" ? "tiles" : "list");
        for (const row of items) box.append(this._opts.mode === "grid" ? this._tile(row, t) : this._listRow(row, t));
        return box;
      };
      if (!grouped) {
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
    this._main.replaceChildren(frag);
  }

  _groupTile(icon, name, sub, badge, onClick) {
    const tile = el("button", "tile");
    tile.type = "button";
    tile.append(el("span", "ico", icon), el("span", "name", name), el("span", "sub", sub));
    if (badge) tile.append(el("span", "badge soon", badge));
    tile.addEventListener("click", onClick);
    return tile;
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
        const open = () => this.setView("containers", { area: g.key });
        if (this._opts.mode === "grid") {
          box.append(this._groupTile("📍", g.name, t.containersCount(g.count), g.soon ? t.soonCount(g.soon) : "", open));
        } else {
          const btn = el("button", "row");
          btn.type = "button";
          const text = el("span", "text");
          text.append(el("span", "name", g.name), el("span", "sub", t.containersCount(g.count)));
          btn.append(el("span", "ico", "📍"), text);
          if (g.soon) btn.append(el("span", "badge soon", t.soonCount(g.soon)));
          btn.addEventListener("click", open);
          box.append(btn);
        }
      }
      frag.append(box);
    }
    this._main.replaceChildren(frag);
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

  async generateRecipes() {
    const hass = this._hass;
    if (!hass || !hass.callWS || this._suggestions === "busy") return;
    const period = this._opts.recipePeriod;
    this._suggestions = "busy";
    this._savedSuggestions = new Set();
    this._update();
    try {
      const res = await hass.callWS({
        type: "call_service",
        domain: DOMAIN,
        service: "suggest_recipes",
        service_data: recipeServiceData(period),
        return_response: true,
      });
      const out = (res && res.response) || {};
      this._suggestions = Array.isArray(out.recipes) ? out.recipes : [];
      if (!this._suggestions.length) {
        const used = period === "all" ? null : Number.isInteger(out.days) ? out.days : period === "default" ? this._recipeDays : Number(period);
        this._suggestions = { none: true, days: used };
      }
    } catch (err) {
      this._suggestions = { error: (err && err.message) || true };
    }
    this._update();
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
      ai.append(period);
      const gen = el("button", "", `✨ ${t.recipesGenerate}`);
      gen.type = "button";
      gen.dataset.role = "generate";
      gen.disabled = this._suggestions === "busy";
      gen.addEventListener("click", () => this.generateRecipes());
      ai.append(gen);
    }
    if (ai.childElementCount) frag.append(ai);

    const s = this._suggestions;
    if (s === "busy") {
      frag.append(el("p", "note", t.recipesBusy));
    } else if (s && s.error) {
      frag.append(el("p", "error", typeof s.error === "string" ? s.error : t.recipesFailed));
    } else if (s && s.none) {
      frag.append(el("p", "note", s.days === null ? t.recipesNoneAll : t.recipesNone(s.days)));
    } else if (Array.isArray(s) && s.length) {
      frag.append(el("h2", "", t.suggestions));
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
      el("h2", "", recipe ? t.recipeEdit : t.recipeNew),
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
    if (this._editing) payload.recipe_id = this._editing.id;
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

if (!customElements.get("larder-experimental")) {
  customElements.define("larder-experimental", LarderExperimental);
}
