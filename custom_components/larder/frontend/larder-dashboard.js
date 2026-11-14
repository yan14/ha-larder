/**
 * Larder-Dashboard (seit 2.0): kachelbasierte Oberfläche mit Start, Behältern, Bereichen, Kategorien und
 * Rezepten, unten eine Leiste zum Wechseln.
 *
 * Für Dialoge (Hinzufügen, Befüllen, NFC), die Karten mit allen Details und die Schätzungen bettet sie die
 * Komponente <larder-panel-embedded embedded> aus larder-panel.js ein (die frühere Oberfläche).
 */
// Mit derselben Versionsangabe laden wie dieses Modul, damit nie eine ältere Kopie aus dem Cache benutzt wird.
const VERSION_QUERY = new URL(import.meta.url).search;
const { attachCompartmentChips, collectDevices, daysUntil, isLarderLabel, knownCompartments, listAreas, rememberCompartment, soonDaysOf, SOON_DAYS } = await import(
  `./larder-panel.js${VERSION_QUERY}`
);
const { installItems } = await import(`./larder-dashboard-items.js${VERSION_QUERY}`);

const DOMAIN = "larder";
const STORAGE_KEY = `${DOMAIN}.experimental`; // historischer Name, bleibt, damit gespeicherte Ansichten erhalten bleiben

const { TEXTS } = await import(`./larder-dashboard-strings.js${VERSION_QUERY}`);
export { TEXTS };

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
const ALL_VIEWS = [...VIEWS, "estimates", "stats", "stock"]; // "estimates" und "stats" erreicht man über ☰/⚙
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
    const comp = states[dev.entities.compartment];
    const compartment = isValid(comp) ? comp.state.trim() : "";
    const attrs = (content && text.attributes) || {};
    const kind = (text && text.attributes && text.attributes.kind) || "container"; // Dose, Beutel (bag) oder Packung (pack)
    const kcal = attrs.kcal_portion !== undefined ? { value: attrs.kcal_portion, per: "portion" } : attrs.kcal_100g !== undefined ? { value: attrs.kcal_100g, per: "100g" } : null;
    return { dev, id: dev.deviceId, name: dev.name, content, days, soon: soonDaysOf(date), category, areaId: dev.areaId, areaName: dev.areaName, compartment, kcal, nutriScore: attrs.nutri_score || null, allergens: Array.isArray(attrs.allergen_warning) ? attrs.allergen_warning : [], kind };
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
  else if (sort === "area" || sort === "place") out.sort((a, b) => cmp(a.areaName || "￿", b.areaName || "￿") || cmp(a.compartment || "", b.compartment || "") || byDate(a, b));
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
const LABEL_LAYOUTS = {
  "3x8": { per: 24, size: "70 × 36 mm" },
  "3x7": { per: 21, size: "70 × 42,3 mm" },
  "2x4": { per: 8, size: "105 × 74 mm" },
  // Etikettendrucker: eine Seite pro Etikett
  "62x29": { per: 1, size: "Brother DK-11209", printer: true },
  "54x25": { per: 1, size: "Dymo 11352", printer: true },
  "89x36": { per: 1, size: "Dymo 99012", printer: true },
};
const LABEL_DESIGNS = ["plain", "frame", "notched", "handwritten"];

function loadOptions() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      mode: MODES.includes(raw.mode) ? raw.mode : "grid",
      sort: ["date", "area", "place", "name", "category"].includes(raw.sort) ? raw.sort : "date",
      areaSort: ["name", "count", "soon"].includes(raw.areaSort) ? raw.areaSort : "name",
      recipeSort: ["newest", "name"].includes(raw.recipeSort) ? raw.recipeSort : "newest",
      recipePeriod: RECIPE_PERIODS.includes(raw.recipePeriod) ? raw.recipePeriod : "default",
      recipeServings: Number.isInteger(raw.recipeServings) && raw.recipeServings >= 0 && raw.recipeServings <= 12 ? raw.recipeServings : 0,
      labelLayout: LABEL_LAYOUTS[raw.labelLayout] ? raw.labelLayout : "3x8",
      labelDesign: raw.labelDesign === "vintage" ? "handwritten" : LABEL_DESIGNS.includes(raw.labelDesign) ? raw.labelDesign : "plain",
      labelParts: raw.labelParts && typeof raw.labelParts === "object" ? raw.labelParts : { qr: true, name: true, content: false },
      itemArea: raw.itemArea && typeof raw.itemArea === "object" ? raw.itemArea : {},
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

const { STYLE } = await import(`./larder-dashboard-style.js${VERSION_QUERY}`);

export class LarderDashboard extends HTMLElement {
  /** Titel auf der Startseite. */
  static appTitle = "Larder";

  constructor() {
    super();
    this._hass = null;
    this._view = "start";
    this._detail = null;
    this._filter = { area: null, category: null, state: null, problem: null };
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
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><button id="settings" type="button" hidden>⋮</button></header>
      <div class="menu" hidden><button type="button" data-role="menu-stats"></button><button type="button" data-role="menu-stock"></button><button type="button" data-role="menu-labels"></button><button type="button" data-role="menu-data"></button><button type="button" data-role="menu-estimates"></button><button type="button" data-role="menu-settings"></button></div>
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
    this._menu.querySelector('[data-role="menu-stats"]').addEventListener("click", () => {
      this._menu.hidden = true;
      this.setView("stats");
    });
    this._menu.querySelector('[data-role="menu-stock"]').addEventListener("click", () => {
      this._menu.hidden = true;
      this.setView("stock");
    });
    this._menu.querySelector('[data-role="menu-data"]').addEventListener("click", () => {
      this._menu.hidden = true;
      this.openDataDialog();
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
    this._classic.addEventListener("larder-filled", (ev) => {
      if (this._selecting) this.stopSelecting();
      // Etikett gleich nach dem Befüllen (z. B. für Gefrierbeutel): ein Tipp öffnet den Etiketten-Dialog
      const ids = (ev.detail && ev.detail.deviceIds) || [];
      const t = texts(this._hass);
      if (ids.length) this.showNotice(t.filledNotice(ids.length), { label: t.labelNow, run: () => this.openLabelDialog(ids) });
    });
    this._classic.addEventListener("larder-transfer", (ev) => this.openTransferDialog(ev.detail.deviceId));
    this._classic.addEventListener("larder-move", (ev) => this.openMoveDialog(ev.detail.deviceId));
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
      this.loadPlans();
      this.loadBought();
      this.loadCookAgain();
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
      if (res && res.retired) {
        this.showNotice(res.retired); // Etikett eines schon geleerten Beutels
        return;
      }
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
  showNotice(text, action = null) {
    this._notice.textContent = text || "";
    this._notice.hidden = !text;
    if (text && action) {
      // z. B. "🖨 Etikett" direkt nach dem Befüllen
      const btn = el("button", "", action.label);
      btn.type = "button";
      btn.dataset.role = "notice-action";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._notice.hidden = true;
        action.run();
      });
      this._notice.append(" ", btn);
    }
  }

  /** Gescannter NFC-Tag einer Dose, während das Dashboard offen ist: Dose öffnen (leere zum Befüllen). */
  async _subscribeScans() {
    const hass = this._hass;
    if (this._scanUnsub || !isAdmin(hass) || !hass.connection || !hass.connection.subscribeEvents) return;
    try {
      this._scanUnsub = await hass.connection.subscribeEvents((ev) => {
        const id = ev && ev.data && ev.data.device_id;
        if (ev && ev.data && ev.data.retired && this.isConnected) {
          this.showNotice(ev.data.message); // NFC-Sticker eines schon geleerten Beutels
          return;
        }
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
    const problem = params.get("problem");
    if (!view && !open && !add && !cc && !problem && !params.has("recipes")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.has("recipes")) this.setView("recipes");
    else if (problem && ["noarea", "nodate", "longexpired"].includes(problem)) this.setView("containers", { problem });
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
    if (view === "stats") this.loadStats();
    if (view === "stock") this.loadStock();
    if (view === "start" || view === "recipes") this.loadPlans();
    if (view === "start") {
      this.loadBought();
      this.loadCookAgain();
    }
    if (view === "stats") this.loadReport();
    const { soon, ...rest } = filter || {};
    this._filter = { area: null, category: null, state: soon ? "soon" : null, problem: null, ...rest };
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
    if (this._detail && !this._rows().some((r) => r.id === this._detail)) {
      // geleerter Beutel oder leere Packung: das Gerät gibt es nicht mehr
      this._detail = null;
      this._classic.removeAttribute("only");
    }
    const detail = !!this._detail;
    this._header.hidden = detail;
    this._main.hidden = detail;
    this._nav.hidden = detail;
    if (detail) return;

    this._title.textContent =
      this._view === "start"
        ? this.constructor.appTitle
        : this._view === "estimates"
          ? t.estimates
          : this._view === "stats"
            ? t.menuStats
            : this._view === "stock"
              ? this.stockTitle()
              : t.views[this._view];
    // ⋮: Statistik und Etiketten für alle, Export, Schätzungen und Einstellungen nur für Administratoren
    const admin = isAdmin(hass);
    this._settingsBtn.hidden = false;
    this._settingsBtn.setAttribute("aria-label", t.moreActions);
    this._settingsBtn.title = t.moreActions;
    for (const role of ["menu-data", "menu-estimates", "menu-settings"]) {
      this._menu.querySelector(`[data-role="${role}"]`).hidden = !admin;
    }
    this._menu.querySelector('[data-role="menu-estimates"]').textContent = `📋 ${t.menuEstimates}`;
    this._menu.querySelector('[data-role="menu-settings"]').textContent = `⚙ ${t.menuSettings}`;
    this._menu.querySelector('[data-role="menu-labels"]').textContent = `🖨 ${t.menuLabels}`;
    this._menu.querySelector('[data-role="menu-data"]').textContent = `📦 ${t.menuData}`;
    this._menu.querySelector('[data-role="menu-stats"]').textContent = `📊 ${t.menuStats}`;
    this._menu.querySelector('[data-role="menu-stock"]').textContent = `🥫 ${this.stockTitle()}`;

    const rows = this._rows();
    const sig = JSON.stringify([
      this._view,
      this._filter,
      this._opts,
      t.title,
      rows.map((r) => [r.id, r.name, r.content, r.days, r.category, r.areaId, r.areaName, r.compartment, r.kcal, r.allergens, r.kind]),
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
      this._inventory,
      !!(this._scan && this._scan.external),
      this._scan && this._scan.mode,
      this._chosenFor,
      this._areaEdit,
      this._plans,
      this._bought,
      this._again,
      this._view === "stats" ? this._report : null,
      this._view === "stats" ? [this._stats, this._statsDays] : null,
      this._view === "stock" ? this._stock : null,
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
      case "stats":
        this._renderStats(t);
        break;
      case "stock":
        this._renderStock();
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
    if (row.kind !== "container") tile.append(el("span", "kindmark", row.kind === "bag" ? "🛍" : "📦"));
    tile.append(el("span", "name", empty ? t.empty : row.content));
    tile.append(el("span", "sub", [row.name, showArea ? row.areaName : null, row.compartment].filter(Boolean).join(" · ")));
    if (!empty && row.days !== null) tile.append(el("span", `badge ${dayClass(row)}`, daysLabel(t, row.days)));
    if (!empty && row.kcal) tile.append(el("span", "kcal", t.kcal(row.kcal, this._lang())));
    if (!empty && row.allergens.length) tile.append(el("span", "allergen", `⚠ ${row.allergens.join(", ")}`));
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
    text.append(el("span", "sub", [row.name, row.areaName, row.compartment, !empty && row.kcal ? t.kcal(row.kcal, this._lang()) : null, !empty && row.allergens.length ? `⚠ ${row.allergens.join(", ")}` : null].filter(Boolean).join(" · ")));
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
    this.stopScan(false);
    this._inventory = null;
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
    const scan = { unsub: null, external: null, mode: this._hasQrScanner() ? "qr" : "nfc", scanned: new Set() };
    this._scan = scan;
    this._inventory = null;
    this._update();
    const add = (id) => {
      if (id && this._scan === scan) {
        scan.scanned.add(id);
        this.toggleSelected(id, true);
      }
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
      else if (res.retired) notify(res.retired);
      else if (!res.device_id) notify(t.scanUnknown);
      else {
        if (this._scan && this._scan.scanned) this._scan.scanned.add(res.device_id);
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
    // Strichcode gekaufter Ware (EAN, 8–14 Ziffern): Packung im Vorrat suchen statt "Dose hinzufügen".
    // Eine EAN sieht für Larder auch wie eine gültige Dosen-ID aus, daher zählt nur eine bekannte Dose.
    const ean = /^\d{8,14}$/.test(String(code).trim());
    if (ean && !(res && (res.device_id || res.retired))) {
      await this.takeByCode(String(code).trim());
      return true;
    }
    if (!res || !res.valid) return false;
    this.setView("containers");
    if (res.retired) {
      this.showNotice(res.retired); // Etikett eines schon geleerten Beutels
      return true;
    }
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

  stopScan(inventory = true) {
    const scan = this._scan;
    if (!scan) return;
    this._scan = null;
    // Inventur: welche gefüllten Dosen wurden nicht gescannt (schon gegessen, aber nicht geleert?)
    if (inventory && scan.scanned && scan.scanned.size) {
      const missing = this._rows().filter((r) => r.content !== "" && !scan.scanned.has(r.id));
      this._inventory = { scanned: scan.scanned.size, missing: missing.map((r) => r.id) };
    }
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

  _inventoryPanel(t) {
    const inv = this._inventory;
    const box = el("div", "scanpanel inventory");
    const byId = new Map(this._rows().map((r) => [r.id, r]));
    const missing = inv.missing.map((id) => byId.get(id)).filter((r) => r && r.content !== "");
    box.append(el("p", "lead", t.inventoryTitle(inv.scanned)));
    if (!missing.length) {
      box.append(el("p", "note", t.inventoryAll));
    } else {
      box.append(el("p", "note", t.inventoryMissing(missing.length)));
      const list = el("ul", "missing");
      for (const r of missing) list.append(el("li", "", `${r.content} (${r.name})`));
      box.append(list);
      const pick = el("button", "", t.inventorySelect);
      pick.type = "button";
      pick.dataset.role = "inventory-select";
      pick.addEventListener("click", () => {
        this._selected = new Set(missing.map((r) => r.id));
        this._update();
      });
      box.append(pick);
    }
    const close = el("button", "", t.inventoryClose);
    close.type = "button";
    close.dataset.role = "inventory-close";
    close.addEventListener("click", () => {
      this._inventory = null;
      this._update();
    });
    box.append(close);
    return box;
  }

  /** Gewählte gefüllte Dosen leeren; vorher fragen, ob gegessen oder weggeworfen. */
  openEmptyDialog(ids) {
    const t = texts(this._hass);
    const form = this._form;
    this._editing = null;
    const byId = new Map(this._rows().map((r) => [r.id, r]));
    const rows = ids.map((id) => byId.get(id)).filter((r) => r && r.content !== "");
    if (!rows.length) return;
    const buttons = el("div", "buttons outcome");
    const choose = (outcome, text, role, primary = false) => {
      const b = el("button", primary ? "submit" : "", text);
      b.type = "button";
      b.dataset.role = role;
      b.addEventListener("click", () => this._emptyMany(rows.map((r) => r.id), outcome));
      buttons.append(b);
    };
    const cancel = el("button", "cancel", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => this._closeDialog());
    buttons.append(cancel);
    choose("thrown", t.thrown, "empty-thrown");
    choose("eaten", t.eaten, "empty-eaten", true);
    const list = el("ul", "missing");
    for (const r of rows) list.append(el("li", "", `${r.content} (${r.name})`));
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    form.replaceChildren(el("h2", "", t.emptyTitle(rows.length)), el("p", "hint", t.emptyQuestion), list, error, buttons);
    this._submit = null;
    this._overlay.hidden = false;
  }

  async _emptyMany(ids, outcome) {
    const t = texts(this._hass);
    let failed = 0;
    for (const id of ids) {
      try {
        await this._hass.callWS({ type: `${DOMAIN}/empty`, device_id: id, outcome });
      } catch {
        failed += 1;
      }
    }
    if (failed) {
      this._form.querySelector(".error").textContent = t.emptyFailed(failed);
      return;
    }
    this._closeDialog();
    this._selected = new Set();
    if (this._inventory) this._inventory = { ...this._inventory, missing: this._inventory.missing.filter((id) => !ids.includes(id)) };
    this._update();
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
    if (isAdmin(this._hass)) {
      const filled = chosen.filter((r) => r.content !== "").length;
      button("empty-selected", `🗑 ${t.selectEmpty(filled)}`, () => this.openEmptyDialog([...this._selected]), { disabled: !filled });
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

  /** "＋": Dose, Beutel oder Packung (Dosen nur für Administratoren, siehe larder-dashboard-items.js). */
  _addButton(t) {
    const btn = el("button", "icon", "＋");
    btn.type = "button";
    btn.dataset.role = "add";
    btn.setAttribute("aria-label", t.add);
    btn.addEventListener("click", () => this.openAddMenu());
    return btn;
  }

  _saveOptions() {
    saveOptions(this._opts);
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
    if (this._filter.problem) {
      chip(t.problems[this._filter.problem] || this._filter.problem, () => (this._filter.problem = null));
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
    else if (state === "bags") rows = rows.filter((r) => r.kind === "bag");
    else if (state === "packs") rows = rows.filter((r) => r.kind === "pack");
    if (this._filter.area !== null) rows = rows.filter((r) => (r.areaId || "") === this._filter.area);
    if (this._filter.category !== null) rows = rows.filter((r) => r.category === this._filter.category);
    // aus den Reparaturhinweisen (Link "Mehr erfahren")
    const problem = this._filter.problem;
    if (problem === "noarea") rows = rows.filter((r) => !r.areaId);
    else if (problem === "nodate") rows = rows.filter((r) => r.content !== "" && r.days === null);
    else if (problem === "longexpired") rows = rows.filter((r) => r.content !== "" && r.days !== null && r.days <= -7);
    const q = (this._query || "").trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.name, r.content, r.areaName || "", r.compartment || ""].some((v) => v.toLowerCase().includes(q)));
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
      [["all", t.filterAll], ["soon", t.filterSoon], ["expired", t.filterExpired], ["filled", t.filterFilled], ["empty", t.filterEmpty], ["bags", t.filterBags], ["packs", t.filterPacks]],
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
        [["date", t.sortDate], ["area", t.sortArea], ["place", t.sortPlace], ["name", t.sortName], ["category", t.sortCategory]],
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
    if (this._inventory && this._selecting) frag.append(this._inventoryPanel(t));
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
      const grouped = ["area", "place", "category"].includes(this._opts.sort);
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
        const keyOf = (r) =>
          this._opts.sort === "area"
            ? r.areaName || t.noArea
            : this._opts.sort === "place"
              ? [r.areaName || t.noArea, r.compartment].filter(Boolean).join(" · ")
              : t.categories[r.category] || r.category;
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
    const bought = this._boughtBox();
    if (bought) frag.append(bought);
    const again = this._againBox();
    if (again) frag.append(again);
    const thaw = this._thawBox(t);
    if (thaw) frag.append(thaw);
    const planned = this._plannedBox(t, false);
    if (planned) frag.append(planned);
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
    if (suggestion !== null || expanded) {
      const actions = el("div", "actions");
      const plan = el("button", "", `📅 ${t.plan}`);
      plan.type = "button";
      plan.dataset.role = "plan";
      plan.addEventListener("click", () => this.openPlanDialog(recipe, suggestion !== null));
      actions.append(plan);
      if (!isAdmin(this._hass)) {
        node.append(actions);
        return node;
      }
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
    const planned = this._plannedBox(t, true);
    if (planned) frag.append(planned);
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

  // ----- Wochenplan -----

  async loadPlans() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/plan_list` });
      this._plans = { plans: (res && res.plans) || [], thaw: (res && res.thaw) || [] };
    } catch {
      this._plans = null;
    }
    this._update();
  }

  _thawBox(t) {
    const thaw = (this._plans && this._plans.thaw) || [];
    if (!thaw.length) return null;
    const box = el("section", "stat thaw");
    box.append(el("h3", "", t.thawTitle));
    const list = el("ul", "missing");
    for (const item of thaw) list.append(el("li", "", t.thawItem(item)));
    const done = el("button", "", `✓ ${t.thawDone}`);
    done.type = "button";
    done.dataset.role = "thawed";
    done.addEventListener("click", async () => {
      try {
        await this._hass.callWS({ type: `${DOMAIN}/thawed`, device_ids: thaw.map((i) => i.device_id).filter(Boolean) });
      } catch {
        /* bleibt stehen */
      }
      this.loadPlans();
    });
    box.append(list, done);
    return box;
  }

  /** Geplante Gerichte; auf der Startseite die nächsten sieben Tage, auf der Rezeptseite alle mit Löschen. */
  _plannedBox(t, withDelete) {
    let plans = (this._plans && this._plans.plans) || [];
    if (!withDelete) {
      const limit = new Date();
      limit.setDate(limit.getDate() + 7);
      plans = plans.filter((p) => new Date(`${p.date}T00:00:00`) <= limit);
    }
    if (!plans.length) return null;
    const box = el("section", "stat planned");
    box.append(el("h3", "", t.planned));
    const list = el("ul", "plans");
    const lang = this._lang();
    for (const plan of plans) {
      const li = el("li");
      li.dataset.plan = plan.id;
      const used = plan.containers.map((c) => `${c.content || c.name}${c.frozen && !c.thawed ? " 🧊" : ""}`).join(", ");
      li.append(el("span", "day", t.planDay(plan.date, lang)), el("span", "title", plan.title));
      if (used) li.append(el("span", "used", used));
      const actions = el("span", "planactions");
      const cooked = el("button", "act", `✓ ${t.planCooked}`);
      cooked.type = "button";
      cooked.dataset.role = "plan-cooked";
      cooked.addEventListener("click", async () => {
        try {
          const res = await this._hass.callWS({ type: `${DOMAIN}/plan_cooked`, plan_id: plan.id });
          this.showNotice(t.planCookedDone(res || {}));
        } catch {
          this.showNotice(t.planFailed);
        }
        this.loadPlans();
      });
      actions.append(cooked);
      if (plan.missing && plan.missing.length) {
        const shop = el("button", "act", `🛒 ${t.planShopping(plan.missing.length)}`);
        shop.type = "button";
        shop.dataset.role = "plan-shopping";
        shop.title = plan.missing.join(", ");
        shop.addEventListener("click", async () => {
          try {
            const res = await this._hass.callWS({ type: `${DOMAIN}/plan_shopping`, plan_id: plan.id });
            this.showNotice(t.planShoppingDone(res.added));
          } catch (err) {
            this.showNotice(err && err.code === "no_shopping_list" ? t.planNoList : t.planFailed);
          }
        });
        actions.append(shop);
      }
      li.append(actions);
      if (withDelete) {
        const del = el("button", "", "✕");
        del.type = "button";
        del.dataset.role = "plan-delete";
        del.setAttribute("aria-label", t.planDelete);
        del.title = t.planDelete;
        del.addEventListener("click", async () => {
          try {
            await this._hass.callWS({ type: `${DOMAIN}/plan_delete`, plan_id: plan.id });
          } catch {
            /* schon weg */
          }
          this.loadPlans();
        });
        li.append(del);
      }
      list.append(li);
    }
    box.append(list);
    return box;
  }

  /** Dialog: Gericht für einen Tag einplanen, mit den Dosen, die dafür gebraucht werden. */
  openPlanDialog(recipe, suggestion = false) {
    const t = texts(this._hass);
    const form = this._form;
    this._editing = null;
    const field = (label, control) => {
      const wrap = el("label", "", label);
      wrap.append(control);
      return wrap;
    };
    const title = el("input");
    title.type = "text";
    title.maxLength = 120;
    title.dataset.f = "title";
    title.value = (recipe && recipe.title) || "";
    const day = el("input");
    day.type = "date";
    day.dataset.f = "date";
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    day.value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    // gefüllte Dosen; vorausgewählt, was im Rezept vorkommt (bei Vorschlägen die "uses")
    const words = ((recipe && (suggestion ? recipe.uses : recipe.ingredients)) || []).map((w) => String(w).toLowerCase());
    const filled = sortRows(this._rows().filter((r) => r.content !== ""), "name", this._lang());
    const boxes = el("div", "checks");
    boxes.dataset.role = "plan-containers";
    for (const row of filled) {
      const wrap = el("label", "check");
      const box = el("input");
      box.type = "checkbox";
      box.value = row.id;
      const content = row.content.toLowerCase();
      box.checked = words.some((w) => w && (w.includes(content) || content.includes(w)));
      wrap.append(box, el("span", "", `${row.content} (${row.name})`));
      boxes.append(wrap);
    }
    if (!filled.length) boxes.append(el("p", "hint", t.planNoContainers));
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const buttons = el("div", "buttons");
    const cancel = el("button", "cancel", t.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => this._closeDialog());
    const submit = el("button", "submit", `📅 ${t.plan}`);
    submit.type = "submit";
    buttons.append(cancel, submit);
    const containersLabel = el("div", "hint", t.planContainers);
    form.replaceChildren(el("h2", "", t.planTitle), field(t.planDish, title), field(t.planDate, day), containersLabel, boxes, error, buttons);
    this._submit = async () => {
      const name = title.value.trim();
      if (!name) {
        error.textContent = t.planNeedTitle;
        return;
      }
      const deviceIds = [...boxes.querySelectorAll("input:checked")].map((b) => b.value);
      try {
        await this._hass.callWS({
          type: `${DOMAIN}/plan_add`,
          date: day.value,
          title: name,
          device_ids: deviceIds,
          ingredients: (recipe && (suggestion ? [...(recipe.uses || []), ...(recipe.extra_ingredients || [])] : recipe.ingredients)) || [],
          ...(recipe && recipe.id && !suggestion ? { recipe_id: recipe.id } : {}),
        });
      } catch {
        error.textContent = t.planSaveFailed;
        return;
      }
      this._closeDialog();
      this.loadPlans();
    };
    this._overlay.hidden = false;
  }

  // ----- Statistik -----

  async loadStats() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    const days = this._statsDays === undefined ? 90 : this._statsDays;
    this._statsDays = days;
    try {
      this._stats = await hass.callWS({ type: `${DOMAIN}/statistics`, ...(days ? { days } : {}) });
    } catch {
      this._stats = null;
    }
    this._update();
  }

  _renderStats(t) {
    const frag = document.createDocumentFragment();
    const bar = el("div", "bar");
    bar.append(
      this._select(
        Object.entries(t.statsPeriods).map(([k, v]) => [k, v]),
        String(this._statsDays || "all"),
        (value) => {
          this._statsDays = value === "all" ? null : Number(value);
          this.loadStats();
        },
        t.statsPeriod,
      ),
      el("span", "grow"),
    );
    frag.append(bar);
    const report = this._reportBox();
    if (report) frag.append(report);
    const st = this._stats;
    if (!st) {
      this._main.replaceChildren(frag);
      return;
    }
    const box = (title, ...children) => {
      const card = el("section", "stat");
      if (title) card.append(el("h3", "", title));
      card.append(...children);
      return card;
    };
    const figure = (value, label, cls = "") => {
      const f = el("div", `fig ${cls}`.trim());
      f.append(el("span", "num", String(value)), el("span", "lbl", label));
      return f;
    };
    const figs = (...items) => {
      const row = el("div", "figs");
      row.append(...items);
      return row;
    };
    const c = st.containers;
    frag.append(
      box(
        t.statsNow,
        figs(
          figure(c.filled, t.statsFilled),
          figure(c.empty, t.statsEmpty),
          figure(c.soon, t.statsSoon, c.soon ? "soon" : ""),
          figure(c.expired, t.statsExpired, c.expired ? "expired" : ""),
          ...(c.undated ? [figure(c.undated, t.statsUndated)] : []),
        ),
      ),
    );
    if (!st.emptied) {
      frag.append(el("p", "note", t.statsNone));
      this._main.replaceChildren(frag);
      return;
    }
    const summary = [];
    if (st.waste_percent !== null && st.waste_percent !== undefined) summary.push(el("p", "lead", t.statsWaste(st.waste_percent)));
    if (st.avg_days_stored !== null && st.avg_days_stored !== undefined) summary.push(el("p", "note", t.statsAvg(st.avg_days_stored)));
    frag.append(
      box(
        `${t.statsEmptied}: ${st.emptied}`,
        figs(
          figure(st.eaten, t.statsEaten, "eaten"),
          figure(st.thrown, t.statsThrown, st.thrown ? "expired" : ""),
          ...(st.unknown ? [figure(st.unknown, t.statsUnknown)] : []),
        ),
        ...summary,
      ),
    );
    const ranking = (title, items, key, role) => {
      if (!items || !items.length) return null;
      const list = el("ol", "rank");
      list.dataset.role = role;
      for (const item of items) {
        const li = el("li");
        li.append(el("span", "name", item[key]), el("span", "count", `${item.count}×`));
        list.append(li);
      }
      return box(title, list);
    };
    for (const node of [
      ranking(t.statsTopThrown, st.top_thrown, "content", "top-thrown"),
      ranking(t.statsTopEaten, st.top_eaten, "content", "top-eaten"),
      ranking(t.statsByArea, st.thrown_by_area, "area", "by-area"),
    ]) {
      if (node) frag.append(node);
    }
    // Monate als einfache Balken (gegessen grün, weggeworfen rot)
    const max = Math.max(1, ...st.months.map((m) => m.eaten + m.thrown));
    const chart = el("div", "months");
    const lang = this._lang();
    for (const m of st.months) {
      const col = el("div", "month");
      const stack = el("div", "stack");
      const thrown = el("div", "seg thrown");
      thrown.style.height = `${(100 * m.thrown) / max}%`;
      const eaten = el("div", "seg eaten");
      eaten.style.height = `${(100 * m.eaten) / max}%`;
      stack.append(thrown, eaten);
      stack.title = `${m.eaten} ${t.statsEaten}, ${m.thrown} ${t.statsThrown}`;
      const [y, mo] = m.month.split("-").map(Number);
      col.append(stack, el("span", "lbl", new Date(y, mo - 1, 1).toLocaleDateString(lang, { month: "short" })));
      chart.append(col);
    }
    frag.append(box(t.statsMonths, chart), el("p", "note", t.statsHint));
    this._main.replaceChildren(frag);
  }

  // ----- Export und Import -----

  /** Signierte Download-Adresse (gilt fünf Minuten, funktioniert auch im Browser der App). */
  async _signedUrl(path) {
    const signed = await this._hass.callWS({ type: "auth/sign_path", path, expires: 300 });
    return this._hass.hassUrl ? this._hass.hassUrl(signed.path) : signed.path;
  }

  async openDataDialog() {
    const hass = this._hass;
    if (!isAdmin(hass)) return;
    const t = texts(hass);
    const form = this._form;
    this._editing = null;
    const download = (role, text, hint) => {
      const box = el("div", "download");
      const link = el("a", "pdf", text);
      link.dataset.role = role;
      link.target = "_blank";
      link.rel = "noopener";
      box.append(link, el("p", "hint", hint));
      return box;
    };
    const inventory = download("export-inventory", t.dataInventory, t.dataInventoryHint);
    const historyLink = download("export-history", t.dataHistory, t.dataHistoryHint);
    const estimates = download("export-estimates", t.dataEstimates, t.dataEstimatesHint);
    const file = el("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.dataset.f = "file";
    const pick = el("label", "", t.dataImport);
    pick.append(file);
    const replaceWrap = el("label", "check");
    const replace = el("input");
    replace.type = "checkbox";
    replace.dataset.f = "replace";
    replaceWrap.append(replace, el("span", "", t.dataReplace));
    const status = el("p", "hint");
    status.dataset.role = "import-status";
    status.setAttribute("role", "status");
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const buttons = el("div", "buttons");
    const close = el("button", "cancel", t.close);
    close.type = "button";
    close.addEventListener("click", () => this._closeDialog());
    buttons.append(close);
    form.replaceChildren(el("h2", "", t.dataTitle), inventory, historyLink, estimates, pick, el("p", "hint", t.dataImportHint), replaceWrap, status, error, buttons);
    file.addEventListener("change", () => this._importEstimates(file, replace.checked));
    this._submit = null;
    this._overlay.hidden = false;
    try {
      inventory.querySelector("a").href = await this._signedUrl(`/api/${DOMAIN}/export/containers.csv`);
      historyLink.querySelector("a").href = await this._signedUrl(`/api/${DOMAIN}/export/history.csv`);
      estimates.querySelector("a").href = await this._signedUrl(`/api/${DOMAIN}/export/estimates.json`);
    } catch {
      error.textContent = t.dataLinkFailed;
    }
  }

  async _importEstimates(input, replace) {
    const t = texts(this._hass);
    const form = this._form;
    const status = form.querySelector('[data-role="import-status"]');
    const error = form.querySelector(".error");
    status.textContent = "";
    error.textContent = "";
    const fileObj = input.files && input.files[0];
    if (!fileObj) return;
    try {
      const data = JSON.parse(await fileObj.text());
      const result = await this._hass.callWS({ type: `${DOMAIN}/estimates_import`, data, replace });
      status.textContent = t.dataImported(result);
    } catch {
      error.textContent = t.dataImportFailed;
    }
    input.value = "";
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
    const check = (label, name, checked = false) => {
      const wrap = el("label", "check");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.f = name;
      box.checked = checked;
      wrap.append(box, el("span", "", label));
      return wrap;
    };
    const layout = el("select");
    layout.dataset.f = "layout";
    const sheets = el("optgroup");
    sheets.label = t.labelsSheets;
    const printers = el("optgroup");
    printers.label = t.labelsPrinters;
    for (const [key, info] of Object.entries(LABEL_LAYOUTS)) {
      const [w, h] = key.split("x");
      const o = el("option", "", info.printer ? `${w} × ${h} mm (${info.size})` : `${w} × ${h} (${info.size})`);
      o.value = key;
      (info.printer ? printers : sheets).append(o);
    }
    layout.append(sheets, printers);
    layout.value = this._opts.labelLayout;
    const design = el("select");
    design.dataset.f = "design";
    for (const key of LABEL_DESIGNS) {
      const o = el("option", "", t.labelsDesigns[key]);
      o.value = key;
      design.append(o);
    }
    design.value = this._opts.labelDesign;
    const parts = this._opts.labelParts;
    const what = el("div", "checks");
    what.dataset.role = "label-parts";
    what.append(
      check(t.labelsQr, "qr", parts.qr !== false),
      check(t.labelsName, "name", parts.name !== false),
      check(t.labelsContent, "content", !!parts.content),
      // vor 2.12.1 gab es nur "Inhalt und MHD": gespeicherte Auswahl übernimmt das MHD vom Inhalt
      check(t.labelsBestBefore, "bestBefore", parts.bestBefore === undefined ? !!parts.content : !!parts.bestBefore),
      check(t.labelsNutrition, "nutrition", !!parts.nutrition),
    );
    const skip = el("input");
    skip.type = "number";
    skip.min = "0";
    skip.inputMode = "numeric";
    skip.dataset.f = "skip";
    skip.value = "0";
    const skipField = field(t.labelsSkip, skip);
    const syncMax = () => {
      skip.max = String(LABEL_LAYOUTS[layout.value].per - 1);
      skipField.hidden = !!LABEL_LAYOUTS[layout.value].printer; // Etikettendrucker: nichts zu überspringen
    };
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
      skipField,
      el("div", "hint", t.labelsWhat),
      what,
      field(t.labelsDesign, design),
      check(t.labelsBorder, "border"),
      el("p", "hint", t.labelsHint),
      error,
      buttons,
    );
    // geänderte Optionen: alten Link verwerfen; mindestens eins von QR-Code, Name, Inhalt
    const syncParts = () => {
      submit.disabled = !["qr", "name", "content", "bestBefore", "nutrition"].some((f) => form.querySelector(`[data-f="${f}"]`).checked);
    };
    syncParts();
    for (const control of form.querySelectorAll("[data-f]")) {
      control.addEventListener("change", () => {
        const link = form.querySelector("a.pdf");
        if (link) link.remove();
        submit.textContent = t.labelsCreate;
        syncParts();
      });
    }
    this._submit = () => this._openLabels(deviceIds);
    this._overlay.hidden = false;
  }

  /** URL des PDFs (signiert, damit sie sich ohne Anmeldung im Browser der App öffnen lässt). */
  async labelUrl(deviceIds, { layout, skip, content, bestBefore = false, border, qr = true, name = true, nutrition = false, design = "plain" }) {
    const params = new URLSearchParams();
    if (deviceIds && deviceIds.length) params.set("device", deviceIds.join(","));
    params.set("layout", layout);
    params.set("skip", String(skip));
    if (content) params.set("content", "1");
    if (bestBefore !== !!content) params.set("bestbefore", bestBefore ? "1" : "0"); // Standard: wie Inhalt
    if (border) params.set("border", "1");
    if (!qr) params.set("qr", "0");
    if (!name) params.set("name", "0");
    if (nutrition) params.set("nutrition", "1");
    if (design !== "plain") params.set("design", design);
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
    const skip = LABEL_LAYOUTS[layout].printer ? 0 : Math.min(Math.max(parseInt(value("skip").value, 10) || 0, 0), per - 1);
    const parts = { qr: value("qr").checked, name: value("name").checked, content: value("content").checked, bestBefore: value("bestBefore").checked, nutrition: value("nutrition").checked };
    const design = value("design").value;
    this._opts.labelLayout = layout;
    this._opts.labelDesign = design;
    this._opts.labelParts = parts;
    saveOptions(this._opts);
    const error = form.querySelector(".error");
    error.textContent = "";
    let url;
    try {
      url = await this.labelUrl(deviceIds, { layout, skip, border: value("border").checked, ...parts, design });
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

installItems(LarderDashboard, { el, isAdmin, listAreas, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment });

if (!customElements.get("larder-dashboard")) {
  customElements.define("larder-dashboard", LarderDashboard);
}
