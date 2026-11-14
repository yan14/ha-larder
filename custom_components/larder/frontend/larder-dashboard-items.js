/**
 * Larder-Dashboard: Beutel (Einweg, mit NFC-Sticker oder QR-Code) und Packungen (Vorrat ohne Dose).
 *
 * Eigenes Modul, damit larder-dashboard.js nicht weiter wächst. `installItems` hängt die Dialoge als
 * Methoden an die Dashboard-Klasse: Auswahl "Was anlegen?", Beutel/Packungen anlegen, NFC-Sticker der Reihe
 * nach beschreiben und "Packung in Dose umfüllen".
 */
const MAX_ITEMS = 30;
const UNITS = ["portions", "pieces", "slices", "grams", "milliliters"];

const TEXT = {
  de: {
    addTitle: "Was möchtest du anlegen?",
    kindContainer: "Dose",
    kindContainerHint: "Wiederverwendbar, mit QR-Code oder NFC-Tag",
    kindBag: "Beutel",
    kindBagHint: "Einweg, z. B. Vakuumbeutel: verschwindet nach dem Leeren",
    kindPack: "Packung",
    kindPackHint: "Vorrat ohne Dose, z. B. Konserven: ohne Code",
    titleBag: "Beutel anlegen",
    titlePack: "Packungen anlegen",
    area: "Bereich",
    compartment: "Fach (optional)",
    compartmentHint: "z. B. Schublade 2",
    noArea: "Kein Bereich",
    content: "Inhalt",
    count: "Anzahl Beutel",
    quantity: "Menge",
    packs: "Anzahl",
    bestBefore: "MHD",
    bestBeforeBag: "MHD (leer = schätzen)",
    vacuum: "Vakuumiert",
    more: "＋ Weitere Zeile",
    remove: "Zeile entfernen",
    scan: "Strichcode scannen",
    scanFound: (name) => `Gefunden: ${name} (Open Food Facts)`,
    scanNotFound: (code) => `Zu ${code} wurde nichts gefunden. Bitte von Hand eintragen.`,
    create: "Anlegen",
    cancel: "Abbrechen",
    done: "Fertig",
    needContent: "Bitte mindestens einen Inhalt eintragen.",
    tooMany: `Höchstens ${MAX_ITEMS} auf einmal.`,
    failed: "Anlegen fehlgeschlagen.",
    createdBag: (n) => (n === 1 ? "1 Beutel angelegt." : `${n} Beutel angelegt.`),
    createdPack: (n) => (n === 1 ? "1 Packung angelegt." : `${n} Packungen angelegt.`),
    createdHint: "Jetzt jeden Beutel kennzeichnen: mit einem NFC-Sticker oder einem gedruckten Etikett.",
    nfc: "📡 NFC-Sticker",
    labels: "🖨 Etiketten",
    nfcTitle: (i, n) => `NFC-Sticker ${i} von ${n}`,
    nfcWrite: "✍ Sticker beschreiben",
    nfcScanHint: "Halte einen Sticker ans Handy: neue Sticker beschreibst du mit dem Knopf, schon beschriebene werden einfach gescannt.",
    nfcHold: "Jetzt den Sticker ans Handy halten und danach auf Weiter tippen.",
    nfcLinked: "Sticker verknüpft.",
    nfcInUse: "Dieser Sticker gehört schon zu einer anderen Dose.",
    nfcFailed: "Verknüpfen fehlgeschlagen.",
    next: "Weiter ›",
    skip: "Überspringen",
    nfcDone: (n) => `${n} Sticker verknüpft.`,
    transferTitle: "In Dose umfüllen",
    transferInto: "Leere Dose",
    transferNone: "Es gibt gerade keine leere Dose.",
    transferHint: "Inhalt und Nährwerte wandern in die Dose, das MHD wird für die geöffnete Ware neu geschätzt (höchstens wie aufgedruckt). Die Packung wird um eins weniger.",
    transfer: "Umfüllen",
    transferDone: (name, left) => `Umgefüllt in ${name}.${left ? ` Noch ${left} im Vorrat.` : ""}`,
    transferFailed: "Umfüllen fehlgeschlagen.",
    stockTitle: "Vorrat",
    codeTitle: "Strichcode",
    codeScan: "📷 Strichcode",
    codeOldest: (place) => `Ältestes zuerst: ${place}`,
    codeOther: "Hast du gerade eine andere in der Hand? Dann dort −1.",
    codeNone: (name) => `${name || "Dieses Produkt"} ist nicht im Vorrat.`,
    codeAdd: "Als Packung anlegen",
    codeUnknown: (code) => `Zu ${code} wurde nichts gefunden.`,
    codeTake: "−1",
    codeTaken: (place) => `Eine Packung aus ${place} entnommen.`,
    codeDate: (d) => `MHD ${d}`,
    noDate: "ohne MHD",
    stockEarliest: (d) => `frühestes MHD ${d}`,
    boughtTitle: "🛒 Eingekauft – in den Vorrat?",
    boughtAdd: "In den Vorrat",
    boughtDismiss: "Nicht anlegen",
    stockIntro: "Packungen nach Produkt, über alle Orte zusammengezählt. Mit Mindestbestand kommt ein Produkt auf die Einkaufsliste, sobald weniger da ist.",
    stockNoList: "Für den Mindestbestand fehlt noch eine Einkaufsliste in den Einstellungen.",
    stockEmpty: "Noch keine Packungen. Lege sie über ＋ → Packung an.",
    stockMin: "Mindestens",
    stockLow: "zu wenig",
    stockNone: "keine mehr da",
    stockFailed: "Speichern fehlgeschlagen.",
    receipt: "Kassenbon",
    receiptBusy: "Kassenbon wird gelesen …",
    receiptDone: (n) => `${n} Produkt(e) vom Kassenbon übernommen. Bitte prüfen und das MHD ergänzen.`,
    receiptFailed: "Auf dem Foto wurde kein Kassenbon erkannt.",
    moveTitle: "Verschieben / aufteilen",
    moveCount: (n) => `Wie viele? (von ${n})`,
    moveTo: "Nach",
    moveHint: "Liegt dort schon dieselbe Ware mit demselben MHD, werden die Packungen zusammengelegt.",
    move: "Verschieben",
    moveDone: (n, place) => `${n} nach ${place} verschoben.`,
    moveFailed: "Verschieben fehlgeschlagen.",
    units: { portions: "Portionen", pieces: "Stück", slices: "Scheiben", grams: "Gramm", milliliters: "Milliliter" },
  },
  en: {
    addTitle: "What do you want to add?",
    kindContainer: "Container",
    kindContainerHint: "Reusable, with a QR code or NFC tag",
    kindBag: "Bag",
    kindBagHint: "Single use, e.g. vacuum bags: gone after emptying",
    kindPack: "Pack",
    kindPackHint: "Stock without a container, e.g. cans: no code",
    titleBag: "Add bags",
    titlePack: "Add packs",
    area: "Area",
    compartment: "Compartment (optional)",
    compartmentHint: "e.g. drawer 2",
    noArea: "No area",
    content: "Contents",
    count: "Number of bags",
    quantity: "Qty",
    packs: "Count",
    bestBefore: "Best before",
    bestBeforeBag: "Best before (empty = estimate)",
    vacuum: "Vacuum sealed",
    more: "＋ Another row",
    remove: "Remove row",
    scan: "Scan barcode",
    scanFound: (name) => `Found: ${name} (Open Food Facts)`,
    scanNotFound: (code) => `Nothing found for ${code}. Please enter it by hand.`,
    create: "Add",
    cancel: "Cancel",
    done: "Done",
    needContent: "Please enter at least one content.",
    tooMany: `At most ${MAX_ITEMS} at once.`,
    failed: "Adding failed.",
    createdBag: (n) => (n === 1 ? "1 bag added." : `${n} bags added.`),
    createdPack: (n) => (n === 1 ? "1 pack added." : `${n} packs added.`),
    createdHint: "Now mark each bag: with an NFC sticker or a printed label.",
    nfc: "📡 NFC stickers",
    labels: "🖨 Labels",
    nfcTitle: (i, n) => `NFC sticker ${i} of ${n}`,
    nfcWrite: "✍ Write sticker",
    nfcScanHint: "Hold a sticker to the phone: write new stickers with the button, stickers already written are simply scanned.",
    nfcHold: "Now hold the sticker to the phone, then tap Next.",
    nfcLinked: "Sticker linked.",
    nfcInUse: "This sticker already belongs to another container.",
    nfcFailed: "Linking failed.",
    next: "Next ›",
    skip: "Skip",
    nfcDone: (n) => `${n} sticker${n === 1 ? "" : "s"} linked.`,
    transferTitle: "Move into a container",
    transferInto: "Empty container",
    transferNone: "There is no empty container right now.",
    transferHint: "Contents and nutrition move into the container, the best-before date is estimated again for the opened food (at most as printed). The pack count goes down by one.",
    transfer: "Move",
    transferDone: (name, left) => `Moved into ${name}.${left ? ` ${left} left in stock.` : ""}`,
    transferFailed: "Moving failed.",
    stockTitle: "Stock",
    codeTitle: "Barcode",
    codeScan: "📷 Barcode",
    codeOldest: (place) => `Oldest first: ${place}`,
    codeOther: "Holding another one right now? Take it from there with −1.",
    codeNone: (name) => `${name || "This product"} is not in stock.`,
    codeAdd: "Add as a pack",
    codeUnknown: (code) => `Nothing found for ${code}.`,
    codeTake: "−1",
    codeTaken: (place) => `Took one pack from ${place}.`,
    codeDate: (d) => `best before ${d}`,
    noDate: "no best-before date",
    stockEarliest: (d) => `earliest best before ${d}`,
    boughtTitle: "🛒 Bought – add to the stock?",
    boughtAdd: "Add to stock",
    boughtDismiss: "Don't add",
    stockIntro: "Packs by product, summed over all places. With a minimum stock a product goes onto the shopping list as soon as there is less.",
    stockNoList: "For the minimum stock, choose a shopping list in the settings first.",
    stockEmpty: "No packs yet. Add them with ＋ → Pack.",
    stockMin: "At least",
    stockLow: "too few",
    stockNone: "none left",
    stockFailed: "Saving failed.",
    receipt: "Receipt",
    receiptBusy: "Reading the receipt …",
    receiptDone: (n) => `${n} product(s) taken from the receipt. Please check them and add the best-before dates.`,
    receiptFailed: "No receipt was recognised in the photo.",
    moveTitle: "Move / split",
    moveCount: (n) => `How many? (of ${n})`,
    moveTo: "To",
    moveHint: "If the same food with the same best-before date is already there, the packs are merged.",
    move: "Move",
    moveDone: (n, place) => `${n} moved to ${place}.`,
    moveFailed: "Moving failed.",
    units: { portions: "portions", pieces: "pieces", slices: "slices", grams: "grams", milliliters: "milliliters" },
  },
};

export function itemTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

/** Zeilen des Dialogs in die Einträge für `larder/create_items` umrechnen (ein Beutel je "Anzahl"). */
export function buildItems(kind, rows, vacuum = true) {
  const items = [];
  for (const row of rows) {
    const content = (row.content || "").trim();
    if (!content) continue;
    const item = { content };
    const quantity = parseInt(row.quantity, 10);
    if (quantity > 0) {
      item.quantity = quantity;
      if (UNITS.includes(row.unit)) item.unit = row.unit;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) item.best_before = row.date;
    if (row.product) item.product = row.product;
    if (kind === "bag") item.vacuum = !!vacuum;
    const copies = kind === "bag" ? Math.max(1, parseInt(row.count, 10) || 1) : 1;
    for (let i = 0; i < copies; i++) items.push({ ...item });
  }
  return items;
}

export function installItems(Dashboard, { el, isAdmin, listAreas, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment }) {
  const proto = Dashboard.prototype;

  const fmtDate = (hass, iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? `${d}.${m}.${y}` : iso;
  };
  const placeName = (p, t) => [p.area, p.compartment].filter(Boolean).join(" · ") || t.noArea;

  /** Gekaufte Packung per Strichcode entnehmen: zeigt alle Orte, die mit dem frühesten MHD zuerst. */
  proto.takeByCode = async function takeByCode(code) {
    const hass = this._hass;
    const t = itemTexts(hass);
    let res;
    try {
      res = await hass.callWS({ type: `${DOMAIN}/stock_code`, code });
    } catch {
      res = null;
    }
    const form = this._form;
    const close = button("cancel", t.cancel, () => this._closeDialog());
    if (!res || !res.entries || !res.entries.length) {
      const parts = [el("h2", "", (res && res.name) || t.codeTitle)];
      if (res && res.name) {
        parts.push(el("p", "hint", t.codeNone(res.name)));
        const add = button("submit", t.codeAdd, () =>
          this.openItemsDialog("pack", { rows: [{ content: res.name, quantity: 1, product: res.product }] }),
        );
        add.dataset.role = "code-add";
        parts.push(buttonsRow(close, add));
      } else {
        parts.push(el("p", "hint", t.codeUnknown((res && res.code) || code)), buttonsRow(close));
      }
      form.replaceChildren(...parts);
      this._submit = null;
      this._overlay.hidden = false;
      return res;
    }
    const list = el("div", "codelist");
    res.entries.forEach((entry, i) => {
      const row = el("div", `coderow${i === 0 ? " oldest" : ""}`);
      const text = el("span", "text");
      text.append(
        el("span", "name", `${placeName(entry, t)}: ${entry.count}`),
        el("span", "sub", entry.best_before ? t.codeDate(fmtDate(hass, entry.best_before)) : t.noDate),
      );
      const take = button(i === 0 ? "primary" : "", t.codeTake, async () => {
        take.disabled = true;
        await this._takeOne(entry);
        this._closeDialog();
        this.showNotice(t.codeTaken(placeName(entry, t)));
        if (this._view === "stock") this.loadStock();
      });
      take.dataset.role = "code-take";
      row.append(text, take);
      list.append(row);
    });
    const parts = [el("h2", "", res.name), el("p", "lead", t.codeOldest(placeName(res.entries[0], t))), list];
    if (res.entries.length > 1) parts.push(el("p", "hint", t.codeOther));
    parts.push(buttonsRow(close));
    form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
    return res;
  };

  /** Eine Packung entnehmen: Anzahl −1, die letzte leert den Eintrag (als gegessen). */
  proto._takeOne = async function _takeOne(entry) {
    const hass = this._hass;
    const row = this._rows().find((r) => r.id === entry.device_id);
    if (entry.count > 1 && row && row.dev.entities.number) {
      await hass.callService("number", "set_value", { entity_id: row.dev.entities.number, value: entry.count - 1 });
      return;
    }
    try {
      await hass.callWS({ type: `${DOMAIN}/empty`, device_id: entry.device_id, outcome: "eaten" });
    } catch {
      if (row && row.dev.entities.button) await hass.callService("button", "press", { entity_id: row.dev.entities.button });
    }
  };

  /** Strichcode-Scanner der App öffnen und die gescannte Ware entnehmen. */
  proto.scanToTake = function scanToTake() {
    this._classic.scanBarcodeRaw((code) => this.takeByCode(code));
  };

  proto.loadBought = async function loadBought() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._bought = ((await hass.callWS({ type: `${DOMAIN}/bought` })) || {}).items || [];
    } catch {
      this._bought = [];
    }
    this._sig = "";
    this._update();
  };

  /** Startseite: abgehakte Einträge von der Einkaufsliste, die Larder gesetzt hat, als Packung anbieten. */
  proto._boughtBox = function _boughtBox() {
    const items = this._bought || [];
    if (!items.length) return null;
    const hass = this._hass;
    const t = itemTexts(hass);
    const dismiss = async (item) => {
      try {
        this._bought = ((await hass.callWS({ type: `${DOMAIN}/bought_dismiss`, item_id: item.id })) || {}).items || [];
      } catch {
        this._bought = this._bought.filter((b) => b.id !== item.id);
      }
      this._sig = "";
      this._update();
    };
    const box = el("section", "stat bought");
    box.append(el("h3", "", t.boughtTitle));
    for (const item of items) {
      const row = el("div", "boughtrow");
      row.dataset.id = item.id;
      const add = button("primary", t.boughtAdd, () =>
        this.openItemsDialog("pack", {
          rows: [{ content: item.content, quantity: item.count || 1, product: item.product || null }],
          area_id: item.area_id,
          compartment: item.compartment,
          onCreated: () => dismiss(item),
        }),
      );
      add.dataset.role = "bought-add";
      const drop = button("", "✕", () => dismiss(item));
      drop.dataset.role = "bought-dismiss";
      drop.setAttribute("aria-label", t.boughtDismiss);
      drop.title = t.boughtDismiss;
      row.append(el("span", "name", item.summary || item.content), add, drop);
      box.append(row);
    }
    return box;
  };

  proto.stockTitle = function stockTitle() {
    return itemTexts(this._hass).stockTitle;
  };

  proto.loadStock = async function loadStock() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._stock = await hass.callWS({ type: `${DOMAIN}/stock` });
    } catch {
      this._stock = { products: [], error: true };
    }
    this._sig = "";
    this._update();
  };

  /** Vorrats-Ansicht: alle Produkte mit Bestand, Orten und Mindestbestand (direkt bearbeitbar). */
  proto._renderStock = function _renderStock() {
    const hass = this._hass;
    const t = itemTexts(hass);
    const frag = document.createDocumentFragment();
    const data = this._stock;
    if (!data) {
      this._main.replaceChildren(frag);
      return;
    }
    if (this._classic._hasBarcodeScanner && this._classic._hasBarcodeScanner()) {
      const bar = el("div", "bar");
      const scan = button("", t.codeScan, () => this.scanToTake());
      scan.dataset.role = "stock-scan";
      bar.append(el("span", "grow"), scan);
      frag.append(bar);
    }
    frag.append(el("p", "note", t.stockIntro));
    if (!data.shopping_list && data.products.some((p) => p.min > 0)) frag.append(el("p", "note warn", t.stockNoList));
    if (!data.products.length) frag.append(el("p", "note", t.stockEmpty));
    const list = el("div", "stocklist");
    for (const p of data.products) {
      const item = el("section", `stockitem${p.low ? " low" : ""}`);
      item.dataset.key = p.key;
      const head = el("div", "stockhead");
      head.append(el("span", "name", p.name), el("span", "count", String(p.count)));
      if (p.low) head.append(el("span", "badge expired", p.count ? t.stockLow : t.stockNone));
      const min = el("input");
      min.type = "number";
      min.min = "0";
      min.max = "999";
      min.inputMode = "numeric";
      min.dataset.role = "stock-min";
      min.value = p.min ? String(p.min) : "";
      min.placeholder = "–";
      min.setAttribute("aria-label", `${t.stockMin} (${p.name})`);
      min.addEventListener("change", async () => {
        const value = Math.max(0, Math.min(999, parseInt(min.value, 10) || 0));
        try {
          const res = await hass.callWS({ type: `${DOMAIN}/stock_min`, content: p.name, min: value });
          this._stock = { ...this._stock, products: res.products };
          this._sig = "";
          this._update();
        } catch {
          this.showNotice(t.stockFailed);
        }
      });
      const minWrap = el("label", "stockmin", t.stockMin);
      minWrap.append(min);
      head.append(minWrap);
      item.append(head);
      const sub = [p.brand, p.package, p.earliest ? t.stockEarliest(fmtDate(hass, p.earliest)) : null].filter(Boolean).join(" · ");
      if (sub) item.append(el("div", "sub", sub));
      const places = el("div", "places");
      for (const place of p.places) {
        const date = place.best_before ? ` · ${fmtDate(hass, place.best_before)}` : "";
        const chip = el("button", "place", `${[place.area, place.compartment].filter(Boolean).join(" · ") || "–"}: ${place.count}${date}`);
        chip.type = "button";
        chip.dataset.id = place.device_id;
        chip.addEventListener("click", () => this.openDetail(place.device_id));
        places.append(chip);
      }
      if (p.places.length) item.append(places);
      list.append(item);
    }
    frag.append(list);
    this._main.replaceChildren(frag);
  };

  /** Packung verschieben oder aufteilen (ein Teil an einen anderen Ort). */
  proto.openMoveDialog = function openMoveDialog(deviceId) {
    const hass = this._hass;
    const t = itemTexts(hass);
    const row = this._rows().find((r) => r.id === deviceId);
    if (!row) return;
    const states = hass.states || {};
    const qty = Number((states[row.dev.entities.number] || {}).state) || 1;
    const unit = (states[row.dev.entities.select] || {}).state;
    const total = ["pieces", "portions"].includes(unit) && qty > 0 ? qty : 1;
    const count = el("input");
    count.type = "number";
    count.min = "1";
    count.max = String(total);
    count.inputMode = "numeric";
    count.dataset.f = "count";
    count.value = String(total);
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
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const submit = button("submit", t.move, null, "submit");
    this._form.replaceChildren(
      el("h2", "", t.moveTitle),
      el("p", "nfcitem", `${row.content} · ${[row.areaName, row.compartment].filter(Boolean).join(" · ")}`),
      field(t.moveCount(total), count),
      field(t.moveTo, area),
      field(t.compartment, compartment),
      el("p", "hint", t.moveHint),
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    const refreshMoveChips = attachCompartmentChips(compartment, () => knownCompartments(hass, this._classic._devices, area.value), () => {});
    area.addEventListener("change", refreshMoveChips);
    this._submit = async () => {
      const n = Math.max(1, Math.min(total, parseInt(count.value, 10) || total));
      submit.disabled = true;
      error.textContent = "";
      try {
        const msg = { type: `${DOMAIN}/pack_move`, device_id: deviceId, count: n, compartment: compartment.value.trim() };
        msg.area_id = area.value || null;
        await hass.callWS(msg);
        rememberCompartment(area.value, msg.compartment);
        const place = [area.value ? area.options[area.selectedIndex].textContent : t.noArea, compartment.value.trim()].filter(Boolean).join(" · ");
        this._closeDialog();
        this.showNotice(t.moveDone(n, place));
        if (this._view === "stock") this.loadStock();
      } catch (err) {
        error.textContent = (err && err.message) || t.moveFailed;
      } finally {
        submit.disabled = false;
      }
    };
    this._overlay.hidden = false;
  };

  const buttonsRow = (...buttons) => {
    const row = el("div", "buttons");
    row.append(...buttons);
    return row;
  };
  const button = (cls, text, onClick, type = "button") => {
    const b = el("button", cls, text);
    b.type = type;
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };
  const field = (label, control) => {
    const wrap = el("label", "", label);
    wrap.append(control);
    return wrap;
  };

  /** "＋": Dose (nur Administratoren), Beutel oder Packung. */
  proto.openAddMenu = function openAddMenu() {
    const t = itemTexts(this._hass);
    const choice = (role, icon, name, hint, run) => {
      const b = el("button", "choice");
      b.type = "button";
      b.dataset.role = role;
      b.append(el("span", "ico", icon), el("span", "name", name), el("span", "sub", hint));
      b.addEventListener("click", run);
      return b;
    };
    const choices = el("div", "choices");
    if (isAdmin(this._hass)) {
      choices.append(
        choice("add-container", "🥡", t.kindContainer, t.kindContainerHint, () => {
          this._closeDialog();
          this._classic.openAddDialog();
        }),
      );
    }
    choices.append(
      choice("add-bag", "🛍", t.kindBag, t.kindBagHint, () => this.openItemsDialog("bag")),
      choice("add-pack", "📦", t.kindPack, t.kindPackHint, () => this.openItemsDialog("pack")),
    );
    this._form.replaceChildren(el("h2", "", t.addTitle), choices, buttonsRow(button("cancel", t.cancel, () => this._closeDialog())));
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** Beutel oder Packungen anlegen: mehrere Zeilen, je Zeile ein Inhalt. */
  proto.openItemsDialog = function openItemsDialog(kind, preset = null) {
    const hass = this._hass;
    const t = itemTexts(hass);
    const form = this._form;
    const bag = kind === "bag";

    const area = el("select");
    area.dataset.f = "area";
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel)]) {
      const o = el("option", "", a.name);
      o.value = a.id;
      area.append(o);
    }
    const remembered = preset && preset.area_id ? preset.area_id : (this._opts.itemArea || {})[kind] || "";
    if ([...area.options].some((o) => o.value === remembered)) area.value = remembered;
    const compartment = el("input");
    compartment.type = "text";
    compartment.maxLength = 60;
    compartment.dataset.f = "compartment";
    compartment.placeholder = t.compartmentHint;
    if (preset && preset.compartment) compartment.value = preset.compartment;

    const rows = el("div", "itemrows");
    const status = el("p", "hint");
    status.dataset.role = "item-status";
    status.hidden = true;
    const addRow = (values = {}) => {
      const row = el("div", "itemrow");
      const input = (name, type, placeholder) => {
        const i = el("input");
        i.type = type;
        i.dataset.i = name;
        if (placeholder) {
          i.placeholder = placeholder;
          i.setAttribute("aria-label", placeholder);
        }
        return i;
      };
      const content = input("content", "text", t.content);
      content.maxLength = 255;
      content.value = values.content || "";
      const quantity = input("quantity", "number", bag ? t.quantity : t.packs);
      quantity.min = "0";
      quantity.max = "9999";
      quantity.inputMode = "numeric";
      quantity.value = values.quantity ? String(values.quantity) : bag ? "" : "1";
      const unit = el("select");
      unit.dataset.i = "unit";
      for (const key of UNITS) {
        const o = el("option", "", t.units[key]);
        o.value = key;
        unit.append(o);
      }
      unit.value = bag ? "grams" : "pieces";
      const date = input("date", "date", bag ? t.bestBeforeBag : t.bestBefore);
      date.title = bag ? t.bestBeforeBag : t.bestBefore;
      const second = el("div", "itemsub");
      if (bag) {
        const count = input("count", "number", t.count);
        count.min = "1";
        count.max = String(MAX_ITEMS);
        count.inputMode = "numeric";
        count.value = "1";
        count.title = t.count;
        const times = el("label", "times", "×");
        times.prepend(count);
        second.append(times);
      }
      const dateLabel = el("label", "datelabel", bag ? t.bestBeforeBag : t.bestBefore);
      dateLabel.append(date);
      second.append(quantity, unit, dateLabel);
      const remove = button("remove", "✕", () => {
        if (rows.children.length > 1) row.remove();
        else content.value = "";
      });
      remove.setAttribute("aria-label", t.remove);
      const first = el("div", "itemmain");
      first.append(content, remove);
      row.append(first, second);
      row._product = values.product || null;
      // von Hand geänderter Inhalt: die gescannten Produktdaten gehören nicht mehr dazu
      content.addEventListener("input", () => (row._product = null));
      rows.append(row);
      return row;
    };
    if (preset && preset.rows && preset.rows.length) for (const values of preset.rows) addRow(values);
    else addRow();

    const extras = [];
    if (!bag && this._classic._hasBarcodeScanner && this._classic._hasBarcodeScanner()) {
      const scan = button("link", `📷 ${t.scan}`, () => {
        this._classic.scanBarcodeRaw(async (code) => {
          let res = null;
          try {
            res = await hass.callWS({ type: `${DOMAIN}/product`, code });
          } catch {
            res = null;
          }
          status.hidden = false;
          if (!res || !res.found) {
            status.textContent = t.scanNotFound((res && res.code) || code);
            return;
          }
          status.textContent = t.scanFound(res.name);
          const free = [...rows.children].find((r) => !r.querySelector('[data-i="content"]').value.trim());
          const row = free || addRow();
          row.querySelector('[data-i="content"]').value = res.name;
          row._product = res.product || null;
        });
      });
      scan.dataset.role = "item-scan";
      extras.push(scan);
    }
    if (!bag && this._canGenerate() && hass.fetchWithAuth) {
      // Kassenbon fotografieren: die KI schlägt Produkte mit Anzahl vor
      const file = el("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;
      file.dataset.role = "receipt-file";
      const receipt = button("link", `🧾 ${t.receipt}`, () => file.click());
      receipt.dataset.role = "item-receipt";
      file.addEventListener("change", async () => {
        const photo = file.files && file.files[0];
        file.value = "";
        if (!photo) return;
        status.hidden = false;
        status.textContent = t.receiptBusy;
        receipt.disabled = true;
        try {
          const body = new FormData();
          body.append("file", photo, photo.name || "receipt.jpg");
          const res = await hass.fetchWithAuth(`/api/${DOMAIN}/receipt_photo`, { method: "POST", body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !Array.isArray(data.items) || !data.items.length) throw new Error(data.message || t.receiptFailed);
          for (const item of data.items) {
            const free = [...rows.children].find((r) => !r.querySelector('[data-i="content"]').value.trim());
            const row = free || addRow();
            row.querySelector('[data-i="content"]').value = item.name;
            row.querySelector('[data-i="quantity"]').value = String(item.count || 1);
            row._product = null;
          }
          status.textContent = t.receiptDone(data.items.length);
        } catch (err) {
          status.textContent = (err && err.message) || t.receiptFailed;
        } finally {
          receipt.disabled = false;
        }
      });
      extras.push(receipt, file);
    }
    const more = button("link", t.more, () => addRow().querySelector('[data-i="content"]').focus());
    more.dataset.role = "item-more";
    extras.push(more);

    let vacuum = null;
    if (bag) {
      vacuum = el("label", "check");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.f = "vacuum";
      box.checked = true;
      vacuum.append(box, el("span", "", t.vacuum));
    }
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const submit = button("submit", t.create, null, "submit");
    form.replaceChildren(
      el("h2", "", bag ? t.titleBag : t.titlePack),
      field(t.area, area),
      field(t.compartment, compartment),
      rows,
      ...extras,
      status,
      ...(vacuum ? [vacuum] : []),
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    const chipsFor = () => knownCompartments(hass, this._classic._devices, area.value);
    const refreshChips = attachCompartmentChips(compartment, chipsFor, () => {});
    area.addEventListener("change", refreshChips);
    this._submit = async () => {
      const data = [...rows.children].map((row) => {
        const v = (name) => {
          const node = row.querySelector(`[data-i="${name}"]`);
          return node ? node.value : "";
        };
        return { content: v("content"), quantity: v("quantity"), unit: v("unit"), date: v("date"), count: v("count"), product: row._product };
      });
      const items = buildItems(kind, data, vacuum ? vacuum.querySelector("input").checked : true);
      error.textContent = "";
      if (!items.length) {
        error.textContent = t.needContent;
        return;
      }
      if (items.length > MAX_ITEMS) {
        error.textContent = t.tooMany;
        return;
      }
      submit.disabled = true;
      try {
        const msg = { type: `${DOMAIN}/create_items`, kind, items };
        if (area.value) msg.area_id = area.value;
        if (compartment.value.trim()) {
          msg.compartment = compartment.value.trim();
          rememberCompartment(area.value, msg.compartment);
        }
        const res = await hass.callWS(msg);
        this._opts.itemArea = { ...(this._opts.itemArea || {}), [kind]: area.value };
        this._saveOptions();
        const created = ((res && res.items) || []).map((it, i) => ({ ...it, content: items[i] ? items[i].content : "" }));
        this._itemsCreated(kind, created);
        if (preset && preset.onCreated) preset.onCreated(created);
      } catch (err) {
        error.textContent = (err && err.message) || t.failed;
      } finally {
        submit.disabled = false;
      }
    };
    this._overlay.hidden = false;
    rows.querySelector('[data-i="content"]').focus();
  };

  /** Nach dem Anlegen: Beutel kennzeichnen (NFC-Sticker der Reihe nach oder Etiketten drucken). */
  proto._itemsCreated = function _itemsCreated(kind, created) {
    const t = itemTexts(this._hass);
    this.setView("containers");
    if (kind !== "bag") {
      this._closeDialog();
      this.showNotice(t.createdPack(created.length));
      return;
    }
    const ids = created.map((c) => c.device_id).filter(Boolean);
    const list = el("ul", "created");
    for (const c of created) list.append(el("li", "", `${c.name} · ${c.content}`));
    const actions = [];
    const nfc = button("", t.nfc, () => this.openNfcSeries(created)); // Beutel kennzeichnet jeder (Dosen nur Administratoren)
    nfc.dataset.role = "items-nfc";
    actions.push(nfc);
    const labels = button("", t.labels, () => this.openLabelDialog(ids));
    labels.dataset.role = "items-labels";
    actions.push(labels, button("submit", t.done, () => this._closeDialog()));
    this._form.replaceChildren(el("h2", "", t.createdBag(created.length)), el("p", "hint", t.createdHint), list, buttonsRow(...actions));
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** NFC-Sticker für mehrere Beutel nacheinander: beschreiben (App) oder einen beschriebenen scannen. */
  proto.openNfcSeries = function openNfcSeries(created) {
    const hass = this._hass;
    const t = itemTexts(hass);
    const classic = this._classic;
    const ext = hass.auth && hass.auth.external;
    const canWrite = !!(ext && typeof ext.fireMessage === "function" && ext.config && ext.config.canWriteTag);
    const items = created.filter((c) => c.device_id);
    let index = 0;
    let linked = 0;
    const finish = () => {
      classic.cancelCapture("series");
      this._nfcSeries = null;
      this._closeDialog();
      if (linked) this.showNotice(t.nfcDone(linked));
    };
    const show = (message = "") => {
      if (index >= items.length) {
        finish();
        return;
      }
      const item = items[index];
      const status = el("p", "hint", message || t.nfcScanHint);
      status.dataset.role = "nfc-status";
      status.setAttribute("role", "status");
      const advance = (text) => {
        linked += 1;
        index += 1;
        show(index < items.length ? text : "");
      };
      // schon beschriebenen Sticker scannen: verknüpfen und weiter
      classic.cancelCapture("series");
      classic.startCapture(
        async (tag) => {
          if (Object.values(classic._nfcLinks || {}).includes(tag)) {
            status.textContent = t.nfcInUse;
            return false;
          }
          try {
            await classic._linkTag({ tag_id: tag, device_id: item.device_id });
          } catch (err) {
            status.textContent = (err && err.message) || t.nfcFailed;
            return false;
          }
          advance(t.nfcLinked);
          return true;
        },
        "series",
        item.device_id,
      );
      const buttons = [button("cancel", t.done, finish), button("", t.skip, () => {
        index += 1;
        show();
      })];
      buttons[1].dataset.role = "nfc-skip";
      if (canWrite) {
        const write = button("submit", t.nfcWrite, async () => {
          const tagId = classic._newTagId();
          try {
            await classic._linkTag({ tag_id: tagId, device_id: item.device_id });
            await classic._writeNewTag(tagId, `${item.name} ${item.content}`.trim());
          } catch (err) {
            status.textContent = (err && err.message) || t.nfcFailed;
            return;
          }
          status.textContent = t.nfcHold;
          write.hidden = true;
          const next = button("submit", t.next, () => advance(""));
          next.dataset.role = "nfc-next";
          write.after(next);
        });
        write.dataset.role = "nfc-write";
        buttons.push(write);
      }
      const what = el("p", "nfcitem", `${item.name} · ${item.content}`);
      this._form.replaceChildren(el("h2", "", t.nfcTitle(index + 1, items.length)), what, status, buttonsRow(...buttons));
      this._submit = null;
      this._overlay.hidden = false;
    };
    this._nfcSeries = { finish };
    show();
  };

  /** Packung öffnen: leere Dose wählen, Inhalt und Nährwerte wandern hinein. */
  proto.openTransferDialog = function openTransferDialog(deviceId) {
    const hass = this._hass;
    const t = itemTexts(hass);
    const empties = this._rows().filter((r) => r.content === "" && r.kind === "container");
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    if (!empties.length) {
      this._form.replaceChildren(el("h2", "", t.transferTitle), el("p", "hint", t.transferNone), buttonsRow(button("cancel", t.cancel, () => this._closeDialog())));
      this._submit = null;
      this._overlay.hidden = false;
      return;
    }
    const target = el("select");
    target.dataset.f = "target";
    for (const r of empties) {
      const o = el("option", "", [r.name, r.areaName].filter(Boolean).join(" · "));
      o.value = r.id;
      target.append(o);
    }
    const submit = button("submit", t.transfer, null, "submit");
    this._form.replaceChildren(
      el("h2", "", t.transferTitle),
      field(t.transferInto, target),
      el("p", "hint", t.transferHint),
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    this._submit = async () => {
      submit.disabled = true;
      error.textContent = "";
      try {
        const res = await hass.callWS({ type: `${DOMAIN}/transfer`, device_id: deviceId, target: target.value });
        const row = empties.find((r) => r.id === target.value);
        this._closeDialog();
        if (!res || !res.left) this._closeDetail();
        this.showNotice(t.transferDone(row ? row.name : "", res ? res.left : 0));
      } catch (err) {
        error.textContent = (err && err.message) || t.transferFailed;
      } finally {
        submit.disabled = false;
      }
    };
    this._overlay.hidden = false;
  };
}
