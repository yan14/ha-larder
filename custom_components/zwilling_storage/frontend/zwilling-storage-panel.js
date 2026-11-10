/*
 * Zwilling Dosen: Übersicht aller Dosen der Integration "zwilling_storage".
 *
 * Liest Geräte, Bereiche, Entitäten und Zustände direkt aus dem hass-Objekt des Frontends.
 * Es gibt keine feste Konfiguration: Neue Dosen erscheinen, sobald sie in Home Assistant
 * angelegt sind, geänderte Werte und Bereiche werden live übernommen.
 */

const DOMAIN = "zwilling_storage";

export const STRINGS = {
  de: {
    title: "Zwilling Dosen",
    area: "Bereich",
    noArea: "Kein Bereich",
    content: "Inhalt",
    bestBefore: "MHD",
    filledAt: "Eingelagert am",
    now: "Jetzt",
    emptyContainer: "Behälter leeren",
    openDevice: "Gerät öffnen",
    qrCode: "QR-Code",
    expired: "abgelaufen",
    expiresToday: "läuft heute ab",
    expiresInDays: (n) => `noch ${n} ${n === 1 ? "Tag" : "Tage"}`,
    count: (n) => `${n} ${n === 1 ? "Dose" : "Dosen"}`,
    noneTitle: "Noch keine Dosen angelegt",
    noneText:
      "Lege über Einstellungen → Geräte & Dienste → Zwilling Food Storage eine Dose an. Sie erscheint hier automatisch.",
    openSettings: "Integration öffnen",
    menu: "Menü",
  },
  en: {
    title: "Zwilling containers",
    area: "Area",
    noArea: "No area",
    content: "Contents",
    bestBefore: "Best before",
    filledAt: "Filled on",
    now: "Now",
    emptyContainer: "Empty container",
    openDevice: "Open device",
    qrCode: "QR code",
    expired: "expired",
    expiresToday: "expires today",
    expiresInDays: (n) => `${n} ${n === 1 ? "day" : "days"} left`,
    count: (n) => `${n} ${n === 1 ? "container" : "containers"}`,
    noneTitle: "No containers yet",
    noneText:
      "Add a container via Settings → Devices & services → Zwilling Food Storage. It will show up here automatically.",
    openSettings: "Open integration",
    menu: "Menu",
  },
};

function strings(hass) {
  const lang = ((hass && (hass.language || (hass.locale && hass.locale.language))) || "en")
    .toLowerCase()
    .split("-")[0];
  return STRINGS[lang] || STRINGS.en;
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
    // Pro Gerät gibt es genau eine Entität je Domain: text, date, datetime, button, image.
    dev.entities[ent.entity_id.split(".")[0]] = ent.entity_id;
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

function navigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
}

const STYLE = `
  :host { display: block; min-height: 100%; background: var(--primary-background-color);
    color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  header { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px;
    background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
    position: sticky; top: 0; z-index: 2; box-sizing: border-box; }
  header h1 { font-size: 20px; font-weight: 400; margin: 0; flex: 1; }
  header .count { opacity: .85; font-size: 14px; }
  #menu { display: none; background: none; border: 0; color: inherit; font-size: 24px; cursor: pointer; padding: 4px 8px; }
  :host([narrow]) #menu { display: inline-block; }
  main { padding: 16px; max-width: 1400px; margin: 0 auto; box-sizing: border-box; }
  h2.area { font-size: 15px; font-weight: 500; margin: 20px 4px 8px; color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .04em; }
  h2.area:first-child { margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--card-background-color, #fff); border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .card .head { display: flex; align-items: baseline; gap: 8px; }
  .card .name { font-size: 18px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card a.open { font-size: 13px; color: var(--primary-color); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .card .arealine { font-size: 13px; color: var(--secondary-text-color); margin-top: -6px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row label { width: 104px; flex: none; font-size: 14px; color: var(--secondary-text-color); }
  .row input { flex: 1; min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; color-scheme: light dark; }
  .row input:disabled { opacity: .5; }
  .row button.now { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .badge { display: none; font-size: 12px; padding: 2px 8px; border-radius: 10px; color: #fff; white-space: nowrap; }
  .badge.expired { display: inline-block; background: var(--error-color, #db4437); }
  .badge.soon { display: inline-block; background: var(--warning-color, #ffa600); }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .actions .spacer { flex: 1; }
  button.empty { font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 0;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  button:disabled { opacity: .5; cursor: default; }
  .qr { width: 72px; height: 72px; border-radius: 6px; background: #fff; display: none; image-rendering: pixelated; }
  .qr.visible { display: block; }
  .none { text-align: center; padding: 48px 16px; color: var(--secondary-text-color); }
  .none h2 { color: var(--primary-text-color); font-weight: 400; }
  .none a { color: var(--primary-color); cursor: pointer; }
`;

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
      <div class="row"><label data-l="content"></label><input data-f="content" type="text" maxlength="255"></div>
      <div class="row"><label data-l="bestBefore"></label><input data-f="bestBefore" type="date"><span class="badge"></span></div>
      <div class="row"><label data-l="filledAt"></label><input data-f="filledAt" type="datetime-local"><button class="now" type="button"></button></div>
      <div class="actions"><button class="empty" type="button"></button><span class="spacer"></span><img class="qr" alt=""></div>`;
    this.el = el;
    this.q = (sel) => el.querySelector(sel);
    this.inputs = {
      content: this.q('[data-f="content"]'),
      bestBefore: this.q('[data-f="bestBefore"]'),
      filledAt: this.q('[data-f="filledAt"]'),
    };

    this.q("a.open").addEventListener("click", () => navigate(`/config/devices/device/${this.deviceId}`));
    this.inputs.content.addEventListener("change", () => {
      if (this.ids.text) this._call("text", "set_value", { entity_id: this.ids.text, value: this.inputs.content.value });
    });
    this.inputs.bestBefore.addEventListener("change", () => {
      const v = this.inputs.bestBefore.value;
      if (this.ids.date && v) this._call("date", "set_value", { entity_id: this.ids.date, date: v });
    });
    this.inputs.filledAt.addEventListener("change", () => {
      const v = this.inputs.filledAt.value;
      const d = new Date(v);
      if (this.ids.datetime && v && !Number.isNaN(d.getTime())) {
        this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: d.toISOString() });
      }
    });
    this.q("button.now").addEventListener("click", () => {
      if (this.ids.datetime) this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: new Date().toISOString() });
    });
    this.q("button.empty").addEventListener("click", () => {
      if (this.ids.button) this._call("button", "press", { entity_id: this.ids.button });
    });
  }

  _call(domain, service, data) {
    const hass = this._panel.hass;
    if (hass) hass.callService(domain, service, data);
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
    this.q(".arealine").textContent = `${t.area}: ${dev.areaName || t.noArea}`;
    this.q('[data-l="content"]').textContent = t.content;
    this.q('[data-l="bestBefore"]').textContent = t.bestBefore;
    this.q('[data-l="filledAt"]').textContent = t.filledAt;
    this.q("button.now").textContent = t.now;
    this.q("button.empty").textContent = t.emptyContainer;

    const text = states[dev.entities.text];
    const date = states[dev.entities.date];
    const dt = states[dev.entities.datetime];
    const btn = states[dev.entities.button];
    const img = states[dev.entities.image];
    const ok = (st) => !!st && st.state !== "unavailable";

    this._setInput(this.inputs.content, isValidState(text) ? text.state : "");
    this._setInput(this.inputs.bestBefore, isValidState(date) ? date.state : "");
    this._setInput(this.inputs.filledAt, isValidState(dt) ? toLocalInputValue(dt.state) : "");
    this.inputs.content.disabled = !ok(text);
    this.inputs.bestBefore.disabled = !ok(date);
    this.inputs.filledAt.disabled = !ok(dt);
    this.q("button.now").disabled = !ok(dt);
    this.q("button.empty").disabled = !ok(btn);

    const badge = this.q(".badge");
    badge.className = "badge";
    badge.textContent = "";
    const days = isValidState(date) ? daysUntil(date.state) : null;
    if (days !== null) {
      if (days < 0) {
        badge.className = "badge expired";
        badge.textContent = t.expired;
      } else if (days <= 3) {
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

class ZwillingStoragePanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._cards = new Map();
    this._devices = [];
    this._registries = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><span class="count"></span></header>
      <main></main>`;
    this._main = this.shadowRoot.querySelector("main");
    this._title = this.shadowRoot.querySelector("h1");
    this._count = this.shadowRoot.querySelector(".count");
    this.shadowRoot.querySelector("#menu").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
  }

  get hass() {
    return this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  // Von Home Assistant gesetzt, hier nicht benötigt.
  set route(_value) {}
  set panel(_value) {}

  _update() {
    const hass = this._hass;
    if (!hass) return;

    const regs = [hass.entities, hass.devices, hass.areas];
    if (!this._registries || regs.some((r, i) => r !== this._registries[i])) {
      this._registries = regs;
      this._devices = collectDevices(hass);
      this._rebuild(hass);
    }

    const t = strings(hass);
    this._title.textContent = t.title;
    this._count.textContent = t.count(this._devices.length);
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
    if (!this._devices.length) {
      const none = document.createElement("div");
      none.className = "none";
      none.innerHTML = `<h2></h2><p></p><a></a>`;
      none.querySelector("h2").textContent = t.noneTitle;
      none.querySelector("p").textContent = t.noneText;
      const link = none.querySelector("a");
      link.textContent = t.openSettings;
      link.addEventListener("click", () => navigate(`/config/integrations/integration/${DOMAIN}`));
      frag.appendChild(none);
    } else {
      let currentArea;
      let grid = null;
      for (const dev of this._devices) {
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

if (!customElements.get("zwilling-storage-panel")) {
  customElements.define("zwilling-storage-panel", ZwillingStoragePanel);
}
