/*
 * Larder: Übersicht aller Dosen der Integration "larder".
 *
 * Liest Geräte, Bereiche, Entitäten und Zustände direkt aus dem hass-Objekt des Frontends.
 * Es gibt keine feste Konfiguration: Neue Dosen erscheinen, sobald sie in Home Assistant
 * angelegt sind, geänderte Werte und Bereiche werden live übernommen.
 */

const DOMAIN = "larder";
// Texte und Stylesheet liegen in eigenen Modulen; mit derselben Versionsangabe laden wie dieses Modul,
// damit nie eine ältere Kopie aus dem Cache benutzt wird.
const VERSION_QUERY = new URL(import.meta.url).search;

const { STRINGS } = await import(`./larder-panel-strings.js${VERSION_QUERY}`);
export { STRINGS };

// ----- Fächer vorschlagen -----

const COMPARTMENT_KEY = `${DOMAIN}.compartments`;
const MAX_COMPARTMENT_CHIPS = 8;

function loadCompartmentMemory() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COMPARTMENT_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Benutztes Fach merken (je Bereich, die zuletzt benutzten zuerst), auch wenn die Dose später weg ist. */
export function rememberCompartment(areaId, value) {
  const text = String(value || "").trim();
  if (!text) return;
  const memory = loadCompartmentMemory();
  const key = areaId || "";
  memory[key] = [text, ...(memory[key] || []).filter((v) => v.toLowerCase() !== text.toLowerCase())].slice(0, 20);
  try {
    window.localStorage.setItem(COMPARTMENT_KEY, JSON.stringify(memory));
  } catch {
    /* Speicher voll oder gesperrt: dann eben ohne */
  }
}

/**
 * Fächer, die in einem Bereich schon benutzt werden oder wurden: aus den Dosen, Beuteln und Packungen dort
 * (am häufigsten zuerst) und aus den zuletzt eingetragenen. Ohne Bereich: alle Fächer.
 */
export function knownCompartments(hass, devices, areaId) {
  const states = (hass && hass.states) || {};
  const counts = new Map();
  const add = (value, weight) => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    const entry = counts.get(key) || { text, n: 0 };
    entry.n += weight;
    counts.set(key, entry);
  };
  for (const dev of devices || []) {
    if (areaId && (dev.areaId || "") !== areaId) continue;
    const comp = states[dev.entities.compartment];
    if (comp && comp.state && !["unknown", "unavailable"].includes(comp.state)) add(comp.state, 1);
  }
  const memory = loadCompartmentMemory();
  const remembered = areaId ? memory[areaId] || [] : Object.values(memory).flat();
  remembered.forEach((value, i) => add(value, 0.5 + (remembered.length - i) / 100));
  return [...counts.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text)).map((e) => e.text);
}

/**
 * Vorschläge als antippbare Chips unter einem Fach-Feld. `getList` liefert die Fächer (z. B. je nach Bereich);
 * `refresh()` zeichnet sie neu, etwa wenn der Bereich gewechselt wurde. Getipptes filtert die Chips.
 */
export function attachCompartmentChips(input, getList, onPick = null) {
  let box = input.nextElementSibling;
  if (!box || !box.classList || !box.classList.contains("compchips")) {
    box = document.createElement("div");
    box.className = "compchips";
    box.dataset.role = "compartment-chips";
    input.after(box);
  }
  const refresh = () => {
    const typed = input.value.trim().toLowerCase();
    const list = getList().filter((v) => v.toLowerCase() !== typed && (!typed || v.toLowerCase().includes(typed)));
    box.replaceChildren(
      ...list.slice(0, MAX_COMPARTMENT_CHIPS).map((value) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "compchip";
        chip.textContent = value;
        chip.addEventListener("click", () => {
          input.value = value;
          refresh();
          if (onPick) onPick(value);
          else input.dispatchEvent(new Event("change"));
        });
        return chip;
      }),
    );
    box.hidden = !box.children.length;
  };
  if (!input.dataset.chips) {
    input.dataset.chips = "1";
    input.addEventListener("input", refresh);
  }
  input._refreshChips = refresh;
  refresh();
  return refresh;
}

/** Beschriftung der Quelle eines Schätzwerts (Tabelle, KI oder vom Nutzer korrigiert, mit Ursprung). */
export function sourceLabel(t, source, origin) {
  if (source === "learned") {
    if (origin === "table") return t.sourceLearnedTable;
    if (origin === "ai") return t.sourceLearnedAi;
    return t.sourceLearned;
  }
  return { table: t.sourceTable, ai: t.sourceAi }[source] || "";
}

function strings(hass) {
  const lang = ((hass && (hass.language || (hass.locale && hass.locale.language))) || "en")
    .toLowerCase()
    .split("-")[0];
  return STRINGS[lang] || STRINGS.en;
}

/** Der Schalter "Einkaufsliste" ist nur sinnvoll, wenn in den Einstellungen eine To-do-Liste gewählt ist. */
function hasShoppingList(state) {
  return !!(state && state.attributes && state.attributes.list);
}

/** Alle Geräte der Integration, sortiert nach Bereich (ohne Bereich zuletzt) und Name. */
export function collectDevices(hass) {
  const byDevice = new Map();
  for (const ent of Object.values(hass.entities || {})) {
    if (ent.platform !== DOMAIN || !ent.device_id) continue;
    let dev = byDevice.get(ent.device_id);
    if (!dev) {
      dev = { deviceId: ent.device_id, entities: {}, entityAreaId: null };
      byDevice.set(ent.device_id, dev);
    }
    // Pro Gerät gibt es je Domain eine Entität (text, date, datetime, button, image, number), mehrere nur bei
    // "switch" (Vakuum = switch, Einkaufsliste = shopping, variabler Lagerort = flexible) und "select"
    // (Einheit = select, Lagerort nach dem Leeren = homeArea).
    const domain = ent.entity_id.split(".")[0];
    const key = ent.translation_key;
    let slot = domain;
    if (domain === "switch") {
      if (key === "shopping" || (!key && /shopping|einkaufsliste/i.test(ent.entity_id))) slot = "shopping";
      else if (key === "flexible" || (!key && /flexible|variabler_lagerort/i.test(ent.entity_id))) slot = "flexible";
    } else if (domain === "text") {
      if (key === "compartment" || (!key && /compartment|_fach$/i.test(ent.entity_id))) slot = "compartment";
    } else if (domain === "select") {
      if (key === "home_area" || (!key && /after_emptying|nach_dem_leeren/i.test(ent.entity_id))) slot = "homeArea";
    }
    dev.entities[slot] = ent.entity_id;
    if (!dev.entityAreaId && ent.area_id) dev.entityAreaId = ent.area_id;
  }

  const devices = [];
  for (const dev of byDevice.values()) {
    const reg = (hass.devices || {})[dev.deviceId] || {};
    const areaId = reg.area_id || dev.entityAreaId || null;
    const area = areaId ? (hass.areas || {})[areaId] : null;
    devices.push({
      deviceId: dev.deviceId,
      entities: dev.entities,
      name: reg.name_by_user || reg.name || dev.deviceId,
      areaId,
      areaName: area ? area.name : null,
    });
  }

  const lang = (hass.language || "en").toLowerCase();
  const cmp = (a, b) => a.localeCompare(b, lang, { numeric: true, sensitivity: "base" });
  devices.sort((a, b) => {
    if (a.areaName === null && b.areaName !== null) return 1;
    if (a.areaName !== null && b.areaName === null) return -1;
    if (a.areaName !== null && b.areaName !== null) {
      const c = cmp(a.areaName, b.areaName);
      if (c !== 0) return c;
    }
    return cmp(a.name, b.name);
  });
  return devices;
}

function isValidState(st) {
  return !!st && st.state !== "unknown" && st.state !== "unavailable";
}

const pad = (n) => String(n).padStart(2, "0");

/** ISO-Zeitstempel -> Wert für <input type="datetime-local"> (lokale Zeit). */
export function toLocalInputValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Verbleibende Tage bis zum MHD (negativ = abgelaufen), Basis ist "heute" in lokaler Zeit. */
export function daysUntil(isoDate, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

/** ISO-Datum um n Tage verschieben (lokale Kalendertage, ohne Zeitzonen-Fallen). */
export function addDays(isoDate, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const SOON_DAYS = 3;

/** "Läuft bald ab" in Tagen: Einstellung der Integration (Attribut `soon_days` der MHD-Entität), sonst 3. */
export function soonDaysOf(dateState) {
  const value = dateState && dateState.attributes ? dateState.attributes.soon_days : undefined;
  return Number.isInteger(value) && value >= 0 ? value : SOON_DAYS;
}

/**
 * Dosen nach Suche filtern und sortieren. `sort`: "area" (Reihenfolge von collectDevices),
 * "date" (frühestes MHD zuerst, ohne MHD zuletzt) oder "name". `filter`: all, soon, expired, filled, empty.
 */
export function arrangeDevices(hass, devices, { query = "", filter = "all", sort = "area" } = {}, now = new Date()) {
  const states = hass.states || {};
  const info = (dev) => {
    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    const content = isValidState(text) ? text.state.trim() : "";
    const days = isValidState(date) ? daysUntil(date.state, now) : null;
    return { content, days, soon: soonDaysOf(date) };
  };
  const q = query.trim().toLowerCase();
  const lang = (hass.language || "en").toLowerCase();
  const cmp = (a, b) => a.localeCompare(b, lang, { numeric: true, sensitivity: "base" });
  const rows = devices
    .map((dev) => ({ dev, ...info(dev) }))
    .filter(({ dev, content, days, soon }) => {
      if (q && ![dev.name, content, dev.areaName || ""].some((v) => v.toLowerCase().includes(q))) return false;
      switch (filter) {
        case "soon":
          return days !== null && days >= 0 && days <= soon;
        case "expired":
          return days !== null && days < 0;
        case "filled":
          return content !== "";
        case "empty":
          return content === "";
        default:
          return true;
      }
    });
  if (sort === "date") {
    rows.sort((a, b) => {
      if (a.days === null && b.days !== null) return 1;
      if (a.days !== null && b.days === null) return -1;
      if (a.days !== b.days && a.days !== null) return a.days - b.days;
      return cmp(a.dev.name, b.dev.name);
    });
  } else if (sort === "name") {
    rows.sort((a, b) => cmp(a.dev.name, b.dev.name));
  }
  return rows.map((r) => r.dev);
}

function isAdmin(hass) {
  return !!(hass && hass.user && hass.user.is_admin);
}

/**
 * Bereiche des hass-Objekts als sortierte Liste [{id, name}].
 * Mit `labelIds` (Beschriftungen "Larder" bzw. "Larder: …", eine ID oder eine Liste) erscheinen nur
 * Bereiche mit einer dieser Beschriftungen; hat keiner der Bereiche eine, werden alle gezeigt. `keep`
 * ist ein Bereich, der immer dabei sein muss (der aktuelle Bereich einer Dose, auch ohne Beschriftung).
 */
export function listAreas(hass, labelIds = null, keep = null) {
  const lang = ((hass && hass.language) || "en").toLowerCase();
  let areas = Object.values((hass && hass.areas) || {});
  const ids = (Array.isArray(labelIds) ? labelIds : [labelIds]).filter(Boolean);
  const tagged = (a) => Array.isArray(a.labels) && a.labels.some((l) => ids.includes(l));
  if (ids.length && areas.some(tagged)) areas = areas.filter((a) => tagged(a) || a.area_id === keep);
  return areas
    .map((a) => ({ id: a.area_id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
}

/** Beschriftung, die einen Bereich als Lagerort markiert: "Larder" oder "Larder: …" (z. B. "Larder: Freezer"). */
export function isLarderLabel(label) {
  const name = String((label && label.name) || "").trim().toLowerCase();
  return name === "larder" || name.startsWith("larder:") || (label && label.label_id === "larder");
}

function navigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
}

const { STYLE } = await import(`./larder-panel-style.js${VERSION_QUERY}`);

const VIEW_KEY = `${DOMAIN}.panel`;

/** Suche, Filter und Sortierung sind eine reine Anzeigepräferenz dieses Browsers. */
function loadViewOptions() {
  const defaults = { query: "", filter: "all", sort: "area" };
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIEW_KEY) || "{}");
    return {
      query: typeof stored.query === "string" ? stored.query : defaults.query,
      filter: ["all", "soon", "expired", "filled", "empty"].includes(stored.filter) ? stored.filter : defaults.filter,
      sort: ["area", "date", "name"].includes(stored.sort) ? stored.sort : defaults.sort,
    };
  } catch (err) {
    return defaults;
  }
}

function saveViewOptions(opts) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(opts));
  } catch (err) {
    /* Speicher nicht verfügbar: Einstellung gilt nur bis zum Neuladen */
  }
}

const DEFAULT_UNITS = ["portions", "pieces", "slices", "grams", "milliliters"];

/** Menge aus einem Eingabefeld: ganze Zahl von 0 bis 9999 (leer = 0 = nicht angegeben). */
function parseQuantity(value) {
  return Math.min(Math.max(parseInt(value, 10) || 0, 0), 9999);
}

/** Auswahl der Einheit füllen (Optionen und aktueller Wert kommen von der Select-Entität). */
function fillUnitSelect(select, state, t) {
  const options = (state && state.attributes && state.attributes.options) || DEFAULT_UNITS;
  const sig = options.join("|");
  if (select.dataset.sig !== sig || select.dataset.lang !== t.units.portions) {
    select.replaceChildren(
      ...options.map((key) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = t.units[key] || key;
        return opt;
      }),
    );
    select.dataset.sig = sig;
    select.dataset.lang = t.units.portions;
  }
  const value = state && state.state && state.state !== "unavailable" && state.state !== "unknown" ? state.state : options[0];
  if (select.value !== value) select.value = value;
}

class DoseCard {
  constructor(panel, deviceId) {
    this._panel = panel;
    this.deviceId = deviceId;
    this.ids = {};
    this._qrSrc = "";

    const el = document.createElement("section");
    el.className = "card";
    el.innerHTML = `
      <div class="head"><span class="name"></span><a class="open"></a></div>
      <div class="arealine"></div>
      <div class="row arearow"><label data-l="area"></label><select data-f="area"></select></div>
      <div class="row comprow"><label data-l="compartment"></label><input data-f="compartment" type="text" maxlength="60"></div>
      <div class="row"><label data-l="content"></label><input data-f="content" type="text" maxlength="255"></div>
      <div class="row quantityrow"><label data-l="quantity"></label><span class="qty"><input data-f="quantity" type="number" min="0" max="9999" step="1" inputmode="numeric"><select data-f="unit"></select><button class="take" type="button">−1</button></span></div>
      <div class="lastrow" hidden><span class="lasttext"></span><button class="lastempty" type="button"></button><button class="lastkeep" type="button"></button></div>
      <div class="row"><label data-l="bestBefore"></label><input data-f="bestBefore" type="date"><span class="badge"></span></div>
      <div class="quickrow"><button class="plus1" type="button"></button><button class="opened" type="button"></button><button class="thawed" type="button"></button></div>
      <div class="row filledrow"><label data-l="filledAt"></label><input data-f="filledAt" type="datetime-local"><button class="now" type="button"></button></div>
      <div class="estimaterow"><button class="estimate" type="button"></button><span class="tip" role="status"></span></div>
      <div class="row vacrow"><label class="check"><input type="checkbox" data-f="vacuum"><span data-l="vacuum"></span></label></div>
      <div class="row shoprow"><label class="check"><input type="checkbox" data-f="shopping"><span data-l="shopping"></span></label></div>
      <div class="row flexrow"><label class="check"><input type="checkbox" data-f="flexible"><span data-l="flexible"></span></label></div>
      <div class="row homerow"><label data-l="homeArea"></label><select data-f="homeArea"></select></div>
      <div class="recallline" role="alert" hidden><span class="txt"></span> <a target="_blank" rel="noopener noreferrer"></a></div>
      <div class="openedline" role="note" hidden></div>
      <div class="usageline" role="note" hidden></div>
      <div class="priceline" role="note" hidden></div>
      <div class="olderhint" role="note" hidden></div>
      <div class="row minrow" hidden><label data-l="minStock"></label><input data-f="minStock" type="number" min="0" max="999" step="1" inputmode="numeric"><span class="stockinfo"></span></div>
      <div class="allergen-warning" role="note" hidden></div>
      <details class="nutrition"><summary></summary>
        <div class="nutgrid">
          <label><span data-n="brand"></span><input data-p="brand" type="text" maxlength="80"></label>
          <label><span data-n="package"></span><input data-p="package" type="text" maxlength="40"></label>
          <label><span data-n="kcal_100g"></span><input data-p="kcal_100g" type="number" min="0" max="10000" step="any" inputmode="decimal"></label>
          <label><span data-n="kcal_portion"></span><input data-p="kcal_portion" type="number" min="0" max="10000" step="any" inputmode="decimal"></label>
          <label><span data-n="nutri_score"></span><select data-p="nutri_score"><option value=""></option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></label>
          <label><span data-n="ean"></span><input data-p="ean" type="text" maxlength="14" inputmode="numeric"></label>
          <label><span data-n="price"></span><input data-p="price" type="number" min="0" max="10000" step="0.01" inputmode="decimal"></label>
          <label class="wide"><span data-n="allergens"></span><input data-p="allergens" type="text" maxlength="200"></label>
          <label class="wide"><span data-n="nutrients"></span><textarea data-p="nutrients" rows="2" maxlength="500"></textarea></label>
        </div>
        <div class="source" hidden></div>
      </details>
      <div class="nfcrow"><span class="nfcstate"></span><button class="nfcbtn" type="button"></button></div>
      <div class="actions"><button class="fill" type="button"></button><button class="transfer" type="button" hidden></button><button class="move" type="button" hidden></button><button class="openpack" type="button" hidden></button><button class="empty" type="button"></button><span class="spacer"></span><img class="qr" alt=""></div>
      <div class="outcomerow" hidden><span class="otext"></span><button class="eaten" type="button"></button><button class="thrown" type="button"></button><button class="ocancel" type="button"></button></div>
      <details class="history"><summary></summary><ul></ul></details>`;
    this.el = el;
    this.q = (sel) => el.querySelector(sel);
    this.inputs = {
      content: this.q('[data-f="content"]'),
      bestBefore: this.q('[data-f="bestBefore"]'),
      filledAt: this.q('[data-f="filledAt"]'),
      quantity: this.q('[data-f="quantity"]'),
      unit: this.q('[data-f="unit"]'),
    };

    this._areaSig = "";
    this.q('[data-f="area"]').addEventListener("change", async (ev) => {
      const hass = this._panel.hass;
      if (!hass || !hass.callWS) return;
      try {
        await hass.callWS({
          type: "config/device_registry/update",
          device_id: this.deviceId,
          area_id: ev.target.value || null,
        });
      } catch (err) {
        this._panel.showError(strings(hass).areaChangeFailed);
      }
    });
    this.q("a.open").addEventListener("click", () => navigate(`/config/devices/device/${this.deviceId}`));
    this.inputs.content.addEventListener("change", () => {
      if (this.ids.text) this._call("text", "set_value", { entity_id: this.ids.text, value: this.inputs.content.value });
    });
    for (const input of el.querySelectorAll("[data-p]")) {
      input.addEventListener("change", () => {
        const hass = this._panel.hass;
        if (!hass || !hass.callWS) return;
        hass
          .callWS({ type: `${DOMAIN}/product_set`, device_id: this.deviceId, product: { [input.dataset.p]: input.value.trim() } })
          .catch(() => {});
      });
    }
    this.q('[data-f="compartment"]').addEventListener("change", (ev) => {
      if (!this.ids.compartment) return;
      this._call("text", "set_value", { entity_id: this.ids.compartment, value: ev.target.value.trim() });
      rememberCompartment(this._areaId, ev.target.value);
    });
    this.inputs.bestBefore.addEventListener("change", () => {
      const v = this.inputs.bestBefore.value;
      if (!this.ids.date) return;
      if (v) this._call("date", "set_value", { entity_id: this.ids.date, date: v });
      else this._call(DOMAIN, "clear_best_before", { entity_id: this.ids.date }); // Leeren geht nur über unseren Service
    });
    this.inputs.filledAt.addEventListener("change", () => {
      const v = this.inputs.filledAt.value;
      if (!this.ids.datetime) return;
      const d = new Date(v);
      if (!v) this._call(DOMAIN, "clear_filled_at", { entity_id: this.ids.datetime });
      else if (!Number.isNaN(d.getTime())) {
        this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: d.toISOString() });
      }
    });
    this.q("button.plus1").addEventListener("click", () => {
      const next = addDays(this.inputs.bestBefore.value, 1);
      if (next && this.ids.date) this._call("date", "set_value", { entity_id: this.ids.date, date: next });
    });
    this.q("button.opened").addEventListener("click", () => {
      if (this.ids.date) this._call(DOMAIN, "mark_opened", { entity_id: this.ids.date });
    });
    this.q("button.thawed").addEventListener("click", () => {
      if (this.ids.date) this._call(DOMAIN, "mark_thawed", { entity_id: this.ids.date });
    });
    this.inputs.quantity.addEventListener("change", () => {
      if (!this.ids.number) return;
      this._call("number", "set_value", { entity_id: this.ids.number, value: parseQuantity(this.inputs.quantity.value) });
    });
    this.inputs.unit.addEventListener("change", () => {
      if (this.ids.select) this._call("select", "select_option", { entity_id: this.ids.select, option: this.inputs.unit.value });
    });
    // Portion entnehmen: −1; bei der letzten fragen, ob die Dose geleert werden soll
    this.q("button.take").addEventListener("click", () => {
      const n = parseQuantity(this.inputs.quantity.value);
      if (!this.ids.number || !(n > 0)) return;
      if (n > 1) {
        this._call("number", "set_value", { entity_id: this.ids.number, value: n - 1 });
        return;
      }
      this.q(".lastrow").hidden = false;
    });
    this.q("button.lastempty").addEventListener("click", () => {
      this.q(".lastrow").hidden = true;
      this._empty("eaten"); // die letzte Portion wurde ja gerade entnommen
    });
    this.q("button.lastkeep").addEventListener("click", () => {
      this.q(".lastrow").hidden = true;
      if (this.ids.number) this._call("number", "set_value", { entity_id: this.ids.number, value: 0 });
    });
    this.q("button.now").addEventListener("click", () => {
      if (this.ids.datetime) this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: new Date().toISOString() });
    });
    // Leeren: erst fragen, ob gegessen oder weggeworfen (für den Verlauf)
    this.q("button.empty").addEventListener("click", () => {
      this._setTip("");
      this.q(".outcomerow").hidden = false;
    });
    this.q("button.eaten").addEventListener("click", () => this._empty("eaten"));
    this.q("button.thrown").addEventListener("click", () => this._empty("thrown"));
    this.q("button.ocancel").addEventListener("click", () => (this.q(".outcomerow").hidden = true));
    this.q("details.history").addEventListener("toggle", () => {
      if (this.q("details.history").open) this.loadHistory();
    });
    this.inputs.content.addEventListener("input", () => this._setTip(""));
    this.q('[data-f="vacuum"]').addEventListener("change", (ev) => {
      if (this.ids.switch) this._call("switch", ev.target.checked ? "turn_on" : "turn_off", { entity_id: this.ids.switch });
    });
    this.q('[data-f="shopping"]').addEventListener("change", (ev) => {
      if (this.ids.shopping) this._call("switch", ev.target.checked ? "turn_on" : "turn_off", { entity_id: this.ids.shopping });
    });
    this.q('[data-f="flexible"]').addEventListener("change", (ev) => {
      if (this.ids.flexible) this._call("switch", ev.target.checked ? "turn_on" : "turn_off", { entity_id: this.ids.flexible });
    });
    this.q('[data-f="homeArea"]').addEventListener("change", (ev) => {
      if (this.ids.homeArea) this._call("select", "select_option", { entity_id: this.ids.homeArea, option: ev.target.value });
    });
    this.q("button.estimate").addEventListener("click", () => this._estimate());
    this.q("button.fill").addEventListener("click", () => this._panel.openFillDialog(this.deviceId));
    // Packung öffnen und in eine leere Dose umfüllen: die Auswahl der Dose übernimmt das Dashboard
    this.q("button.openpack").addEventListener("click", () => {
      this._panel.dispatchEvent(new CustomEvent("larder-open-pack", { detail: { deviceId: this.deviceId } }));
    });
    this.q("button.move").addEventListener("click", () => {
      this._panel.dispatchEvent(new CustomEvent("larder-move", { detail: { deviceId: this.deviceId } }));
    });
    // Mindestbestand des Produkts (gilt für alle Packungen mit diesem Inhalt)
    this.q('[data-f="minStock"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      const value = Math.max(0, Math.min(999, parseInt(ev.target.value, 10) || 0));
      hass.callWS({ type: `${DOMAIN}/stock_min`, content, min: value }).catch(() => this._panel.showError(strings(hass).minStockFailed));
    });
    this.q("button.transfer").addEventListener("click", () => {
      this._panel.dispatchEvent(new CustomEvent("larder-transfer", { detail: { deviceId: this.deviceId } }));
    });
    this.q("button.nfcbtn").addEventListener("click", () => this._panel.nfcAction(this.deviceId));
  }

  _setTip(text, isError = false) {
    this._tip = text;
    this._tipError = isError;
    const el = this.q(".tip");
    el.textContent = text;
    el.classList.toggle("error", isError);
  }

  /** MHD per Tabelle/KI schätzen (Service der Integration); zeigt Hinweis oder Fehlermeldung an. */
  async _estimate() {
    const hass = this._panel.hass;
    if (!hass || !this.ids.date || this._estimating || !hass.callWS) return;
    const t = strings(hass);
    this._estimating = true;
    this.q("button.estimate").disabled = true;
    this.q("button.estimate").textContent = t.estimating;
    this._setTip("");
    try {
      const res = await hass.callWS({
        type: "call_service",
        domain: DOMAIN,
        service: "estimate_best_before",
        service_data: {},
        target: { entity_id: this.ids.date },
        return_response: true,
      });
      const out = res && res.response && res.response[this.ids.date];
      if (out && out.status === "estimated") {
        const source = sourceLabel(t, out.source, out.origin);
        const head = t.estimated(out.days) + (source ? ` (${source})` : "");
        this._setTip([head, out.tip].filter(Boolean).join(". "));
      }
    } catch (err) {
      this._setTip((err && err.message) || t.estimateFailed, true);
    } finally {
      this._estimating = false;
      this.q("button.estimate").textContent = t.estimate;
      this.q("button.estimate").disabled = false;
    }
  }

  _call(domain, service, data) {
    const hass = this._panel.hass;
    if (hass) hass.callService(domain, service, data);
  }

  /** Dose leeren und festhalten, was mit dem Inhalt passiert ist (ohne Verlauf: einfach den Button drücken). */
  async _empty(outcome) {
    this.q(".outcomerow").hidden = true;
    const hass = this._panel.hass;
    if (!hass || !this.ids.button) return;
    try {
      await hass.callWS({ type: `${DOMAIN}/empty`, device_id: this.deviceId, outcome });
    } catch {
      this._call("button", "press", { entity_id: this.ids.button });
    }
    if (this.q("details.history").open) this.loadHistory();
  }

  async loadHistory() {
    const hass = this._panel.hass;
    const t = strings(hass);
    const list = this.q("details.history ul");
    let records = [];
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/history`, device_id: this.deviceId, limit: 10 });
      records = (res && res.records) || [];
    } catch {
      records = [];
    }
    const lang = (hass.language || "en").toLowerCase();
    const day = (iso) => {
      const d = iso ? new Date(iso) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
    };
    list.replaceChildren(
      ...(records.length
        ? records.map((r) => {
            const li = document.createElement("li");
            const span = [day(r.filled_at), day(r.emptied)].filter(Boolean).join(" – ");
            const result = r.outcome ? t.historyOutcome[r.outcome] : r.expired ? t.historyExpired : "";
            li.textContent = [span, r.content, result].filter(Boolean).join(" · ");
            if (r.outcome) li.dataset.outcome = r.outcome;
            return li;
          })
        : [Object.assign(document.createElement("li"), { textContent: t.historyEmpty })]),
    );
  }

  _isFocused(input) {
    const root = this._panel.shadowRoot;
    return !!root && root.activeElement === input;
  }

  _setInput(input, value) {
    if (this._isFocused(input)) return; // nie überschreiben, während jemand tippt
    if (input.value !== value) input.value = value;
  }

  update(hass, dev) {
    const t = strings(hass);
    this.ids = dev.entities;
    const states = hass.states || {};

    this.q(".name").textContent = dev.name;
    this.q(".name").title = dev.name;
    const open = this.q("a.open");
    open.textContent = t.openDevice;
    const admin = isAdmin(hass);
    const arealine = this.q(".arealine");
    arealine.textContent = `${t.area}: ${dev.areaName || t.noArea}`;
    arealine.classList.toggle("hidden", admin);
    this.q(".arearow").classList.toggle("visible", admin);
    this.q('[data-l="area"]').textContent = t.area;
    // Produktdaten und Nährwerte (Attribute der Entität "Inhalt"); nur bei gefüllter Dose
    const contentState = states[dev.entities.text];
    const attrs = (contentState && contentState.attributes) || {};
    const nut = this.q("details.nutrition");
    const filledNow = isValidState(contentState) && contentState.state.trim() !== "";
    const decimalComma = String(hass.language || "en").toLowerCase().startsWith("de");
    nut.hidden = !filledNow;
    const warn = this.q(".allergen-warning");
    const warned = filledNow && Array.isArray(attrs.allergen_warning) && attrs.allergen_warning.length > 0;
    warn.hidden = !warned;
    warn.textContent = warned ? t.allergenWarning(attrs.allergen_warning.join(", ")) : "";
    const bits = [t.nutrition];
    if (attrs.kcal_100g !== undefined) bits.push(`${String(attrs.kcal_100g).replace(".", decimalComma ? "," : ".")} kcal/100 g`);
    if (attrs.nutri_score) bits.push(`Nutri-Score ${attrs.nutri_score}`);
    nut.querySelector("summary").textContent = bits.join(" · ");
    for (const label of nut.querySelectorAll("[data-n]")) label.textContent = t.nutritionFields[label.dataset.n];
    for (const input of nut.querySelectorAll("[data-p]")) {
      const v = attrs[input.dataset.p];
      this._setInput(input, v === undefined || v === null ? "" : String(v));
    }
    nut.querySelector('[data-p="nutrients"]').placeholder = t.nutrientsHint;
    const source = nut.querySelector(".source");
    source.hidden = attrs.source !== "openfoodfacts";
    source.textContent = t.offSource;
    // Fach im Bereich (z. B. "Schublade 2")
    const comp = states[dev.entities.compartment];
    this.q(".comprow").style.display = comp ? "" : "none";
    this.q('[data-l="compartment"]').textContent = t.compartment;
    const compInput = this.q('[data-f="compartment"]');
    compInput.placeholder = t.compartmentHint;
    this._areaId = dev.areaId || "";
    if (comp) attachCompartmentChips(compInput, () => knownCompartments(hass, this._panel._devices, this._areaId));
    compInput.disabled = !comp || comp.state === "unavailable";
    this._setInput(compInput, isValidState(comp) ? comp.state : "");
    if (admin) {
      const select = this.q('[data-f="area"]');
      const areas = listAreas(hass, this._panel.larderLabel, dev.areaId);
      const sig = JSON.stringify([areas, t.noArea]);
      if (sig !== this._areaSig) {
        this._areaSig = sig;
        select.replaceChildren(
          ...[{ id: "", name: t.noArea }, ...areas].map((a) => {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = a.name;
            return opt;
          }),
        );
      }
      this._setInput(select, dev.areaId || "");
    }
    this.q('[data-l="content"]').textContent = t.content;
    this.q('[data-l="bestBefore"]').textContent = t.bestBefore;
    this.q('[data-l="filledAt"]').textContent = t.filledAt;
    this.q("button.now").textContent = t.now;
    this.q("button.plus1").textContent = t.plusOneDay;
    this.q("button.opened").textContent = t.opened;
    this.q("button.thawed").textContent = t.thawed;
    this.q('[data-l="quantity"]').textContent = t.quantity;
    this.q("button.empty").textContent = t.emptyContainer;
    this.q(".otext").textContent = t.outcomeQuestion;
    this.q("button.eaten").textContent = t.eaten;
    this.q("button.thrown").textContent = t.thrown;
    this.q("button.ocancel").textContent = t.cancel;
    this.q("details.history summary").textContent = t.history;
    this.q("button.fill").textContent = t.fill;
    this.q('[data-l="vacuum"]').textContent = t.vacuum;
    this.q('[data-l="shopping"]').textContent = t.shopping;
    this.q('[data-l="flexible"]').textContent = t.flexible;
    this.q('[data-l="homeArea"]').textContent = t.homeArea;
    if (!this._estimating) this.q("button.estimate").textContent = t.estimate;

    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    const dt = states[dev.entities.datetime];
    const btn = states[dev.entities.button];
    const img = states[dev.entities.image];
    const ok = (st) => !!st && st.state !== "unavailable";

    this._setInput(this.inputs.content, isValidState(text) ? text.state : "");
    this._setInput(this.inputs.bestBefore, isValidState(date) ? date.state : "");
    this._setInput(this.inputs.filledAt, isValidState(dt) ? toLocalInputValue(dt.state) : "");
    const quantity = states[dev.entities.number];
    const nQuantity = isValidState(quantity) ? Number(quantity.state) : 0;
    this._setInput(this.inputs.quantity, nQuantity > 0 ? String(nQuantity) : "");
    this.inputs.quantity.disabled = !ok(quantity);
    const unit = states[dev.entities.select];
    fillUnitSelect(this.inputs.unit, unit, t);
    this.inputs.unit.disabled = !ok(unit);
    this.inputs.unit.style.display = unit ? "" : "none";
    this.q(".quantityrow").style.display = quantity ? "" : "none";
    // −1 nur für zählbare Einheiten (nicht Gramm/Milliliter) und solange etwas da ist
    const countable = !unit || ["portions", "pieces", "slices"].includes(unit.state);
    const take = this.q("button.take");
    take.hidden = !(countable && nQuantity > 0 && ok(quantity));
    take.title = t.takeOne;
    take.setAttribute("aria-label", t.takeOne);
    if (take.hidden) this.q(".lastrow").hidden = true;
    this.q(".lasttext").textContent = t.lastOne;
    this.q("button.lastempty").textContent = t.emptyContainer;
    this.q("button.lastkeep").textContent = t.keep;
    this.inputs.content.disabled = !ok(text);
    this.inputs.bestBefore.disabled = !ok(date);
    this.inputs.filledAt.disabled = !ok(dt);
    this.q(".filledrow").style.display = dt ? "" : "none"; // Packungen haben kein Befüll-Datum
    this.q("button.now").disabled = !ok(dt);

    // Schnellaktionen unter dem MHD: +1 Tag (nur mit MHD) und Geöffnet (sobald etwas drin ist).
    const hasContentNow = isValidState(text) && text.state.trim() !== "";
    this.q(".quickrow").classList.toggle("visible", ok(date) && hasContentNow);
    this.q("button.fill").classList.toggle("visible", ok(text) && !hasContentNow);
    this.q("button.plus1").disabled = !isValidState(date);

    // NFC: nur für Administratoren (Verknüpfen und Lösen sind Administrator-Befehle).
    const nfc = this._panel.nfcState(this.deviceId);
    const kind = (text && text.attributes && text.attributes.kind) || "container";
    this.q(".nfcrow").classList.toggle("visible", admin && nfc !== null && kind !== "pack");
    const transfer = this.q("button.transfer");
    transfer.hidden = !(kind === "pack" && hasContentNow);
    transfer.textContent = t.transfer;
    const opened = kind === "pack" && hasContentNow && text.attributes && text.attributes.opened;
    const openBtn = this.q("button.openpack");
    openBtn.hidden = !(kind === "pack" && hasContentNow && !opened);
    openBtn.textContent = t.openPack;
    const openedLine = this.q(".openedline");
    openedLine.hidden = !opened;
    openedLine.textContent = opened ? t.openedSince(opened) : "";
    const move = this.q("button.move");
    move.hidden = !(kind === "pack" && hasContentNow);
    move.textContent = t.movePack;
    // ältestes zuerst: liegt dieselbe Ware woanders mit früherem MHD?
    const older = this.q(".olderhint");
    older.hidden = true;
    if (kind === "pack" && hasContentNow && isValidState(date)) {
      const key = text.state.trim().toLowerCase();
      let best = null;
      for (const other of this._panel._devices || []) {
        if (other.deviceId === this.deviceId) continue;
        const ot = states[other.entities.text];
        const od = states[other.entities.date];
        if (!isValidState(ot) || !isValidState(od) || (ot.attributes && ot.attributes.kind) !== "pack") continue;
        if (ot.state.trim().toLowerCase() !== key || od.state >= date.state) continue;
        if (!best || od.state < best.date) {
          const comp = states[other.entities.compartment];
          best = { date: od.state, place: [other.areaName, isValidState(comp) ? comp.state.trim() : ""].filter(Boolean).join(" · ") || t.noArea };
        }
      }
      if (best) {
        older.hidden = false;
        older.textContent = t.olderElsewhere(best.place, best.date);
      }
    }
    // Rückrufwarnung zu diesem Inhalt (ungelesen)
    const recallLine = this.q(".recallline");
    const recall = hasContentNow && text && text.attributes ? text.attributes.recall : null;
    recallLine.hidden = !recall;
    if (recall) {
      recallLine.querySelector(".txt").textContent = t.recallLine(recall.title, recall.reason);
      const link = recallLine.querySelector("a");
      link.textContent = t.recallLink;
      link.href = recall.link;
    }
    // Packungen desselben Produkts (alle Orte): Anzahl und Wert
    const isPack = kind === "pack" && hasContentNow && text.attributes;
    const priceOf = (attrs) => {
      if (!attrs) return null;
      if (Number(attrs.price) > 0) return { price: Number(attrs.price), source: attrs.price_source || "own" };
      if (Number(attrs.price_remembered) > 0) return { price: Number(attrs.price_remembered), source: attrs.price_remembered_source || "own" };
      return null;
    };
    let total = 0;
    let value = 0;
    if (isPack) {
      const key = text.state.trim().toLowerCase();
      for (const other of this._panel._devices || []) {
        const ot = states[other.entities.text];
        if (!isValidState(ot) || (ot.attributes && ot.attributes.kind) !== "pack" || ot.state.trim().toLowerCase() !== key) continue;
        const q = states[other.entities.number];
        const u = states[other.entities.select];
        const n = isValidState(q) ? Number(q.state) : 0;
        const count = n > 0 && (!u || ["pieces", "portions"].includes(u.state)) ? n : 1;
        total += count;
        const p = priceOf(ot.attributes);
        if (p) value += count * p.price;
      }
    }
    // Verbrauch: reicht der Bestand dieses Produkts (alle Orte) noch wie lange?
    const usageLine = this.q(".usageline");
    const perWeek = isPack ? Number(text.attributes.consumption_per_week) : 0;
    usageLine.hidden = !(perWeek > 0);
    if (perWeek > 0) {
      const basis = text.attributes.consumption_basis || {};
      usageLine.textContent = t.usageLine(Math.round((total / perWeek) * 7), basis.takes || 0, basis.days || 0);
    }
    // Preis je Packung und Wert aller Packungen dieses Produkts
    const priceLine = this.q(".priceline");
    const ownPrice = isPack ? priceOf(text.attributes) : null;
    priceLine.hidden = !ownPrice;
    if (ownPrice) priceLine.textContent = t.priceLine(ownPrice.price, ownPrice.source === "openprices", total > 1 ? value : null);
    const priceInput = this.q('[data-p="price"]');
    priceInput.placeholder = text && text.attributes && text.attributes.price_remembered ? String(text.attributes.price_remembered) : "";
    const minRow = this.q(".minrow");
    minRow.hidden = !(kind === "pack" && hasContentNow);
    this.q('[data-l="minStock"]').textContent = t.minStock;
    if (!minRow.hidden) this._setInput(this.q('[data-f="minStock"]'), text.attributes.min_stock ? String(text.attributes.min_stock) : "");
    if (nfc !== null) {
      this.q(".nfcstate").textContent = { linked: t.nfcLinked, none: t.nfcNone, waiting: t.nfcWaiting }[nfc];
      this.q("button.nfcbtn").textContent = { linked: t.nfcUnlink, none: t.nfcLink, waiting: t.cancel }[nfc];
    }

    const vac = states[dev.entities.switch];
    const vacInput = this.q('[data-f="vacuum"]');
    this.q(".vacrow").style.display = vac ? "" : "none";
    vacInput.disabled = !ok(vac);
    vacInput.checked = !!vac && vac.state === "on";

    // "Beim Leeren auf die Einkaufsliste": nur sichtbar, wenn in den Einstellungen eine Liste gewählt ist.
    const shop = states[dev.entities.shopping];
    const shopInput = this.q('[data-f="shopping"]');
    this.q(".shoprow").style.display = hasShoppingList(shop) ? "" : "none";
    shopInput.disabled = !ok(shop);
    shopInput.checked = !!shop && shop.state === "on";

    // Variabler Lagerort: Schalter, und nur wenn er an ist, der Lagerort nach dem Leeren
    const flex = states[dev.entities.flexible];
    const flexInput = this.q('[data-f="flexible"]');
    this.q(".flexrow").style.display = flex ? "" : "none";
    flexInput.disabled = !ok(flex);
    flexInput.checked = !!flex && flex.state === "on";
    const home = states[dev.entities.homeArea];
    const homeSelect = this.q('[data-f="homeArea"]');
    const showHome = !!home && !!flex && flex.state === "on";
    this.q(".homerow").style.display = showHome ? "" : "none";
    if (showHome) {
      const options = (home.attributes && home.attributes.options) || ["none"];
      const sig = JSON.stringify([options, t.homeNone]);
      if (homeSelect.dataset.sig !== sig) {
        homeSelect.dataset.sig = sig;
        homeSelect.replaceChildren(
          ...options.map((o) => {
            const opt = document.createElement("option");
            opt.value = o;
            opt.textContent = o === "none" ? t.homeNone : o;
            return opt;
          }),
        );
      }
      this._setInput(homeSelect, home.state);
      homeSelect.disabled = !ok(home);
    }

    // "MHD schätzen": nur sichtbar, wenn die Schätzung nicht ausgeschaltet ist, Inhalt da und MHD noch leer.
    const aiOn = !!(date && date.attributes && date.attributes.estimates);
    const hasContent = isValidState(text) && text.state.trim() !== "";
    const showEstimate = aiOn && ok(date) && hasContent && !isValidState(date);
    this.q(".estimaterow").classList.toggle("visible", showEstimate || !!this._tip);
    this.q("button.estimate").style.display = showEstimate || this._estimating ? "" : "none";
    this.q("button.empty").disabled = !ok(btn);

    const badge = this.q(".badge");
    badge.className = "badge";
    badge.textContent = "";
    const days = isValidState(date) ? daysUntil(date.state) : null;
    if (days !== null) {
      if (days < 0) {
        badge.className = "badge expired";
        badge.textContent = t.expired;
      } else if (days <= soonDaysOf(date)) {
        badge.className = "badge soon";
        badge.textContent = days === 0 ? t.expiresToday : t.expiresInDays(days);
      }
    }

    const qr = this.q("img.qr");
    const pic = img && img.attributes && img.attributes.entity_picture;
    if (pic) {
      const src = hass.hassUrl ? hass.hassUrl(pic) : pic;
      if (src !== this._qrSrc) {
        this._qrSrc = src;
        qr.src = src;
      }
      qr.alt = t.qrCode;
      qr.title = t.qrCode;
      qr.classList.add("visible");
    } else {
      qr.classList.remove("visible");
    }
  }
}

class LarderPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this.larderLabel = null; // IDs der Beschriftungen "Larder" / "Larder: …" (nur wenn es sie gibt)
    this._cards = new Map();
    this._devices = [];
    this._pendingFill = null; // eben angelegte Dose, für die der Befüll-Dialog aufgehen soll
    this._registries = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header><button id="menu" type="button" aria-label="Menu">☰</button><button id="back" type="button" aria-label="Back">←</button><h1></h1><span class="count"></span><div class="tabs"><button type="button" data-view="containers"></button><button type="button" data-view="estimates"></button></div><button class="ideas" type="button"></button><button class="add" type="button"></button></header>
      <main><div id="notice" class="notice" hidden></div><div class="toolbar" hidden><input type="search" data-f="query" autocomplete="off"><select data-f="filter"></select><select data-f="sort"></select></div><div id="content"></div><div id="estimates" hidden></div></main>
      <div class="overlay" hidden>
        <form class="dialog" novalidate>
          <h2></h2>
          <div class="modes">
            <label><input type="radio" name="mode" value="new" checked> <span data-l="modeNew"></span></label>
            <label><input type="radio" name="mode" value="scan"> <span data-l="modeZwilling"></span></label>
            <label><input type="radio" name="mode" value="nfc"> <span data-l="nfcScan"></span></label>
            <label data-w="nfcwrite" hidden><input type="radio" name="mode" value="nfcwrite"> <span data-l="nfcWrite"></span></label>
          </div>
          <div class="nfcstatus" data-w="nfc" role="status" hidden></div>
          <label class="field" data-w="code" hidden><span data-l="codeLabel"></span><input type="text" data-f="code" autocomplete="off"></label>
          <label class="field"><span data-l="nameLabel"></span><input type="text" data-f="name" autocomplete="off"></label>
          <label class="field"><span data-l="area"></span><select data-f="area"></select></label>
          <label class="check"><input type="checkbox" data-f="vacuum"><span data-l="vacuum"></span></label>
          <label class="check" data-w="shopping" hidden><input type="checkbox" data-f="shopping"><span data-l="shopping"></span></label>
          <label class="check"><input type="checkbox" data-f="flexible"><span data-l="flexible"></span></label>
          <label class="field" data-w="homeArea" hidden><span data-l="homeArea"></span><select data-f="homeArea"></select></label>
          <div class="error" role="alert"></div>
          <div class="buttons"><button type="button" class="cancel"></button><button type="submit" class="submit"></button></div>
        </form>
      </div>
      <div class="overlay fill" hidden>
        <form class="dialog fillform" novalidate>
          <h2></h2>
          <label class="field"><span data-l="content"></span><span class="contentline"><input type="text" data-f="content" maxlength="255" list="zs-contents" autocomplete="off"><button type="button" class="barcode" hidden>EAN</button><button type="button" class="photo" hidden>📷</button><input type="file" class="photofile" accept="image/*" capture="environment" hidden></span><datalist id="zs-contents"></datalist></label>
          <div class="hint barcodestatus" role="status" hidden></div>
          <label class="field" data-w="area" hidden><span data-l="area"></span><select data-f="area"></select></label>
          <label class="field" data-w="compartment" hidden><span data-l="compartment"></span><input type="text" data-f="compartment" maxlength="60" autocomplete="off"></label>
          <label class="field" data-w="quantity"><span data-l="quantity"></span><span class="qty"><input type="number" data-f="quantity" min="0" max="9999" step="1" inputmode="numeric"><select data-f="unit"></select></span></label>
          <label class="check" data-w="vacuum"><input type="checkbox" data-f="vacuum"><span data-l="vacuum"></span></label>
          <label class="check" data-w="shopping"><input type="checkbox" data-f="shopping"><span data-l="shopping"></span></label>
          <label class="field"><span data-l="filledAt"></span><input type="datetime-local" data-f="filledAt"></label>
          <label class="field"><span data-l="bestBefore"></span><input type="date" data-f="bestBefore"></label>
          <label class="check" data-w="estimate"><input type="checkbox" data-f="estimate" checked><span data-l="fillEstimate"></span></label>
          <div class="error" role="alert"></div>
          <div class="buttons"><button type="button" class="cancel"></button><button type="submit" class="submit"></button></div>
        </form>
      </div>
      <div class="overlay recipes" hidden>
        <form class="dialog recipeform" novalidate>
          <h2 data-l="recipeTitle"></h2>
          <p class="hint" data-l="recipeHint"></p>
          <div class="recipeopts">
            <label class="field"><span data-l="recipeDays"></span><input type="number" data-f="days" min="0" max="365" step="1" value="3" inputmode="numeric"></label>
            <label class="field"><span data-l="recipeServings"></span><input type="number" data-f="servings" min="1" max="20" step="1" inputmode="numeric"></label>
          </div>
          <div class="error" role="alert"></div>
          <div class="recipelist" role="status"></div>
          <div class="buttons"><button type="button" class="cancel"></button><button type="submit" class="submit"></button></div>
        </form>
      </div>`;
    this._main = this.shadowRoot.querySelector("#content");
    this._notice = this.shadowRoot.querySelector("#notice");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._form = this.shadowRoot.querySelector("form.dialog");
    this._addBtn = this.shadowRoot.querySelector("button.add");
    this._busy = false;
    this._addBtn.addEventListener("click", () => this.openAddDialog());
    this._overlay.addEventListener("click", (ev) => {
      if (ev.target === this._overlay) this.closeAddDialog();
    });
    this._form.querySelector("button.cancel").addEventListener("click", () => this.closeAddDialog());
    this._form.querySelector('[data-f="flexible"]').addEventListener("change", () => this._syncHomeArea());
    this._form.querySelector('[data-f="area"]').addEventListener("change", () => {
      if (this._form.querySelector('[data-f="flexible"]').checked) this._syncHomeArea();
    });
    for (const radio of this._form.querySelectorAll('input[name="mode"]')) {
      radio.addEventListener("change", () => this._syncMode());
    }
    this._form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.submitAdd();
    });
    this._fillOverlay = this.shadowRoot.querySelector(".overlay.fill");
    this._fillForm = this.shadowRoot.querySelector("form.fillform");
    this._fillDevices = [];
    this._contents = [];
    this._fillOverlay.addEventListener("click", (ev) => {
      if (ev.target === this._fillOverlay) this.closeFillDialog();
    });
    this._fillForm.querySelector("button.cancel").addEventListener("click", () => this.closeFillDialog());
    this._fillForm.querySelector("button.barcode").addEventListener("click", () => this.scanBarcode());
    this._fillForm.querySelector("button.photo").addEventListener("click", () => this._fillForm.querySelector("input.photofile").click());
    this._fillForm.querySelector("input.photofile").addEventListener("change", (ev) => this.contentFromPhoto(ev.target));
    this._fillForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.submitFill();
    });
    this._recipeOverlay = this.shadowRoot.querySelector(".overlay.recipes");
    this._recipeForm = this.shadowRoot.querySelector("form.recipeform");
    this._ideasBtn = this.shadowRoot.querySelector("button.ideas");
    this._ideasBtn.addEventListener("click", () => this.openRecipeDialog());
    this._recipeOverlay.addEventListener("click", (ev) => {
      if (ev.target === this._recipeOverlay) this.closeRecipeDialog();
    });
    this._recipeForm.querySelector("button.cancel").addEventListener("click", () => this.closeRecipeDialog());
    this._recipeForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.submitRecipes();
    });
    this._view = "containers";
    this._est = null;
    this._toolbar = this.shadowRoot.querySelector(".toolbar");
    this._opts = loadViewOptions();
    for (const field of ["query", "filter", "sort"]) {
      const node = this._toolbar.querySelector(`[data-f="${field}"]`);
      node.addEventListener(field === "query" ? "input" : "change", () => {
        this._opts[field] = node.value;
        saveViewOptions(this._opts);
        if (this._hass) this._update();
      });
    }
    this._layoutSig = "";
    this._nfcLinks = {}; // device_id -> tag_id
    this._nfcTag = null;
    this._capture = null; // { source, deviceId?, onTag }
    this._subscribed = false;
    this._unsubs = [];
    this._estimatesEl = this.shadowRoot.querySelector("#estimates");
    this._tabs = this.shadowRoot.querySelector(".tabs");
    for (const btn of this._tabs.querySelectorAll("button")) {
      btn.addEventListener("click", () => this.setView(btn.dataset.view));
    }
    this._title = this.shadowRoot.querySelector("h1");
    this._count = this.shadowRoot.querySelector(".count");
    this.shadowRoot.querySelector("#back").addEventListener("click", () => {
      this.removeAttribute("only");
      this.dispatchEvent(new Event("larder-detail-closed", { bubbles: true, composed: true }));
    });
    this.shadowRoot.querySelector("#menu").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
  }

  static get observedAttributes() {
    return ["only", "ids", "show"];
  }

  /**
   * Eingebettet im Dashboard: `only` zeigt die Karte einer Dose (mit Zurück-Knopf),
   * `show="cards"` mit `ids` (kommagetrennt, in dieser Reihenfolge) die Karten mehrerer Dosen,
   * `show="estimates"` die Liste der gemerkten Schätzungen.
   */
  attributeChangedCallback(name) {
    if (!this._opts) return;
    this._layoutSig = "";
    if (name === "show" && this._hass) {
      const show = this.getAttribute("show");
      if (show === null && this._view !== "containers") this.setView("containers");
      if (show === "estimates" || (show === "cards" && this._view !== "containers")) {
        this.setView(show === "estimates" ? "estimates" : "containers");
      }
    }
    if (this._hass) this._update();
  }

  get hass() {
    return this._hass;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._update();
    if (first) this.loadAreaLabel();
  }

  /**
   * ID der Beschriftung "Larder" suchen (Name ohne Beachtung der Groß-/Kleinschreibung). Nur Bereiche mit
   * dieser Beschriftung erscheinen dann in der Bereichsauswahl. Nur für Administratoren (Registerabfrage).
   */
  async loadAreaLabel() {
    const hass = this._hass;
    if (!hass || !hass.callWS || !isAdmin(hass)) return;
    let ids = null;
    try {
      const labels = await hass.callWS({ type: "config/label_registry/list" });
      const found = (Array.isArray(labels) ? labels : []).filter(isLarderLabel).map((l) => l.label_id).sort();
      ids = found.length ? found : null;
    } catch (err) {
      ids = null; // ohne Beschriftungen: alle Bereiche zeigen
    }
    if (JSON.stringify(ids) !== JSON.stringify(this.larderLabel)) {
      this.larderLabel = ids;
      this._update();
    }
  }

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  // Von Home Assistant gesetzt, hier nicht benötigt.
  set route(_value) {}
  set panel(_value) {}

  _mode() {
    return this._form.querySelector('input[name="mode"]:checked').value;
  }

  _syncMode() {
    const mode = this._mode();
    this._form.querySelector('[data-w="code"]').hidden = mode !== "scan";
    const status = this._form.querySelector('[data-w="nfc"]');
    status.hidden = mode !== "nfc" && mode !== "nfcwrite";
    if (mode === "nfcwrite") {
      this._nfcTag = null;
      this.cancelCapture("dialog");
      status.textContent = strings(this._hass).nfcWriteHint;
    } else if (mode === "nfc") {
      this._nfcTag = null;
      this._setNfcStatus();
      this.startCapture((tag) => this._dialogTag(tag), "dialog");
    } else {
      this.cancelCapture("dialog");
    }
  }

  /** Kann die App (Companion) NFC-Tags beschreiben? Dann gibt es im Dialog "Neuen NFC-Tag beschreiben". */
  _refreshWriteSupport() {
    const ext = this._hass && this._hass.auth && this._hass.auth.external;
    const label = this._form.querySelector('[data-w="nfcwrite"]');
    if (!ext || typeof ext.fireMessage !== "function") {
      label.hidden = true;
      return;
    }
    Promise.resolve(ext.config)
      .then((cfg) => {
        label.hidden = !(cfg && cfg.canWriteTag);
      })
      .catch(() => {
        label.hidden = true;
      });
  }

  /** Neuen Tag in Home Assistant anlegen (damit er in der Tag-Liste steht) und die App zum Beschreiben auffordern. */
  async _writeNewTag(tagId, name) {
    const hass = this._hass;
    try {
      await hass.callWS({ type: "tag/create", tag_id: tagId, name });
    } catch (err) {
      /* nicht schlimm: der Tag funktioniert auch ohne Eintrag in der Tag-Liste */
    }
    hass.auth.external.fireMessage({ type: "tag/write", payload: { name, tag: tagId } });
  }

  _newTagId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
    return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
  }

  _setNfcStatus(message) {
    const t = strings(this._hass);
    this._form.querySelector('[data-w="nfc"]').textContent = message || (this._nfcTag ? t.nfcGot : t.nfcWaiting);
  }

  _dialogTag(tag) {
    const t = strings(this._hass);
    if (Object.values(this._nfcLinks).includes(tag)) {
      this._nfcTag = null;
      this._setNfcStatus(t.nfcInUse);
      return false; // weiter auf einen anderen Tag warten
    }
    this._nfcTag = tag;
    this._setNfcStatus();
    return true;
  }

  /** Fehlermeldung oberhalb der Karten anzeigen (z. B. wenn das Ändern des Bereichs scheitert). */
  showError(message) {
    this._notice.textContent = message || "";
    this._notice.hidden = !message;
  }

  /** Dialog "Dose hinzufügen" öffnen; mit `code` ist direkt "Zwilling-QR-Code einlesen" vorgewählt. */
  openAddDialog(code = "") {
    const hass = this._hass;
    if (!hass || !isAdmin(hass)) return;
    const t = strings(hass);
    this._form.querySelector('[data-f="name"]').value = "";
    this._form.querySelector('[data-f="code"]').value = code;
    const radio = this._form.querySelector(`input[name="mode"][value="${code ? "scan" : "new"}"]`);
    radio.checked = true;
    this._nfcTag = null;
    this.loadAreaLabel();
    this._refreshWriteSupport();
    this._syncMode();
    this._fillAreaOptions(t);
    this._form.querySelector('[data-f="area"]').value = "";
    // Vorgaben der neuen Dose: Vakuum (Vorbelegung aus den Einstellungen), Einkaufsliste (nur mit Liste), variabler Lagerort
    const f = (name) => this._form.querySelector(`[data-f="${name}"]`);
    f("vacuum").checked = true;
    f("shopping").checked = false;
    f("flexible").checked = false;
    this._form.querySelector('[data-w="shopping"]').hidden = !this._devices.some((d) => hasShoppingList((hass.states || {})[d.entities.shopping]));
    this._syncHomeArea();
    if (hass.callWS) {
      hass
        .callWS({ type: `${DOMAIN}/settings` })
        .then((res) => {
          if (res && typeof res.vacuum_default === "boolean") f("vacuum").checked = res.vacuum_default;
          if (res && typeof res.shopping_list === "boolean") this._form.querySelector('[data-w="shopping"]').hidden = !res.shopping_list;
        })
        .catch(() => {});
    }
    this._form.querySelector(".error").textContent = "";
    this._notice.hidden = true;
    this._overlay.hidden = false;
  }

  /** "Nach dem Leeren zurück in": nur bei variablem Lagerort, vorbelegt mit dem gewählten Bereich. */
  _syncHomeArea() {
    const t = strings(this._hass);
    const flexible = this._form.querySelector('[data-f="flexible"]').checked;
    const wrap = this._form.querySelector('[data-w="homeArea"]');
    wrap.hidden = !flexible;
    if (!flexible) return;
    const select = this._form.querySelector('[data-f="homeArea"]');
    const area = this._form.querySelector('[data-f="area"]').value;
    select.replaceChildren(
      ...[{ id: "", name: t.homeNone }, ...listAreas(this._hass, this.larderLabel)].map((a) => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        return opt;
      }),
    );
    select.value = area;
  }

  closeAddDialog() {
    this._overlay.hidden = true;
    this.cancelCapture("dialog");
  }

  _fillAreaOptions(t) {
    const select = this._form.querySelector('[data-f="area"]');
    select.replaceChildren(
      ...[{ id: "", name: t.noArea }, ...listAreas(this._hass, this.larderLabel)].map((a) => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        return opt;
      }),
    );
  }

  /** Dose über den Config Flow der Integration anlegen (gleicher Ablauf wie in den Einstellungen). */
  async submitAdd() {
    const hass = this._hass;
    if (!hass || this._busy) return;
    const t = strings(hass);
    const errorEl = this._form.querySelector(".error");
    const mode = this._mode();
    const code = this._form.querySelector('[data-f="code"]').value.trim();
    const name = this._form.querySelector('[data-f="name"]').value.trim();
    const area = this._form.querySelector('[data-f="area"]').value;
    errorEl.textContent = "";
    if (mode === "scan" && !code) {
      errorEl.textContent = t.invalidCode;
      return;
    }
    if (mode === "nfc" && !this._nfcTag) {
      errorEl.textContent = t.nfcWaiting;
      return;
    }

    const input = {};
    if (mode === "scan") input.qr_code = code;
    if (name) input.name = name;
    if (area) input.area_id = area;
    const check = (f) => this._form.querySelector(`[data-f="${f}"]`).checked;
    input.vacuum = check("vacuum");
    if (!this._form.querySelector('[data-w="shopping"]').hidden) input.shopping = check("shopping");
    input.flexible = check("flexible");
    const home = this._form.querySelector('[data-f="homeArea"]').value;
    if (input.flexible && home) input.home_area = home;

    this._busy = true;
    this._form.querySelector("button.submit").disabled = true;
    const knownDevices = new Set(this._devices.map((d) => d.deviceId));
    let flowId = null;
    try {
      let result = await hass.callApi("POST", "config/config_entries/flow", {
        handler: DOMAIN,
        show_advanced_options: false,
      });
      flowId = result.flow_id;
      result = await hass.callApi("POST", `config/config_entries/flow/${flowId}`, {
        next_step_id: mode === "scan" ? "scan" : "create", // "nfc" und "nfcwrite" legen wie "neu" eine neue ID an
      });
      result = await hass.callApi("POST", `config/config_entries/flow/${flowId}`, input);
      if (result.type === "create_entry") {
        flowId = null;
        if (mode === "nfc") {
          const entryId = result.result && result.result.entry_id;
          try {
            await this._linkTag({ tag_id: this._nfcTag, entry_id: entryId });
          } catch (err) {
            this.showError(t.nfcFailed + (err && err.message ? ` ${err.message}` : ""));
          }
        }
        if (mode === "nfcwrite") {
          const entryId = result.result && result.result.entry_id;
          const tagId = this._newTagId();
          try {
            await this._linkTag({ tag_id: tagId, entry_id: entryId });
            await this._writeNewTag(tagId, name || result.title || "Larder");
          } catch (err) {
            this.showError(t.nfcFailed + (err && err.message ? ` ${err.message}` : ""));
          }
        }
        this.closeAddDialog();
        // Neue Dose: sobald ihr Gerät da ist, gleich "Dose befüllen" öffnen (wie nach dem Scan einer leeren Dose).
        this._pendingFill = { known: knownDevices, until: Date.now() + 20000 };
        this._checkPendingFill();
        return;
      }
      if (result.type === "abort") {
        flowId = null;
        errorEl.textContent = result.reason === "already_configured" ? t.alreadyConfigured : t.addFailed;
        return;
      }
      errorEl.textContent = result.errors && result.errors.qr_code ? t.invalidCode : t.addFailed;
    } catch (err) {
      errorEl.textContent = t.addFailed;
    } finally {
      if (flowId) {
        try {
          await hass.callApi("DELETE", `config/config_entries/flow/${flowId}`);
        } catch (err) {
          /* Flow war schon beendet */
        }
      }
      this._busy = false;
      this._form.querySelector("button.submit").disabled = false;
    }
  }

  /** Wartet auf das Gerät einer eben angelegten Dose und öffnet dann den Befüll-Dialog dafür. */
  _checkPendingFill() {
    const pending = this._pendingFill;
    const hass = this._hass;
    if (!pending || !hass) return;
    if (Date.now() > pending.until) {
      this._pendingFill = null;
      return;
    }
    const states = hass.states || {};
    const dev = this._devices.find(
      (d) => !pending.known.has(d.deviceId) && d.entities.text && states[d.entities.text],
    );
    if (!dev || !this._cards.has(dev.deviceId)) return;
    this._pendingFill = null;
    this.highlight(dev.deviceId, true);
  }

  /** `?add=<ID>` (vom Scan-Webhook): Dialog mit Code öffnen, bzw. Hinweis für Nicht-Administratoren. */
  _handleAddParam() {
    if (this.hasAttribute("embedded")) return; // im Dashboard übernimmt das die äußere Ansicht
    const hass = this._hass;
    const code = new URLSearchParams(window.location.search).get("add");
    if (!code || !hass || !hass.user) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (isAdmin(hass)) {
      this.openAddDialog(code);
    } else {
      this.showError(strings(hass).adminOnly(code));
    }
  }

  /**
   * Dialog "Dose befüllen": Inhalt (mit Vorschlägen), Vakuum, Eingelagert am, MHD, optional schätzen.
   * Mit einer Liste von Geräte-IDs werden mehrere Dosen auf einmal mit denselben Angaben befüllt
   * (Menge gilt pro Dose); die Vorbelegung kommt dann von der ersten Dose, Inhalt und MHD bleiben leer.
   */
  openFillDialog(deviceIds) {
    const hass = this._hass;
    const wanted = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    const devs = hass ? wanted.map((id) => this._devices.find((d) => d.deviceId === id)).filter(Boolean) : [];
    if (!devs.length) return false;
    const many = devs.length > 1;
    const dev = devs[0];
    const t = strings(hass);
    const states = hass.states || {};
    const f = (name) => this._fillForm.querySelector(`[data-f="${name}"]`);
    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    const dt = states[dev.entities.datetime];
    const vac = states[dev.entities.switch];
    this._fillDevices = devs.map((d) => d.deviceId);
    this._fillForm.querySelector("h2").textContent = many ? t.fillTitleMany(devs.length) : `${t.fillTitle}: ${dev.name}`;
    f("content").value = !many && isValidState(text) ? text.state : "";
    f("content").placeholder = t.fillPlaceholder;
    const barcode = this._fillForm.querySelector("button.barcode");
    barcode.hidden = !this._hasBarcodeScanner();
    barcode.title = t.barcode;
    barcode.setAttribute("aria-label", t.barcode);
    const photo = this._fillForm.querySelector("button.photo");
    photo.hidden = !(hass.fetchWithAuth && hass.services && hass.services.ai_task);
    photo.title = t.contentPhoto;
    photo.setAttribute("aria-label", t.contentPhoto);
    const barcodeStatus = this._fillForm.querySelector(".barcodestatus");
    barcodeStatus.hidden = true;
    barcodeStatus.textContent = "";
    this._scannedProduct = null;
    const quantity = states[dev.entities.number];
    const nQuantity = isValidState(quantity) ? Number(quantity.state) : 0;
    f("quantity").value = nQuantity > 0 ? String(nQuantity) : "";
    fillUnitSelect(f("unit"), states[dev.entities.select], t);
    f("unit").style.display = states[dev.entities.select] ? "" : "none";
    this._fillForm.querySelector('[data-w="quantity"]').hidden = !quantity || quantity.state === "unavailable";
    f("vacuum").checked = !!vac && vac.state === "on";
    this._fillForm.querySelector('[data-w="vacuum"]').hidden = !vac || vac.state === "unavailable";
    // Bereich nur bei Dosen mit variablem Lagerort (und nur für Administratoren, die Bereiche ändern dürfen)
    const flexible = devs.filter((d) => {
      const st = states[d.entities.flexible];
      return !!st && st.state === "on";
    });
    const areaWrap = this._fillForm.querySelector('[data-w="area"]');
    areaWrap.hidden = !(isAdmin(hass) && flexible.length);
    if (!areaWrap.hidden) {
      const current = flexible[0].areaId || "";
      const areas = listAreas(hass, this.larderLabel, current);
      f("area").replaceChildren(
        ...[{ id: "", name: t.noArea }, ...areas].map((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name;
          return opt;
        }),
      );
      f("area").value = current;
    }
    // Fach gehört zum Platz: bei variablen Dosen zusammen mit dem Bereich abfragen
    const compWrap = this._fillForm.querySelector('[data-w="compartment"]');
    compWrap.hidden = areaWrap.hidden || !states[flexible[0] && flexible[0].entities.compartment];
    if (!compWrap.hidden) {
      const comp = states[flexible[0].entities.compartment];
      f("compartment").value = isValidState(comp) ? comp.state : "";
      f("compartment").placeholder = t.compartmentHint;
      // Fächer des gewählten Bereichs vorschlagen (wechselt mit dem Bereich)
      const refresh = attachCompartmentChips(f("compartment"), () => knownCompartments(hass, this._devices, f("area").value), () => {});
      f("area").onchange = refresh;
    }
    const shop = states[dev.entities.shopping];
    f("shopping").checked = !!shop && shop.state === "on";
    this._fillForm.querySelector('[data-w="shopping"]').hidden = !hasShoppingList(shop) || shop.state === "unavailable";
    f("filledAt").value = !many && isValidState(dt) ? toLocalInputValue(dt.state) : toLocalInputValue(new Date().toISOString());
    f("bestBefore").value = !many && isValidState(date) ? date.state : "";
    const canEstimate = !!(date && date.attributes && date.attributes.estimates) && date.state !== "unavailable";
    this._fillForm.querySelector('[data-w="estimate"]').hidden = !canEstimate;
    f("estimate").checked = true;
    this._fillForm.querySelector(".error").textContent = "";
    this._fillOverlay.hidden = false;
    this._loadContents();
    if (f("content").focus) f("content").focus();
    return true;
  }

  closeFillDialog() {
    this._fillOverlay.hidden = true;
    this._fillDevices = [];
  }

  /** Vorschläge für den Inhalt vom Server holen (zuletzt benutzte zuerst). */
  async _loadContents() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/contents` });
      this._contents = (res && Array.isArray(res.contents) ? res.contents : []).slice(0, 100);
    } catch (err) {
      /* Vorschläge sind optional */
    }
    const list = this._fillForm.querySelector("datalist");
    list.replaceChildren(
      ...this._contents.map((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        return opt;
      }),
    );
  }

  /** Kann die App (Companion) Strichcodes scannen? */
  _hasBarcodeScanner() {
    const external = this._hass && this._hass.auth && this._hass.auth.external;
    return !!(external && external.config && external.config.hasBarCodeScanner && typeof external._commandHandler === "function");
  }

  /** Strichcode gekaufter Ware scannen und den Produktnamen (Open Food Facts) als Inhalt eintragen. */
  scanBarcode() {
    const t = strings(this._hass);
    const status = this._fillForm.querySelector(".barcodestatus");
    this.scanBarcodeRaw((code) => this._lookupProduct(code, t, status));
  }

  /** Strichcode-Scanner der App öffnen; `onCode` bekommt den gelesenen Code (auch für das Dashboard). */
  scanBarcodeRaw(onCode) {
    const hass = this._hass;
    const external = hass && hass.auth && hass.auth.external;
    if (!this._hasBarcodeScanner() || typeof external.addCommandHandler !== "function" || this._barcodeScan) return;
    const t = strings(hass);
    const original = external._commandHandler;
    const scan = {};
    this._barcodeScan = scan;
    const finish = () => {
      if (this._barcodeScan !== scan) return;
      this._barcodeScan = null;
      external.addCommandHandler(original);
    };
    external.addCommandHandler((msg) => {
      if (this._barcodeScan === scan && msg && msg.command === "bar_code/scan_result") {
        const code = String((msg.payload && msg.payload.rawValue) || "");
        finish();
        external.fireMessage({ type: "bar_code/close" });
        onCode(code);
      } else if (this._barcodeScan === scan && msg && msg.command === "bar_code/aborted") {
        finish();
      }
      return original(msg);
    });
    external.fireMessage({
      type: "bar_code/scan",
      payload: { title: t.barcodeTitle, description: t.barcodeDescription, alternative_option_label: t.cancel },
    });
  }

  /** Foto hochladen, die KI schlägt den Inhalt vor (nur ein Vorschlag, gespeichert wird mit "Speichern"). */
  async contentFromPhoto(input) {
    const hass = this._hass;
    const file = input.files && input.files[0];
    if (!file || !hass.fetchWithAuth) return;
    const t = strings(hass);
    const status = this._fillForm.querySelector(".barcodestatus");
    const button = this._fillForm.querySelector("button.photo");
    status.hidden = false;
    status.textContent = t.contentPhotoBusy;
    button.disabled = true;
    try {
      const form = new FormData();
      form.append("file", file, file.name || "photo.jpg");
      const res = await hass.fetchWithAuth(`/api/${DOMAIN}/content_photo`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.content) throw new Error(body.message || t.contentPhotoFailed);
      const field = this._fillForm.querySelector('[data-f="content"]');
      field.value = body.content;
      field.dispatchEvent(new Event("input"));
      this._scannedProduct = null;
      status.textContent = t.contentPhotoDone(body.content);
    } catch (err) {
      status.textContent = (err && err.message) || t.contentPhotoFailed;
    } finally {
      button.disabled = false;
      input.value = "";
    }
  }

  async _lookupProduct(code, t, status) {
    let res = null;
    try {
      res = await this._hass.callWS({ type: `${DOMAIN}/product`, code });
    } catch {
      res = { found: false, error: "unavailable" };
    }
    status.hidden = false;
    if (res && res.found) {
      const input = this._fillForm.querySelector('[data-f="content"]');
      input.value = res.name;
      input.dispatchEvent(new Event("input"));
      this._scannedProduct = res.product || null;
      status.textContent = t.barcodeFound(res.name, res.code) + (res.product && res.product.kcal_100g !== undefined ? ` ${t.barcodeNutrition}` : "") + ` ${t.offSource}`;
    } else if (res && res.error === "unavailable") {
      status.textContent = t.barcodeOffline;
    } else {
      status.textContent = t.barcodeNotFound((res && res.code) || code);
    }
  }

  async submitFill() {
    const hass = this._hass;
    const devs = hass ? (this._fillDevices || []).map((id) => this._devices.find((d) => d.deviceId === id)).filter(Boolean) : [];
    if (!devs.length || this._busy) return;
    const t = strings(hass);
    const f = (name) => this._fillForm.querySelector(`[data-f="${name}"]`);
    const errorEl = this._fillForm.querySelector(".error");
    const content = f("content").value.trim();
    if (!content) {
      errorEl.textContent = t.fillNoContent;
      return;
    }
    const values = {
      content,
      vacuum: f("vacuum").checked,
      shopping: f("shopping").checked,
      quantity: parseQuantity(f("quantity").value),
      unit: f("unit").value,
      filled: new Date(f("filledAt").value),
      bestBefore: f("bestBefore").value,
      area: this._fillForm.querySelector('[data-w="area"]').hidden ? undefined : f("area").value,
      compartment: this._fillForm.querySelector('[data-w="compartment"]').hidden ? undefined : f("compartment").value.trim(),
      product: this._scannedProduct || null,
    };
    const wantEstimate =
      f("estimate").checked && !this._fillForm.querySelector('[data-w="estimate"]').hidden && !values.bestBefore;
    this._busy = true;
    this._fillForm.querySelector("button.submit").disabled = true;
    try {
      for (const dev of devs) await this._fillOne(dev, values);
    } catch (err) {
      errorEl.textContent = (err && err.message) || t.fillFailed;
      return;
    } finally {
      this._busy = false;
      this._fillForm.querySelector("button.submit").disabled = false;
    }
    this.closeFillDialog();
    if (wantEstimate) {
      for (const dev of devs) {
        const card = this._cards.get(dev.deviceId);
        if (card) await card._estimate();
      }
    }
    this.dispatchEvent(new CustomEvent("larder-filled", { detail: { deviceIds: devs.map((d) => d.deviceId) } }));
  }

  /** Eine Dose mit den Angaben aus dem Dialog befüllen. */
  async _fillOne(dev, values) {
    const hass = this._hass;
    const states = hass.states || {};
    const ids = dev.entities;
    const before = states[ids.text];
    await hass.callService("text", "set_value", { entity_id: ids.text, value: values.content });
    // Produktdaten und Nährwerte: aus dem Strichcode übernehmen; bei anderem Inhalt ohne Scan die alten verwerfen
    if (hass.callWS && (values.product || (isValidState(before) && before.state.trim() && before.state.trim() !== values.content))) {
      try {
        await hass.callWS({ type: `${DOMAIN}/product_set`, device_id: dev.deviceId, product: values.product || {}, replace: true });
      } catch {
        /* ältere Version ohne Produktdaten */
      }
    }
    const vac = states[ids.switch];
    if (vac && vac.state !== "unavailable") {
      await hass.callService("switch", values.vacuum ? "turn_on" : "turn_off", { entity_id: ids.switch });
    }
    const shopState = states[ids.shopping];
    if (hasShoppingList(shopState) && shopState.state !== "unavailable") {
      await hass.callService("switch", values.shopping ? "turn_on" : "turn_off", { entity_id: ids.shopping });
    }
    const quantityState = states[ids.number];
    if (quantityState && quantityState.state !== "unavailable") {
      await hass.callService("number", "set_value", { entity_id: ids.number, value: values.quantity });
      const unitState = states[ids.select];
      if (unitState && unitState.state !== "unavailable" && values.unit) {
        await hass.callService("select", "select_option", { entity_id: ids.select, option: values.unit });
      }
    }
    if (ids.datetime && !Number.isNaN(values.filled.getTime())) {
      await hass.callService("datetime", "set_value", { entity_id: ids.datetime, datetime: values.filled.toISOString() });
    }
    if (ids.date && values.bestBefore) {
      await hass.callService("date", "set_value", { entity_id: ids.date, date: values.bestBefore });
    }
    // Variabler Lagerort: die Dose in den gewählten Bereich stellen
    const flex = states[ids.flexible];
    if (values.area !== undefined && flex && flex.state === "on" && (dev.areaId || "") !== values.area && hass.callWS) {
      await hass.callWS({ type: "config/device_registry/update", device_id: dev.deviceId, area_id: values.area || null });
    }
    if (values.compartment !== undefined && flex && flex.state === "on" && ids.compartment) {
      await hass.callService("text", "set_value", { entity_id: ids.compartment, value: values.compartment });
      rememberCompartment(values.area !== undefined ? values.area : dev.areaId, values.compartment);
    }
  }

  /** "Rezeptideen" nur für Administratoren zeigen, wenn die KI-Integration und der Service da sind. */
  _updateIdeasButton() {
    const hass = this._hass;
    const services = (hass && hass.services) || {};
    const available = !!(services.ai_task && services[DOMAIN] && services[DOMAIN].suggest_recipes);
    this._ideasBtn.classList.toggle(
      "visible",
      !!hass && isAdmin(hass) && this._view === "containers" && available && this._devices.length > 0,
    );
  }

  openRecipeDialog() {
    if (!this._hass || !isAdmin(this._hass)) return;
    this._recipeForm.querySelector(".error").textContent = "";
    this._recipeForm.querySelector(".recipelist").replaceChildren();
    this._recipeOverlay.hidden = false;
    this._loadRecipeDays();
  }

  /** Feld "Tage voraus" einmalig mit dem Zeitraum aus den Einstellungen vorbelegen. */
  async _loadRecipeDays() {
    if (this._recipeDaysLoaded || !this._hass.callWS) return;
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/settings` });
      const days = Number(res && res.recipe_days);
      if (Number.isInteger(days) && days >= 0) {
        this._recipeForm.querySelector('[data-f="days"]').value = String(days);
        this._recipeDaysLoaded = true;
      }
    } catch {
      /* ältere Version der Integration: Vorgabe bleibt */
    }
  }

  closeRecipeDialog() {
    this._recipeOverlay.hidden = true;
  }

  /** Rezeptideen von der KI holen (Service `larder.suggest_recipes`) und anzeigen. */
  async submitRecipes() {
    const hass = this._hass;
    if (!hass || !hass.callWS || this._recipeBusy) return;
    const t = strings(hass);
    const form = this._recipeForm;
    const list = form.querySelector(".recipelist");
    const errorEl = form.querySelector(".error");
    const days = Math.min(Math.max(parseInt(form.querySelector('[data-f="days"]').value, 10) || 0, 0), 365);
    const servings = parseInt(form.querySelector('[data-f="servings"]').value, 10);
    const serviceData = { days };
    if (servings > 0) serviceData.servings = Math.min(servings, 20);

    this._recipeBusy = true;
    const submit = form.querySelector("button.submit");
    submit.disabled = true;
    errorEl.textContent = "";
    const busy = document.createElement("div");
    busy.className = "msg";
    busy.textContent = t.recipeBusy;
    list.replaceChildren(busy);
    try {
      const res = await hass.callWS({
        type: "call_service",
        domain: DOMAIN,
        service: "suggest_recipes",
        service_data: serviceData,
        return_response: true,
      });
      const out = (res && res.response) || {};
      const recipes = Array.isArray(out.recipes) ? out.recipes : [];
      if (!recipes.length) {
        const none = document.createElement("div");
        none.className = "msg";
        none.textContent = t.recipeNone(days);
        list.replaceChildren(none);
      } else {
        list.replaceChildren(...recipes.map((r) => this._recipeNode(r, t)));
      }
    } catch (err) {
      list.replaceChildren();
      errorEl.textContent = (err && err.message) || t.recipeFailed;
    } finally {
      this._recipeBusy = false;
      submit.disabled = false;
    }
  }

  _recipeNode(recipe, t) {
    const el = document.createElement("article");
    el.className = "recipe";
    const h = document.createElement("h3");
    h.textContent = recipe.title;
    if (recipe.minutes) {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = t.recipeMinutes(recipe.minutes);
      h.append(meta);
    }
    el.append(h);
    for (const [label, items] of [[t.recipeUses, recipe.uses], [t.recipeExtra, recipe.extra_ingredients]]) {
      if (!items || !items.length) continue;
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = `${label}: ${items.join(", ")}`;
      el.append(line);
    }
    if (recipe.steps && recipe.steps.length) {
      const ol = document.createElement("ol");
      for (const step of recipe.steps) {
        const li = document.createElement("li");
        li.textContent = step;
        ol.append(li);
      }
      el.append(ol);
    }
    return el;
  }

  /** Zwischen Dosen-Übersicht und Liste der gemerkten Schätzungen wechseln (nur Administratoren). */
  setView(view) {
    if (view === "estimates" && !isAdmin(this._hass)) return;
    this._view = view;
    this._main.hidden = view !== "containers";
    this._estimatesEl.hidden = view !== "estimates";
    this._addBtn.classList.toggle("visible", isAdmin(this._hass) && view === "containers");
    this._updateIdeasButton();
    for (const btn of this._tabs.querySelectorAll("button")) {
      btn.classList.toggle("active", btn.dataset.view === view);
    }
    this._updateToolbar(strings(this._hass));
    if (view === "estimates") this.loadEstimates();
  }

  async _estCall(msg) {
    const hass = this._hass;
    const t = strings(hass);
    this.showError("");
    try {
      const res = await hass.callWS(msg);
      if (res && res.entries) this._est = { ...(this._est || {}), entries: res.entries };
      this._renderEstimates();
      return true;
    } catch (err) {
      this.showError((err && err.message) || t.estFailed);
      return false;
    }
  }

  async loadEstimates() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._est = await hass.callWS({ type: `${DOMAIN}/estimates` });
      this.showError("");
      try {
        this._estSuggestions = ((await hass.callWS({ type: `${DOMAIN}/estimate_suggestions` })) || {}).suggestions || [];
      } catch {
        this._estSuggestions = [];
      }
    } catch (err) {
      this._est = this._est || { entries: [], mode: "table" };
      this.showError(strings(hass).estLoadFailed);
    }
    this._renderEstimates();
  }

  /** Liste der gemerkten Schätzungen zeichnen: eigene Zeile zum Hinzufügen, darunter alle Einträge. */
  _renderEstimates() {
    const hass = this._hass;
    if (!hass || !this._est) return;
    const t = strings(hass);
    this._estLang = t;
    const root = this._estimatesEl;
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const field = (label, input) => {
      const wrap = el("label", "f");
      wrap.append(el("span", "", label), input);
      return wrap;
    };
    const input = (type, value, extra = {}) => {
      const node = el("input");
      node.type = type;
      node.value = value;
      Object.assign(node, extra);
      return node;
    };

    const frag = document.createDocumentFragment();
    frag.append(el("h2", "", t.estTitle), el("p", "intro", t.estIntro));
    if (this._est.mode === "off") frag.append(el("p", "intro", t.estOff));

    // --- Vorschläge aus dem Verlauf (nie still übernommen) ---
    const suggestions = this._estSuggestions || [];
    if (suggestions.length) {
      const box = el("section", "est suggest");
      box.append(el("h3", "", t.estSuggestTitle), el("p", "intro", t.estSuggestIntro));
      for (const s of suggestions) {
        const line = el("div", "sugg");
        line.dataset.key = s.key;
        const what = el("div", "what");
        what.append(
          el("span", "name", `${s.content}: ${s.days} → ${s.suggested} ${t.estDaysShort}`),
          el("span", "meta", `${s.area} · ${s.vacuum ? t.estVacuum : t.estNoVacuum}`),
          el("span", "meta", s.direction === "shorter" ? t.estSuggestShorter(s.count) : t.estSuggestLonger(s.count)),
        );
        const btns = el("div", "btns");
        const act = (cls, text, action) => {
          const b = el("button", cls, text);
          b.type = "button";
          b.dataset.role = `suggestion-${action}`;
          b.addEventListener("click", async () => {
            try {
              const res = await hass.callWS({ type: `${DOMAIN}/estimate_suggestion`, key: s.key, action });
              this._estSuggestions = res.suggestions || [];
              if (res.entries) this._est = { ...this._est, entries: res.entries };
            } catch (err) {
              this.showError((err && err.message) || t.estFailed);
            }
            this._renderEstimates();
          });
          return b;
        };
        btns.append(act("del", t.estSuggestIgnore, "ignore"), act("save", t.estSuggestAccept, "accept"));
        line.append(what, btns);
        box.append(line);
      }
      frag.append(box);
    }

    // --- eigenen Eintrag hinzufügen ---
    const add = el("section", "est new");
    add.append(el("h3", "", t.estAddTitle));
    const content = input("text", "", { maxLength: 255 });
    content.dataset.f = "content";
    const area = el("select");
    area.dataset.f = "area";
    for (const a of listAreas(hass, this.larderLabel)) {
      const opt = el("option", "", a.name);
      opt.value = a.name;
      area.append(opt);
    }
    const days = input("number", "", { min: 1, max: 3650, step: 1 });
    days.dataset.f = "days";
    const vacuum = input("checkbox", "");
    vacuum.checked = true;
    vacuum.dataset.f = "vacuum";
    const vacLabel = el("label", "check");
    vacLabel.append(vacuum, el("span", "", t.estVacuum));
    const addBtns = el("div", "btns");
    const addBtn = el("button", "save", t.estAdd);
    addBtn.type = "button";
    addBtn.addEventListener("click", async () => {
      if (!content.value.trim() || !area.value || !Number(days.value)) {
        this.showError(t.estNeedFields);
        return;
      }
      await this._estCall({
        type: `${DOMAIN}/estimate_add`,
        content: content.value.trim(),
        area: area.value,
        vacuum: vacuum.checked,
        days: Number(days.value),
      });
    });
    addBtns.append(addBtn);
    add.append(field(t.estContent, content), field(t.estDays, days), field(t.estArea, area), vacLabel, addBtns);
    frag.append(add);

    // --- vorhandene Einträge ---
    if (!this._est.entries.length) {
      frag.append(el("p", "intro", t.estEmpty));
    }
    for (const entry of this._est.entries) {
      const row = el("section", "est");
      row.dataset.key = entry.key;
      const what = el("div", "what");
      what.append(
        el("span", "name", entry.content),
        el("span", "meta", `${entry.area} · ${entry.vacuum ? t.estVacuum : t.estNoVacuum}`),
        el("span", "meta", `${t.estSource}: ${sourceLabel(t, entry.source, entry.origin)}`),
      );
      const tip = input("text", entry.tip, { maxLength: 500 });
      tip.dataset.f = "tip";
      const d = input("number", String(entry.days), { min: 1, max: 3650, step: 1 });
      d.dataset.f = "days";
      const btns = el("div", "btns");
      const del = el("button", "del", t.estDelete);
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!window.confirm(t.estConfirmDelete(entry.content))) return;
        await this._estCall({ type: `${DOMAIN}/estimate_delete`, key: entry.key });
      });
      const save = el("button", "save", t.estSave);
      save.type = "button";
      save.addEventListener("click", async () => {
        if (!Number(d.value)) {
          this.showError(t.estNeedFields);
          return;
        }
        await this._estCall({
          type: `${DOMAIN}/estimate_set`,
          key: entry.key,
          days: Number(d.value),
          tip: tip.value,
        });
      });
      btns.append(del, save);
      row.append(what, field(t.estTip, tip), field(t.estDays, d), btns);
      frag.append(row);
    }
    root.replaceChildren(frag);
  }

  // ---------- NFC ----------

  /** Zustand der NFC-Zeile einer Karte: "linked", "none", "waiting" oder null (nicht anzeigen). */
  nfcState(deviceId) {
    if (!isAdmin(this._hass)) return null;
    if (this._capture && this._capture.deviceId === deviceId) return "waiting";
    return this._nfcLinks[deviceId] ? "linked" : "none";
  }

  /** Klick auf den NFC-Knopf einer Karte: verknüpfen, Warten abbrechen oder lösen. */
  async nfcAction(deviceId) {
    const t = strings(this._hass);
    const state = this.nfcState(deviceId);
    this.showError("");
    if (state === "waiting") {
      this.cancelCapture("card");
    } else if (state === "linked") {
      try {
        const res = await this._hass.callWS({ type: `${DOMAIN}/nfc_unlink`, device_id: deviceId });
        this._nfcLinks = (res && res.by_device) || {};
      } catch (err) {
        this.showError((err && err.message) || t.nfcFailed);
      }
      this._update();
    } else {
      this.startCapture(async (tag) => {
        if (Object.values(this._nfcLinks).includes(tag)) {
          this.showError(t.nfcInUse);
          return false;
        }
        try {
          await this._linkTag({ tag_id: tag, device_id: deviceId });
        } catch (err) {
          this.showError((err && err.message) || t.nfcFailed);
        }
        return true;
      }, "card", deviceId);
      this._update();
    }
  }

  async _linkTag(params) {
    const res = await this._hass.callWS({ type: `${DOMAIN}/nfc_link`, ...params });
    this._nfcLinks = (res && res.by_device) || this._nfcLinks;
    this._update();
  }

  async loadNfc() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/nfc_tags` });
      this._nfcLinks = (res && res.by_device) || {};
    } catch (err) {
      this._nfcLinks = {};
    }
    this._update();
  }

  /** Auf den nächsten gescannten Tag warten. `onTag` liefert false, wenn der Tag nicht taugt (weiter warten). */
  startCapture(onTag, source, deviceId = null) {
    this._capture = { source, deviceId, onTag };
  }

  cancelCapture(source) {
    if (this._capture && (!source || this._capture.source === source)) {
      this._capture = null;
      this._update();
    }
  }

  async _tagScanned(tagId) {
    const cap = this._capture;
    if (!cap || !tagId) return;
    const done = await cap.onTag(tagId);
    if (done !== false && this._capture === cap) {
      this._capture = null;
      this._update();
    }
  }

  /** Ereignisse abonnieren (nur Administratoren dürfen beliebige Ereignisse abonnieren). */
  async _subscribe() {
    const hass = this._hass;
    if (this._subscribed || !hass || !hass.connection) return;
    if (!isAdmin(hass)) {
      // ohne Administratorrechte: nur gescannte Tags (zum Kennzeichnen von Beuteln), über Larder
      if (typeof hass.connection.subscribeMessage !== "function") return;
      this._subscribed = true;
      try {
        this._unsubs.push(await hass.connection.subscribeMessage((ev) => this._tagScanned(ev && ev.tag_id), { type: `${DOMAIN}/tag_scans` }));
      } catch {
        this._subscribed = false;
      }
      return;
    }
    if (!hass.connection.subscribeEvents) return;
    this._subscribed = true;
    try {
      this._unsubs.push(
        await hass.connection.subscribeEvents((ev) => this._tagScanned(ev.data && ev.data.tag_id), "tag_scanned"),
        await hass.connection.subscribeEvents((ev) => {
          // eingebettet öffnet die äußere Ansicht die Dose selbst
          if (!this.hasAttribute("embedded")) this.highlight(ev.data && ev.data.device_id);
        }, `${DOMAIN}_dose_scanned`),
      );
    } catch (err) {
      this._subscribed = false;
    }
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs.splice(0)) {
      try {
        unsub();
      } catch (err) {
        /* Verbindung schon getrennt */
      }
    }
    this._subscribed = false;
  }

  /** Dose hervorheben (nach dem Scannen ihres Tags): Ansicht zurücksetzen, hinscrollen, kurz blinken lassen. */
  highlight(deviceId, fill = false) {
    const hass = this._hass;
    if (!hass || !deviceId || !this._devices.some((d) => d.deviceId === deviceId)) return false;
    if (this._view !== "containers") this.setView("containers");
    if (!this._arranged.some((d) => d.deviceId === deviceId)) {
      this._opts = { query: "", filter: "all", sort: this._opts.sort };
      saveViewOptions(this._opts);
      this._update();
    }
    const card = this._cards.get(deviceId);
    if (!card) return false;
    card.el.classList.remove("flash");
    void card.el.offsetWidth; // Animation neu starten
    card.el.classList.add("flash");
    if (card.el.scrollIntoView) card.el.scrollIntoView({ block: "center", behavior: "smooth" });
    // Leere Dose: gleich "Dose befüllen" anbieten (nach dem Scan mit dem Handy).
    if (fill) {
      const dev = this._devices.find((d) => d.deviceId === deviceId);
      const text = dev && (hass.states || {})[dev.entities.text];
      if (text && text.state !== "unavailable" && !(isValidState(text) && text.state.trim() !== "")) {
        this.openFillDialog(deviceId);
      }
    }
    return true;
  }

  /** `?recipes=1` (Knopf "Rezepte" in der täglichen Benachrichtigung): Rezept-Dialog öffnen. */
  _handleRecipesParam() {
    if (this.hasAttribute("embedded")) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("recipes") || !this._hass || !this._hass.user) return;
    window.history.replaceState(null, "", window.location.pathname);
    this.openRecipeDialog();
  }

  /** `?open=<Geräte-ID>` (aus der Benachrichtigung nach einem NFC-Scan): Dose hervorheben. */
  _handleOpenParam() {
    if (this.hasAttribute("embedded")) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id || !this._devices.length) return;
    window.history.replaceState(null, "", window.location.pathname);
    this.highlight(id, true);
  }

  _updateToolbar(t) {
    const bar = this._toolbar;
    bar.hidden = this._view !== "containers" || this._devices.length === 0;
    const query = bar.querySelector('[data-f="query"]');
    query.placeholder = t.searchPlaceholder;
    query.setAttribute("aria-label", t.searchPlaceholder);
    if (this._shadowActive() !== query) query.value = this._opts.query;
    const fill = (node, label, items, value) => {
      node.setAttribute("aria-label", label);
      const sig = JSON.stringify(items);
      if (node.dataset.sig !== sig) {
        node.dataset.sig = sig;
        node.replaceChildren(
          ...items.map(([v, text]) => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = text;
            return opt;
          }),
        );
      }
      node.value = value;
    };
    fill(bar.querySelector('[data-f="filter"]'), t.filterLabel, [
      ["all", t.filterAll],
      ["soon", t.filterSoon(soonDaysOf(this._devices.length ? this._hass.states[this._devices[0].entities.date] : null))],
      ["expired", t.filterExpired],
      ["filled", t.filterFilled],
      ["empty", t.filterEmpty],
    ], this._opts.filter);
    fill(bar.querySelector('[data-f="sort"]'), t.sortLabel, [
      ["area", t.sortArea],
      ["date", t.sortDate],
      ["name", t.sortName],
    ], this._opts.sort);
  }

  _shadowActive() {
    return this.shadowRoot.activeElement;
  }

  _update() {
    const hass = this._hass;
    if (!hass) return;

    const regs = [hass.entities, hass.devices, hass.areas];
    let registriesChanged = false;
    if (!this._registries || regs.some((r, i) => r !== this._registries[i])) {
      this._registries = regs;
      this._devices = collectDevices(hass);
      registriesChanged = true;
    }
    // Reihenfolge und Sichtbarkeit hängen auch von den Zuständen ab (Filter, Sortierung nach MHD).
    const only = this.getAttribute("only");
    const ids = this.hasAttribute("embedded") && this.getAttribute("show") === "cards" && !only ? this.getAttribute("ids") : null;
    this._flat = false;
    if (only) {
      this._arranged = this._devices.filter((d) => d.deviceId === only);
    } else if (ids !== null) {
      this._flat = true;
      const byId = new Map(this._devices.map((d) => [d.deviceId, d]));
      this._arranged = ids.split(",").map((id) => byId.get(id)).filter(Boolean);
    } else {
      this._arranged = arrangeDevices(hass, this._devices, this._opts);
    }
    const sig = JSON.stringify([this._arranged.map((d) => d.deviceId), this._opts.sort, this._devices.length, this._flat]);
    if (registriesChanged || sig !== this._layoutSig) {
      this._layoutSig = sig;
      this._rebuild(hass);
    }

    this._checkPendingFill();

    const t = strings(hass);
    this._title.textContent = only ? (this._arranged[0] || {}).name || t.title : t.title;
    this._count.textContent = t.count(this._devices.length);
    this._updateToolbar(t);
    this._addBtn.textContent = `+ ${t.addContainer}`;
    this._addBtn.classList.toggle("visible", isAdmin(hass) && this._view === "containers");
    this._ideasBtn.textContent = t.recipeBtn;
    this._updateIdeasButton();
    for (const el of this._recipeForm.querySelectorAll("[data-l]")) el.textContent = t[el.dataset.l];
    this._recipeForm.querySelector("button.cancel").textContent = t.recipeClose;
    this._recipeForm.querySelector("button.submit").textContent = t.recipeGo;
    this._tabs.classList.toggle("visible", isAdmin(hass));
    for (const btn of this._tabs.querySelectorAll("button")) {
      btn.textContent = btn.dataset.view === "estimates" ? t.tabEstimates : t.tabContainers;
      btn.classList.toggle("active", btn.dataset.view === this._view);
    }
    if (this._est && this._view === "estimates" && this._estLang !== t) this._renderEstimates();
    this._form.querySelector("h2").textContent = t.addContainer;
    for (const el of this._form.querySelectorAll("[data-l]")) el.textContent = t[el.dataset.l];
    this._form.querySelector("button.cancel").textContent = t.cancel;
    this._form.querySelector("button.submit").textContent = t.submit;
    for (const el of this._fillForm.querySelectorAll("[data-l]")) el.textContent = t[el.dataset.l];
    this._fillForm.querySelector("button.cancel").textContent = t.cancel;
    this._fillForm.querySelector("button.submit").textContent = t.fillSave;
    this._handleAddParam();
    this._handleOpenParam();
    this._handleRecipesParam();
    this._subscribe();
    if (!this._nfcLoaded) {
      this._nfcLoaded = true;
      this.loadNfc();
    }
    for (const dev of this._devices) {
      const card = this._cards.get(dev.deviceId);
      if (card) card.update(hass, dev);
    }
  }

  /** Bereichsüberschriften und Kartenreihenfolge neu aufbauen; vorhandene Karten bleiben erhalten. */
  _rebuild(hass) {
    const t = strings(hass);
    const present = new Set(this._devices.map((d) => d.deviceId));
    for (const id of [...this._cards.keys()]) {
      if (!present.has(id)) this._cards.delete(id);
    }
    for (const dev of this._devices) {
      if (!this._cards.has(dev.deviceId)) this._cards.set(dev.deviceId, new DoseCard(this, dev.deviceId));
    }

    const frag = document.createDocumentFragment();
    const none = (title, text, linkText) => {
      const box = document.createElement("div");
      box.className = "none";
      box.innerHTML = `<h2></h2><p></p><a></a>`;
      box.querySelector("h2").textContent = title;
      box.querySelector("p").textContent = text;
      const link = box.querySelector("a");
      if (linkText) {
        link.textContent = linkText;
        link.addEventListener("click", () => navigate(`/config/integrations/integration/${DOMAIN}`));
      } else {
        link.remove();
      }
      return box;
    };
    const shown = this._arranged || this._devices;
    if (!this._devices.length) {
      frag.appendChild(none(t.noneTitle, t.noneText, t.openSettings));
    } else if (!shown.length) {
      frag.appendChild(none(t.title, t.noMatch, ""));
    } else if (this._opts.sort !== "area" || this._flat) {
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const dev of shown) grid.appendChild(this._cards.get(dev.deviceId).el);
      frag.appendChild(grid);
    } else {
      let currentArea;
      let grid = null;
      for (const dev of shown) {
        if (grid === null || dev.areaName !== currentArea) {
          currentArea = dev.areaName;
          const h = document.createElement("h2");
          h.className = "area";
          h.textContent = dev.areaName || t.noArea;
          grid = document.createElement("div");
          grid.className = "grid";
          frag.appendChild(h);
          frag.appendChild(grid);
        }
        grid.appendChild(this._cards.get(dev.deviceId).el);
      }
    }
    this._main.replaceChildren(frag);
  }
}

if (!customElements.get("larder-panel")) {
  customElements.define("larder-panel", LarderPanel);
}

// Eingebettete Variante für das Dashboard unter eigenem Namen: Hat der Browser noch ein älteres
// <larder-panel> aus einer früheren Sitzung registriert, nutzt die eingebettete Variante trotzdem diesen Code.
if (!customElements.get("larder-panel-embedded")) {
  customElements.define("larder-panel-embedded", class extends LarderPanel {});
}
