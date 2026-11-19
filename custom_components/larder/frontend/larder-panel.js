/*
 * Larder: overview of all containers of the integration "larder".
 *
 * Reads devices, areas, entities and states directly from the frontend's hass object.
 * There is no fixed configuration: new containers appear as soon as they are created in
 * Home Assistant, changed values and areas are applied live.
 */

const DOMAIN = "larder";
// Texts and stylesheet live in modules of their own; load them with the same version query as this module,
// so an older copy from the cache is never used.
const VERSION_QUERY = new URL(import.meta.url).search;

const { STRINGS } = await import(`./larder-panel-strings.js${VERSION_QUERY}`);
const { SECTION_NAMES } = await import(`./larder-dashboard-supply.js${VERSION_QUERY}`);
export { STRINGS };

// ----- Suggesting compartments -----

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

/** Remember a used compartment (per area, recently used first), even if the container is gone later. */
export function rememberCompartment(areaId, value) {
  const text = String(value || "").trim();
  if (!text) return;
  const memory = loadCompartmentMemory();
  const key = areaId || "";
  memory[key] = [text, ...(memory[key] || []).filter((v) => v.toLowerCase() !== text.toLowerCase())].slice(0, 20);
  try {
    window.localStorage.setItem(COMPARTMENT_KEY, JSON.stringify(memory));
  } catch {
    /* storage full or blocked: then without */
  }
}

/**
 * Compartments that are or were used in an area: from the containers, bags and packs there
 * (most frequent first) and from those entered last. Without an area: all compartments.
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
 * Suggestions as tappable chips below a compartment field. `getList` returns the compartments (e.g. depending on the area);
 * `refresh()` redraws them, for instance when the area was changed. Typing filters the chips.
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

/** Label of the source of an estimate (table, AI or corrected by the user, with origin). */
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

/** The switch "Shopping list" only makes sense if a to-do list is chosen in the settings. */
function hasShoppingList(state) {
  return !!(state && state.attributes && state.attributes.list);
}

/** All devices of the integration, sorted by area (without area last) and name. */
export function collectDevices(hass) {
  const byDevice = new Map();
  for (const ent of Object.values(hass.entities || {})) {
    if (ent.platform !== DOMAIN || !ent.device_id) continue;
    let dev = byDevice.get(ent.device_id);
    if (!dev) {
      dev = { deviceId: ent.device_id, entities: {}, entityAreaId: null };
      byDevice.set(ent.device_id, dev);
    }
    // Per device there is one entity per domain (text, date, datetime, button, image, number), several only for
    // "switch" (vacuum = switch, shopping list = shopping, variable storage place = flexible) and "select"
    // (unit = select, place after emptying = homeArea).
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

/** ISO timestamp -> value for <input type="datetime-local"> (local time). */
export function toLocalInputValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Days left until the best-before date (negative = expired), based on "today" in local time. */
export function daysUntil(isoDate, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

/** Shift an ISO date by n days (local calendar days, without time zone traps). */
export function addDays(isoDate, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const SOON_DAYS = 3;

/** "Expires soon" in days: setting of the integration (attribute `soon_days` of the date entity), else 3. */
export function soonDaysOf(dateState) {
  const value = dateState && dateState.attributes ? dateState.attributes.soon_days : undefined;
  return Number.isInteger(value) && value >= 0 ? value : SOON_DAYS;
}

/**
 * Filter containers by search and sort them. `sort`: "area" (order of collectDevices),
 * "date" (earliest date first, without a date last) or "name". `filter`: all, soon, expired, filled, empty.
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
 * Areas of the hass object as a sorted list [{id, name}].
 * With `labelIds` (labels "Larder" or "Larder: …", one ID or a list) only areas with one of
 * these labels appear; if none of the areas has one, all are shown. `keep`
 * is an area that must always be included (the current area of a container, even without a label).
 */
let AREA_SCOPES = null; // area id → "food" | "household" | "pharmacy" | "both" | null (from larder/area_scopes)

/** Which side of the dashboard an entry belongs to: food, household or pharmacy (medicines). */
export function scopeOfKind(kind) {
  return kind === "household" ? "household" : kind === "medicine" ? "pharmacy" : kind === "voucher" ? "voucher" : "food";
}

/** Remember what each area is used for (food, household or both), see `listAreas`. */
export function setAreaScopes(scopes) {
  AREA_SCOPES = scopes || null;
}

/** May this area hold entries of this scope ("food", "household" or "pharmacy")? Unknown or unlabelled areas may. */
export function areaAllows(areaId, scope) {
  const s = AREA_SCOPES && AREA_SCOPES[areaId];
  return !scope || scope === "voucher" || !s || s === "both" || s === scope; // vouchers may lie anywhere
}

/** ISO date as a short local date ("26.11." in German, "Nov 26" otherwise). */
function fmtDay(iso, hass) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const lang = ((hass && hass.language) || "en").toLowerCase();
  return new Date(y, m - 1, d).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/** All to-do lists of Home Assistant as [{id, name}], sorted by name (for choosing a shopping list). */
export function todoLists(hass) {
  const lang = ((hass && hass.language) || "en").toLowerCase();
  return Object.values((hass && hass.states) || {})
    .filter((s) => s.entity_id.startsWith("todo."))
    .map((s) => ({ id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id }))
    .sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: "base" }));
}

export function listAreas(hass, labelIds = null, keep = null, scope = null) {
  const lang = ((hass && hass.language) || "en").toLowerCase();
  let areas = Object.values((hass && hass.areas) || {});
  const ids = (Array.isArray(labelIds) ? labelIds : [labelIds]).filter(Boolean);
  const tagged = (a) => Array.isArray(a.labels) && a.labels.some((l) => ids.includes(l));
  if (ids.length && areas.some(tagged)) areas = areas.filter((a) => tagged(a) || a.area_id === keep);
  if (scope) areas = areas.filter((a) => areaAllows(a.area_id, scope) || a.area_id === keep);
  return areas
    .map((a) => ({ id: a.area_id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
}

/** Label that marks an area as a storage place: "Larder" or "Larder: …" (e.g. "Larder: Freezer"). */
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

/** Search, filter and sorting are a pure display preference of this browser. */
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
    /* storage not available: the setting only applies until reload */
  }
}

const DEFAULT_UNITS = ["portions", "pieces", "slices", "grams", "milliliters"];

/** Quantity from an input field: whole number from 0 to 9999 (empty = 0 = not given). */
function parseQuantity(value) {
  return Math.min(Math.max(parseInt(value, 10) || 0, 0), 9999);
}

/** Fill the unit select (options and current value come from the select entity). */
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
      <div class="row bbrow"><label data-l="bestBefore"></label><input data-f="bestBefore" type="date"><span class="badge"></span></div>
      <div class="quickrow"><button class="plus1" type="button"></button><button class="opened" type="button"></button><button class="thawed" type="button"></button></div>
      <div class="row filledrow"><label data-l="filledAt"></label><input data-f="filledAt" type="datetime-local"><button class="now" type="button"></button></div>
      <div class="estimaterow"><button class="estimate" type="button"></button><span class="tip" role="status"></span></div>
      <div class="row vacrow"><label class="check"><input type="checkbox" data-f="vacuum"><span data-l="vacuum"></span></label></div>
      <div class="row shoprow"><label class="check"><input type="checkbox" data-f="shopping"><span data-l="shopping"></span></label></div>
      <div class="row flexrow"><label class="check"><input type="checkbox" data-f="flexible"><span data-l="flexible"></span></label></div>
      <div class="row homerow"><label data-l="homeArea"></label><select data-f="homeArea"></select></div>
      <div class="row sizerow" hidden><label data-l="size"></label><input data-f="size" type="text" maxlength="20" list="zs-sizes" autocomplete="off"><label class="check"><input type="checkbox" data-f="sizeVariable"><span data-l="sizeVariable"></span></label></div>
      <div class="recallline" role="alert" hidden><span class="txt"></span> <a target="_blank" rel="noopener noreferrer"></a></div>
      <div class="openedline" role="note" hidden></div>
      <div class="usageline" role="note" hidden></div>
      <div class="priceline" role="note" hidden></div>
      <div class="packline" role="note" hidden></div>
      <div class="olderhint" role="note" hidden></div>
      <div class="row minrow" hidden><label data-l="minStock"></label><input data-f="minStock" type="number" min="0" max="999" step="1" inputmode="numeric"><span class="stockinfo"></span></div>
      <div class="row replrow" hidden><label data-l="replaceEvery"></label><input data-f="replaceWeeks" type="number" min="0" max="520" step="1" inputmode="numeric"><span class="replinfo"></span><button class="replaced" type="button" hidden></button></div>
      <div class="row listrow" hidden><label data-l="shopList"></label><select data-f="shopList"></select></div>
      <div class="row sectionrow" hidden><label data-l="section"></label><select data-f="section"></select></div>
      <div class="allergen-warning" role="note" hidden></div>
      <details class="nutrition"><summary></summary>
        <div class="nutgrid">
          <label><span data-n="brand"></span><input data-p="brand" type="text" maxlength="80"></label>
          <label><span data-n="package"></span><input data-p="package" type="text" maxlength="40"></label>
          <label data-hh="only"><span data-n="pack_size"></span><input data-p="pack_size" type="number" min="1" max="9999" step="1" inputmode="numeric"></label>
          <label data-hh="only"><span data-n="piece"></span><input data-p="piece" type="text" maxlength="30"></label>
          <label data-hh="pao"><span data-n="pao"></span><input data-p="pao" type="number" min="0" max="120" step="1" inputmode="numeric"></label>
          <label data-hh="no"><span data-n="kcal_100g"></span><input data-p="kcal_100g" type="number" min="0" max="10000" step="any" inputmode="decimal"></label>
          <label data-hh="no"><span data-n="kcal_portion"></span><input data-p="kcal_portion" type="number" min="0" max="10000" step="any" inputmode="decimal"></label>
          <label data-hh="no"><span data-n="nutri_score"></span><select data-p="nutri_score"><option value=""></option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></label>
          <label><span data-n="ean"></span><input data-p="ean" type="text" maxlength="14" inputmode="numeric"></label>
          <label><span data-n="price"></span><input data-p="price" type="number" min="0" max="10000" step="0.01" inputmode="decimal"></label>
          <label class="wide" data-hh="no"><span data-n="allergens"></span><input data-p="allergens" type="text" maxlength="200"></label>
          <label class="wide" data-hh="no"><span data-n="nutrients"></span><textarea data-p="nutrients" rows="2" maxlength="500"></textarea></label>
        </div>
        <div class="source" hidden></div>
      </details>
      <div class="nfcrow"><span class="nfcstate"></span><button class="nfcbtn" type="button"></button></div>
      <div class="actions"><button class="fill" type="button"></button><button class="transfer" type="button" hidden></button><button class="move" type="button" hidden></button><button class="openpack" type="button" hidden></button><select class="convert" hidden></select><button class="empty" type="button"></button><span class="spacer"></span><img class="qr" alt=""></div>
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
      else this._call(DOMAIN, "clear_best_before", { entity_id: this.ids.date }); // emptying only works through our service
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
    // take a portion: −1; with the last one ask whether the container should be emptied
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
      this._empty("eaten"); // the last portion was just taken after all
    });
    this.q("button.lastkeep").addEventListener("click", () => {
      this.q(".lastrow").hidden = true;
      if (this.ids.number) this._call("number", "set_value", { entity_id: this.ids.number, value: 0 });
    });
    this.q("button.now").addEventListener("click", () => {
      if (this.ids.datetime) this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: new Date().toISOString() });
    });
    // emptying: ask first whether eaten or thrown away (for the history)
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
    // container size: fixed at the container, or (variable) that of the current filling
    this.q('[data-f="size"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      if (!hass || !hass.callWS) return;
      const variable = this.q('[data-f="sizeVariable"]').checked;
      const size = ev.target.value.trim();
      hass.callWS(variable ? { type: `${DOMAIN}/size_fill`, device_id: this.deviceId, size } : { type: `${DOMAIN}/size_set`, device_id: this.deviceId, size, variable: false }).catch(() => {});
    });
    this.q('[data-f="sizeVariable"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      if (!hass || !hass.callWS) return;
      const text = (hass.states || {})[this._panel._devices.find((d) => d.deviceId === this.deviceId).entities.text];
      const fixed = (text && text.attributes && text.attributes.size_fixed) || (ev.target.checked ? "" : this.q('[data-f="size"]').value.trim());
      hass.callWS({ type: `${DOMAIN}/size_set`, device_id: this.deviceId, size: fixed, variable: ev.target.checked }).catch(() => {});
    });
    this.q('[data-f="flexible"]').addEventListener("change", (ev) => {
      if (this.ids.flexible) this._call("switch", ev.target.checked ? "turn_on" : "turn_off", { entity_id: this.ids.flexible });
    });
    this.q('[data-f="homeArea"]').addEventListener("change", (ev) => {
      if (this.ids.homeArea) this._call("select", "select_option", { entity_id: this.ids.homeArea, option: ev.target.value });
    });
    this.q("button.estimate").addEventListener("click", () => this._estimate());
    this.q("button.fill").addEventListener("click", () => this._panel.openFillDialog(this.deviceId));
    // open a pack and transfer it into an empty container: the dashboard handles choosing the container
    this.q("select.convert").addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const kind = ev.target.value;
      ev.target.value = "";
      if (!hass || !hass.callWS || !kind) return;
      hass.callWS({ type: `${DOMAIN}/convert_kind`, device_id: this.deviceId, kind }).catch(() => {});
    });
    this.q("button.openpack").addEventListener("click", () => {
      this._panel.dispatchEvent(new CustomEvent("larder-open-pack", { detail: { deviceId: this.deviceId } }));
    });
    this.q("button.move").addEventListener("click", () => {
      this._panel.dispatchEvent(new CustomEvent("larder-move", { detail: { deviceId: this.deviceId } }));
    });
    // minimum stock of the product (applies to all packs with this content)
    this.q('[data-f="minStock"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      const value = Math.max(0, Math.min(999, parseInt(ev.target.value, 10) || 0));
      hass.callWS({ type: `${DOMAIN}/stock_min`, content, min: value }).catch(() => this._panel.showError(strings(hass).minStockFailed));
    });
    // replacement interval of a household item (weeks, 0 = none) and "replaced" (one piece, interval restarts)
    this.q('[data-f="replaceWeeks"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      const weeks = Math.max(0, Math.min(520, parseFloat(String(ev.target.value).replace(",", ".")) || 0));
      hass.callWS({ type: `${DOMAIN}/replace_interval`, content, weeks }).catch(() => this._panel.showError(strings(hass).replaceFailed));
    });
    this.q("button.replaced").addEventListener("click", () => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      hass.callWS({ type: `${DOMAIN}/replaced`, content, device_id: this.deviceId }).catch(() => this._panel.showError(strings(hass).replaceFailed));
    });
    // own shopping list of the product (remembered by product name, "" = the default list)
    this.q('[data-f="shopList"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      const msg = { type: `${DOMAIN}/product_list`, content };
      if (ev.target.value) msg.list = ev.target.value;
      hass.callWS(msg).catch(() => this._panel.showError(strings(hass).shopListFailed));
    });
    // store section of the product (4.7, remembered by product name, "" = suggestion)
    this.q('[data-f="section"]').addEventListener("change", (ev) => {
      const hass = this._panel.hass;
      const content = this.inputs.content.value.trim();
      if (!hass || !hass.callWS || !content) return;
      const msg = { type: `${DOMAIN}/product_section`, content };
      if (ev.target.value) msg.section = ev.target.value;
      hass.callWS(msg).catch(() => this._panel.showError(strings(hass).shopListFailed));
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

  /** Estimate the best-before date by table/AI (service of the integration); shows a hint or an error. */
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

  /** Empty the container and record what happened to the content (without history: just press the button). */
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
    if (this._isFocused(input)) return; // never overwrite while someone is typing
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
    // product data and nutrition (attributes of the "Content" entity); only for a filled container
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
    const household = attrs.kind === "household";
    const nonFood = household || attrs.kind === "medicine";
    for (const label of nut.querySelectorAll("[data-hh]")) {
      const want = label.dataset.hh;
      // "only": household items, "pao": household items and medicines, "no": food only
      label.hidden = want === "only" ? !household : want === "pao" ? !nonFood : nonFood;
    }
    const bits = [nonFood ? t.productDetails : t.nutrition];
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
    // compartment in the area (e.g. "Drawer 2")
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
      const areas = listAreas(hass, this._panel.larderLabel, dev.areaId, scopeOfKind(attrs.kind));
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
    this.q('[data-l="size"]').textContent = t.size;
    this.q('[data-l="sizeVariable"]').textContent = t.sizeVariable;
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
    // −1 only for countable units (not grams/millilitres) and as long as something is there
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
    this.q(".filledrow").style.display = dt ? "" : "none"; // packs have no fill date
    this.q("button.now").disabled = !ok(dt);

    // quick actions below the date: +1 day (only with a date) and Opened (as soon as something is inside).
    const hasContentNow = isValidState(text) && text.state.trim() !== "";
    this.q(".quickrow").classList.toggle("visible", ok(date) && hasContentNow);
    this.q("button.fill").classList.toggle("visible", ok(text) && !hasContentNow);
    this.q("button.plus1").disabled = !isValidState(date);

    // NFC: administrators only (linking and unlinking are administrator commands).
    const nfc = this._panel.nfcState(this.deviceId);
    const kind = (text && text.attributes && text.attributes.kind) || "container";
    const packLike = kind === "pack" || kind === "household" || kind === "medicine";
    const nonFoodKind = kind === "household" || kind === "medicine";
    // packs, household items and medicines are used up, containers and bags are emptied
    if (kind !== "container" && kind !== "bag") {
      this.q("button.empty").textContent = t.usedUp;
      this.q("button.lastempty").textContent = t.usedUp;
    }
    this.q(".nfcrow").classList.toggle("visible", admin && nfc !== null && !packLike);
    // household items: the date is optional (e.g. sunscreen); medicines: the expiry date; no estimate for either
    this.q('[data-l="bestBefore"]').textContent = kind === "medicine" ? t.expiry : kind === "household" ? t.expiryOptional : t.bestBefore;
    if (nonFoodKind) this.q(".quickrow").classList.remove("visible");
    this.q(".estimaterow").style.display = nonFoodKind ? "none" : "";
    const convert = this.q("select.convert");
    convert.hidden = !(packLike && hasContentNow);
    const convertSig = `${kind}|${t.convertTo}`;
    if (!convert.hidden && convert.dataset.sig !== convertSig) {
      const option = (value, label) => {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        return o;
      };
      const targets = { pack: t.convertToPack, household: t.convertToHousehold, medicine: t.convertToMedicine };
      convert.replaceChildren(option("", t.convertTo), ...Object.entries(targets).filter(([k]) => k !== kind).map(([k, label]) => option(k, label)));
      convert.dataset.sig = convertSig;
    }
    const transfer = this.q("button.transfer");
    transfer.hidden = !(kind === "pack" && hasContentNow);
    transfer.textContent = t.transfer;
    const opened = packLike && hasContentNow && text.attributes && text.attributes.opened;
    const openBtn = this.q("button.openpack");
    openBtn.hidden = !(packLike && hasContentNow && !opened);
    openBtn.textContent = t.openPack;
    // container size (containers only)
    const sizeRow = this.q(".sizerow");
    sizeRow.hidden = kind !== "container" || !ok(text);
    if (!sizeRow.hidden) {
      const a = (text && text.attributes) || {};
      const variable = !!a.size_variable;
      this.q('[data-f="sizeVariable"]').checked = variable;
      const sizeInput = this.q('[data-f="size"]');
      this._setInput(sizeInput, variable ? (hasContentNow ? a.size || "" : "") : a.size_fixed || "");
      sizeInput.placeholder = variable ? (hasContentNow ? a.size_last || t.sizeHint : t.sizeVariableEmpty) : t.sizeHint;
      sizeInput.disabled = variable && !hasContentNow;
    }
    const openedLine = this.q(".openedline");
    openedLine.hidden = !opened;
    openedLine.textContent = opened ? t.openedSince(opened) : "";
    const move = this.q("button.move");
    move.hidden = !(packLike && hasContentNow);
    move.textContent = t.movePack;
    // oldest first: are the same goods somewhere else with an earlier date?
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
    // recall warning for this content (unread)
    const recallLine = this.q(".recallline");
    const recall = hasContentNow && text && text.attributes ? text.attributes.recall : null;
    recallLine.hidden = !recall;
    if (recall) {
      recallLine.querySelector(".txt").textContent = t.recallLine(recall.title, recall.reason);
      const link = recallLine.querySelector("a");
      link.textContent = t.recallLink;
      link.href = recall.link;
    }
    // packs of the same product (all places): count and value
    const isPack = packLike && hasContentNow && text.attributes;
    const sizeOf = (a) => Math.max(1, Number(a && a.pack_size) || 1); // household: pieces per pack
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
        if (!isValidState(ot) || (ot.attributes && ot.attributes.kind) !== kind || ot.state.trim().toLowerCase() !== key) continue;
        const q = states[other.entities.number];
        const u = states[other.entities.select];
        const n = isValidState(q) ? Number(q.state) : 0;
        const count = n > 0 && (!u || ["pieces", "portions"].includes(u.state)) ? n : 1;
        total += count;
        const p = priceOf(ot.attributes);
        if (p) value += (count / sizeOf(ot.attributes)) * p.price; // the price is per pack
      }
    }
    // consumption: how long does the stock of this product (all places) still last?
    const usageLine = this.q(".usageline");
    const perWeek = isPack ? Number(text.attributes.consumption_per_week) : 0;
    usageLine.hidden = !(perWeek > 0);
    if (perWeek > 0) {
      const basis = text.attributes.consumption_basis || {};
      usageLine.textContent = t.usageLine(Math.round((total / perWeek) * 7), basis.takes || 0, basis.days || 0);
    }
    // price per pack and value of all packs of this product
    const priceLine = this.q(".priceline");
    const ownPrice = isPack ? priceOf(text.attributes) : null;
    priceLine.hidden = !ownPrice;
    if (ownPrice) priceLine.textContent = t.priceLine(ownPrice.price, ownPrice.source === "openprices", total > 1 ? value : null);
    // household: pieces and packs of this product (all places)
    const packLine = this.q(".packline");
    const size = isPack && kind === "household" ? sizeOf(text.attributes) : 1;
    packLine.hidden = !(size > 1);
    if (size > 1) packLine.textContent = t.packsLine(total, text.attributes.piece, Math.round((total / size) * 10) / 10);
    const priceInput = this.q('[data-p="price"]');
    priceInput.placeholder = text && text.attributes && text.attributes.price_remembered ? String(text.attributes.price_remembered) : "";
    const minRow = this.q(".minrow");
    minRow.hidden = !(packLike && hasContentNow);
    this.q('[data-l="minStock"]').textContent = t.minStock;
    if (!minRow.hidden) this._setInput(this.q('[data-f="minStock"]'), text.attributes.min_stock ? String(text.attributes.min_stock) : "");
    // replacement interval: household items with content
    const replRow = this.q(".replrow");
    replRow.hidden = !(kind === "household" && hasContentNow);
    if (!replRow.hidden) {
      const repl = text.attributes.replace;
      this.q('[data-l="replaceEvery"]').textContent = t.replaceEvery;
      this._setInput(this.q('[data-f="replaceWeeks"]'), repl ? String(repl.weeks).replace(".0", "") : "");
      this.q(".replinfo").textContent = repl ? t.replaceInfo(repl.days, fmtDay(repl.due, hass)) : "";
      const replaced = this.q("button.replaced");
      replaced.hidden = !repl;
      replaced.textContent = `🔁 ${t.replaced}`;
    }
    // shopping list of the product: only with content and as soon as there are to-do lists
    const lists = todoLists(hass);
    const listRow = this.q(".listrow");
    listRow.hidden = !(hasContentNow && lists.length);
    this.q('[data-l="shopList"]').textContent = t.shopList;
    if (!listRow.hidden) {
      const select = this.q('[data-f="shopList"]');
      const sig = JSON.stringify([t.shopListDefault, lists]);
      if (select.dataset.sig !== sig) {
        select.replaceChildren(
          ...[{ id: "", name: t.shopListDefault }, ...lists].map((l) => {
            const o = document.createElement("option");
            o.value = l.id;
            o.textContent = l.name;
            return o;
          }),
        );
        select.dataset.sig = sig;
      }
      this._setInput(select, (text.attributes && text.attributes.shopping_list) || "");
    }
    // store section: with content and a shopping list, like the list row
    const sectionRow = this.q(".sectionrow");
    const sAttrs = (text && text.attributes) || {};
    sectionRow.hidden = listRow.hidden || !sAttrs.section;
    this.q('[data-l="section"]').textContent = t.section;
    if (!sectionRow.hidden) {
      const names = String(hass.language || "en").toLowerCase().startsWith("de") ? SECTION_NAMES.de : SECTION_NAMES.en;
      const select = this.q('[data-f="section"]');
      const suggested = sAttrs.section_own ? "" : sAttrs.section;
      const sig = JSON.stringify([names, suggested, t.sectionAuto]);
      if (select.dataset.sig !== sig) {
        const opts = [["", suggested ? t.sectionAuto(names[suggested] || suggested) : t.sectionAuto("")], ...Object.entries(names)];
        select.replaceChildren(
          ...opts.map(([value, name]) => {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = name;
            return o;
          }),
        );
        select.dataset.sig = sig;
      }
      this._setInput(select, sAttrs.section_own ? sAttrs.section : "");
    }
    if (nfc !== null) {
      this.q(".nfcstate").textContent = { linked: t.nfcLinked, none: t.nfcNone, waiting: t.nfcWaiting }[nfc];
      this.q("button.nfcbtn").textContent = { linked: t.nfcUnlink, none: t.nfcLink, waiting: t.cancel }[nfc];
    }

    const vac = states[dev.entities.switch];
    const vacInput = this.q('[data-f="vacuum"]');
    this.q(".vacrow").style.display = vac ? "" : "none";
    vacInput.disabled = !ok(vac);
    vacInput.checked = !!vac && vac.state === "on";

    // "Add to shopping list when emptied": only visible if a list is chosen in the settings.
    const shop = states[dev.entities.shopping];
    const shopInput = this.q('[data-f="shopping"]');
    this.q(".shoprow").style.display = hasShoppingList(shop) ? "" : "none";
    shopInput.disabled = !ok(shop);
    shopInput.checked = !!shop && shop.state === "on";

    // variable storage place: switch, and only if it is on, the place after emptying
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

    // "Estimate date": only visible if the estimate is not switched off, content is there and the date still empty.
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
        badge.textContent = t.expiredSince(-days);
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
    this.larderLabel = null; // IDs of the labels "Larder" / "Larder: …" (only if they exist)
    this._cards = new Map();
    this._devices = [];
    this._pendingFill = null; // container just created, for which the fill dialog should open
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
          <label class="field"><span data-l="content"></span><span class="contentline"><input type="text" data-f="content" maxlength="255" list="zs-contents" autocomplete="off"><button type="button" class="barcode" hidden>EAN</button><button type="button" class="photo" hidden>📷</button><input type="file" class="photofile" accept="image/*" capture="environment" hidden></span><datalist id="zs-contents"></datalist><datalist id="zs-sizes"></datalist></label>
          <div class="hint barcodestatus" role="status" hidden></div>
          <label class="field" data-w="area" hidden><span data-l="area"></span><select data-f="area"></select></label>
          <label class="field" data-w="compartment" hidden><span data-l="compartment"></span><input type="text" data-f="compartment" maxlength="60" autocomplete="off"></label>
          <label class="field" data-w="boxsize" hidden><span data-l="boxSize"></span><input type="text" data-f="boxSize" maxlength="20" list="zs-sizes" autocomplete="off"></label>
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
   * Embedded in the dashboard: `only` shows the card of one container (with a back button),
   * `show="cards"` with `ids` (comma-separated, in this order) the cards of several containers,
   * `show="estimates"` the list of remembered estimates.
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
   * Find the ID of the label "Larder" (name case-insensitive). Only areas with
   * this label then appear in the area select. Administrators only (registry query).
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
      ids = null; // without labels: show all areas
    }
    if (JSON.stringify(ids) !== JSON.stringify(this.larderLabel)) {
      this.larderLabel = ids;
      this._update();
    }
  }

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  // Set by Home Assistant, not needed here.
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

  /** Can the app (Companion) write NFC tags? Then the dialog offers "Write a new NFC tag". */
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

  /** Create a new tag in Home Assistant (so it is in the tag list) and ask the app to write it. */
  async _writeNewTag(tagId, name) {
    const hass = this._hass;
    try {
      await hass.callWS({ type: "tag/create", tag_id: tagId, name });
    } catch (err) {
      /* not a problem: the tag also works without an entry in the tag list */
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
      return false; // keep waiting for another tag
    }
    this._nfcTag = tag;
    this._setNfcStatus();
    return true;
  }

  /** Show an error message above the cards (e.g. if changing the area fails). */
  showError(message) {
    this._notice.textContent = message || "";
    this._notice.hidden = !message;
  }

  /** Open the dialog "Add container"; with `code` "Read Zwilling QR code" is preselected. */
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
    // presets of the new container: vacuum (default from the settings), shopping list (only with a list), variable storage place
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

  /** "Back to after emptying": only with a variable storage place, preset with the chosen area. */
  _syncHomeArea() {
    const t = strings(this._hass);
    const flexible = this._form.querySelector('[data-f="flexible"]').checked;
    const wrap = this._form.querySelector('[data-w="homeArea"]');
    wrap.hidden = !flexible;
    if (!flexible) return;
    const select = this._form.querySelector('[data-f="homeArea"]');
    const area = this._form.querySelector('[data-f="area"]').value;
    select.replaceChildren(
      ...[{ id: "", name: t.homeNone }, ...listAreas(this._hass, this.larderLabel, null, "food")].map((a) => {
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
      ...[{ id: "", name: t.noArea }, ...listAreas(this._hass, this.larderLabel, null, "food")].map((a) => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        return opt;
      }),
    );
  }

  /** Create a container through the config flow of the integration (same flow as in the settings). */
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
        next_step_id: mode === "scan" ? "scan" : "create", // "nfc" and "nfcwrite" create a new ID like "new"
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
        // New container: as soon as its device is there, open "Fill container" right away (as after scanning an empty container).
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
          /* flow was already finished */
        }
      }
      this._busy = false;
      this._form.querySelector("button.submit").disabled = false;
    }
  }

  /** Waits for the device of a container just created and then opens the fill dialog for it. */
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

  /** `?add=<ID>` (from the scan webhook): open the dialog with the code, or a note for non-administrators. */
  _handleAddParam() {
    if (this.hasAttribute("embedded")) return; // in the dashboard the outer view takes care of this
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
   * Dialog "Fill container": content (with suggestions), vacuum, stored on, best-before date, optional estimate.
   * With a list of device IDs several containers are filled at once with the same values
   * (quantity applies per container); the presets then come from the first container, content and date stay empty.
   */
  openFillDialog(deviceIds, preset = null) {
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
    this._fillQuantities = (preset && preset.quantities) || null; // batch cooking: quantity per container
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
    if (preset && preset.content) f("content").value = preset.content;
    if (preset && preset.unit && [...f("unit").options].some((o) => o.value === preset.unit)) f("unit").value = preset.unit;
    if (this._fillQuantities) {
      const first = this._fillQuantities[dev.deviceId];
      f("quantity").value = first ? String(first) : "";
    }
    // size for containers with a variable size (suggestion: the one used last)
    const variableDevs = devs.filter((d) => {
      const st = states[d.entities.text];
      return !!(st && st.attributes && st.attributes.size_variable);
    });
    this._fillForm.querySelector('[data-w="boxsize"]').hidden = !variableDevs.length;
    if (variableDevs.length) {
      const st = states[variableDevs[0].entities.text];
      f("boxSize").value = (preset && preset.sizes && preset.sizes[variableDevs[0].deviceId]) || (st.attributes && st.attributes.size_last) || "";
    }
    this._fillSizes = (preset && preset.sizes) || null;
    this._syncSizeList();
    f("vacuum").checked = !!vac && vac.state === "on";
    this._fillForm.querySelector('[data-w="vacuum"]').hidden = !vac || vac.state === "unavailable";
    // area only for containers with a variable storage place (and only for administrators, who may change areas)
    const flexible = devs.filter((d) => {
      const st = states[d.entities.flexible];
      return !!st && st.state === "on";
    });
    const areaWrap = this._fillForm.querySelector('[data-w="area"]');
    areaWrap.hidden = !(isAdmin(hass) && flexible.length);
    if (!areaWrap.hidden) {
      const current = flexible[0].areaId || "";
      const areas = listAreas(hass, this.larderLabel, current, "food");
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
    // the compartment belongs to the place: ask for it together with the area for variable containers
    const compWrap = this._fillForm.querySelector('[data-w="compartment"]');
    compWrap.hidden = areaWrap.hidden || !states[flexible[0] && flexible[0].entities.compartment];
    if (!compWrap.hidden) {
      const comp = states[flexible[0].entities.compartment];
      f("compartment").value = isValidState(comp) ? comp.state : "";
      f("compartment").placeholder = t.compartmentHint;
      // suggest compartments of the chosen area (changes with the area)
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
    this._fillQuantities = null;
    this._fillSizes = null;
  }

  /** Known container sizes as suggestions (from the containers). */
  _syncSizeList() {
    const states = (this._hass && this._hass.states) || {};
    const seen = new Map();
    for (const d of this._devices) {
      const a = (states[d.entities.text] || {}).attributes || {};
      for (const s of [a.size_fixed, a.size_last, a.size]) if (s) seen.set(String(s).replace(/\s+/g, "").toLowerCase(), s);
    }
    const list = this.shadowRoot.querySelector("#zs-sizes");
    if (!list) return;
    list.replaceChildren(
      ...[...seen.values()].map((s) => {
        const o = document.createElement("option");
        o.value = s;
        return o;
      }),
    );
  }

  /** Fetch suggestions for the content from the server (recently used first). */
  async _loadContents() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: `${DOMAIN}/contents` });
      this._contents = (res && Array.isArray(res.contents) ? res.contents : []).slice(0, 100);
    } catch (err) {
      /* suggestions are optional */
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

  /** Can the app (Companion) scan barcodes? */
  _hasBarcodeScanner() {
    const external = this._hass && this._hass.auth && this._hass.auth.external;
    return !!(external && external.config && external.config.hasBarCodeScanner && typeof external._commandHandler === "function");
  }

  /** Scan the barcode of bought goods and enter the product name (Open Food Facts) as the content. */
  scanBarcode() {
    const t = strings(this._hass);
    const status = this._fillForm.querySelector(".barcodestatus");
    this.scanBarcodeRaw((code) => this._lookupProduct(code, t, status));
  }

  /** Open the app's barcode scanner; `onCode` gets the code read (also for the dashboard). */
  /**
   * Barcode scanner of the app that stays open for one product after another (put away after shopping).
   * `onCode(code)` returns a short message that is shown in the scanner; `onClose()` runs when it is closed.
   */
  scanBarcodeSeries(onCode, onClose = () => {}) {
    const hass = this._hass;
    const external = hass && hass.auth && hass.auth.external;
    if (!this._hasBarcodeScanner() || typeof external.addCommandHandler !== "function" || this._barcodeScan) return false;
    const t = strings(hass);
    const original = external._commandHandler;
    const scan = {};
    this._barcodeScan = scan;
    const notify = (message) => message && external.fireMessage({ type: "bar_code/notify", payload: { message } });
    external.addCommandHandler((msg) => {
      if (this._barcodeScan === scan && msg && msg.command === "bar_code/scan_result") {
        Promise.resolve(onCode(String((msg.payload && msg.payload.rawValue) || ""))).then(notify, () => {});
      } else if (this._barcodeScan === scan && msg && msg.command === "bar_code/aborted") {
        this._barcodeScan = null;
        external.addCommandHandler(original);
        onClose();
      }
      return original(msg);
    });
    external.fireMessage({
      type: "bar_code/scan",
      payload: { title: t.putAwayTitle, description: t.putAwayDescription, alternative_option_label: t.putAwayDone },
    });
    return true;
  }

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

  /** Upload a photo, the AI suggests the content (only a suggestion, saved with "Save"). */
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
      const quantities = this._fillQuantities;
      const sizes = this._fillSizes;
      const boxSize = this._fillForm.querySelector('[data-w="boxsize"]').hidden ? null : f("boxSize").value.trim();
      for (const dev of devs) {
        const q = quantities && quantities[dev.deviceId];
        await this._fillOne(dev, q ? { ...values, quantity: q } : values);
        const st = (hass.states || {})[dev.entities.text];
        if (boxSize !== null && st && st.attributes && st.attributes.size_variable && hass.callWS) {
          const size = (sizes && sizes[dev.deviceId]) || boxSize;
          await hass.callWS({ type: `${DOMAIN}/size_fill`, device_id: dev.deviceId, size }).catch(() => {});
        }
      }
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

  /** Fill one container with the values from the dialog. */
  async _fillOne(dev, values) {
    const hass = this._hass;
    const states = hass.states || {};
    const ids = dev.entities;
    const before = states[ids.text];
    await hass.callService("text", "set_value", { entity_id: ids.text, value: values.content });
    // product data and nutrition: take from the barcode; for another content without a scan drop the old ones
    if (hass.callWS && (values.product || (isValidState(before) && before.state.trim() && before.state.trim() !== values.content))) {
      try {
        await hass.callWS({ type: `${DOMAIN}/product_set`, device_id: dev.deviceId, product: values.product || {}, replace: true });
      } catch {
        /* older version without product data */
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
    // variable storage place: put the container into the chosen area
    const flex = states[ids.flexible];
    if (values.area !== undefined && flex && flex.state === "on" && (dev.areaId || "") !== values.area && hass.callWS) {
      await hass.callWS({ type: "config/device_registry/update", device_id: dev.deviceId, area_id: values.area || null });
    }
    if (values.compartment !== undefined && flex && flex.state === "on" && ids.compartment) {
      await hass.callService("text", "set_value", { entity_id: ids.compartment, value: values.compartment });
      rememberCompartment(values.area !== undefined ? values.area : dev.areaId, values.compartment);
    }
  }

  /** Show "Recipe ideas" only to administrators if the AI integration and the service exist. */
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

  /** Preset the field "days ahead" once with the period from the settings. */
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
      /* older version of the integration: the default stays */
    }
  }

  closeRecipeDialog() {
    this._recipeOverlay.hidden = true;
  }

  /** Fetch recipe ideas from the AI (service `larder.suggest_recipes`) and show them. */
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

  /** Switch between the container overview and the list of remembered estimates (administrators only). */
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

  /** Draw the list of remembered estimates: an own row for adding, below it all entries. */
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

    // --- suggestions from the history (never applied silently) ---
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

    // --- add an own entry ---
    const add = el("section", "est new");
    add.append(el("h3", "", t.estAddTitle));
    const content = input("text", "", { maxLength: 255 });
    content.dataset.f = "content";
    const area = el("select");
    area.dataset.f = "area";
    for (const a of listAreas(hass, this.larderLabel, null, "food")) {
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

    // --- existing entries ---
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

  /** State of a card's NFC row: "linked", "none", "waiting" or null (do not show). */
  nfcState(deviceId) {
    if (!isAdmin(this._hass)) return null;
    if (this._capture && this._capture.deviceId === deviceId) return "waiting";
    return this._nfcLinks[deviceId] ? "linked" : "none";
  }

  /** Click on a card's NFC button: link, cancel waiting or unlink. */
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

  /** Wait for the next scanned tag. `onTag` returns false if the tag is no good (keep waiting). */
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

  /** Subscribe to events (only administrators may subscribe to arbitrary events). */
  async _subscribe() {
    const hass = this._hass;
    if (this._subscribed || !hass || !hass.connection) return;
    if (!isAdmin(hass)) {
      // without administrator rights: only scanned tags (for labelling bags), through Larder
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
          // embedded, the outer view opens the container itself
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
        /* connection already closed */
      }
    }
    this._subscribed = false;
  }

  /** Highlight a container (after scanning its tag): reset the view, scroll to it, let it blink briefly. */
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
    void card.el.offsetWidth; // restart the animation
    card.el.classList.add("flash");
    if (card.el.scrollIntoView) card.el.scrollIntoView({ block: "center", behavior: "smooth" });
    // Empty container: offer "Fill container" right away (after scanning with the phone).
    if (fill) {
      const dev = this._devices.find((d) => d.deviceId === deviceId);
      const text = dev && (hass.states || {})[dev.entities.text];
      if (text && text.state !== "unavailable" && !(isValidState(text) && text.state.trim() !== "")) {
        this.openFillDialog(deviceId);
      }
    }
    return true;
  }

  /** `?recipes=1` (button "Recipes" in the daily notification): open the recipe dialog. */
  _handleRecipesParam() {
    if (this.hasAttribute("embedded")) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("recipes") || !this._hass || !this._hass.user) return;
    window.history.replaceState(null, "", window.location.pathname);
    this.openRecipeDialog();
  }

  /** `?open=<device ID>` (from the notification after an NFC scan): highlight the container. */
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
    // Order and visibility also depend on the states (filter, sorting by date).
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
      // vouchers (4.8) have a dialog of their own in the dashboard, not a card
      const isVoucher = (d) => ((hass.states[d.entities.text] || {}).attributes || {}).kind === "voucher";
      this._arranged = arrangeDevices(hass, this._devices.filter((d) => !isVoucher(d)), this._opts);
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

  /** Rebuild area headings and card order; existing cards are kept. */
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

// Embedded variant for the dashboard under its own name: if the browser still has an older
// <larder-panel> registered from an earlier session, the embedded variant still uses this code.
if (!customElements.get("larder-panel-embedded")) {
  customElements.define("larder-panel-embedded", class extends LarderPanel {});
}
