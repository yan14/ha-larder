/**
 * Larder dashboard (6.1, Block 46): finishing the shopping.
 *
 * "Recently put away" (#167): one list of everything put away, bought in the shopping mode, read from a receipt or
 * added with ＋ – price, best-before date and place in columns, one Save. Opens after putting away and under
 * More → 📝 Recently put away. The best-before date is suggested from earlier purchases of exactly this product
 * (#168), else (fresh food) from the shelf-life table, and marked as a suggestion.
 * `installPutAway` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

/** Texts in the user's language; French and Dutch fall back to English for anything missing. */
const LANG_CACHE = new WeakMap();
function pickLang(table, hass) {
  const lang = String((hass && hass.language) || "en").toLowerCase().slice(0, 2);
  if (lang === "en" || !table[lang]) return table.en;
  if (lang === "de") return table.de;
  let byLang = LANG_CACHE.get(table);
  if (!byLang) LANG_CACHE.set(table, (byLang = {}));
  return byLang[lang] || (byLang[lang] = { ...table.en, ...table[lang] });
}

const TEXT = {
  de: {
    menu: "📝 Zuletzt eingeräumt",
    title: "Zuletzt eingeräumt",
    titleNow: "Eben eingeräumt",
    intro: "Preis, MHD und Ort für alles auf einmal nachtragen. 💡 = Vorschlag, prüfen und bei Bedarf ändern.",
    finish: "📝 Preis, MHD und Ort nachtragen",
    showAll: "Alle der letzten 7 Tage",
    onlyOpen: "Nur Unvollständiges",
    none: "In den letzten 7 Tagen wurde nichts eingeräumt.",
    allDone: "Alles vollständig – nichts nachzutragen.",
    price: "Preis (€)",
    date: "MHD",
    area: "Bereich",
    noArea: "Kein Bereich",
    compartment: "Fach",
    store: "Laden",
    added: (n, count) => (count > n ? `+${n} (jetzt ${count})` : `+${n}`),
    day: (d) => `eingeräumt ${d}`,
    suggestHistory: (days) => `💡 Wie beim letzten Kauf: ${days} ${days === 1 ? "Tag" : "Tage"}`,
    suggestTable: (days) => `💡 Schätzung (Tabelle): ${days} ${days === 1 ? "Tag" : "Tage"}`,
    save: "Speichern",
    saving: "Wird gespeichert …",
    saved: (n) => (n === 1 ? "1 Eintrag gespeichert." : `${n} Einträge gespeichert.`),
    nothing: "Nichts geändert.",
    failed: "Speichern fehlgeschlagen.",
    close: "Schließen",
    priceLabel: "💶 Preis pro Packung",
    priceStore: "Laden (optional)",
    priceSave: "Preis speichern",
    priceSaved: "Preis gespeichert.",
    priceFailed: "Preis konnte nicht gespeichert werden.",
  },
  en: {
    menu: "📝 Recently put away",
    title: "Recently put away",
    titleNow: "Just put away",
    intro: "Add price, best-before date and place for everything at once. 💡 = suggestion, check it and change it if needed.",
    finish: "📝 Add price, date and place",
    showAll: "Everything of the last 7 days",
    onlyOpen: "Only incomplete ones",
    none: "Nothing was put away in the last 7 days.",
    allDone: "Everything complete – nothing to add.",
    price: "Price (€)",
    date: "Best before",
    area: "Area",
    noArea: "No area",
    compartment: "Compartment",
    store: "Store",
    added: (n, count) => (count > n ? `+${n} (now ${count})` : `+${n}`),
    day: (d) => `put away ${d}`,
    suggestHistory: (days) => `💡 Like the last purchase: ${days} ${days === 1 ? "day" : "days"}`,
    suggestTable: (days) => `💡 Estimate (table): ${days} ${days === 1 ? "day" : "days"}`,
    save: "Save",
    saving: "Saving …",
    saved: (n) => (n === 1 ? "1 entry saved." : `${n} entries saved.`),
    nothing: "Nothing changed.",
    failed: "Saving failed.",
    close: "Close",
    priceLabel: "💶 Price per pack",
    priceStore: "Store (optional)",
    priceSave: "Save price",
    priceSaved: "Price saved.",
    priceFailed: "The price could not be saved.",
  },
  fr: {
    menu: "📝 Rangé récemment",
    title: "Rangé récemment",
    titleNow: "Juste rangé",
    intro: "Ajoutez prix, date et emplacement pour tout en une fois. 💡 = suggestion, à vérifier et modifier si besoin.",
    finish: "📝 Ajouter prix, date et emplacement",
    showAll: "Tout des 7 derniers jours",
    onlyOpen: "Seulement l'incomplet",
    none: "Rien n'a été rangé ces 7 derniers jours.",
    allDone: "Tout est complet – rien à ajouter.",
    price: "Prix (€)",
    date: "À consommer avant",
    area: "Pièce",
    noArea: "Sans pièce",
    compartment: "Compartiment",
    store: "Magasin",
    added: (n, count) => (count > n ? `+${n} (maintenant ${count})` : `+${n}`),
    day: (d) => `rangé le ${d}`,
    suggestHistory: (days) => `💡 Comme au dernier achat : ${days} ${days === 1 ? "jour" : "jours"}`,
    suggestTable: (days) => `💡 Estimation (tableau) : ${days} ${days === 1 ? "jour" : "jours"}`,
    save: "Enregistrer",
    saving: "Enregistrement …",
    saved: (n) => (n === 1 ? "1 entrée enregistrée." : `${n} entrées enregistrées.`),
    nothing: "Rien n'a changé.",
    failed: "L'enregistrement a échoué.",
    close: "Fermer",
    priceLabel: "💶 Prix par paquet",
    priceStore: "Magasin (facultatif)",
    priceSave: "Enregistrer le prix",
    priceSaved: "Prix enregistré.",
    priceFailed: "Le prix n'a pas pu être enregistré.",
  },
  nl: {
    menu: "📝 Onlangs opgeborgen",
    title: "Onlangs opgeborgen",
    titleNow: "Net opgeborgen",
    intro: "Vul prijs, houdbaarheid en plek voor alles tegelijk in. 💡 = voorstel, controleer en wijzig indien nodig.",
    finish: "📝 Prijs, datum en plek invullen",
    showAll: "Alles van de afgelopen 7 dagen",
    onlyOpen: "Alleen onvolledige",
    none: "De afgelopen 7 dagen is niets opgeborgen.",
    allDone: "Alles compleet – niets in te vullen.",
    price: "Prijs (€)",
    date: "Houdbaar tot",
    area: "Ruimte",
    noArea: "Geen ruimte",
    compartment: "Vak",
    store: "Winkel",
    added: (n, count) => (count > n ? `+${n} (nu ${count})` : `+${n}`),
    day: (d) => `opgeborgen ${d}`,
    suggestHistory: (days) => `💡 Zoals bij de vorige aankoop: ${days} ${days === 1 ? "dag" : "dagen"}`,
    suggestTable: (days) => `💡 Schatting (tabel): ${days} ${days === 1 ? "dag" : "dagen"}`,
    save: "Opslaan",
    saving: "Opslaan …",
    saved: (n) => (n === 1 ? "1 item opgeslagen." : `${n} items opgeslagen.`),
    nothing: "Niets gewijzigd.",
    failed: "Opslaan mislukt.",
    close: "Sluiten",
    priceLabel: "💶 Prijs per verpakking",
    priceStore: "Winkel (optioneel)",
    priceSave: "Prijs opslaan",
    priceSaved: "Prijs opgeslagen.",
    priceFailed: "De prijs kon niet worden opgeslagen.",
  },
};

export function putAwayTexts(hass) {
  return pickLang(TEXT, hass);
}

/** "1,49" / "1.49" → 1.49; empty or invalid → null. */
export function parsePrice(value) {
  const n = parseFloat(String(value || "").replace(",", ".").replace(/[^\d.]/g, ""));
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Rows that still lack something (household items have no date). */
export function incomplete(row) {
  return !row.price || (row.kind !== "household" && !row.best_before);
}

/** What changed in one row of the list: the message row for `larder/put_away_save`, or null. */
export function changedRow(row, values) {
  const out = { device_id: row.device_id, added: row.added };
  const price = parsePrice(values.price);
  if (price && price !== row.price) out.price = price;
  if (values.date && values.date !== row.best_before) out.best_before = values.date;
  if ((values.area_id || "") !== (row.area_id || "") || String(values.compartment || "").trim() !== (row.compartment || "")) {
    out.area_id = values.area_id || null;
    out.compartment = String(values.compartment || "").trim();
  }
  if (out.price && values.store) out.store = values.store;
  return Object.keys(out).length > 2 ? out : null;
}

export function installPutAway(Dashboard, { el, DOMAIN, listAreas }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };
  const input = (type, value, label, f) => {
    const i = el("input");
    i.type = type;
    if (value != null) i.value = value;
    i.setAttribute("aria-label", label);
    i.placeholder = label;
    i.dataset.f = f;
    return i;
  };

  /**
   * The list. `devices`: only these entries (right after putting away), with a switch to everything of the last
   * 7 days. Opens with only the incomplete ones when there are any.
   */
  proto.openPutAwayList = async function openPutAwayList(devices = null) {
    const hass = this._hass;
    const t = putAwayTexts(hass);
    let rows = [];
    try {
      rows = (await hass.callWS({ type: `${DOMAIN}/put_away_recent` })).rows || [];
    } catch {
      rows = [];
    }
    const state = { devices: devices && devices.length ? new Set(devices) : null, onlyOpen: rows.some(incomplete) };
    const areas = [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic && this._classic.larderLabel)];
    const list = el("div", "putlist");
    const status = el("p", "hint");
    status.setAttribute("role", "status");
    const inputs = new Map(); // device_id → its inputs

    const rowEl = (r) => {
      const box = el("div", "putrow putedit");
      box.dataset.id = r.device_id;
      const head = el("div", "text");
      head.append(
        el("span", "name", `${r.content} ${t.added(r.added, r.count)}`),
        el("span", "sub", [r.area, r.compartment, r.day ? t.day(r.day) : null].filter(Boolean).join(" · ")),
      );
      const price = input("text", r.price ? String(r.price).replace(".", hass.language && /^(de|fr|nl)/.test(hass.language) ? "," : ".") : "", t.price, "pa-price");
      price.inputMode = "decimal";
      const fields = el("div", "putfields");
      fields.append(price);
      let date = null;
      if (r.kind !== "household") {
        date = input("date", r.best_before || (r.suggest ? r.suggest.best_before : ""), t.date, "pa-date");
        if (!r.best_before && r.suggest) date.classList.add("suggested");
        date.addEventListener("input", () => date.classList.remove("suggested"));
        fields.append(date);
        if (this._datePhotoButton) fields.append(this._datePhotoButton(date));
      }
      const area = el("select");
      area.dataset.f = "pa-area";
      area.setAttribute("aria-label", t.area);
      for (const a of areas) {
        const o = el("option", "", a.name);
        o.value = a.id;
        area.append(o);
      }
      if (r.area_id && !areas.some((a) => a.id === r.area_id)) {
        const o = el("option", "", r.area || r.area_id);
        o.value = r.area_id;
        area.append(o);
      }
      area.value = r.area_id || "";
      const compartment = input("text", r.compartment || "", t.compartment, "pa-compartment");
      compartment.maxLength = 60;
      fields.append(area, compartment);
      box.append(head, fields);
      if (!r.best_before && r.suggest) {
        const note = el("span", "sub suggest", r.suggest.source === "history" ? t.suggestHistory(r.suggest.days) : t.suggestTable(r.suggest.days));
        box.append(note);
      }
      inputs.set(r.device_id, { row: r, price, date, area, compartment });
      return box;
    };

    const render = () => {
      let shown = state.devices ? rows.filter((r) => state.devices.has(r.device_id)) : rows;
      if (state.onlyOpen) shown = shown.filter(incomplete);
      const parts = [];
      if (!rows.length) parts.push(el("p", "hint", t.none));
      else if (!shown.length) parts.push(el("p", "hint", t.allDone));
      for (const r of shown) parts.push(rowEl(r));
      list.replaceChildren(...parts);
      title.textContent = state.devices ? t.titleNow : t.title;
      scope.hidden = !state.devices;
    };

    const title = el("h2", "", t.title);
    const filters = el("div", "putfilters");
    const scope = button("link", t.showAll, () => {
      state.devices = null;
      render();
    });
    scope.dataset.role = "putaway-all";
    const open = el("label", "check");
    const openBox = el("input");
    openBox.type = "checkbox";
    openBox.checked = state.onlyOpen;
    openBox.dataset.f = "pa-only-open";
    openBox.addEventListener("change", () => {
      state.onlyOpen = openBox.checked;
      render();
    });
    open.append(openBox, el("span", "", t.onlyOpen));
    filters.append(open, scope);

    const save = button("submit", t.save, async () => {
      const store = this._shopStore || null;
      const changes = [];
      for (const [, i] of inputs) {
        if (!i.price.isConnected) continue;
        const change = changedRow(i.row, {
          price: i.price.value,
          date: i.date ? i.date.value : "",
          area_id: i.area.value,
          compartment: i.compartment.value,
          store,
        });
        if (change) changes.push(change);
      }
      if (!changes.length) {
        status.textContent = t.nothing;
        return;
      }
      save.disabled = true;
      status.textContent = t.saving;
      try {
        const res = await hass.callWS({ type: `${DOMAIN}/put_away_save`, rows: changes });
        rows = (await hass.callWS({ type: `${DOMAIN}/put_away_recent` })).rows || [];
        inputs.clear();
        render();
        status.textContent = t.saved(res.saved);
        if (this._view === "stock" && this.loadStock) this.loadStock();
      } catch (err) {
        status.textContent = (err && err.message) || t.failed;
      } finally {
        save.disabled = false;
      }
    });
    save.dataset.role = "putaway-save";
    const close = button("cancel", t.close, () => this._closeDialog());
    const buttons = el("div", "buttons");
    buttons.append(close, save);
    this._form.replaceChildren(title, el("p", "hint", t.intro), filters, list, status, buttons);
    this._submit = null;
    render();
    this._overlay.hidden = false;
  };

  /** #170: the price of a product in the product view, for all its packs. */
  proto._priceEditor = function _priceEditor(p, onChanged) {
    const hass = this._hass;
    const t = putAwayTexts(hass);
    const box = el("div", "ownvalue priceedit");
    const comma = /^(de|fr|nl)/.test(String(hass.language || ""));
    const current = p.price && p.price.source !== "openprices" ? p.price.price : null;
    const price = input("text", current ? (comma ? String(current.toFixed(2)).replace(".", ",") : current.toFixed(2)) : "", t.price, "product-price");
    price.inputMode = "decimal";
    const store = input("text", "", t.priceStore, "product-store");
    store.maxLength = 60;
    const status = el("span", "sub");
    const save = button("", t.priceSave, async () => {
      save.disabled = true;
      try {
        await hass.callWS({ type: `${DOMAIN}/price_set`, content: p.name, price: parsePrice(price.value), store: store.value.trim() || null });
        if (this.showNotice) this.showNotice(t.priceSaved);
        if (onChanged) onChanged({});
      } catch {
        status.textContent = t.priceFailed;
      } finally {
        save.disabled = false;
      }
    });
    save.dataset.role = "product-price-save";
    box.append(el("span", "label", t.priceLabel), price, store, save, status);
    return box;
  };
}
