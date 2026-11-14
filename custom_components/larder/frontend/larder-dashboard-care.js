/**
 * Larder-Dashboard: Vorrat pflegen – Inventur je Fach und angebrochene Packungen.
 *
 * `installCare` hängt die Methoden an die Dashboard-Klasse (wie larder-dashboard-items.js).
 */

const TEXT = {
  de: {
    title: "Inventur",
    intro: "Wähle einen Bereich und optional ein Fach. Larder zeigt alles, was dort sein sollte; du hakst ab, korrigierst die Anzahl oder trägst aus, was nicht mehr da ist.",
    area: "Bereich",
    noArea: "Kein Bereich",
    compartment: "Fach (leer: ganzer Bereich)",
    compartmentHint: "z. B. Regal oben",
    start: "Inventur starten",
    empty: "Hier sollte laut Larder nichts sein.",
    progress: (done, all) => `${done} von ${all} geprüft`,
    ok: "✓",
    okLabel: "Stimmt",
    gone: "Weg",
    eaten: "Gegessen",
    thrown: "Weggeworfen",
    elsewhere: "Woanders",
    cancel: "Abbrechen",
    count: "Anzahl",
    scan: "📷 Scannen",
    addPack: "＋ Packung, die fehlt",
    finish: "Fertig",
    status: { ok: "✓ stimmt", changed: "✓ korrigiert", gone: "ausgetragen", moved: "verschoben" },
    notHere: (name) => `${name} gehört nicht in dieses Fach.`,
    unknown: "Dieser Code gehört zu nichts in diesem Fach.",
    summaryTitle: "Inventur abgeschlossen",
    summary: (s) => `${s.ok + s.changed} bestätigt (${s.changed} korrigiert), ${s.gone} ausgetragen, ${s.moved} verschoben, ${s.open} nicht geprüft.`,
    done: "OK",
    openTitle: "Packung anbrechen",
    openIntro: (n) => (n > 1 ? `Eine von ${n} Packungen wird als eigener Eintrag abgetrennt und als angebrochen markiert.` : "Die Packung wird als angebrochen markiert."),
    openWhere: "Wohin kommt sie?",
    openHint: "Das MHD wird für geöffnete Ware am neuen Ort geschätzt, höchstens das aufgedruckte Datum.",
    open: "Anbrechen",
    opened: (date) => `Angebrochen, MHD jetzt ${date}.`,
    openFailed: "Anbrechen fehlgeschlagen.",
    relocateTitle: "Dose woanders",
  },
  en: {
    title: "Stocktake",
    intro: "Choose an area and optionally a compartment. Larder shows everything that should be there; tick it off, correct the count or remove what is gone.",
    area: "Area",
    noArea: "No area",
    compartment: "Compartment (empty: whole area)",
    compartmentHint: "e.g. top shelf",
    start: "Start stocktake",
    empty: "According to Larder there is nothing here.",
    progress: (done, all) => `${done} of ${all} checked`,
    ok: "✓",
    okLabel: "Correct",
    gone: "Gone",
    eaten: "Eaten",
    thrown: "Thrown away",
    elsewhere: "Elsewhere",
    cancel: "Cancel",
    count: "Count",
    scan: "📷 Scan",
    addPack: "＋ Missing pack",
    finish: "Done",
    status: { ok: "✓ correct", changed: "✓ corrected", gone: "removed", moved: "moved" },
    notHere: (name) => `${name} does not belong in this compartment.`,
    unknown: "This code belongs to nothing in this compartment.",
    summaryTitle: "Stocktake finished",
    summary: (s) => `${s.ok + s.changed} confirmed (${s.changed} corrected), ${s.gone} removed, ${s.moved} moved, ${s.open} not checked.`,
    done: "OK",
    openTitle: "Open a pack",
    openIntro: (n) => (n > 1 ? `One of ${n} packs is split off as its own entry and marked as opened.` : "The pack is marked as opened."),
    openWhere: "Where does it go?",
    openHint: "The best-before date is estimated for opened food at the new place, at most the printed date.",
    open: "Open",
    opened: (date) => `Opened, best before now ${date}.`,
    openFailed: "Opening failed.",
    relocateTitle: "Container elsewhere",
  },
};

export function careTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

/** Einträge an einem Ort: Bereich (leer = ohne Bereich) und optional Fach (Groß-/Kleinschreibung egal). */
export function rowsAtPlace(rows, areaId, compartment) {
  const comp = String(compartment || "").trim().toLowerCase();
  return rows.filter(
    (r) => r.content !== "" && (r.areaId || "") === (areaId || "") && (!comp || String(r.compartment || "").trim().toLowerCase() === comp),
  );
}

export function installCare(Dashboard, { el, isAdmin, listAreas, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment, CATEGORY_ICONS }) {
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
  const fmt = (hass, iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? `${d}.${m}.${y}` : iso;
  };

  // ---------- Packung anbrechen ----------

  proto.openOpenDialog = function openOpenDialog(deviceId) {
    const hass = this._hass;
    const t = careTexts(hass);
    const row = this._rows().find((r) => r.id === deviceId);
    if (!row) return;
    const states = hass.states || {};
    const qty = Number((states[row.dev.entities.number] || {}).state) || 1;
    const area = el("select");
    area.dataset.f = "area";
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel, row.areaId)]) {
      const o = el("option", "", a.name);
      o.value = a.id;
      area.append(o);
    }
    area.value = row.areaId || "";
    const compartment = el("input");
    compartment.type = "text";
    compartment.maxLength = 60;
    compartment.dataset.f = "compartment";
    compartment.placeholder = t.compartmentHint;
    compartment.value = row.compartment || "";
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const submit = button("submit", t.open);
    submit.type = "submit";
    this._form.replaceChildren(
      el("h2", "", t.openTitle),
      el("p", "nfcitem", row.content),
      el("p", "hint", t.openIntro(qty)),
      field(t.openWhere, area),
      field(t.compartment.split(" (")[0], compartment),
      el("p", "hint", t.openHint),
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    const refresh = attachCompartmentChips(compartment, () => knownCompartments(hass, this._classic._devices, area.value), () => {});
    area.addEventListener("change", refresh);
    this._submit = async () => {
      submit.disabled = true;
      error.textContent = "";
      try {
        const res = await hass.callWS({ type: `${DOMAIN}/pack_open`, device_id: deviceId, area_id: area.value || null, compartment: compartment.value.trim() });
        rememberCompartment(area.value, compartment.value);
        this._closeDialog();
        this.showNotice(t.opened(fmt(hass, res && res.best_before)));
        if (res && res.device_id && res.device_id !== deviceId) this.openDetail(res.device_id);
      } catch (err) {
        error.textContent = (err && err.message) || t.openFailed;
      } finally {
        submit.disabled = false;
      }
    };
    this._overlay.hidden = false;
  };

  // ---------- Inventur ----------

  proto.stocktakeTitle = function stocktakeTitle() {
    return careTexts(this._hass).title;
  };

  proto.stocktakeSig = function stocktakeSig() {
    const take = this._take;
    return take ? [take.areaId, take.compartment, take.started, [...take.status.entries()]] : null;
  };

  proto._takeRows = function _takeRows() {
    const take = this._take;
    return take ? rowsAtPlace(this._rows(), take.areaId, take.compartment) : [];
  };

  proto.stocktakeTick = function stocktakeTick(deviceId, status = "ok") {
    const take = this._take;
    if (!take || !take.started) return false;
    const row = this._takeRows().find((r) => r.id === deviceId) || (take.items || []).find((r) => r.id === deviceId);
    if (!row) {
      const any = this._rows().find((r) => r.id === deviceId);
      this.showNotice(any ? careTexts(this._hass).notHere(any.content || any.name) : careTexts(this._hass).unknown);
      return false;
    }
    if (status === "ok" && take.status.get(deviceId) === "changed") return true;
    take.status.set(deviceId, status);
    this._sig = "";
    this._update();
    return true;
  };

  /** Gescannten Code (QR einer Dose, Strichcode einer Packung) in der Inventur abhaken. */
  proto.stocktakeScan = async function stocktakeScan(code) {
    const hass = this._hass;
    const take = this._take;
    let res = null;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/resolve_code`, code });
    } catch {
      res = null;
    }
    if (res && res.device_id) {
      this.stocktakeTick(res.device_id);
      return;
    }
    if (/^\d{8,14}$/.test(String(code).trim())) {
      try {
        const found = await hass.callWS({ type: `${DOMAIN}/stock_code`, code: String(code).trim() });
        const here = new Set(this._takeRows().map((r) => r.id));
        const hit = (found.entries || []).find((e) => here.has(e.device_id) && !take.status.has(e.device_id))
          || (found.entries || []).find((e) => here.has(e.device_id));
        if (hit) {
          this.stocktakeTick(hit.device_id);
          return;
        }
      } catch {
        /* unten: Hinweis */
      }
    }
    this.showNotice(careTexts(hass).unknown);
  };

  proto._renderStocktake = function _renderStocktake() {
    const hass = this._hass;
    const t = careTexts(hass);
    const frag = document.createDocumentFragment();
    if (!this._take) this._take = { areaId: "", compartment: "", started: false, status: new Map() };
    const take = this._take;
    if (!take.started) {
      frag.append(el("p", "note", t.intro));
      const form = el("div", "takeform");
      const area = el("select");
      area.dataset.f = "take-area";
      for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel)]) {
        const o = el("option", "", a.name);
        o.value = a.id;
        area.append(o);
      }
      area.value = take.areaId;
      const comp = el("input");
      comp.type = "text";
      comp.maxLength = 60;
      comp.dataset.f = "take-compartment";
      comp.placeholder = t.compartmentHint;
      comp.value = take.compartment;
      const start = button("primary", t.start, () => {
        this._take = { areaId: area.value, compartment: comp.value.trim(), started: true, status: new Map() };
        this._take.items = this._takeRows(); // was am Anfang dort sein sollte (Ausgetragenes bleibt sichtbar)
        this._sig = "";
        this._update();
      });
      start.dataset.role = "take-start";
      form.append(field(t.area, area), field(t.compartment, comp), start);
      frag.append(form);
      this._main.replaceChildren(frag);
      const refresh = attachCompartmentChips(comp, () => knownCompartments(hass, this._classic._devices, area.value), () => {});
      area.addEventListener("change", refresh);
      return;
    }
    // Liste: was am Anfang da sein sollte, mit aktuellem Stand
    const current = new Map(this._takeRows().map((r) => [r.id, r]));
    const rows = (take.items || []).map((r) => current.get(r.id) || r);
    for (const r of current.values()) if (!rows.some((x) => x.id === r.id)) rows.push(r);
    const areaName = take.areaId ? ((hass.areas || {})[take.areaId] || {}).name || take.areaId : t.noArea;
    const head = el("div", "bar");
    head.append(el("span", "grow takeplace", [areaName, take.compartment].filter(Boolean).join(" · ")));
    if (this._classic._hasBarcodeScanner && this._classic._hasBarcodeScanner()) {
      const scan = button("", t.scan, () => this._classic.scanBarcodeRaw((code) => this.stocktakeScan(code)));
      scan.dataset.role = "take-scan";
      head.append(scan);
    }
    frag.append(head);
    const checked = rows.filter((r) => take.status.has(r.id)).length;
    frag.append(el("p", "count", rows.length ? t.progress(checked, rows.length) : t.empty));
    const list = el("div", "takelist");
    const states = hass.states || {};
    for (const row of rows) {
      const status = take.status.get(row.id);
      const item = el("div", `takerow${status ? ` ${status}` : ""}`);
      item.dataset.id = row.id;
      const text = el("span", "text");
      text.append(
        el("span", "name", row.content),
        el("span", "sub", [row.name, row.compartment && !take.compartment ? row.compartment : null, row.opened ? "🔓" : null].filter(Boolean).join(" · ")),
      );
      item.append(el("span", "ico", CATEGORY_ICONS[row.category] || CATEGORY_ICONS.other), text);
      const actions = el("span", "acts");
      if (status && status !== "changed") {
        actions.append(el("span", "state", t.status[status]));
      } else {
        const unit = (states[row.dev.entities.select] || {}).state;
        const qtyState = states[row.dev.entities.number];
        if (qtyState && row.kind !== "container" && ["pieces", "portions"].includes(unit)) {
          const qty = el("input");
          qty.type = "number";
          qty.min = "1";
          qty.max = "9999";
          qty.inputMode = "numeric";
          qty.dataset.role = "take-count";
          qty.value = String(Number(qtyState.state) || 1);
          qty.setAttribute("aria-label", t.count);
          qty.addEventListener("change", () => {
            const n = Math.max(1, Math.min(9999, parseInt(qty.value, 10) || 1));
            hass.callService("number", "set_value", { entity_id: row.dev.entities.number, value: n });
            take.status.set(row.id, "changed");
            this._sig = "";
            this._update();
          });
          actions.append(qty);
        }
        if (status === "changed") actions.append(el("span", "state", t.status.changed));
        else {
          const ok = button("primary", t.ok, () => this.stocktakeTick(row.id));
          ok.dataset.role = "take-ok";
          ok.title = t.okLabel;
          ok.setAttribute("aria-label", t.okLabel);
          actions.append(ok);
        }
        const gone = button("", t.gone, () => {
          actions.replaceChildren(
            ...[["eaten", t.eaten], ["thrown", t.thrown]].map(([outcome, label]) => {
              const b = button("", label, async () => {
                try {
                  await hass.callWS({ type: `${DOMAIN}/empty`, device_id: row.id, outcome });
                } catch {
                  if (row.dev.entities.button) hass.callService("button", "press", { entity_id: row.dev.entities.button });
                }
                take.status.set(row.id, "gone");
                this._sig = "";
                this._update();
              });
              b.dataset.role = `take-${outcome}`;
              return b;
            }),
            button("", t.cancel, () => {
              this._sig = "";
              this._update();
            }),
          );
        });
        gone.dataset.role = "take-gone";
        actions.append(gone);
        if (row.kind !== "container" || isAdmin(hass)) {
          const away = button("", t.elsewhere, () => {
            const done = () => {
              take.status.set(row.id, "moved");
              this._sig = "";
              this._update();
            };
            if (row.kind === "container") this._relocateContainer(row, done);
            else this.openMoveDialog(row.id, done);
          });
          away.dataset.role = "take-elsewhere";
          actions.append(away);
        }
      }
      item.append(actions);
      list.append(item);
    }
    frag.append(list);
    const foot = el("div", "help");
    const add = button("", t.addPack, () =>
      this.openItemsDialog("pack", { area_id: take.areaId, compartment: take.compartment, rows: [] }),
    );
    add.dataset.role = "take-add";
    const finish = button("primary", t.finish, () => this._finishStocktake(rows));
    finish.dataset.role = "take-finish";
    foot.append(add, finish);
    frag.append(foot);
    this._main.replaceChildren(frag);
  };

  proto._finishStocktake = function _finishStocktake(rows) {
    const t = careTexts(this._hass);
    const take = this._take;
    const counts = { ok: 0, changed: 0, gone: 0, moved: 0, open: 0 };
    for (const row of rows) counts[take.status.get(row.id) || "open"] += 1;
    this._take = { areaId: take.areaId, compartment: take.compartment, started: false, status: new Map() };
    this._form.replaceChildren(
      el("h2", "", t.summaryTitle),
      el("p", "", t.summary(counts)),
      buttonsRow(Object.assign(button("submit", t.done, () => this._closeDialog()), { type: "button" })),
    );
    this._submit = null;
    this._overlay.hidden = false;
    this._sig = "";
    this._update();
  };

  /** Dose in einen anderen Bereich/ein anderes Fach stellen (nur Administratoren dürfen Geräte ändern). */
  proto._relocateContainer = function _relocateContainer(row, onDone) {
    const hass = this._hass;
    const t = careTexts(hass);
    const area = el("select");
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel, row.areaId)]) {
      const o = el("option", "", a.name);
      o.value = a.id;
      area.append(o);
    }
    area.value = row.areaId || "";
    area.dataset.f = "area";
    const comp = el("input");
    comp.type = "text";
    comp.maxLength = 60;
    comp.dataset.f = "compartment";
    comp.value = row.compartment || "";
    const submit = button("submit", t.done);
    submit.type = "submit";
    this._form.replaceChildren(
      el("h2", "", t.relocateTitle),
      el("p", "nfcitem", `${row.content} · ${row.name}`),
      field(t.area, area),
      field(t.compartment.split(" (")[0], comp),
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    const refresh = attachCompartmentChips(comp, () => knownCompartments(hass, this._classic._devices, area.value), () => {});
    area.addEventListener("change", refresh);
    this._submit = async () => {
      await hass.callWS({ type: "config/device_registry/update", device_id: row.id, area_id: area.value || null });
      if (row.dev.entities.compartment) hass.callService("text", "set_value", { entity_id: row.dev.entities.compartment, value: comp.value.trim() });
      rememberCompartment(area.value, comp.value);
      this._closeDialog();
      onDone();
    };
    this._overlay.hidden = false;
  };
}
