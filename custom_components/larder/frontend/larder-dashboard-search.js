/**
 * Larder dashboard (5.0): search in the header (#118).
 *
 * Typing a product shows every match with count, places and date; a product in packs opens the places view of
 * the barcode dialog (−1, open, move, one pack more) without a scan, a container or voucher its own card.
 * Digits of a barcode (8–14) look the barcode up like a scan.
 * `installSearch` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

const TEXT = {
  de: {
    button: "Suchen",
    scan: "Scannen",
    title: "Suchen",
    placeholder: "Produkt oder Barcode …",
    hint: "Mindestens zwei Buchstaben eingeben.",
    none: (q) => `Nichts gefunden für „${q}“.`,
    barcode: (code) => `Barcode ${code} suchen`,
    count: (n) => `${n}×`,
    places: (n) => (n === 1 ? "1 Ort" : `${n} Orte`),
    until: (date) => `MHD ${date}`,
    close: "Schließen",
    noArea: "ohne Bereich",
  },
  en: {
    button: "Search",
    scan: "Scan",
    title: "Search",
    placeholder: "Product or barcode …",
    hint: "Type at least two letters.",
    none: (q) => `Nothing found for "${q}".`,
    barcode: (code) => `Look up barcode ${code}`,
    count: (n) => `${n}×`,
    places: (n) => (n === 1 ? "1 place" : `${n} places`),
    until: (date) => `best before ${date}`,
    close: "Close",
    noArea: "no area",
  },
};

export function searchTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

const PACK_KINDS = ["pack", "household", "medicine"];

export function installSearch(Dashboard, { el }) {
  const proto = Dashboard.prototype;
  const button = (cls, label, onClick) => {
    const b = el("button", cls, label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };
  const fmtDate = (hass, iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? `${d}.${m}.${y}` : String(iso).slice(0, 10);
  };

  /** Matches for a query: packs grouped by product, containers, bags and vouchers one by one. */
  proto.searchMatches = function searchMatches(query) {
    const q = String(query || "").trim().toLocaleLowerCase();
    if (q.length < 2) return [];
    const groups = new Map();
    const single = [];
    for (const row of this._rows()) {
      if (!row.content || !row.content.toLocaleLowerCase().includes(q)) continue;
      if (PACK_KINDS.includes(row.kind)) {
        const key = row.content.toLocaleLowerCase();
        if (!groups.has(key)) groups.set(key, { name: row.content, rows: [] });
        groups.get(key).rows.push(row);
      } else {
        single.push({ name: row.content, rows: [row] });
      }
    }
    const all = [...groups.values(), ...single];
    // what starts with the query first, then alphabetically
    all.sort((a, b) => {
      const sa = a.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
      const sb = b.name.toLocaleLowerCase().startsWith(q) ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name);
    });
    return all.slice(0, 30);
  };

  proto.openSearch = function openSearch(initial = "") {
    const hass = this._hass;
    const t = searchTexts(hass);
    const form = this._form;
    const input = el("input");
    input.type = "search";
    input.dataset.f = "search-input";
    input.placeholder = t.placeholder;
    input.setAttribute("aria-label", t.title);
    input.autocomplete = "off";
    input.value = initial;
    const results = el("div", "searchlist");
    results.dataset.role = "search-results";
    const draw = () => {
      const q = input.value.trim();
      const parts = [];
      const digits = q.replace(/\s/g, "");
      if (/^\d{8,14}$/.test(digits)) {
        const code = button("primary", t.barcode(digits), () => this.takeByCode(digits));
        code.dataset.role = "search-barcode";
        parts.push(code);
      }
      const matches = this.searchMatches(q);
      for (const match of matches) {
        const rows = match.rows;
        const packs = PACK_KINDS.includes(rows[0].kind);
        const states = hass.states || {};
        const count = packs ? rows.reduce((n, r) => n + (Number((states[r.dev.entities.number] || {}).state) || 1), 0) : null;
        const places = [...new Set(rows.map((r) => [r.areaName, r.compartment].filter(Boolean).join(" · ") || t.noArea))];
        const dates = rows.map((r) => String((states[r.dev.entities.date] || {}).state || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
        const sub = [
          packs ? t.count(count) : rows[0].name,
          places.length > 2 ? t.places(places.length) : places.join(", "),
          dates.length ? t.until(fmtDate(hass, dates[0])) : null,
        ].filter(Boolean).join(" · ");
        const item = button("searchrow", "", () => {
          if (packs) this.takeByCode("", match.name);
          else this.openContainer(rows[0]);
          if (!packs) this._closeDialog();
        });
        item.dataset.role = "search-item";
        item.append(el("span", "name", match.name), el("span", "sub", sub));
        parts.push(item);
      }
      if (!parts.length) parts.push(el("p", "hint", q.length < 2 ? t.hint : t.none(q)));
      results.replaceChildren(...parts);
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const first = results.querySelector("button");
      if (first) first.click();
    });
    const close = button("cancel", t.close, () => this._closeDialog());
    const row = el("div", "buttons");
    row.append(close);
    form.replaceChildren(el("h2", "", t.title), input, results, row);
    this._submit = null;
    this._overlay.hidden = false;
    draw();
    setTimeout(() => input.focus(), 0);
    return input;
  };
}
