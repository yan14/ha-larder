/**
 * Larder dashboard (since 2.0): tile-based interface with start, storage, areas, categories and
 * recipes, with a bar at the bottom to switch.
 *
 * For dialogs (add, fill, NFC), the cards with all details and the estimates it embeds the
 * component <larder-panel-embedded embedded> from larder-panel.js (the former interface).
 */
// Load with the same version query as this module, so an older copy from the cache is never used.
const VERSION_QUERY = new URL(import.meta.url).search;
const { areaAllows, scopeOfKind, setAreaScopes, todoLists, attachCompartmentChips, collectDevices, daysUntil, isLarderLabel, knownCompartments, listAreas, rememberCompartment, soonDaysOf, SOON_DAYS } = await import(
  `./larder-panel.js${VERSION_QUERY}`
);
const { installItems } = await import(`./larder-dashboard-items.js${VERSION_QUERY}`);
const { installCare } = await import(`./larder-dashboard-care.js${VERSION_QUERY}`);
const { installCook } = await import(`./larder-dashboard-cook.js${VERSION_QUERY}`);
const { installSupply, supplyTexts } = await import(`./larder-dashboard-supply.js${VERSION_QUERY}`);
const { installVouchers, money } = await import(`./larder-dashboard-vouchers.js${VERSION_QUERY}`);
const { installShopping, shoppingTexts } = await import(`./larder-dashboard-shopping.js${VERSION_QUERY}`);
const { installDataCare, dataCareTexts } = await import(`./larder-dashboard-datacare.js${VERSION_QUERY}`);
const { sectionNames } = await import(`./larder-dashboard-supply.js${VERSION_QUERY}`);
const { installSearch, searchTexts } = await import(`./larder-dashboard-search.js${VERSION_QUERY}`);
const { installHistory } = await import(`./larder-dashboard-history.js${VERSION_QUERY}`);

const DOMAIN = "larder";
const STORAGE_KEY = `${DOMAIN}.experimental`; // historic name, kept so saved views survive

const { TEXTS } = await import(`./larder-dashboard-strings.js${VERSION_QUERY}`);
export { TEXTS };

export const CATEGORY_ICONS = {
  fish: "🐟",
  raw_meat: "🥩",
  deli: "🥓",
  plant: "🌱",
  condiment: "🧂",
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
  hh_paper: "🧻",
  hh_laundry: "🧺",
  hh_cleaning: "🧽",
  hh_care: "🧴",
  hh_batteries: "🔋",
  hh_other: "🧰",
  voucher: "🎟️",
  md_pain: "🌡️",
  md_cold: "🤧",
  md_digest: "🫖",
  md_wound: "🩹",
  md_allergy: "🌼",
  md_vitamin: "🍊",
  md_other: "💊",
  empty: "🫙",
};

// 5.0 (#117): the bar – Start · Larder · Shopping · Recipes · More; areas and categories are groupings of Larder
const VIEWS = ["start", "containers", "shopping", "recipes", "more"];
const GROUP_VIEWS = ["containers", "areas", "categories"];
const ALL_VIEWS = [...VIEWS, "areas", "categories", "estimates", "stats", "stock", "stocktake", "supply"];
const MODES = ["grid", "list", "cards"];
const VIEW_ICONS = { start: "🏠", containers: "🥫", shopping: "🛒", recipes: "📖", more: "⋯", areas: "📍", categories: "🏷️" };

/** Recognise the QR label of a compartment (…/larder?place=<area>&compartment=<compartment>). */
export function placeFromCode(code) {
  const text = String(code || "").trim();
  const at = text.indexOf("?");
  if (at < 0 || !/larder$/.test(text.slice(0, at).replace(/\/+$/, ""))) return null;
  const params = new URLSearchParams(text.slice(at + 1));
  if (!params.has("place")) return null;
  const area = params.get("place");
  return { areaId: area === "-" ? "" : area, compartment: params.get("compartment") || "" };
}

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

/** A container with content, days left and category, as the tiles need it. */
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
    const kind = (text && text.attributes && text.attributes.kind) || "container"; // container, bag, pack or household item
    const kcal = attrs.kcal_portion !== undefined ? { value: attrs.kcal_portion, per: "portion" } : attrs.kcal_100g !== undefined ? { value: attrs.kcal_100g, per: "100g" } : null;
    return { dev, id: dev.deviceId, name: dev.name, content, days, value: kind === "voucher" && attrs.value !== undefined ? Number(attrs.value) : null, soon: soonDaysOf(date), category, areaId: dev.areaId, areaName: dev.areaName, compartment, kcal, nutriScore: attrs.nutri_score || null, allergens: Array.isArray(attrs.allergen_warning) ? attrs.allergen_warning : [], kind, opened: attrs.opened || null, size: (text && text.attributes && (content ? text.attributes.size : text.attributes.size_fixed)) || null };
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
  if (days < 0) return `${t.expired} (${t.expiredSince(-days)})`;
  if (days === 0) return t.today;
  return t.daysShort(days);
}

function dayClass(row) {
  if (row.content === "" || row.days === null) return "";
  if (row.days < 0) return "expired";
  if (row.days <= (row.soon ?? SOON_DAYS)) return "soon";
  return "";
}

/** "12.11." / "Nov 12" for an ISO date (opened since …). */
function fmtShort(iso, lang) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(lang, lang.startsWith("de") ? { day: "2-digit", month: "2-digit" } : { month: "short", day: "numeric" });
}

function navigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
}

/** Period for recipe ideas: setting of the integration, fixed days or "all" (no period). */
export const RECIPE_PERIODS = ["default", "1", "3", "7", "14", "30", "all"];

/** Data for the service `suggest_recipes` depending on the chosen period. */
export function recipeServiceData(period) {
  if (period === "all") return { all_containers: true };
  if (period === "default" || !RECIPE_PERIODS.includes(period)) return {};
  return { days: Number(period) };
}

export const PHOTO_MAX_FILES = 4;
const PHOTO_MAX_SIDE = 2000;

/**
 * Prepare a photo for the upload: scale down to at most 2000 px and send as JPEG (saves
 * data volume and AI cost, iPhone photos become JPEG this way). PDFs and everything the browser
 * cannot draw go unchanged.
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

/** Label sheets as in labels.py (fields per sheet for "skip"). */
const LABEL_LAYOUTS = {
  "3x8": { per: 24, size: "70 × 36 mm" },
  "3x7": { per: 21, size: "70 × 42,3 mm" },
  "2x4": { per: 8, size: "105 × 74 mm" },
  // label printer: one page per label
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
      labelLook: raw.labelLook && typeof raw.labelLook === "object" ? raw.labelLook : { color: "black", inverted: false, logo: false },
      itemArea: raw.itemArea && typeof raw.itemArea === "object" ? raw.itemArea : {},
      scope: ["household", "pharmacy", "voucher"].includes(raw.scope) ? raw.scope : "food",
      dataCareSeen: typeof raw.dataCareSeen === "string" ? raw.dataCareSeen : "", // 4.12: month the data care box was dismissed
    };
  } catch {
    return { mode: "grid", sort: "date", areaSort: "name", recipeSort: "newest", recipePeriod: "default" };
  }
}

function saveOptions(opts) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* storage not available: settings only apply to this session */
  }
}

const { STYLE } = await import(`./larder-dashboard-style.js${VERSION_QUERY}`);

/** Views that show either food or household items. */
const SCOPED_VIEWS = ["containers", "areas", "categories"];
const SCOPE_LABELS = ["haushalt", "household", "lebensmittel", "food", "apotheke", "pharmacy", "hausapotheke", "medicine"];

/** "Larder: Household" / "Larder: Food" (and the German names): extra labels that only set the scope. */
export function isScopeLabel(label) {
  const name = String((label && label.name) || "").trim().toLowerCase();
  return SCOPE_LABELS.includes(name.replace(/^larder\s*:\s*/, "")) && name.startsWith("larder");
}

export class LarderDashboard extends HTMLElement {
  /** Title on the start page. */
  static appTitle = "Larder";

  constructor() {
    super();
    this._hass = null;
    this._view = "start";
    this._detail = null;
    this._filter = { area: null, category: null, state: null, problem: null };
    this._opts = loadOptions();
    this._recipeDays = SOON_DAYS; // until the setting is loaded
    this._sig = "";
    this._recipes = null;
    this._recipesLoading = false;
    this._suggestions = null; // null = not requested, "busy", list or { error }
    this._savedSuggestions = new Set();
    this._openRecipe = null;
    this._photo = null; // null, "busy" or { error }
    this._selecting = false; // selection mode in the storage view
    this._selected = new Set(); // device IDs
    this._scan = null; // running series scan
    this._chosenFor = null; // device IDs the current suggestions come from
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><button id="search" type="button">🔍</button><button id="scan" type="button" hidden>📷</button></header>
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
    this._searchBtn = this.shadowRoot.querySelector("#search");
    this._scanBtn = this.shadowRoot.querySelector("#scan");
    this._photoInput = this.shadowRoot.querySelector("#photo");
    this._photoInput.addEventListener("change", () => {
      const files = [...(this._photoInput.files || [])];
      this._photoInput.value = "";
      if (files.length) this.readRecipePhotos(files);
    });
    this.shadowRoot.querySelector("#menu").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
    this._notice = this.shadowRoot.querySelector(".notice");
    this._notice.addEventListener("click", () => (this._notice.hidden = true));
    // 5.0 (#118): a search on every page and one scan button that recognises what was scanned
    this._searchBtn.addEventListener("click", () => this.openSearch());
    this._scanBtn.addEventListener("click", () => this.scanOne());
    // The embedded classic view sits between content and bar (for cards and estimates)
    this._nav.before(this._classic);
    this._classic.addEventListener("larder-detail-closed", () => this._closeDetail());
    // 5.1: "History of this product" on a card
    this._classic.addEventListener("larder-product-history", (ev) => {
      if (ev.detail && ev.detail.content) this.openProductHistory(ev.detail.content);
    });
    this._classic.addEventListener("larder-filled", (ev) => {
      if (this._selecting) this.stopSelecting();
      // label right after filling (e.g. for freezer bags): one tap opens the label dialog
      const ids = (ev.detail && ev.detail.deviceIds) || [];
      const t = texts(this._hass);
      if (ids.length) this.showNotice(t.filledNotice(ids.length), { label: t.labelNow, run: () => this.openLabelDialog(ids) });
    });
    this._classic.addEventListener("larder-transfer", (ev) => this.openTransferDialog(ev.detail.deviceId));
    this._classic.addEventListener("larder-move", (ev) => this.openMoveDialog(ev.detail.deviceId));
    this._classic.addEventListener("larder-open-pack", (ev) => this.openOpenDialog(ev.detail.deviceId));
    this._form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (this._submit) this._submit();
    });
    this._overlay.addEventListener("click", (ev) => {
      if (ev.target === this._overlay) this._closeDialog();
    });
  }

  /**
   * On reloading the page Home Assistant may create the panel element before this
   * module has finished loading (it waits for the classic dashboard). Then hass, narrow,
   * route and panel end up as plain properties on the not yet upgraded element and shadow
   * the setters of this class; the page would stay empty. Here they are applied afterwards.
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
    this._fitHeight();
    // Home Assistant may still move the panel into place right after attaching it
    if (window.requestAnimationFrame) window.requestAnimationFrame(() => this._fitHeight());
    setTimeout(() => this.isConnected && this._fitHeight(), 400);
    if (!this._onResize) {
      this._onResize = () => this._fitHeight();
      window.addEventListener("resize", this._onResize);
      window.addEventListener("orientationchange", this._onResize);
    }
  }

  /**
   * Fixed height = the space Home Assistant really leaves below our top edge. `100dvh` alone is too tall in
   * the app on iOS: the panel starts below the status bar (safe area), so the navigation was pushed off the
   * screen and the whole page could be scrolled.
   */
  _fitHeight() {
    const top = this.getBoundingClientRect().top + (window.scrollY || 0);
    // a scrolled container of Home Assistant gives a negative top: keep the last good value
    if (top >= 0) this._top = top;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewport) return;
    // set on the element itself, so no outer style (min-height: 100vh and the like) can stretch it again
    this.style.height = `${Math.max(240, Math.floor(viewport - (this._top || 0)))}px`;
    this.style.minHeight = "0px";
  }

  disconnectedCallback() {
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
      this._onResize = null;
    }
    this.stopScan();
    if (this._scanUnsub) {
      try {
        this._scanUnsub();
      } catch {
        /* connection already gone */
      }
      this._scanUnsub = null;
    }
    if (this._placeUnsub) {
      try {
        this._placeUnsub();
      } catch {
        /* connection already gone */
      }
      this._placeUnsub = null;
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
      this.loadRunningLow();
      this.loadRecalls();
      this.loadScopes();
      this.loadReplaceDue();
      this.loadDataGaps();
      this.loadSettings();
      this.loadShopLists();
      this._handleViewParam();
      this._subscribeScans();
    }
  }

  /**
   * Own QR code scanned (`?cc=<container ID>`): open the container as with NFC (an empty one for filling)
   * and report the scan (event `larder_dose_scanned`); unknown codes lead to adding.
   */
  async _openScanned(cc) {
    const hass = this._hass;
    this.setView("containers");
    let deviceId = null;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/resolve_code`, code: cc });
      deviceId = res && res.device_id;
      if (res && res.retired) {
        this.showNotice(res.retired); // label of a bag that was already emptied
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

  /** Short notice below the header (tapping closes it). */
  showNotice(text, action = null) {
    this._notice.textContent = text || "";
    this._notice.hidden = !text;
    if (text && action) {
      // e.g. "🖨 Label" right after filling
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

  /** Scanned NFC tag of a container while the dashboard is open: open the container (empty ones for filling). */
  async _subscribeScans() {
    const hass = this._hass;
    if (this._scanUnsub || !isAdmin(hass) || !hass.connection || !hass.connection.subscribeEvents) return;
    try {
      this._scanUnsub = await hass.connection.subscribeEvents((ev) => {
        const id = ev && ev.data && ev.data.device_id;
        if (this._view === "stocktake" && this._take && this._take.started && ev && ev.data && ev.data.device_id) {
          this.stocktakeTick(ev.data.device_id); // stocktake: an NFC scan ticks off instead of opening
          return;
        }
        if (ev && ev.data && ev.data.retired && this.isConnected) {
          this.showNotice(ev.data.message); // NFC sticker of a bag that was already emptied
          return;
        }
        if (!id || this._scan || this._selecting || !this.isConnected) return; // series scan only selects
        const row = this._rows().find((r) => r.id === id);
        if (!row) return;
        if (this._view !== "containers") this.setView("containers");
        this.openContainer(row);
      }, `${DOMAIN}_dose_scanned`);
      // NFC tag of a compartment (not reported through the dashboard: source nfc)
      this._placeUnsub = await hass.connection.subscribeEvents((ev) => {
        const d = (ev && ev.data) || {};
        if (!d.place || d.source !== "nfc" || this._scan || this._selecting || !this.isConnected) return;
        this.openPlace(d.area_id || "", d.compartment || "");
      }, `${DOMAIN}_compartment_scanned`);
    } catch {
      this._scanUnsub = null;
    }
  }

  /** `?view=recipes` etc. (e.g. button "Recipes" in the daily notification). */
  _handleViewParam() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const open = params.get("open");
    const add = params.get("add");
    const cc = params.get("cc");
    const problem = params.get("problem");
    const place = params.get("place");
    if (!view && !open && !add && !cc && !problem && !place && !params.has("recipes")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.has("recipes")) this.setView("recipes");
    else if (problem && ["noarea", "nodate", "longexpired"].includes(problem)) this.setView("containers", { problem });
    else if (view && ALL_VIEWS.includes(view)) this.setView(view);
    if (place) {
      // NFC tag or QR label of a compartment: compartment view
      this.setView("containers");
      this.openPlace(place === "-" ? "" : place, params.get("compartment") || "");
    } else if (cc) {
      this._openScanned(cc);
    } else if (open) {
      // scan (shortcut, NFC notification): open the container, fill an empty one right away
      this.setView("containers");
      const row = this._rows().find((r) => r.id === open);
      if (row) this.openContainer(row);
    } else if (add) {
      // unknown container scanned: dialog "Add container" with the code
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
    if (view !== this._view && this._main) this._main.scrollTop = 0; // a new page starts at the top
    if (view === "estimates" && !isAdmin(this._hass)) return;
    if (view !== "areas") this._areaEdit = false;
    if (view !== "containers") {
      this.stopScan();
      this._selecting = false;
    }
    this._view = view;
    if (view === "stats") this.loadStats();
    if (view === "stock") this.loadStock();
    if (view === "supply") this.loadSupply();
    if (view === "shopping") this.loadShopping();
    if (view === "containers" && this._opts.scope === "voucher") this.loadVoucherStats();
    if (view === "containers") this.loadSizes();
    if (view === "start" || view === "recipes") this.loadPlans();
    if (view === "start") {
      this.loadBought();
      this.loadCookAgain();
      this.loadRunningLow();
      this.loadRecalls();
      this.loadReplaceDue();
      this.loadDataGaps();
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

  /** Tapping a container: fill empty ones right away, open filled ones in the detail view. */
  openContainer(row) {
    if (this._selecting) {
      this.toggleSelected(row.id);
      return;
    }
    if (row.kind === "voucher") this.openVoucher(row);
    else if (row.content === "" && isAdmin(this._hass)) this._classic.openFillDialog(row.id);
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
      // emptied bag or empty pack: the device no longer exists
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
              : this._view === "stocktake"
                ? this.stocktakeTitle()
                : this._view === "supply"
                  ? this.supplyTitle()
                  : this._view === "shopping"
                    ? this.shoppingTitle()
                    : t.views[this._view];
    const search = searchTexts(hass);
    this._searchBtn.setAttribute("aria-label", search.button);
    this._searchBtn.title = search.button;
    this._scanBtn.hidden = !this._hasQrScanner() || !!this._scan;
    this._scanBtn.dataset.role = "scan-one";
    this._scanBtn.setAttribute("aria-label", search.scan);
    this._scanBtn.title = search.scan;

    // storage, areas and categories show either food or household items (the switch is remembered)
    const everything = this._rows();
    const rows = SCOPED_VIEWS.includes(this._view) ? everything.filter((r) => scopeOfKind(r.kind) === this._opts.scope) : everything;
    const sig = JSON.stringify([
      this._scopes,
      this._scopePlan,
      this._view,
      this._filter,
      this._opts,
      t.title,
      rows.map((r) => [r.id, r.name, r.content, r.days, r.category, r.areaId, r.areaName, r.compartment, r.kcal, r.allergens, r.kind, r.opened]),
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
      this._listChosen,
      this._view === "start" && !rows.length ? this._areaSig() : null,
      this._plans,
      this._bought,
      this._again,
      this._view === "containers" ? this._sizes : null,
      this._low,
      this._replaceDue,
      this._dataGaps,
      this._recalls,
      this._view === "stats" ? this._report : null,
      this._view === "stats" ? [this._stats, this._statsDays, this._hhStats] : null,
      this._view === "stock" ? this._stock : null,
      this._view === "supply" ? this._supply : null,
      this._view === "shopping" ? this.shoppingSig() : null,
      this._opts.scope === "voucher" ? this._voucherStats : null,
      this._supplyCheck,
      this._shopCount(),
      this._view === "more" ? [this.canBatch(), this.canReadReceipt(), this._dataGaps] : null,
      this._view === "stocktake" ? this.stocktakeSig() : null,
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
      case "stocktake":
        this._renderStocktake();
        break;
      case "supply":
        this._renderSupply();
        break;
      case "shopping":
        this._renderShopping();
        break;
      case "more":
        this._renderMore();
        break;
      default:
        this._renderStart(t, rows);
    }
    if (this._view === "estimates") this._classicShow = "estimates";
    if (GROUP_VIEWS.includes(this._view)) this._main.prepend(this._groupBar());
    this._syncClassic();
  }

  /** The embedded classic view shows cards (all details) or the estimates, else only its dialogs. */
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
    // areas and categories belong to Larder, the pages reached through More to More
    const current = GROUP_VIEWS.includes(this._view) ? "containers" : VIEWS.includes(this._view) ? this._view : "more";
    const open = this._shopCount();
    const buttons = VIEWS.map((view) => {
      const btn = el("button");
      btn.type = "button";
      btn.dataset.view = view;
      btn.classList.toggle("active", view === current);
      const ico = el("span", "ico", VIEW_ICONS[view]);
      if (view === "shopping" && open > 0) {
        const badge = el("span", "navbadge", open > 99 ? "99+" : String(open));
        badge.dataset.role = "shop-badge";
        ico.append(badge);
      }
      btn.append(ico, el("span", "", t.views[view]));
      btn.addEventListener("click", () => this.setView(view));
      return btn;
    });
    this._nav.replaceChildren(...buttons);
  }

  /** Open items on the shopping lists Larder uses (badge on "Shopping"); the to-do state is the count. */
  _shopCount() {
    const states = (this._hass && this._hass.states) || {};
    return (this._shopLists || []).reduce((sum, id) => sum + (Number((states[id] || {}).state) || 0), 0);
  }

  async loadShopLists() {
    try {
      this._shopLists = ((await this._hass.callWS({ type: `${DOMAIN}/shopping_lists` })) || {}).lists || [];
    } catch {
      this._shopLists = [];
    }
    this._sig = "";
    this._update();
  }

  /** Larder page: list, by area or by category (5.0: instead of two places in the bar). */
  _groupBar() {
    const t = texts(this._hass);
    const bar = el("div", "groupbar");
    bar.setAttribute("role", "tablist");
    for (const view of GROUP_VIEWS) {
      const btn = el("button", view === this._view ? "active" : "", `${VIEW_ICONS[view === "containers" ? "list" : view] || "☰"} ${t.groups[view]}`);
      btn.type = "button";
      btn.dataset.group = view;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(view === this._view));
      btn.addEventListener("click", () => this.setView(view));
      bar.append(btn);
    }
    return bar;
  }

  /** What used to be in ⋮, in three sections; "Setup" for administrators only (5.0, #117). */
  _moreItems() {
    const hass = this._hass;
    const t = texts(hass);
    const admin = isAdmin(hass);
    const st = supplyTexts(hass);
    const cook = this.cookMenuTexts();
    const shop = shoppingTexts(hass);
    return [
      ["everyday", [
        ["menu-putaway", `📥 ${this.putAwayTitle()}`, true, () => this.openPutAway()],
        ["menu-receipt", shop.receipt, this.canReadReceipt(), () => this.openReceipt()],
        ["menu-stocktake", `📋 ${this.stocktakeTitle()}`, true, () => this.setView("stocktake")],
        ["menu-batch", cook.batch, this.canBatch(), () => this.openBatchDialog()],
        ["menu-labels", `🖨 ${t.menuLabels}`, true, () => this.openLabelDialog()],
      ]],
      ["overview", [
        ["menu-stock", `🗃️ ${this.stockTitle()}`, true, () => this.setView("stock")],
        ["menu-stats", `📊 ${t.menuStats}`, true, () => this.setView("stats")],
        ["menu-supply", st.menu, this._supplyCheck !== false, () => this.setView("supply")],
        ["menu-datacare", dataCareTexts(hass).menu, true, () => {
          this._dataGaps = null;
          this.openDataCare();
        }],
      ]],
      ["setup", [
        ["menu-areas", `📍 ${t.menuAreas}`, admin, () => {
          this.setView("areas");
          this._areaEdit = true;
          this._sig = "";
          this._update();
        }],
        ["menu-sections", st.sectionsMenu, admin, () => this.openSectionsDialog()],
        ["menu-sizes", cook.sizes, admin, () => this.openSizesDialog()],
        ["menu-data", `📦 ${t.menuData}`, admin, () => this.openDataDialog()],
        ["menu-estimates", `📋 ${t.menuEstimates}`, admin, () => this.setView("estimates")],
        ["menu-settings", `⚙ ${t.menuSettings}`, admin, () => navigate(`/config/integrations/integration/${DOMAIN}`)],
      ]],
    ];
  }

  _renderMore() {
    const t = texts(this._hass);
    const frag = document.createDocumentFragment();
    for (const [section, items] of this._moreItems()) {
      const shown = items.filter(([, , visible]) => visible);
      if (!shown.length) continue;
      const box = el("section", "more");
      box.dataset.section = section;
      box.append(el("h3", "", t.moreSections[section]));
      for (const [role, label, , run] of shown) {
        const btn = el("button", "moreitem", label);
        btn.type = "button";
        btn.dataset.role = role;
        btn.addEventListener("click", run);
        box.append(btn);
      }
      frag.append(box);
    }
    this._main.replaceChildren(frag);
  }

  _tile(row, t, { showArea = false } = {}) {
    const empty = row.content === "";
    const tile = el("button", `tile${empty ? " empty" : ""}`);
    tile.type = "button";
    tile.dataset.id = row.id;
    tile.append(el("span", "ico", CATEGORY_ICONS[row.category] || CATEGORY_ICONS.other));
    if (row.kind === "bag" || row.kind === "pack") tile.append(el("span", "kindmark", row.kind === "bag" ? "🛍" : row.opened ? "📦🔓" : "📦"));
    tile.append(el("span", "name", empty ? t.empty : row.content));
    tile.append(el("span", "sub", [row.name, showArea ? row.areaName : null, row.compartment, row.size].filter(Boolean).join(" · ")));
    if (!empty && row.days !== null) tile.append(el("span", `badge ${dayClass(row)}`, daysLabel(t, row.days)));
    if (!empty && row.kcal) tile.append(el("span", "kcal", t.kcal(row.kcal, this._lang())));
    if (row.value) tile.append(el("span", "kcal", money(row.value, this._lang().startsWith("de"))));
    if (!empty && row.opened) tile.append(el("span", "kcal opened", t.openedSince(fmtShort(row.opened, this._lang()))));
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
    text.append(el("span", "sub", [row.name, row.opened ? t.openedSince(fmtShort(row.opened, this._lang())) : null, row.value ? money(row.value, this._lang().startsWith("de")) : null, row.areaName, row.compartment, row.size, !empty && row.kcal ? t.kcal(row.kcal, this._lang()) : null, !empty && row.allergens.length ? `⚠ ${row.allergens.join(", ")}` : null].filter(Boolean).join(" · ")));
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

  // ----- Selection (fill several containers, recipe ideas from chosen containers, series scan) -----

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

  /** Recipe ideas from the chosen containers: switch to the recipe page and ask the AI. */
  recipesFromSelected() {
    const ids = this._rows().filter((r) => this._selected.has(r.id) && r.content !== "").map((r) => r.id);
    if (!ids.length) return;
    this.stopSelecting();
    this.setView("recipes");
    this.generateRecipes(ids);
  }

  /** Series scan: NFC scans (event larder_dose_scanned) and, in the Companion app, its QR scanner. */
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
        // Own subscription: reports NFC scans and suppresses the notification to the phone meanwhile
        scan.unsub = await hass.connection.subscribeMessage((data) => add(data && data.device_id), {
          type: `${DOMAIN}/scan_session`,
        });
      } else if (hass.connection && hass.connection.subscribeEvents) {
        scan.unsub = await hass.connection.subscribeEvents((ev) => add(ev && ev.data && ev.data.device_id), `${DOMAIN}_dose_scanned`);
      }
      if (this._scan !== scan && scan.unsub) scan.unsub();
    } catch {
      /* without a subscription the app's QR scanner remains */
    }
    if (this._scan === scan && scan.mode === "qr") this.openQrScanner();
  }

  /** Switch between QR code and NFC: QR opens the app's scanner, NFC closes it (otherwise the iPhone reads no tags). */
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

  /** Can the app open a QR scanner (Home Assistant app with camera)? */
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
   * Open the QR scanner of the Home Assistant app (iOS/Android). It stays open until it is closed;
   * every hit selects the container and shows a short note in the scanner. The app's commands run
   * through a single receiver of the frontend that is only extended here (and restored afterwards).
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
        // QR scanner closed or "NFC" chosen in the scanner: go on with NFC until "Stop scan"
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
   * Single scan with the QR scanner of the Home Assistant app (iOS and Android): own codes and
   * Zwilling codes. Open a known container (an empty one right away for filling), add an unknown one.
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
              // not a Larder code: the scanner stays open for the next try
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

  /** Evaluate a scanned code; false if it is not a Larder code. */
  async _resolveSingle(code) {
    const hass = this._hass;
    const place = placeFromCode(code);
    if (place) {
      hass.callWS({ type: `${DOMAIN}/report_place_scan`, area_id: place.areaId, compartment: place.compartment }).catch(() => {});
      this.openPlace(place.areaId, place.compartment);
      return true;
    }
    let res;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/resolve_code`, code });
    } catch {
      return false;
    }
    // Barcode of bought goods (EAN, 8–14 digits): look for the pack in the stock instead of "Add container".
    // To Larder an EAN also looks like a valid container ID, so only a known container counts.
    const ean = /^\d{8,14}$/.test(String(code).trim());
    if (ean && !(res && (res.device_id || res.retired))) {
      await this.takeByCode(String(code).trim());
      return true;
    }
    if (!res || !res.valid) return false;
    this.setView("containers");
    if (res.retired) {
      this.showNotice(res.retired); // label of a bag that was already emptied
      return true;
    }
    if (!res.device_id) {
      // unknown: add, with the whole code (Zwilling codes contain type and size)
      if (isAdmin(hass)) this._classic.openAddDialog(code.trim());
      else this.showNotice(texts(hass).adminOnly(res.cc));
      return true;
    }
    hass.callWS({ type: `${DOMAIN}/report_scan`, cc: res.cc }).catch(() => {});
    const row = this._rows().find((r) => r.id === res.device_id);
    if (row) this.openContainer(row);
    return true;
  }

  stopScan(inventory = true) {
    const scan = this._scan;
    if (!scan) return;
    this._scan = null;
    // stocktake: which filled containers were not scanned (already eaten but not emptied?)
    if (inventory && scan.scanned && scan.scanned.size) {
      const missing = this._rows().filter((r) => r.content !== "" && !scan.scanned.has(r.id));
      this._inventory = { scanned: scan.scanned.size, missing: missing.map((r) => r.id) };
    }
    if (scan.unsub) {
      try {
        scan.unsub();
      } catch {
        /* connection already gone */
      }
    }
    this._closeQrScanner(scan);
    this._update();
  }

  /** Toggle QR code / NFC (tap or swipe) with short instructions. */
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

  /** Empty the chosen filled containers; ask first whether eaten or thrown away. */
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
    // tiles → list → cards with all details → tiles; the button shows the next view
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

  /** "＋": container, bag, pack or household item (containers for administrators only, see larder-dashboard-items.js). */
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

  _countText(t, shown, all) {
    return this._opts.scope === "food" ? t.count(shown, all) : t.countItems(shown, all);
  }

  /** Containers after filters (state, area, category, search) and sorting. */
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
    // from the repair hints (link "Learn more")
    const problem = this._filter.problem;
    if (problem === "noarea") rows = rows.filter((r) => !r.areaId);
    else if (problem === "nodate") rows = rows.filter((r) => r.content !== "" && r.days === null);
    else if (problem === "longexpired") rows = rows.filter((r) => r.content !== "" && r.days !== null && r.days <= -7);
    const q = (this._query || "").trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.name, r.content, r.areaName || "", r.compartment || ""].some((v) => v.toLowerCase().includes(q)));
    return sortRows(rows, this._opts.sort, this._lang());
  }

  /** Search field and state filter (as in the former dashboard). */
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
      this._opts.scope !== "food"
        ? [["all", t.filterAll], ["soon", t.filterSoon], ["expired", t.filterExpired]] // household and pharmacy: dates only
        : [["all", t.filterAll], ["soon", t.filterSoon], ["expired", t.filterExpired], ["filled", t.filterFilled], ["empty", t.filterEmpty], ["bags", t.filterBags], ["packs", t.filterPacks]],
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

  /** Redraw only the result list (while typing into the search, without losing focus). */
  _refreshResults() {
    if (!this._results || this._view !== "containers") return;
    const t = texts(this._hass);
    const allRows = this._rows();
    const rows = this._containerRows(allRows);
    this._classicShow = null;
    this._classicIds = null;
    this._results.replaceChildren(this._renderResults(t, allRows, rows));
    if (this._countEl) this._countEl.textContent = this._countText(t, rows.length, allRows.length);
    this._syncClassic();
  }

  /** Area scopes (food, household, both) from the Larder labels, see household.py. */
  async loadScopes() {
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/area_scopes` });
      this._scopes = (res && res.scopes) || null;
      this._scopePlan = (res && res.plan) || {};
    } catch {
      this._scopes = null;
      this._scopePlan = {};
    }
    setAreaScopes(this._scopes);
    this._sig = "";
    this._update();
  }

  /** Switch "Food | Household" above storage, areas, categories and stock. */
  _scopeSwitch(t = texts(this._hass)) {
    const box = el("div", "scope");
    box.setAttribute("role", "tablist");
    const scopes = [["food", "🍎"], ["household", "🧻"], ["pharmacy", "💊"]];
    // vouchers (4.8): only once there is one (not in the stock view and the statistics: no stock)
    if (!["stock", "stats"].includes(this._view) && (this._opts.scope === "voucher" || this._rows().some((r) => r.kind === "voucher"))) scopes.push(["voucher", "🎟️"]);
    if (scopes.length > 3) box.classList.add("compact");
    for (const [scope, icon] of scopes) {
      // four sides do not fit on a phone: the others show their symbol only
      const short = scopes.length > 3 && scope !== this._opts.scope;
      const btn = el("button", scope === this._opts.scope ? "on" : "", short ? icon : `${icon} ${t.scopes[scope]}`);
      btn.type = "button";
      btn.dataset.scope = scope;
      if (short) {
        btn.setAttribute("aria-label", t.scopes[scope]);
        btn.title = t.scopes[scope];
      }
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", scope === this._opts.scope ? "true" : "false");
      btn.addEventListener("click", () => this.setScope(scope));
      box.append(btn);
    }
    return box;
  }

  setScope(scope) {
    const next = ["household", "pharmacy", "voucher"].includes(scope) ? scope : "food";
    if (next === "voucher") this.loadVoucherStats();
    if (next === this._opts.scope) return;
    this._opts.scope = next;
    saveOptions(this._opts);
    if (this._view === "stats" && next === "household") this.loadHouseholdStats();
    // filters belong to the other scope (its areas and categories)
    this._filter = { area: null, category: null, state: null, problem: null };
    this._sig = "";
    this._update();
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
    frag.append(this._scopeSwitch(t), bar);
    const voucherStats = this._opts.scope === "voucher" ? this._voucherStatsBox() : null;
    if (voucherStats) frag.append(voucherStats);
    if (this._scan) frag.append(this._scanPanel(t));
    if (this._inventory && this._selecting) frag.append(this._inventoryPanel(t));
    const chips = this._chips(t, allRows);
    if (chips) frag.append(chips);

    frag.append(this._searchRow(t, allRows));
    this._countEl = el("p", "count", this._countText(t, rows.length, allRows.length));
    frag.append(this._countEl);
    const free = this._opts.scope !== "food" ? null : this._freeLine(); // free containers belong to food
    if (free) frag.append(free);
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
      if (mode === "cards" && this._opts.scope !== "voucher") {
        // all details: the cards of the classic view, in this order and with these filters
        this._classicShow = "cards";
        this._classicIds = rows.map((r) => r.id).join(",");
      } else if (!grouped || mode === "cards") {
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

  /** IDs of the Larder labels once the embedded view has loaded them (else null). */
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
    // show storage places without containers: with a Larder label, when editing all areas of Home Assistant
    const labelIds = this._larderLabelIds();
    const admin = isAdmin(this._hass);
    const editing = admin && this._areaEdit;
    for (const area of Object.values(this._hass.areas || {})) {
      const tagged = labelIds && (area.labels || []).some((l) => labelIds.includes(l));
      if ((editing || (tagged && areaAllows(area.area_id, this._opts.scope))) && !groups.has(area.area_id)) {
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
    if (!editing) frag.append(this._scopeSwitch(t));
    frag.append(bar);
    if (editing) frag.append(el("p", "note", t.areaEditHint));
    const planned = Object.keys(this._scopePlan || {}).length;
    if (editing && planned) {
      // 4.0: suggest "food" for fridges and freezers, "household" for bathroom and utility rooms
      const auto = el("button", "", t.scopeAuto(planned));
      auto.type = "button";
      auto.dataset.role = "scope-auto";
      auto.addEventListener("click", async () => {
        auto.disabled = true;
        try {
          await this._hass.callWS({ type: `${DOMAIN}/area_scopes_auto` });
          this._labels = null;
          await this._loadLabels();
          if (this._classic.loadAreaLabel) await this._classic.loadAreaLabel();
          await this.loadScopes();
          this.showNotice(t.scopeAutoDone(planned));
        } catch (err) {
          this.showNotice(t.areaSaveFailed((err && err.message) || String(err)));
          auto.disabled = false;
        }
      });
      frag.append(auto);
    }
    if (!list.length) {
      frag.append(el("p", "note", t.noneYet));
    } else {
      const box = el("div", this._opts.mode === "grid" ? "tiles" : "list");
      for (const g of list) {
        const open = editing ? () => this.openAreaDialog(g.key) : () => this.setView("containers", { area: g.key });
        const sub = editing ? this._areaKindText(g.key, t) : (this._opts.scope === "food" ? t.containersCount : t.itemsCount)(g.count);
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

  // ----- Managing areas -----

  setAreaEdit(on) {
    this._areaEdit = !!on && isAdmin(this._hass);
    if (this._areaEdit) {
      this._loadLabels();
      this.loadScopes();
    }
    this._update();
  }

  /** Load all labels of Home Assistant (for the storage kind and display when editing). */
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

  /** "Larder: Freezer" → "Freezer"; the plain "Larder" stays. */
  _kindName(label) {
    const name = String((label && label.name) || "").trim();
    const short = name.replace(/^larder\s*:\s*/i, "");
    return short || name;
  }

  _areaKindText(areaId, t) {
    const area = (this._hass.areas || {})[areaId];
    const larder = (this._labels || []).filter(isLarderLabel);
    const kinds = larder
      .filter((l) => !isScopeLabel(l) && area && (area.labels || []).includes(l.label_id))
      .map((l) => this._kindName(l));
    const scope = (this._scopes || {})[areaId];
    if (!kinds.length && !scope) return t.areaKindNone;
    return [...kinds, scope ? t.scopeNames[scope] : null].filter(Boolean).join(" · ");
  }

  /** Create an area (without ID) or edit one: name, storage kind (Larder label) and use. */
  async openAreaDialog(areaId = null) {
    const hass = this._hass;
    if (!isAdmin(hass)) return;
    const t = texts(hass);
    const area = areaId ? (hass.areas || {})[areaId] : null;
    const labels = this._labels || (await this._loadLabels());
    // the scope labels ("Larder: Household", "Larder: Food") are extra and set with their own dropdown
    const larder = labels.filter((l) => isLarderLabel(l) && !isScopeLabel(l));
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
    // new area: if there are Larder labels, suggest the first one right away (otherwise it does not show in the lists)
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
    const scope = el("select");
    scope.dataset.f = "scope";
    for (const key of ["both", "food", "household", "pharmacy"]) scope.append(option(key, t.scopeNames[key]));
    scope.value = (area && (this._scopes || {})[area.area_id]) || "both";
    form.replaceChildren(
      el("h2", "", area ? t.areaEditTitle : t.areaAdd),
      field(t.areaName, name),
      field(t.areaKind, kind),
      newWrap,
      field(t.areaScope, scope),
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
      // foreign labels stay, only the Larder labels are replaced
      const larderIds = larder.map((l) => l.label_id);
      const labels = [...((area && area.labels) || []).filter((l) => !larderIds.includes(l)), ...(labelId ? [labelId] : [])];
      let id = area && area.area_id;
      if (area) {
        await hass.callWS({ type: "config/area_registry/update", area_id: area.area_id, name, labels });
      } else {
        id = ((await hass.callWS({ type: "config/area_registry/create", name, labels })) || {}).area_id;
      }
      const scope = form.querySelector('[data-f="scope"]').value;
      const before = (area && (this._scopes || {})[area.area_id]) || "both";
      // only with a Larder label the area is offered at all, so only then the scope matters
      if (id && scope !== before && (labelId || scope !== "both")) {
        await hass.callWS({ type: `${DOMAIN}/area_scope_set`, area_id: id, scope });
      }
      this._closeDialog();
      this._labels = null;
      await this._loadLabels();
      if (this._classic.loadAreaLabel) await this._classic.loadAreaLabel();
      await this.loadScopes();
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
    const add = this._addButton(t);
    if (add) bar.append(add);
    bar.append(this._modeButton(t));
    const frag = document.createDocumentFragment();
    frag.append(this._scopeSwitch(t), bar);
    if (!list.length) {
      frag.append(el("p", "note", t.noneYet));
    } else {
      const box = el("div", this._opts.mode === "grid" ? "tiles" : "list");
      for (const g of list) {
        const name = t.categories[g.key] || g.key;
        const icon = CATEGORY_ICONS[g.key] || CATEGORY_ICONS.other;
        const open = () => this.setView("containers", { category: g.key });
        if (this._opts.mode === "grid") {
          box.append(this._groupTile(icon, name, (this._opts.scope === "food" ? t.containersCount : t.itemsCount)(g.count), g.soon ? t.soonCount(g.soon) : "", open));
        } else {
          const btn = el("button", "row");
          btn.type = "button";
          const text = el("span", "text");
          text.append(el("span", "name", name), el("span", "sub", (this._opts.scope === "food" ? t.containersCount : t.itemsCount)(g.count)));
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

  /** "Get started" (empty Larder): areas, shopping list, first item; done steps are ticked. */
  _startBox(t) {
    const admin = isAdmin(this._hass);
    const ids = this._larderLabelIds() || [];
    const tagged = Object.values(this._hass.areas || {}).some((a) => (a.labels || []).some((l) => ids.includes(l)));
    const done = [tagged, !!this._listChosen, false];
    const actions = [
      () => {
        this.setView("areas");
        this.setAreaEdit(true);
      },
      () => navigate(`/config/integrations/integration/${DOMAIN}`),
      () => this.openAddMenu(),
    ];
    const box = el("section", "stat start");
    box.dataset.role = "get-started";
    box.append(el("h3", "", t.startTitle));
    t.startSteps.forEach(([title, hint, label], i) => {
      const row = el("div", "boughtrow");
      row.dataset.step = String(i + 1);
      if (done[i]) row.classList.add("done");
      const text = el("span", "name");
      text.append(el("span", "", `${done[i] ? "✅" : `${i + 1}.`} ${title}`), el("span", "sub", hint));
      row.append(text);
      if (admin || i === 2) {
        const btn = el("button", done[i] ? "" : "primary", label);
        btn.type = "button";
        btn.dataset.role = `start-${i + 1}`;
        btn.addEventListener("click", actions[i]);
        row.append(btn);
      }
      box.append(row);
    });
    return box;
  }

  _renderStart(t, rows) {
    const hass = this._hass;
    const frag = document.createDocumentFragment();
    frag.append(el("div", "hello", t.hello(hass.user && hass.user.name)));
    if (rows.length) frag.append(this._quickActions(t));
    if (!rows.length) {
      // 4.7: nothing in Larder yet – three steps instead of empty boxes
      frag.append(this._startBox(t));
      this._main.replaceChildren(frag);
      return;
    }
    const scopeOf = (item) => scopeOfKind(item.kind);
    const soon = sortRows(rows.filter((r) => scopeOf(r) === "food" && isSoon(r)), "date", this._lang());
    const isHh = (item) => scopeOf(item) !== "food";
    // household and pharmacy: expiring soon (with their longer warning), running low, bought
    const others = ["household", "pharmacy", "voucher"].map((scope) => ({
      scope,
      soon: sortRows(rows.filter((r) => scopeOf(r) === scope && isSoon(r)), "date", this._lang()),
      low: scope === "voucher" ? null : this._lowBox((item) => scopeOf(item) === scope),
      replace: scope === "household" ? this._replaceBox() : null,
      bought: scope === "voucher" ? null : this._boughtBox((item) => scopeOf(item) === scope),
      used: rows.some((r) => scopeOf(r) === scope),
    })).filter((s) => s.used || s.low || s.bought || s.replace);
    // sections once household items or medicines are in use: food first, the others below
    if (others.length) frag.append(el("h2", "section", `🍎 ${t.scopes.food}`));
    if (soon.length) {
      frag.append(el("p", "lead", t.soonTitle));
      const box = el("div", "tiles");
      for (const row of soon) box.append(this._tile(row, t, { showArea: true }));
      frag.append(box);
    } else {
      frag.append(el("p", "lead", t.soonNone(rows.length ? rows[0].soon : SOON_DAYS)));
    }
    const recall = this._recallBox();
    if (recall) frag.insertBefore(recall, frag.childNodes[1] || null);
    const low = this._lowBox((item) => !isHh(item));
    if (low) frag.append(low);
    const bought = this._boughtBox((item) => !isHh(item));
    if (bought) frag.append(bought);
    const again = this._againBox();
    if (again) frag.append(again);
    const thaw = this._thawBox(t);
    if (thaw) frag.append(thaw);
    const planned = this._plannedBox(t, false);
    if (planned) frag.append(planned);
    for (const other of others) {
      const head = el("h2", "section", `${{ pharmacy: "💊", voucher: "🎟️" }[other.scope] || "🧻"} ${t.scopes[other.scope]}`);
      head.dataset.role = `${other.scope}-section`;
      frag.append(head);
      if (other.soon.length) {
        frag.append(el("p", "lead", t.soonOther));
        const box = el("div", "tiles");
        box.dataset.role = `${other.scope}-soon`;
        for (const row of other.soon) box.append(this._tile(row, t, { showArea: true }));
        frag.append(box);
      }
      if (other.replace) frag.append(other.replace);
      if (other.low) frag.append(other.low);
      if (other.bought) frag.append(other.bought);
      if (!other.soon.length && !other.low && !other.bought && !other.replace) frag.append(el("p", "lead", { pharmacy: t.pharmacyFine, voucher: t.voucherFine }[other.scope] || t.householdFine));
    }
    const care = this._dataCareBox();
    if (care) frag.append(care);
    const help = el("div", "help");
    const show = el("button", "", t.helpContainers);
    show.type = "button";
    show.dataset.role = "containers";
    show.addEventListener("click", () => this.setView("containers", { soon: soon.length > 0 }));
    help.append(show);
    frag.append(help);
    this._main.replaceChildren(frag);
  }

  /** 5.0 (#117): the frequent actions at the top of the start page: scan, put away, receipt, recipe idea. */
  _quickActions(t) {
    const hass = this._hass;
    const box = el("div", "quick");
    const add = (role, label, run) => {
      const btn = el("button", "", label);
      btn.type = "button";
      btn.dataset.role = role;
      btn.addEventListener("click", run);
      box.append(btn);
    };
    if (this._hasQrScanner()) add("quick-scan", `📷 ${t.quickScan}`, () => this.scanOne());
    add("putaway", `📥 ${this.putAwayTitle()}`, () => this.openPutAway());
    if (this.canReadReceipt()) add("start-receipt", shoppingTexts(hass).receipt, () => this.openReceipt());
    if (this._canGenerate()) {
      add("recipes", `🍳 ${t.quickRecipe}`, () => {
        this.setView("recipes");
        this.generateRecipes();
      });
    }
    return box;
  }

  // ----- Recipes -----

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

  /** Read the settings of the integration (default period for recipe ideas). */
  async loadSettings() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/settings` });
      const listed = !!(res && res.shopping_list);
      const supply = res ? res.supply_check !== false : true;
      if (supply !== this._supplyCheck) {
        this._supplyCheck = supply;
        this._sig = "";
        this._update();
      }
      if (listed !== this._listChosen) {
        this._listChosen = listed;
        this._sig = "";
        this._update();
      }
      const days = Number(res && res.recipe_days);
      if (Number.isInteger(days) && days >= 0 && days !== this._recipeDays) {
        this._recipeDays = days;
        this._sig = "";
        this._update();
      }
    } catch {
      /* older version of the integration: the default stays */
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

  /** Upload photos (or a PDF), the AI reads the recipe; the draft opens for checking. */
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
      /* was already deleted: reload the list */
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
    const week = el("div", "bar week");
    week.append(this._weekButton());
    frag.append(week);
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
        /* stays as it is */
      }
      this.loadPlans();
    });
    box.append(list, done);
    return box;
  }

  /** Planned dishes; on the start page the next seven days, on the recipe page all with delete. */
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
            /* already gone */
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

  /** Dialog: plan a dish for a day, with the containers needed for it. */
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
    // filled containers; preselected what occurs in the recipe (for suggestions the "uses")
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

  /** Household items: use and spending per month (#82). */
  async loadHouseholdStats() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._hhStats = await hass.callWS({ type: `${DOMAIN}/household_statistics` });
    } catch {
      this._hhStats = { error: true };
    }
    this._sig = "";
    this._update();
  }

  async loadStats() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    if (this._opts.scope === "household") this.loadHouseholdStats();
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
    frag.append(this._scopeSwitch(t));
    if (this._opts.scope === "household") {
      this._renderHouseholdStats(t, frag);
      return;
    }
    if (this._opts.scope === "pharmacy" || this._opts.scope === "voucher") {
      frag.append(el("p", "note", this._opts.scope === "voucher" ? t.statsVoucherNone : t.statsPharmacyNone));
      this._main.replaceChildren(frag);
      return;
    }
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
    if (st.thrown_value) summary.push(el("p", "note", t.statsThrownValue(st.thrown_value, st.thrown_priced)));
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
    // months as simple bars (eaten green, thrown away red)
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

  _renderHouseholdStats(t, frag) {
    const st = this._hhStats;
    if (!st || st.error) {
      if (st) frag.append(el("p", "note", t.statsHhFailed));
      this._main.replaceChildren(frag);
      return;
    }
    const de = this._lang().startsWith("de");
    const euro = (v) => (de ? `${v.toFixed(2).replace(".", ",")} €` : `€${v.toFixed(2)}`);
    if (!st.products.length) {
      frag.append(el("p", "note", t.statsHhNone));
      this._main.replaceChildren(frag);
      return;
    }
    const total = el("section", "stat");
    total.dataset.role = "hh-total";
    total.append(el("h3", "", t.statsHhTitle));
    const fig = el("div", "fig");
    fig.append(el("span", "num", st.cost_per_month ? euro(st.cost_per_month) : "–"), el("span", "lbl", t.statsHhPerMonth));
    const figs = el("div", "figs");
    figs.append(fig);
    total.append(figs);
    frag.append(total);
    // months as bars: money if every take had a price, else pieces
    const byCost = st.months.some((m) => m.cost > 0);
    const value = (m) => (byCost ? m.cost : m.pieces);
    const max = Math.max(...st.months.map(value), 0) || 1;
    const chart = el("div", "months");
    const lang = this._lang();
    for (const m of st.months) {
      const col = el("div", "month");
      const stack = el("div", "stack");
      const seg = el("div", "seg spent");
      seg.style.height = `${(100 * value(m)) / max}%`;
      stack.append(seg);
      stack.title = byCost ? euro(m.cost) : `${m.pieces}`;
      const [y, mo] = m.month.split("-").map(Number);
      col.append(stack, el("span", "lbl", new Date(y, mo - 1, 1).toLocaleDateString(lang, { month: "short" })));
      chart.append(col);
    }
    const months = el("section", "stat");
    months.append(el("h3", "", byCost ? t.statsHhMonthsCost : t.statsHhMonthsPieces), chart);
    frag.append(months);
    const list = el("section", "stat");
    list.dataset.role = "hh-products";
    list.append(el("h3", "", t.statsHhProducts));
    const ol = el("ol", "rank");
    list.append(ol);
    for (const p of st.products) {
      const row = el("li");
      const used = t.statsHhUsed(String(p.pieces_per_month).replace(".", de ? "," : "."), p.piece);
      row.append(el("span", "name", p.name), el("span", "count", p.cost_per_month ? `${used} · ${euro(p.cost_per_month)}` : used));
      ol.append(row);
    }
    frag.append(list);
    frag.append(el("p", "note", st.complete ? t.statsHhHint : `${t.statsHhHint} ${t.statsHhIncomplete}`));
    this._main.replaceChildren(frag);
  }

  // ----- Export and import -----

  /** Signed download address (valid for five minutes, also works in the app's browser). */
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

  // ----- QR labels -----

  /** Dialog for the label sheet; without IDs for all containers. */
  openLabelDialog(deviceIds = null, places = null) {
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
    const look = this._opts.labelLook || {};
    const color = el("select");
    color.dataset.f = "color";
    for (const key of ["black", "blue", "green", "red", "brown"]) {
      const o = el("option", "", t.labelsColors[key]);
      o.value = key;
      color.append(o);
    }
    color.value = look.color || "black";
    const inverted = check(t.labelsInverted, "inverted", !!look.inverted);
    const logo = check(t.labelsLogo, "logo", !!look.logo);
    const invertedHint = el("p", "hint", t.labelsInvertedHint);
    invertedHint.dataset.role = "inverted-hint";
    const syncInverted = () => {
      const on = inverted.querySelector("input").checked;
      invertedHint.hidden = !on;
      color.disabled = on;
    };
    inverted.querySelector("input").addEventListener("change", syncInverted);
    syncInverted();
    const what = el("div", "checks");
    what.dataset.role = "label-parts";
    what.append(
      check(t.labelsQr, "qr", parts.qr !== false),
      check(t.labelsName, "name", parts.name !== false),
      check(t.labelsContent, "content", !!parts.content),
      // before 2.12.1 there was only "content and date": a saved choice takes the date from the content
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
      skipField.hidden = !!LABEL_LAYOUTS[layout.value].printer; // label printer: nothing to skip
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
    if (places) what.hidden = true; // compartment label: name of the compartment and QR code
    form.replaceChildren(
      el("h2", "", places ? t.labelsPlaceTitle : t.labelsTitle),
      el("p", "hint", places ? t.labelsForPlaces(places.map((p) => p.name).join(", ")) : t.labelsFor(deviceIds ? deviceIds.length : null)),
      field(t.labelsLayout, layout),
      skipField,
      ...(places ? [] : [el("div", "hint", t.labelsWhat)]),
      what,
      field(t.labelsDesign, design),
      field(t.labelsColor, color),
      inverted,
      invertedHint,
      logo,
      check(t.labelsBorder, "border"),
      el("p", "hint", t.labelsHint),
      error,
      buttons,
    );
    // changed options: drop the old link; at least one of QR code, name, content
    const syncParts = () => {
      submit.disabled = !places && !["qr", "name", "content", "bestBefore", "nutrition"].some((f) => form.querySelector(`[data-f="${f}"]`).checked);
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
    this._submit = () => this._openLabels(deviceIds, places);
    this._overlay.hidden = false;
  }

  /** URL of the PDF (signed, so it opens in the app's browser without logging in). */
  async labelUrl(deviceIds, { layout, skip, content, bestBefore = false, border, qr = true, name = true, nutrition = false, design = "plain", color = "black", inverted = false, logo = false, places = null }) {
    const params = new URLSearchParams();
    if (places && places.length) for (const p of places) params.append("place", `${p.areaId || ""}|${p.compartment || ""}`);
    else if (deviceIds && deviceIds.length) params.set("device", deviceIds.join(","));
    params.set("layout", layout);
    params.set("skip", String(skip));
    if (content) params.set("content", "1");
    if (bestBefore !== !!content) params.set("bestbefore", bestBefore ? "1" : "0"); // default: like content
    if (border) params.set("border", "1");
    if (!qr) params.set("qr", "0");
    if (!name) params.set("name", "0");
    if (nutrition) params.set("nutrition", "1");
    if (design !== "plain") params.set("design", design);
    if (inverted) params.set("inverted", "1");
    else if (color && color !== "black") params.set("color", color);
    if (logo) params.set("logo", "1");
    const path = `/api/${DOMAIN}/labels.pdf?${params}`;
    const signed = await this._hass.callWS({ type: "auth/sign_path", path, expires: 300 });
    return this._hass.hassUrl ? this._hass.hassUrl(signed.path) : signed.path;
  }

  /**
   * Create the link to the PDF and show it in the dialog. Tapping opens it (a real link also works
   * in the app and without a pop-up blocker; in the app it opens in the browser for sharing and printing).
   */
  async _openLabels(deviceIds, places = null) {
    const t = texts(this._hass);
    const form = this._form;
    const value = (name) => form.querySelector(`[data-f="${name}"]`);
    const layout = value("layout").value;
    const per = LABEL_LAYOUTS[layout].per;
    const skip = LABEL_LAYOUTS[layout].printer ? 0 : Math.min(Math.max(parseInt(value("skip").value, 10) || 0, 0), per - 1);
    const chosen = { qr: value("qr").checked, name: value("name").checked, content: value("content").checked, bestBefore: value("bestBefore").checked, nutrition: value("nutrition").checked };
    const parts = places ? { qr: true, name: true, content: false, bestBefore: false, nutrition: false } : chosen;
    const design = value("design").value;
    const look = { color: value("color").value, inverted: value("inverted").checked, logo: value("logo").checked };
    this._opts.labelLayout = layout;
    this._opts.labelDesign = design;
    if (!places) this._opts.labelParts = chosen;
    this._opts.labelLook = look;
    saveOptions(this._opts);
    const error = form.querySelector(".error");
    error.textContent = "";
    let url;
    try {
      url = await this.labelUrl(deviceIds, { layout, skip, border: value("border").checked, ...parts, design, ...look, places });
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

installItems(LarderDashboard, { el, isAdmin, listAreas, todoLists, scopeOfKind, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment });
installCook(LarderDashboard, { el, isAdmin, DOMAIN });
installSupply(LarderDashboard, { el, DOMAIN });
installDataCare(LarderDashboard, { el, DOMAIN });
installSearch(LarderDashboard, { el });
installHistory(LarderDashboard, { el, DOMAIN, money });
installShopping(LarderDashboard, { el, DOMAIN, todoLists, sectionNames });
installVouchers(LarderDashboard, { el, isAdmin, listAreas, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment });
installCare(LarderDashboard, { el, isAdmin, listAreas, scopeOfKind, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment, CATEGORY_ICONS });

if (!customElements.get("larder-dashboard")) {
  customElements.define("larder-dashboard", LarderDashboard);
}
