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
      "Füge mit „Dose hinzufügen“ eine Dose hinzu. Sie erscheint hier automatisch.",
    openSettings: "Integration öffnen",
    menu: "Menü",
    addContainer: "Dose hinzufügen",
    modeNew: "Neuen QR-Code erstellen",
    modeZwilling: "Zwilling-QR-Code einlesen",
    codeLabel: "QR-Code-Inhalt oder ID",
    nameLabel: "Name (optional)",
    cancel: "Abbrechen",
    submit: "Hinzufügen",
    invalidCode: "Im QR-Code wurde keine gültige ID (cc) gefunden.",
    alreadyConfigured: "Diese Dose wurde bereits hinzugefügt.",
    addFailed: "Die Dose konnte nicht hinzugefügt werden.",
    adminOnly: (code) =>
      `Nur Administratoren können Dosen hinzufügen. Gescannter Code: ${code}`,
    areaChangeFailed: "Der Bereich konnte nicht geändert werden.",
    vacuum: "Vakuum",
    estimate: "MHD schätzen",
    estimating: "Schätze …",
    estimated: (days) => `Geschätzt: ca. ${days} ${days === 1 ? "Tag" : "Tage"} haltbar`,
    estimateFailed: "Die Schätzung ist fehlgeschlagen.",
    plusOneDay: "+1 Tag",
    opened: "Geöffnet",
    searchPlaceholder: "Suchen …",
    filterLabel: "Filter",
    filterAll: "Alle",
    filterSoon: "Läuft bald ab (≤ 3 Tage)",
    filterExpired: "Abgelaufen",
    filterFilled: "Befüllt",
    filterEmpty: "Leer",
    sortLabel: "Sortierung",
    sortArea: "Nach Bereich",
    sortDate: "Nach MHD",
    sortName: "Nach Name",
    noMatch: "Keine Dose passt zu Suche und Filter.",
    sourceTable: "Tabelle",
    sourceAi: "KI",
    sourceLearned: "von dir korrigiert",
    sourceLearnedTable: "Tabelle, von dir korrigiert",
    sourceLearnedAi: "KI, von dir korrigiert",
    tabContainers: "Dosen",
    tabEstimates: "Schätzungen",
    estTitle: "Gemerkte Schätzungen",
    estIntro:
      "Hier stehen alle Werte, die für Inhalt, Bereich und Vakuum gemerkt wurden (aus der Tabelle, von der KI oder von dir). Du kannst Tage und Tipp ändern, Einträge löschen (dann wird neu geschätzt) oder eigene hinzufügen.",
    estContent: "Inhalt",
    estArea: "Bereich",
    estVacuum: "Vakuum",
    estNoVacuum: "ohne Vakuum",
    estDays: "Tage",
    estTip: "Tipp",
    estSource: "Quelle",
    estSave: "Speichern",
    estDelete: "Löschen",
    estAdd: "Hinzufügen",
    estAddTitle: "Eigenen Eintrag hinzufügen",
    estEmpty: "Noch nichts gemerkt. Einträge entstehen, sobald du ein MHD schätzen lässt oder korrigierst.",
    estConfirmDelete: (name) => `„${name}“ löschen? Beim nächsten Schätzen wird neu berechnet.`,
    estFailed: "Die Änderung konnte nicht gespeichert werden.",
    estLoadFailed: "Die Liste konnte nicht geladen werden.",
    estNeedFields: "Inhalt, Bereich und Tage ausfüllen.",
    estOff: "Die MHD-Schätzung ist ausgeschaltet. Die Einträge bleiben erhalten.",
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
      "Add a container with “Add container”. It will show up here automatically.",
    openSettings: "Open integration",
    menu: "Menu",
    addContainer: "Add container",
    modeNew: "Create new QR code",
    modeZwilling: "Read Zwilling QR code",
    codeLabel: "QR code content or ID",
    nameLabel: "Name (optional)",
    cancel: "Cancel",
    submit: "Add",
    invalidCode: "No valid ID (cc) found in the QR code.",
    alreadyConfigured: "This container has already been added.",
    addFailed: "The container could not be added.",
    adminOnly: (code) => `Only administrators can add containers. Scanned code: ${code}`,
    areaChangeFailed: "The area could not be changed.",
    vacuum: "Vacuum",
    estimate: "Estimate best before",
    estimating: "Estimating…",
    estimated: (days) => `Estimated: about ${days} ${days === 1 ? "day" : "days"} shelf life`,
    estimateFailed: "The estimate failed.",
    plusOneDay: "+1 day",
    opened: "Opened",
    searchPlaceholder: "Search …",
    filterLabel: "Filter",
    filterAll: "All",
    filterSoon: "Expiring soon (≤ 3 days)",
    filterExpired: "Expired",
    filterFilled: "Filled",
    filterEmpty: "Empty",
    sortLabel: "Sort",
    sortArea: "By area",
    sortDate: "By best before",
    sortName: "By name",
    noMatch: "No container matches the search and filter.",
    sourceTable: "table",
    sourceAi: "AI",
    sourceLearned: "corrected by you",
    sourceLearnedTable: "table, corrected by you",
    sourceLearnedAi: "AI, corrected by you",
    tabContainers: "Containers",
    tabEstimates: "Estimates",
    estTitle: "Remembered estimates",
    estIntro:
      "All values remembered for a combination of contents, area and vacuum (from the table, the AI or from you). You can change days and tip, delete entries (the next estimate is calculated anew) or add your own.",
    estContent: "Contents",
    estArea: "Area",
    estVacuum: "Vacuum",
    estNoVacuum: "no vacuum",
    estDays: "Days",
    estTip: "Tip",
    estSource: "Source",
    estSave: "Save",
    estDelete: "Delete",
    estAdd: "Add",
    estAddTitle: "Add your own entry",
    estEmpty: "Nothing remembered yet. Entries appear when you estimate or correct a best-before date.",
    estConfirmDelete: (name) => `Delete “${name}”? The next estimate is calculated anew.`,
    estFailed: "The change could not be saved.",
    estLoadFailed: "The list could not be loaded.",
    estNeedFields: "Fill in contents, area and days.",
    estOff: "Best-before estimates are switched off. The entries are kept.",
  },
};

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

/** ISO-Datum um n Tage verschieben (lokale Kalendertage, ohne Zeitzonen-Fallen). */
export function addDays(isoDate, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const SOON_DAYS = 3;

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
    return { content, days };
  };
  const q = query.trim().toLowerCase();
  const lang = (hass.language || "en").toLowerCase();
  const cmp = (a, b) => a.localeCompare(b, lang, { numeric: true, sensitivity: "base" });
  const rows = devices
    .map((dev) => ({ dev, ...info(dev) }))
    .filter(({ dev, content, days }) => {
      if (q && ![dev.name, content, dev.areaName || ""].some((v) => v.toLowerCase().includes(q))) return false;
      switch (filter) {
        case "soon":
          return days !== null && days >= 0 && days <= SOON_DAYS;
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

/** Bereiche des hass-Objekts als sortierte Liste [{id, name}]. */
export function listAreas(hass) {
  const lang = ((hass && hass.language) || "en").toLowerCase();
  return Object.values((hass && hass.areas) || {})
    .map((a) => ({ id: a.area_id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
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
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; row-gap: 2px; column-gap: 0; }
  .row label { grid-column: 1 / -1; font-size: 13px; color: var(--secondary-text-color); }
  .row input { min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; color-scheme: light dark; }
  .row input:disabled { opacity: .5; }
  .row .badge, .row button.now { margin-left: 8px; }
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
  .row select { grid-column: 1 / -1; min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; }
  .row.arearow { display: none; }
  .row.arearow.visible { display: grid; }
  .arealine.hidden { display: none; }
  header button.add { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid currentColor; background: none; color: inherit; display: none; }
  header button.add.visible { display: inline-block; }
  .notice { background: var(--card-background-color, #fff); border-left: 4px solid var(--warning-color, #ffa600);
    padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center;
    justify-content: center; z-index: 10; padding: 16px; box-sizing: border-box; }
  .overlay[hidden] { display: none; }
  .dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px;
    padding: 20px; width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
  .dialog h2 { margin: 0; font-size: 20px; font-weight: 500; }
  .dialog .field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--secondary-text-color); }
  .dialog .field[hidden] { display: none; }
  .dialog input[type="text"], .dialog select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px; box-sizing: border-box; }
  .dialog .modes { display: flex; flex-direction: column; gap: 6px; color: var(--primary-text-color); font-size: 15px; }
  .dialog .error { color: var(--error-color, #db4437); font-size: 14px; min-height: 1em; }
  .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog .buttons button { font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 0; }
  .dialog .buttons button.cancel { background: none; color: var(--primary-color); }
  .dialog .buttons button.submit { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .row.vacrow label.check { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; font-size: 14px;
    color: var(--primary-text-color); cursor: pointer; }
  .estimaterow { display: none; flex-direction: column; gap: 4px; margin-top: -4px; }
  .estimaterow.visible { display: flex; }
  .estimaterow button.estimate { align-self: flex-start; font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px;
    cursor: pointer; border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .estimaterow .tip { font-size: 13px; color: var(--secondary-text-color); }
  .estimaterow .tip.error { color: var(--error-color, #db4437); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .toolbar[hidden] { display: none; }
  .toolbar input, .toolbar select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; min-width: 0; }
  .toolbar input { flex: 1 1 180px; }
  .toolbar select { flex: 0 1 auto; }
  .quickrow { display: none; gap: 8px; margin-top: -4px; }
  .quickrow.visible { display: flex; }
  .quickrow button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .quickrow button:disabled { opacity: .5; cursor: default; }
  header .tabs { display: none; gap: 4px; }
  header .tabs.visible { display: flex; }
  header .tabs button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent; background: none; color: inherit; opacity: .8; }
  header .tabs button.active { border-color: currentColor; opacity: 1; }
  #estimates { display: flex; flex-direction: column; gap: 12px; }
  #estimates[hidden], #content[hidden] { display: none; }
  #estimates h2 { margin: 0; font-size: 20px; font-weight: 400; }
  #estimates .intro { margin: 0; font-size: 14px; color: var(--secondary-text-color); }
  .est { background: var(--card-background-color, #fff); border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); padding: 12px 16px; display: grid; gap: 8px 12px;
    grid-template-columns: minmax(0, 1fr) 90px; align-items: end; }
  .est .what { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .est .what .name { font-size: 16px; font-weight: 500; }
  .est .what .meta { font-size: 13px; color: var(--secondary-text-color); }
  .est .f { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; }
  .est input[type="text"], .est input[type="number"], .est select { font: inherit; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 6px;
    padding: 6px 8px; box-sizing: border-box; min-width: 0; width: 100%; }
  .est .btns { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; }
  .est .btns button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer; border: 0; }
  .est .btns button.save { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .est .btns button.del { background: none; color: var(--error-color, #db4437); border: 1px solid var(--divider-color); }
  .est.new { border: 1px dashed var(--divider-color); box-shadow: none; }
  .est.new h3 { grid-column: 1 / -1; margin: 0; font-size: 15px; font-weight: 500; }
  .est .check { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--primary-text-color); }
  .none { text-align: center; padding: 48px 16px; color: var(--secondary-text-color); }
  .none h2 { color: var(--primary-text-color); font-weight: 400; }
  .none a { color: var(--primary-color); cursor: pointer; }
`;

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
      <div class="row"><label data-l="content"></label><input data-f="content" type="text" maxlength="255"></div>
      <div class="row"><label data-l="bestBefore"></label><input data-f="bestBefore" type="date"><span class="badge"></span></div>
      <div class="quickrow"><button class="plus1" type="button"></button><button class="opened" type="button"></button></div>
      <div class="row"><label data-l="filledAt"></label><input data-f="filledAt" type="datetime-local"><button class="now" type="button"></button></div>
      <div class="estimaterow"><button class="estimate" type="button"></button><span class="tip" role="status"></span></div>
      <div class="row vacrow"><label class="check"><input type="checkbox" data-f="vacuum"><span data-l="vacuum"></span></label></div>
      <div class="actions"><button class="empty" type="button"></button><span class="spacer"></span><img class="qr" alt=""></div>`;
    this.el = el;
    this.q = (sel) => el.querySelector(sel);
    this.inputs = {
      content: this.q('[data-f="content"]'),
      bestBefore: this.q('[data-f="bestBefore"]'),
      filledAt: this.q('[data-f="filledAt"]'),
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
    this.q("button.now").addEventListener("click", () => {
      if (this.ids.datetime) this._call("datetime", "set_value", { entity_id: this.ids.datetime, datetime: new Date().toISOString() });
    });
    this.q("button.empty").addEventListener("click", () => {
      this._setTip("");
      if (this.ids.button) this._call("button", "press", { entity_id: this.ids.button });
    });
    this.inputs.content.addEventListener("input", () => this._setTip(""));
    this.q('[data-f="vacuum"]').addEventListener("change", (ev) => {
      if (this.ids.switch) this._call("switch", ev.target.checked ? "turn_on" : "turn_off", { entity_id: this.ids.switch });
    });
    this.q("button.estimate").addEventListener("click", () => this._estimate());
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
    if (admin) {
      const select = this.q('[data-f="area"]');
      const areas = listAreas(hass);
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
    this.q("button.empty").textContent = t.emptyContainer;
    this.q('[data-l="vacuum"]').textContent = t.vacuum;
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
    this.inputs.content.disabled = !ok(text);
    this.inputs.bestBefore.disabled = !ok(date);
    this.inputs.filledAt.disabled = !ok(dt);
    this.q("button.now").disabled = !ok(dt);

    // Schnellaktionen unter dem MHD: +1 Tag (nur mit MHD) und Geöffnet (sobald etwas drin ist).
    const hasContentNow = isValidState(text) && text.state.trim() !== "";
    this.q(".quickrow").classList.toggle("visible", ok(date) && hasContentNow);
    this.q("button.plus1").disabled = !isValidState(date);

    const vac = states[dev.entities.switch];
    const vacInput = this.q('[data-f="vacuum"]');
    this.q(".vacrow").style.display = vac ? "" : "none";
    vacInput.disabled = !ok(vac);
    vacInput.checked = !!vac && vac.state === "on";

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
      <header><button id="menu" type="button" aria-label="Menu">☰</button><h1></h1><span class="count"></span><div class="tabs"><button type="button" data-view="containers"></button><button type="button" data-view="estimates"></button></div><button class="add" type="button"></button></header>
      <main><div id="notice" class="notice" hidden></div><div class="toolbar" hidden><input type="search" data-f="query" autocomplete="off"><select data-f="filter"></select><select data-f="sort"></select></div><div id="content"></div><div id="estimates" hidden></div></main>
      <div class="overlay" hidden>
        <form class="dialog" novalidate>
          <h2></h2>
          <div class="modes">
            <label><input type="radio" name="mode" value="new" checked> <span data-l="modeNew"></span></label>
            <label><input type="radio" name="mode" value="scan"> <span data-l="modeZwilling"></span></label>
          </div>
          <label class="field" data-w="code" hidden><span data-l="codeLabel"></span><input type="text" data-f="code" autocomplete="off"></label>
          <label class="field"><span data-l="nameLabel"></span><input type="text" data-f="name" autocomplete="off"></label>
          <label class="field"><span data-l="area"></span><select data-f="area"></select></label>
          <div class="error" role="alert"></div>
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
    for (const radio of this._form.querySelectorAll('input[name="mode"]')) {
      radio.addEventListener("change", () => this._syncMode());
    }
    this._form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.submitAdd();
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
    this._estimatesEl = this.shadowRoot.querySelector("#estimates");
    this._tabs = this.shadowRoot.querySelector(".tabs");
    for (const btn of this._tabs.querySelectorAll("button")) {
      btn.addEventListener("click", () => this.setView(btn.dataset.view));
    }
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

  _mode() {
    return this._form.querySelector('input[name="mode"]:checked').value;
  }

  _syncMode() {
    this._form.querySelector('[data-w="code"]').hidden = this._mode() !== "scan";
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
    this._syncMode();
    this._fillAreaOptions(t);
    this._form.querySelector('[data-f="area"]').value = "";
    this._form.querySelector(".error").textContent = "";
    this._notice.hidden = true;
    this._overlay.hidden = false;
  }

  closeAddDialog() {
    this._overlay.hidden = true;
  }

  _fillAreaOptions(t) {
    const select = this._form.querySelector('[data-f="area"]');
    select.replaceChildren(
      ...[{ id: "", name: t.noArea }, ...listAreas(this._hass)].map((a) => {
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

    const input = {};
    if (mode === "scan") input.qr_code = code;
    if (name) input.name = name;
    if (area) input.area_id = area;

    this._busy = true;
    this._form.querySelector("button.submit").disabled = true;
    let flowId = null;
    try {
      let result = await hass.callApi("POST", "config/config_entries/flow", {
        handler: DOMAIN,
        show_advanced_options: false,
      });
      flowId = result.flow_id;
      result = await hass.callApi("POST", `config/config_entries/flow/${flowId}`, {
        next_step_id: mode === "scan" ? "scan" : "create",
      });
      result = await hass.callApi("POST", `config/config_entries/flow/${flowId}`, input);
      if (result.type === "create_entry") {
        flowId = null;
        this.closeAddDialog();
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

  /** `?add=<ID>` (vom Scan-Webhook): Dialog mit Code öffnen, bzw. Hinweis für Nicht-Administratoren. */
  _handleAddParam() {
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

  /** Zwischen Dosen-Übersicht und Liste der gemerkten Schätzungen wechseln (nur Administratoren). */
  setView(view) {
    if (view === "estimates" && !isAdmin(this._hass)) return;
    this._view = view;
    this._main.hidden = view !== "containers";
    this._estimatesEl.hidden = view !== "estimates";
    this._addBtn.classList.toggle("visible", isAdmin(this._hass) && view === "containers");
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

    // --- eigenen Eintrag hinzufügen ---
    const add = el("section", "est new");
    add.append(el("h3", "", t.estAddTitle));
    const content = input("text", "", { maxLength: 255 });
    content.dataset.f = "content";
    const area = el("select");
    area.dataset.f = "area";
    for (const a of listAreas(hass)) {
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
      ["soon", t.filterSoon],
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
    this._arranged = arrangeDevices(hass, this._devices, this._opts);
    const sig = JSON.stringify([this._arranged.map((d) => d.deviceId), this._opts.sort, this._devices.length]);
    if (registriesChanged || sig !== this._layoutSig) {
      this._layoutSig = sig;
      this._rebuild(hass);
    }

    const t = strings(hass);
    this._title.textContent = t.title;
    this._count.textContent = t.count(this._devices.length);
    this._updateToolbar(t);
    this._addBtn.textContent = `+ ${t.addContainer}`;
    this._addBtn.classList.toggle("visible", isAdmin(hass) && this._view === "containers");
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
    this._handleAddParam();
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
    } else if (this._opts.sort !== "area") {
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

if (!customElements.get("zwilling-storage-panel")) {
  customElements.define("zwilling-storage-panel", ZwillingStoragePanel);
}
