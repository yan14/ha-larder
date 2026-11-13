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
            (r) => `<div class="row" data-id="${esc(r.id)}"><span class="ico">${r.icon}</span><span class="text"><div class="name">${esc(r.content)}</div><div class="sub">${esc([r.name, r.area].filter(Boolean).join(" · "))}</div></span><span class="badge${r.days < 0 ? " expired" : ""}">${esc(when(r.days))}</span></div>`,
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
