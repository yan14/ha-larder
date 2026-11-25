/**
 * Lovelace card "Larder: expires soon" (type: custom:larder-card).
 *
 * Loaded automatically by the integration (no resource needed) and appears in the
 * card picker. Options (YAML):
 *   title: heading (default: "Läuft bald ab" / "Expires soon")
 *   days: only containers that expire within this many days (default: setting "Expires soon")
 *   show_expired: show expired ones (default: true)
 *   limit: at most this many containers (default: 8)
 *   area: only containers from this area (area ID)
 * Tapping a container opens it in the Larder dashboard.
 */
const { collectDevices, daysUntil, hassChanged, soonDaysOf } = await import(`./larder-panel.js${new URL(import.meta.url).search}`);

const TEXT = {
  de: {
    title: "Läuft bald ab",
    none: "Nichts läuft bald ab.",
    today: "heute",
    tomorrow: "morgen",
    inDays: (n) => `in ${n} Tagen`,
    expired: (n) => (n === -1 ? "seit gestern abgelaufen" : `seit ${-n} Tagen abgelaufen`),
    more: (n) => `und ${n} weitere`,
    description: "Dosen aus Larder, die bald ablaufen.",
  },
  en: {
    title: "Expiring soon",
    none: "Nothing expires soon.",
    today: "today",
    tomorrow: "tomorrow",
    inDays: (n) => `in ${n} days`,
    expired: (n) => (n === -1 ? "expired yesterday" : `expired ${-n} days ago`),
    more: (n) => `and ${n} more`,
    description: "Containers from Larder that expire soon.",
  },
};

const ICONS = {
  fish: "🐟", raw_meat: "🥩", deli: "🥓", plant: "🌱", condiment: "🧂", dairy: "🧀", egg: "🥚", produce: "🥦", bread: "🍞",
  dish: "🍲", dry: "🌾", sweet: "🍫", coffee: "☕", mixed: "🍱", other: "📦",
};

function texts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

const valid = (st) => !!st && !["unknown", "unavailable", ""].includes(st.state);

/** Containers with a date within the limit (expired first), as the card shows them. */
export function expiringRows(hass, config = {}, now = new Date()) {
  const states = (hass && hass.states) || {};
  const rows = [];
  for (const dev of collectDevices(hass)) {
    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    if (!valid(text) || !text.state.trim() || !valid(date)) continue;
    if (config.area && dev.areaId !== config.area) continue;
    const days = daysUntil(date.state, now);
    if (days === null) continue;
    const limit = Number.isFinite(Number(config.days)) && config.days !== undefined && config.days !== null ? Number(config.days) : soonDaysOf(date);
    if (days > limit) continue;
    if (days < 0 && config.show_expired === false) continue;
    rows.push({
      id: dev.deviceId,
      name: dev.name,
      area: dev.areaName,
      content: text.state.trim(),
      icon: ICONS[(text.attributes && text.attributes.category) || "other"] || ICONS.other,
      days,
      allergens: Array.isArray(text.attributes && text.attributes.allergen_warning) ? text.attributes.allergen_warning : [],
    });
  }
  return rows.sort((a, b) => a.days - b.days || a.content.localeCompare(b.content));
}

export class LarderCard extends HTMLElement {
  static getStubConfig() {
    return { show_expired: true, limit: 8 };
  }

  setConfig(config) {
    this._config = { show_expired: true, limit: 8, ...(config || {}) };
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._hassMemo) this._hassMemo = {};
    if (hassChanged(prev, hass, this._hassMemo)) this._render();
  }

  getCardSize() {
    return 1 + Math.min((this._rows || []).length, this._config ? this._config.limit : 8);
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = texts(this._hass);
    const rows = expiringRows(this._hass, this._config);
    this._rows = rows;
    const limit = Math.max(1, Number(this._config.limit) || 8);
    const sig = JSON.stringify([rows, limit, this._config.title, t.title]);
    if (sig === this._sig) return;
    this._sig = sig;
    const shown = rows.slice(0, limit);
    const when = (d) => (d < 0 ? t.expired(d) : d === 0 ? t.today : d === 1 ? t.tomorrow : t.inDays(d));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 8px; }
        h2 { margin: 0 0 8px; font-size: 18px; font-weight: 400; }
        .row { display: flex; align-items: center; gap: 12px; padding: 6px 0; cursor: pointer; border-top: 1px solid var(--divider-color); }
        .row:first-of-type { border-top: 0; }
        .ico { font-size: 22px; width: 28px; text-align: center; }
        .text { flex: 1; min-width: 0; }
        .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sub { font-size: 12px; color: var(--secondary-text-color); }
        .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; white-space: nowrap;
          background: var(--warning-color, #f57c00); color: #fff; }
        .badge.expired { background: var(--error-color, #c62828); }
        .none, .more { color: var(--secondary-text-color); font-size: 14px; padding: 6px 0; }
      </style>
      <ha-card>
        <h2>${esc(this._config.title || t.title)}</h2>
        ${shown.length ? "" : `<div class="none">${esc(t.none)}</div>`}
        ${shown
          .map(
            (r) => `<div class="row" data-id="${esc(r.id)}"><span class="ico">${r.icon}</span><span class="text"><div class="name">${esc(r.content)}</div><div class="sub">${esc([r.name, r.area, r.allergens.length ? `⚠ ${r.allergens.join(", ")}` : ""].filter(Boolean).join(" · "))}</div></span><span class="badge${r.days < 0 ? " expired" : ""}">${esc(when(r.days))}</span></div>`,
          )
          .join("")}
        ${rows.length > shown.length ? `<div class="more">${esc(t.more(rows.length - shown.length))}</div>` : ""}
      </ha-card>`;
    for (const row of this.shadowRoot.querySelectorAll(".row")) {
      row.addEventListener("click", () => {
        window.history.pushState(null, "", `/larder?open=${encodeURIComponent(row.dataset.id)}`);
        window.dispatchEvent(new Event("location-changed"));
      });
    }
  }
}


const STOCK_TEXT = {
  de: {
    title: "Vorrat",
    low: "Unter Mindestbestand",
    bought: "Eingekauft, noch nicht im Vorrat",
    opened: "Angebrochen",
    none: "Alles da.",
    shop: "🛒",
    shopped: "auf der Liste",
    of: (n, min) => `${n} von ${min}`,
    description: "Vorrat aus Larder: was unter Mindestbestand ist, Eingekauftes und angebrochene Packungen.",
  },
  en: {
    title: "Stock",
    low: "Below minimum stock",
    bought: "Bought, not in stock yet",
    opened: "Opened",
    none: "Everything is there.",
    shop: "🛒",
    shopped: "on the list",
    of: (n, min) => `${n} of ${min}`,
    description: "Stock from Larder: below minimum stock, bought items and opened packs.",
  },
};

function stockTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? STOCK_TEXT.de : STOCK_TEXT.en;
}

const REFRESH_MS = 5 * 60 * 1000;

/** Lovelace card "Larder: stock" (type: custom:larder-stock-card). */
export class LarderStockCard extends HTMLElement {
  static getStubConfig() {
    return { show_bought: true, show_opened: true };
  }

  setConfig(config) {
    this._config = { show_bought: true, show_opened: true, ...(config || {}) };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    // reload when contents or quantities of Larder change (debounced) or every 5 minutes at the latest
    const sig = Object.values(hass.entities || {})
      .filter((e) => e.platform === "larder" && /^(text|number)\./.test(e.entity_id))
      .map((e) => (hass.states[e.entity_id] || {}).state)
      .join("|");
    if (first || sig !== this._stateSig || Date.now() - (this._loaded || 0) > REFRESH_MS) {
      this._stateSig = sig;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.load(), first ? 0 : 1500);
    }
  }

  getCardSize() {
    return 3;
  }

  async load() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    this._loaded = Date.now();
    try {
      const [stock, bought] = await Promise.all([
        hass.callWS({ type: "larder/stock" }),
        this._config && this._config.show_bought === false ? Promise.resolve({ items: [] }) : hass.callWS({ type: "larder/bought" }),
      ]);
      this._data = { stock, bought: (bought && bought.items) || [] };
    } catch {
      this._data = { stock: { products: [] }, bought: [] };
    }
    this._render();
  }

  _go(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = stockTexts(this._hass);
    const data = this._data || { stock: { products: [] }, bought: [] };
    const products = data.stock.products || [];
    const low = products.filter((p) => p.low);
    const opened = this._config.show_opened === false ? [] : products.filter((p) => p.opened > 0);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const section = (title, rows) => (rows.length ? `<h3>${esc(title)}</h3>${rows.join("")}` : "");
    const lowRows = low.map(
      (p) => `<div class="row" data-go="/larder?view=stock"><span class="name">${esc(p.name)}</span><span class="sub">${esc(t.of(p.count, p.min))}</span>${
        data.stock.shopping_list ? `<button data-shop="${esc(p.name)}" title="${esc(t.shop)}">${(this._shopped || new Set()).has(p.name) ? esc(t.shopped) : t.shop}</button>` : ""
      }</div>`,
    );
    const boughtRows = (data.bought || []).map((b) => `<div class="row" data-go="/larder"><span class="name">${esc(b.summary || b.content)}</span></div>`);
    const openedRows = opened.map((p) => {
      const place = p.places.find((x) => x.opened) || {};
      return `<div class="row" data-go="/larder?open=${esc(place.device_id || "")}"><span class="name">🔓 ${esc(p.name)}</span><span class="sub">${esc([place.area, place.compartment].filter(Boolean).join(" · "))}</span></div>`;
    });
    const body = section(t.low, lowRows) + section(t.bought, boughtRows) + section(t.opened, openedRows);
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 8px; }
        h2 { margin: 0 0 4px; font-size: 18px; font-weight: 400; }
        h3 { margin: 10px 0 2px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }
        .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; border-top: 1px solid var(--divider-color); }
        .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
        .row button { font: inherit; font-size: 13px; padding: 3px 10px; border-radius: 12px; cursor: pointer;
          border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
        .none { color: var(--secondary-text-color); font-size: 14px; padding: 6px 0; }
      </style>
      <ha-card>
        <h2>${esc(this._config.title || t.title)}</h2>
        ${body || `<div class="none">${esc(t.none)}</div>`}
      </ha-card>`;
    for (const row of this.shadowRoot.querySelectorAll("[data-go]")) {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        this._go(row.dataset.go);
      });
    }
    for (const btn of this.shadowRoot.querySelectorAll("[data-shop]")) {
      btn.addEventListener("click", async () => {
        try {
          await this._hass.callWS({ type: "larder/stock_shop", content: btn.dataset.shop });
          this._shopped = new Set([...(this._shopped || []), btn.dataset.shop]);
        } catch {
          /* stays */
        }
        this._render();
      });
    }
  }
}

if (!customElements.get("larder-stock-card")) {
  customElements.define("larder-stock-card", LarderStockCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "larder-stock-card",
    name: "Larder: Vorrat / Stock",
    description: stockTexts({ language: (navigator.language || "en").slice(0, 2) }).description,
    preview: true,
  });
}

if (!customElements.get("larder-card")) {
  customElements.define("larder-card", LarderCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "larder-card",
    name: "Larder",
    description: texts({ language: (navigator.language || "en").slice(0, 2) }).description,
    preview: true,
  });
}

// ---------- 5.3 (#130): shopping and compartment cards ----------

const MORE_TEXT = {
  de: {
    shopTitle: "Einkaufen",
    shopOpen: (n) => (n === 1 ? "1 Eintrag offen" : `${n} Einträge offen`),
    shopNone: "Nichts auf der Liste.",
    shopGo: "🛒 Einkaufsmodus",
    shopDescription: "Offene Einträge der Einkaufslisten von Larder, mit Knopf zum Einkaufsmodus.",
    placeTitle: "Fach",
    placeNone: "Leer.",
    placeMissing: "Bitte in den Karten-Optionen einen Bereich (area) wählen.",
    placeTake: "−1",
    placeDescription: "Was in einem Bereich oder Fach liegt, mit −1 – z. B. für ein Tablet am Kühlschrank.",
    noDate: "ohne MHD",
  },
  en: {
    shopTitle: "Shopping",
    shopOpen: (n) => (n === 1 ? "1 open item" : `${n} open items`),
    shopNone: "Nothing on the list.",
    shopGo: "🛒 Shopping mode",
    shopDescription: "Open items on Larder's shopping lists, with a button to the shopping mode.",
    placeTitle: "Compartment",
    placeNone: "Empty.",
    placeMissing: "Please choose an area in the card options.",
    placeTake: "−1",
    placeDescription: "What is in an area or compartment, with −1 – e.g. for a tablet at the fridge.",
    noDate: "no date",
  },
};

function moreTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? MORE_TEXT.de : MORE_TEXT.en;
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const goTo = (path) => {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
};

/** Lovelace card "Larder: shopping" (type: custom:larder-shopping-card): open items per list. */
export class LarderShoppingCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    const prev = this._hass;
    this._hass = hass;
    if (first) this.load();
    if (!this._hassMemo) this._hassMemo = {};
    if (hassChanged(prev, hass, this._hassMemo)) this._render();
  }

  getCardSize() {
    return 2;
  }

  async load() {
    try {
      this._lists = ((await this._hass.callWS({ type: "larder/shopping_lists" })) || {}).lists || [];
    } catch {
      this._lists = [];
    }
    this._sig = "";
    this._render();
  }

  /** [{entity_id, name, open}] of the lists Larder uses. */
  rows() {
    const states = (this._hass && this._hass.states) || {};
    return (this._lists || [])
      .map((id) => ({ entity_id: id, name: ((states[id] || {}).attributes || {}).friendly_name || id, open: Number((states[id] || {}).state) || 0 }))
      .filter((r) => r.open > 0);
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = moreTexts(this._hass);
    const rows = this.rows();
    const total = rows.reduce((n, r) => n + r.open, 0);
    const sig = JSON.stringify([rows, this._config.title, t.shopTitle]);
    if (sig === this._sig) return;
    this._sig = sig;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px; }
        h2 { margin: 0 0 6px; font-size: 18px; font-weight: 400; display: flex; align-items: center; gap: 8px; }
        .count { font-size: 13px; padding: 1px 8px; border-radius: 10px; background: var(--error-color, #c62828); color: #fff; }
        .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; border-top: 1px solid var(--divider-color); }
        .none { color: var(--secondary-text-color); font-size: 14px; }
        button { margin-top: 8px; font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
          border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
      </style>
      <ha-card>
        <h2>${escHtml(this._config.title || t.shopTitle)}${total ? `<span class="count" data-role="shop-count">${total}</span>` : ""}</h2>
        ${rows.length ? rows.map((r) => `<div class="row"><span>${escHtml(r.name)}</span><span>${escHtml(t.shopOpen(r.open))}</span></div>`).join("") : `<div class="none">${escHtml(t.shopNone)}</div>`}
        <button type="button" data-role="shop-go">${escHtml(t.shopGo)}</button>
      </ha-card>`;
    this.shadowRoot.querySelector('[data-role="shop-go"]').addEventListener("click", () => goTo("/larder?view=shopping"));
  }
}

/** Entries of one area (and compartment) as the compartment card shows them. */
export function placeRows(hass, config = {}, now = new Date()) {
  const states = (hass && hass.states) || {};
  const wanted = String(config.compartment || "").trim().toLowerCase();
  const rows = [];
  for (const dev of collectDevices(hass)) {
    if (!config.area || dev.areaId !== config.area) continue;
    const text = states[dev.entities.text];
    if (!valid(text) || !text.state.trim()) continue;
    const compartment = String((states[dev.entities.compartment] || {}).state || "").trim();
    if (wanted && compartment.toLowerCase() !== wanted) continue;
    const kind = (text.attributes && text.attributes.kind) || "container";
    const date = states[dev.entities.date];
    const unit = (states[dev.entities.select] || {}).state;
    const count = Number((states[dev.entities.number] || {}).state) || 0;
    rows.push({
      id: dev.deviceId,
      name: dev.name,
      content: text.state.trim(),
      kind,
      icon: ICONS[(text.attributes && text.attributes.category) || "other"] || ICONS.other,
      count: ["pack", "household", "medicine"].includes(kind) || ["pieces", "portions"].includes(unit) ? count : null,
      days: valid(date) ? daysUntil(date.state, now) : null,
      compartment,
    });
  }
  return rows.sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999) || a.content.localeCompare(b.content));
}

/** Lovelace card "Larder: compartment" (type: custom:larder-place-card, options area and compartment). */
export class LarderPlaceCard extends HTMLElement {
  static getStubConfig(hass) {
    const area = Object.keys((hass && hass.areas) || {})[0] || "";
    return { area, compartment: "" };
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._hassMemo) this._hassMemo = {};
    if (hassChanged(prev, hass, this._hassMemo)) this._render();
  }

  getCardSize() {
    return 1 + Math.min((this._rows || []).length, 8);
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = moreTexts(this._hass);
    const tt = texts(this._hass);
    const area = (this._hass.areas || {})[this._config.area];
    const rows = placeRows(this._hass, this._config);
    this._rows = rows;
    const sig = JSON.stringify([rows, this._config, t.placeTitle]);
    if (sig === this._sig) return;
    this._sig = sig;
    const title = this._config.title || [area ? area.name : null, this._config.compartment].filter(Boolean).join(" · ") || t.placeTitle;
    const when = (d) => (d === null ? t.noDate : d < 0 ? tt.expired(d) : d === 0 ? tt.today : d === 1 ? tt.tomorrow : tt.inDays(d));
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 8px; }
        h2 { margin: 0 0 8px; font-size: 18px; font-weight: 400; }
        .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--divider-color); cursor: pointer; }
        .row:first-of-type { border-top: 0; }
        .ico { font-size: 20px; width: 26px; text-align: center; }
        .text { flex: 1; min-width: 0; }
        .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sub { font-size: 12px; color: var(--secondary-text-color); }
        .sub.expired { color: var(--error-color, #c62828); }
        button { font: inherit; font-size: 15px; padding: 6px 14px; border-radius: 10px; cursor: pointer; border: 0;
          background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .none { color: var(--secondary-text-color); font-size: 14px; padding: 6px 0; }
      </style>
      <ha-card>
        <h2>${escHtml(title)}</h2>
        ${!this._config.area ? `<div class="none">${escHtml(t.placeMissing)}</div>` : rows.length ? "" : `<div class="none">${escHtml(t.placeNone)}</div>`}
        ${rows
          .map(
            (r) => `<div class="row" data-id="${escHtml(r.id)}"><span class="ico">${r.icon}</span><span class="text"><div class="name">${escHtml(r.content)}${r.count && r.count > 1 ? ` · ${r.count}` : ""}</div><div class="sub${r.days !== null && r.days < 0 ? " expired" : ""}">${escHtml([when(r.days), this._config.compartment ? null : r.compartment].filter(Boolean).join(" · "))}</div></span>${
              ["pack", "household", "medicine"].includes(r.kind) ? `<button type="button" data-take="${escHtml(r.id)}">${t.placeTake}</button>` : ""
            }</div>`,
          )
          .join("")}
      </ha-card>`;
    for (const row of this.shadowRoot.querySelectorAll(".row")) {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        goTo(`/larder?open=${encodeURIComponent(row.dataset.id)}`);
      });
    }
    for (const btn of this.shadowRoot.querySelectorAll("[data-take]")) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await this._hass.callWS({ type: "larder/pack_take", device_id: btn.dataset.take, outcome: "eaten" });
        } catch {
          btn.disabled = false;
        }
      });
    }
  }
}

for (const [type, cls, name, description] of [
  ["larder-shopping-card", LarderShoppingCard, "Larder: Einkaufen / Shopping", (t) => t.shopDescription],
  ["larder-place-card", LarderPlaceCard, "Larder: Fach / Compartment", (t) => t.placeDescription],
]) {
  if (!customElements.get(type)) {
    customElements.define(type, cls);
    window.customCards = window.customCards || [];
    window.customCards.push({ type, name, description: description(moreTexts({ language: (navigator.language || "en").slice(0, 2) })), preview: true });
  }
}
