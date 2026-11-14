/**
 * Lovelace-Karte "Larder: läuft bald ab" (type: custom:larder-card).
 *
 * Wird von der Integration automatisch geladen (keine Ressource nötig) und erscheint in der
 * Kartenauswahl. Optionen (YAML):
 *   title: Überschrift (Standard: "Läuft bald ab")
 *   days: nur Dosen, die in so vielen Tagen ablaufen (Standard: Einstellung "Läuft bald ab")
 *   show_expired: abgelaufene zeigen (Standard: true)
 *   limit: höchstens so viele Dosen (Standard: 8)
 *   area: nur Dosen aus diesem Bereich (Bereichs-ID)
 * Antippen einer Dose öffnet sie im Larder-Dashboard.
 */
const { collectDevices, daysUntil, soonDaysOf } = await import(`./larder-panel.js${new URL(import.meta.url).search}`);

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
  fish: "🐟", raw_meat: "🥩", deli: "🥓", dairy: "🧀", egg: "🥚", produce: "🥦", bread: "🍞",
  dish: "🍲", dry: "🌾", sweet: "🍫", coffee: "☕", mixed: "🍱", other: "📦",
};

function texts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

const valid = (st) => !!st && !["unknown", "unavailable", ""].includes(st.state);

/** Dosen mit MHD innerhalb der Grenze (abgelaufene zuerst), wie sie die Karte zeigt. */
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
    this._hass = hass;
    this._render();
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

/** Lovelace-Karte "Larder: Vorrat" (type: custom:larder-stock-card). */
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
    // neu laden, wenn sich Inhalte oder Mengen von Larder ändern (gebündelt) oder spätestens alle 5 Minuten
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
          /* bleibt */
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
