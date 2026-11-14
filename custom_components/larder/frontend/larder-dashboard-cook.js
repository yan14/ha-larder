/**
 * Larder-Dashboard: Vorkochen und Planen – Behältergrößen, freie Behälter, Vorkochen (ein Gericht auf mehrere
 * Dosen aufteilen) und der Wochenplan-Vorschlag aus Dosen, die bald ablaufen.
 *
 * `installCook` hängt die Methoden an die Dashboard-Klasse (wie larder-dashboard-items.js).
 */

const TEXT = {
  de: {
    free: (list) => `Frei: ${list}`,
    freeNone: "Frei: keine Behälter",
    sizesTitle: "Behältergrößen",
    sizesIntro: "Feste Größen stellst du auf der Karte einer Dose ein. Hier trägst du die losen Behälter ein, auf die Deckel mit variabler Größe passen.",
    sizesLoose: "Lose Behälter",
    sizesSize: "Größe",
    sizesCount: "Anzahl",
    sizesAdd: "＋ Größe",
    sizesOverview: "Übersicht",
    sizesRow: (r) => `${r.size}: ${r.free} frei von ${r.total}`,
    sizesNone: "Noch keine Größen hinterlegt.",
    save: "Speichern",
    cancel: "Abbrechen",
    close: "Schließen",
    menuSizes: "Behältergrößen",
    menuBatch: "Vorkochen",
    batchTitle: "Vorkochen",
    batchIntro: "Ein Gericht auf mehrere leere Dosen aufteilen. Danach öffnet sich das Befüllen für alle gewählten Dosen, mit der Menge je Dose.",
    batchDish: "Gericht",
    batchTotal: "Menge insgesamt",
    batchContainers: "Leere Dosen",
    batchNone: "Keine leere Dose da.",
    batchVariable: "variabel",
    batchSuggest: "Passende vorschlagen",
    batchSplit: (n, list) => (n ? `${n} ${n === 1 ? "Dose" : "Dosen"}: ${list}` : "Noch keine Dose gewählt."),
    batchOver: (rest) => ` – ${rest} ml passen nicht hinein, noch eine Dose wählen.`,
    batchNext: "Weiter zum Befüllen",
    batchNeed: "Gericht eintragen und mindestens eine Dose wählen.",
    units: { portions: "Portionen", milliliters: "ml", grams: "g", pieces: "Stück" },
    weekButton: "🪄 Woche vorschlagen",
    weekTitle: "Vorschlag für die nächsten Tage",
    weekBusy: "Larder sucht Gerichte …",
    weekNone: "Kein Vorschlag: Für die Dosen, die bald ablaufen, passt kein Rezept (oder es läuft nichts ab).",
    weekError: (e) => `KI: ${e}`,
    weekUses: (list) => `Verbraucht: ${list}`,
    weekSource: { book: "📖 Rezeptbuch", ai: "🤖 KI" },
    weekRemove: "Entfernen",
    weekOther: "↻ Anderes",
    weekAccept: "Übernehmen",
    weekAccepted: (n) => `${n} ${n === 1 ? "Gericht" : "Gerichte"} im Wochenplan.`,
    weekDay: (iso) => {
      const d = new Date(`${iso}T00:00:00`);
      return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    },
  },
  en: {
    free: (list) => `Free: ${list}`,
    freeNone: "Free: no containers",
    sizesTitle: "Container sizes",
    sizesIntro: "Set fixed sizes on the card of a container. Here you enter the loose boxes that lids with a variable size fit on.",
    sizesLoose: "Loose boxes",
    sizesSize: "Size",
    sizesCount: "Count",
    sizesAdd: "＋ Size",
    sizesOverview: "Overview",
    sizesRow: (r) => `${r.size}: ${r.free} free of ${r.total}`,
    sizesNone: "No sizes yet.",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    menuSizes: "Container sizes",
    menuBatch: "Batch cooking",
    batchTitle: "Batch cooking",
    batchIntro: "Split one dish into several empty containers. Then the fill dialog opens for all chosen containers, with the amount per container.",
    batchDish: "Dish",
    batchTotal: "Total amount",
    batchContainers: "Empty containers",
    batchNone: "No empty container.",
    batchVariable: "variable",
    batchSuggest: "Suggest fitting ones",
    batchSplit: (n, list) => (n ? `${n} ${n === 1 ? "container" : "containers"}: ${list}` : "No container chosen yet."),
    batchOver: (rest) => ` – ${rest} ml do not fit, choose another container.`,
    batchNext: "Continue to filling",
    batchNeed: "Enter a dish and choose at least one container.",
    units: { portions: "portions", milliliters: "ml", grams: "g", pieces: "pieces" },
    weekButton: "🪄 Suggest week",
    weekTitle: "Suggestion for the next days",
    weekBusy: "Larder is looking for dishes …",
    weekNone: "No suggestion: no recipe fits the containers that expire soon (or nothing expires).",
    weekError: (e) => `AI: ${e}`,
    weekUses: (list) => `Uses: ${list}`,
    weekSource: { book: "📖 Recipe book", ai: "🤖 AI" },
    weekRemove: "Remove",
    weekOther: "↻ Other",
    weekAccept: "Accept",
    weekAccepted: (n) => `${n} ${n === 1 ? "dish" : "dishes"} in the meal plan.`,
    weekDay: (iso) => {
      const d = new Date(`${iso}T00:00:00`);
      return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    },
  },
};

export function cookTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

/** Größe in Litern ("500 ml" → 0.5, "1,5 l" → 1.5); null, wenn nicht erkennbar. */
export function litres(size) {
  const m = /^(\d+(?:[.,]\d+)?)\s*(ml|cl|l|liter|litre)?$/i.exec(String(size || "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const unit = (m[2] || "l").toLowerCase();
  return unit === "ml" ? n / 1000 : unit === "cl" ? n / 100 : n;
}

/**
 * Menge auf die gewählten Dosen verteilen. Mit Millilitern und bekannten Größen: jede Dose so voll wie sie fasst
 * (der Rest in die letzte); sonst gleichmäßig (ganze Zahlen, der Rest auf die ersten).
 */
export function splitAmount(total, unit, sizes) {
  const n = sizes.length;
  if (!n || !(total > 0)) return sizes.map(() => 0);
  const caps = sizes.map((s) => litres(s));
  if (unit === "milliliters" && caps.every((c) => c)) {
    // jede Dose so voll, wie sie fasst; was übrig bleibt, passt nicht (siehe overflow)
    let rest = total;
    return caps.map((c) => {
      const take = Math.min(rest, Math.round(c * 1000));
      rest -= take;
      return Math.max(0, take);
    });
  }
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return sizes.map((_, i) => base + (i < extra ? 1 : 0));
}

/** Für Milliliter die kleinste Auswahl an Dosen (größte zuerst), die die Menge fasst. */
export function suggestContainers(total, options) {
  const sorted = options.filter((o) => litres(o.size)).sort((a, b) => litres(b.size) - litres(a.size));
  const chosen = [];
  let rest = total;
  for (const o of sorted) {
    if (rest <= 0) break;
    chosen.push(o);
    rest -= litres(o.size) * 1000;
  }
  // zu viel genommen: die größte, die gerade noch reicht, durch eine kleinere ersetzen
  if (chosen.length && rest < 0) {
    const last = chosen[chosen.length - 1];
    const fit = sorted.filter((o) => !chosen.includes(o) && litres(o.size) * 1000 >= litres(last.size) * 1000 + rest).pop();
    if (fit && litres(fit.size) < litres(last.size)) chosen[chosen.length - 1] = fit;
  }
  return chosen;
}

export function installCook(Dashboard, { el, isAdmin, DOMAIN }) {
  const proto = Dashboard.prototype;
  const button = (cls, text, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };
  const field = (label, control) => {
    const wrap = el("label", "", label);
    wrap.append(control);
    return wrap;
  };
  const buttonsRow = (...buttons) => {
    const row = el("div", "buttons");
    row.append(...buttons);
    return row;
  };

  // ---------- Größen ----------

  proto.loadSizes = async function loadSizes() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._sizes = await hass.callWS({ type: `${DOMAIN}/sizes` });
    } catch {
      this._sizes = null;
    }
    this._sig = "";
    this._update();
  };

  /** Zeile "Frei: 3 × 1 l, 1 × 0,5 l" für die Lager-Ansicht (null ohne Größen). */
  proto._freeLine = function _freeLine() {
    const rows = (this._sizes && this._sizes.overview) || [];
    if (!rows.length) return null;
    const t = cookTexts(this._hass);
    const free = rows.filter((r) => r.free > 0);
    const line = el("p", "freesizes", free.length ? t.free(free.map((r) => `${r.free} × ${r.size}`).join(", ")) : t.freeNone);
    line.dataset.role = "free-sizes";
    line.addEventListener("click", () => this.openSizesDialog());
    return line;
  };

  proto.openSizesDialog = async function openSizesDialog() {
    const hass = this._hass;
    const t = cookTexts(hass);
    if (!this._sizes) await this.loadSizes();
    const data = this._sizes || { overview: [], loose: {} };
    const list = el("div", "looselist");
    const addRow = (size = "", count = "") => {
      const row = el("div", "looserow");
      const s = el("input");
      s.type = "text";
      s.maxLength = 20;
      s.placeholder = "1 l";
      s.value = size;
      s.dataset.f = "loose-size";
      s.setAttribute("aria-label", t.sizesSize);
      const c = el("input");
      c.type = "number";
      c.min = "0";
      c.max = "999";
      c.inputMode = "numeric";
      c.value = count === "" ? "" : String(count);
      c.dataset.f = "loose-count";
      c.setAttribute("aria-label", t.sizesCount);
      row.append(s, el("span", "", "×"), c);
      list.append(row);
    };
    for (const [size, count] of Object.entries(data.loose || {})) addRow(size, count);
    if (!Object.keys(data.loose || {}).length) addRow();
    const add = button("", t.sizesAdd, () => addRow());
    add.dataset.role = "loose-add";
    const overview = el("ul", "sizeoverview");
    for (const r of data.overview || []) overview.append(el("li", "", t.sizesRow(r)));
    if (!(data.overview || []).length) overview.append(el("li", "", t.sizesNone));
    const save = button("submit", t.save, async () => {
      const loose = {};
      for (const row of list.querySelectorAll(".looserow")) {
        const size = row.querySelector('[data-f="loose-size"]').value.trim();
        const count = parseInt(row.querySelector('[data-f="loose-count"]').value, 10) || 0;
        if (size && count > 0) loose[size] = (loose[size] || 0) + count;
      }
      try {
        this._sizes = await hass.callWS({ type: `${DOMAIN}/loose_set`, loose });
      } catch {
        /* bleibt offen */
        return;
      }
      this._closeDialog();
      this._sig = "";
      this._update();
    });
    save.dataset.role = "loose-save";
    this._form.replaceChildren(
      el("h2", "", t.sizesTitle),
      el("p", "hint", t.sizesIntro),
      el("h3", "", t.sizesLoose),
      list,
      add,
      el("h3", "", t.sizesOverview),
      overview,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), save),
    );
    this._submit = null;
    this._overlay.hidden = false;
  };

  // ---------- Vorkochen ----------

  proto.openBatchDialog = async function openBatchDialog(preset = {}) {
    const hass = this._hass;
    const t = cookTexts(hass);
    if (!this._sizes) await this.loadSizes();
    const states = hass.states || {};
    const looseSizes = ((this._sizes && this._sizes.overview) || []).filter((r) => r.free > 0).map((r) => r.size);
    const empties = this._rows().filter((r) => r.kind === "container" && r.content === "");
    const dish = el("input");
    dish.type = "text";
    dish.maxLength = 255;
    dish.dataset.f = "batch-dish";
    dish.value = preset.content || "";
    const total = el("input");
    total.type = "number";
    total.min = "1";
    total.max = "99999";
    total.inputMode = "numeric";
    total.dataset.f = "batch-total";
    const unit = el("select");
    unit.dataset.f = "batch-unit";
    for (const key of ["portions", "milliliters", "grams", "pieces"]) {
      const o = el("option", "", t.units[key]);
      o.value = key;
      unit.append(o);
    }
    const qty = el("span", "qty");
    qty.append(total, unit);
    const list = el("div", "batchlist");
    const options = [];
    for (const row of empties) {
      const attrs = (states[row.dev.entities.text] || {}).attributes || {};
      const line = el("label", "check batchrow");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.id = row.id;
      const option = { id: row.id, box, size: attrs.size_variable ? null : attrs.size_fixed || null, variable: !!attrs.size_variable };
      line.append(box, el("span", "", [row.name, row.areaName, option.variable ? t.batchVariable : option.size].filter(Boolean).join(" · ")));
      if (option.variable && looseSizes.length) {
        const pick = el("select");
        pick.dataset.f = "batch-size";
        for (const s of ["", ...looseSizes]) {
          const o = el("option", "", s || "–");
          o.value = s;
          pick.append(o);
        }
        pick.value = attrs.size_last && looseSizes.includes(attrs.size_last) ? attrs.size_last : "";
        pick.addEventListener("change", () => {
          option.size = pick.value || null;
          sync();
        });
        option.size = pick.value || null;
        option.pick = pick;
        line.append(pick);
      }
      box.addEventListener("change", () => sync());
      options.push(option);
      list.append(line);
    }
    if (!empties.length) list.append(el("p", "hint", t.batchNone));
    const preview = el("p", "hint");
    preview.dataset.role = "batch-preview";
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const chosen = () => options.filter((o) => o.box.checked);
    const amounts = () => {
      const picked = chosen();
      return splitAmount(parseInt(total.value, 10) || 0, unit.value, picked.map((o) => o.size));
    };
    const sync = () => {
      const picked = chosen();
      const parts = amounts();
      const want = parseInt(total.value, 10) || 0;
      const over = picked.length ? want - parts.reduce((a, q) => a + q, 0) : 0;
      preview.textContent = t.batchSplit(picked.length, parts.map((q) => (q ? `${q} ${t.units[unit.value]}` : "–")).join(", ")) + (over > 0 ? t.batchOver(over) : "");
    };
    total.addEventListener("input", sync);
    unit.addEventListener("change", sync);
    const suggest = button("", t.batchSuggest, () => {
      const want = parseInt(total.value, 10) || 0;
      const picks = unit.value === "milliliters" && want ? suggestContainers(want, options.filter((o) => o.size)) : [];
      for (const o of options) o.box.checked = picks.includes(o);
      sync();
    });
    suggest.dataset.role = "batch-suggest";
    const next = button("submit", t.batchNext, () => {
      const picked = chosen();
      const content = dish.value.trim();
      if (!content || !picked.length) {
        error.textContent = t.batchNeed;
        return;
      }
      const parts = amounts();
      const quantities = {};
      const sizes = {};
      picked.forEach((o, i) => {
        if (parts[i]) quantities[o.id] = parts[i];
        if (o.variable && o.size) sizes[o.id] = o.size;
      });
      this._closeDialog();
      this._classic.openFillDialog(picked.map((o) => o.id), { content, quantities, unit: unit.value, sizes });
    });
    next.dataset.role = "batch-next";
    this._form.replaceChildren(
      el("h2", "", t.batchTitle),
      el("p", "hint", t.batchIntro),
      field(t.batchDish, dish),
      field(t.batchTotal, qty),
      el("h3", "", t.batchContainers),
      list,
      suggest,
      preview,
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), next),
    );
    sync();
    this._submit = null;
    this._overlay.hidden = false;
  };

  // ---------- Wochenplan-Vorschlag ----------

  proto.openWeekSuggest = async function openWeekSuggest() {
    const hass = this._hass;
    const t = cookTexts(hass);
    const form = this._form;
    form.replaceChildren(el("h2", "", t.weekTitle), el("p", "hint", t.weekBusy));
    this._submit = null;
    this._overlay.hidden = false;
    let res;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/plan_suggest` });
    } catch (err) {
      res = { days: [], others: [], error: (err && err.message) || "?" };
    }
    const days = [...(res.days || [])];
    const others = [...(res.others || [])];
    const render = () => {
      const list = el("div", "weeklist");
      days.forEach((day, i) => {
        const card = el("div", "weekday");
        card.dataset.date = day.date;
        const head = el("div", "head");
        head.append(el("span", "day", t.weekDay(day.date)), el("span", "title", day.title), el("span", "src", t.weekSource[day.source] || ""));
        card.append(head, el("div", "sub", t.weekUses(day.uses.map((u) => u.content).join(", "))));
        const acts = el("div", "acts");
        if (others.length) {
          const other = button("", t.weekOther, () => {
            const next = others.shift();
            others.push({ ...day, date: undefined });
            days[i] = { ...next, date: day.date };
            render();
          });
          other.dataset.role = "week-other";
          acts.append(other);
        }
        const remove = button("", t.weekRemove, () => {
          days.splice(i, 1);
          render();
        });
        remove.dataset.role = "week-remove";
        acts.append(remove);
        card.append(acts);
        list.append(card);
      });
      const parts = [el("h2", "", t.weekTitle)];
      if (days.length) parts.push(list);
      else parts.push(el("p", "hint", t.weekNone));
      if (res.error) parts.push(el("p", "hint", t.weekError(res.error)));
      const accept = button("submit", t.weekAccept, async () => {
        accept.disabled = true;
        for (const day of days) {
          try {
            await hass.callWS({
              type: `${DOMAIN}/plan_add`,
              date: day.date,
              title: day.title,
              device_ids: day.uses.map((u) => u.device_id).filter(Boolean),
              ...(day.recipe_id ? { recipe_id: day.recipe_id } : {}),
              ingredients: day.ingredients || [],
            });
          } catch {
            /* weiter mit den anderen Tagen */
          }
        }
        this._closeDialog();
        this.showNotice(t.weekAccepted(days.length));
        this.loadPlans();
      });
      accept.dataset.role = "week-accept";
      accept.disabled = !days.length;
      parts.push(buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), accept));
      form.replaceChildren(...parts);
    };
    render();
  };

  proto._weekButton = function _weekButton() {
    const b = button("", cookTexts(this._hass).weekButton, () => this.openWeekSuggest());
    b.dataset.role = "week-suggest";
    return b;
  };

  proto.cookMenuTexts = function cookMenuTexts() {
    const t = cookTexts(this._hass);
    return { sizes: `📏 ${t.menuSizes}`, batch: `🍲 ${t.menuBatch}` };
  };

  proto.canBatch = function canBatch() {
    return isAdmin(this._hass);
  };
}
