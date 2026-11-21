/**
 * Larder dashboard: bags (disposable, with NFC sticker or QR code) and packs (stock without a container).
 *
 * A module of its own so larder-dashboard.js does not grow further. `installItems` attaches the dialogs as
 * methods to the dashboard class: choice "Add what?", creating bags/packs, writing NFC stickers one after
 * another and "Transfer pack into a container".
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
    kindHousehold: "Haushaltsartikel",
    kindHouseholdHint: "Ohne Haltbarkeit, z. B. Klopapier, Waschmittel, Batterien",
    titleHousehold: "Haushaltsartikel anlegen",
    kindVoucher: "Gutschein",
    kindVoucherHint: "Mit Wert und Ablaufdatum – damit keiner verfällt",
    kindMedicine: "Medikament",
    kindMedicineHint: "Mit Verfallsdatum, z. B. Ibuprofen, Nasenspray, Pflaster",
    titleMedicine: "Medikamente anlegen",
    expiry: "Verfallsdatum",
    expiryOptional: "Ablaufdatum (optional)",
    createdMedicine: (n) => (n === 1 ? "1 Medikament angelegt." : `${n} Medikamente angelegt.`),
    shopList: "Einkaufsliste",
    shopListDefault: "Standardliste",
    packSize: "Stück je Packung",
    piece: "Einheit, z. B. Rollen",
    createdHousehold: (n) => (n === 1 ? "1 Haushaltsartikel angelegt." : `${n} Haushaltsartikel angelegt.`),
    stockPacks: (packs) => `${packs} ${packs === "1" ? "Packung" : "Packungen"}`,
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
    stockTitle: "Bestand",
    usageLasts: (weeks, takes, months) => `reicht noch ca. ${weeks} · aus ${takes} Entnahmen in ${months}`,
    suggestMin: (n) => `Vorschlag: mindestens ${n}`,
    priceEach: (p, est) => `${est ? "ca. " : ""}${p} € je Packung${est ? " (Open Prices)" : ""}`,
    priceHistory: "Preisverlauf",
    valueOf: (v) => `Wert ca. ${v} €`,
    stockValue: (v, n) => `Vorrat im Wert von ca. ${v} € (${n} Produkte mit Preis)`,
    price: "€",
    againTitle: "💡 Mal wieder …?",
    againItem: (n) => `${n}× in den letzten 90 Tagen gegessen, gerade nicht da`,
    againShop: "🛒 Einkaufsliste",
    againShopped: (c) => `${c} steht auf der Einkaufsliste.`,
    againDismiss: "Nicht jetzt",
    lowTitle: "⏳ Bald leer",
    lowItem: (n, days) => `noch ${n}, reicht ca. ${days} ${days === 1 ? "Tag" : "Tage"}`,
    lowShopped: (c) => `${c} steht auf der Einkaufsliste.`,
    lowDismiss: "Eine Woche ausblenden",
    recallTitle: "⚠️ Rückrufwarnung",
    recallIn: (list) => `Im Vorrat: ${list}`,
    recallVia: { barcode: "Strichcode", brand: "Marke und Name", name: "Name" },
    recallMatched: (via) => `Übereinstimmung: ${via} – bitte Packung prüfen`,
    recallOpen: "Zur Warnung",
    recallRead: "Gelesen",
    reportTitle: (label) => `📅 ${label}`,
    codeTitle: "Strichcode",
    openedMark: "🔓 angebrochen",
    codeScan: "📷 Strichcode",
    codeOldest: (place) => `Ältestes zuerst: ${place}`,
    codeNone: (name) => `${name || "Dieses Produkt"} ist nicht im Vorrat.`,
    codeAdd: "Als Packung anlegen",
    codeLink: "🔗 Mit Produkt im Vorrat verknüpfen",
    codeLinkTitle: "Strichcode zuordnen",
    codeLinkHint: (code) => `Zu welchem Produkt im Vorrat gehört ${code}? Larder merkt sich den Strichcode, der nächste Scan findet es.`,
    codeLinkNone: "Im Vorrat ist gerade kein Produkt.",
    codeLinkSave: "Verknüpfen",
    codeLinkFailed: "Verknüpfen fehlgeschlagen.",
    codeLinked: (name) => `Strichcode mit ${name} verknüpft.`,
    codeUnknown: (code) => `Zu ${code} wurde nichts gefunden.`,
    replaceTitle: "🔁 Bald wechseln",
    replaceWhen: (days, date) => (days < 0 ? `überfällig seit ${date}` : days === 0 ? "heute fällig" : `fällig am ${date}`),
    replaced: "Gewechselt",
    replacedDone: (name) => `${name}: gewechselt, ein Stück entnommen.`,
    putAway: "Einräumen",
    putAwayHint: "Gekaufte Produkte nacheinander scannen: bekannte kommen als Packung an ihren gewohnten Ort, unbekannte legst du am Ende gesammelt an.",
    putAwayScan: "Scannen",
    putAwayCode: "Strichcode eingeben",
    putAwayAddCode: "Einräumen",
    putAwayAdded: "Eingeräumt",
    putAwayNow: (n) => `jetzt ${n}`,
    putAwayDate: "Preis/MHD",
    putAwayPrice: "Preis",
    putAwayTicked: "✓ abgehakt",
    codeAdded: (place) => `Eine Packung mehr in ${place}. Preis und MHD gleich eintragen:`,
    boughtAdded: (name, place) => `${name} → ${place}`,
    putAwayUnknown: (n) => (n === 1 ? "1 unbekanntes Produkt" : `${n} unbekannte Produkte`),
    putAwayAddPacks: (n) => (n === 1 ? "Als Packung anlegen" : `${n} als Packungen anlegen`),
    putAwayAddHousehold: (n) => (n === 1 ? "Als Haushaltsartikel anlegen" : `${n} als Haushaltsartikel anlegen`),
    putAwayEmpty: "Noch nichts gescannt.",
    putAwayDoneOne: (name, place) => `${name} → ${place}`,
    putAwayUnknownOne: (name) => `${name}: unbekannt, am Ende anlegen`,
    codeUsed: "Verbraucht",
    codeUsedPiece: "−1 Stück",
    codeThrown: "Entsorgen",
    codeOpen: "Anbrechen",
    codeMove: "Umbuchen",
    codeNewPack: "Neue Packung hinzufügen",
    codeUsedDone: (place) => `Eine Packung aus ${place} verbraucht.`,
    codeUsedPieceDone: (place) => `Ein Stück aus ${place} entnommen.`,
    codeThrownDone: (place) => `Eine Packung aus ${place} entsorgt.`,
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
    receiptJoined: (n) => (n === 1 ? "1 bekanntes Produkt an seinen üblichen Ort gelegt." : `${n} bekannte Produkte an ihren üblichen Ort gelegt.`),
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
    kindHousehold: "Household item",
    kindHouseholdHint: "No best-before date, e.g. toilet paper, detergent, batteries",
    titleHousehold: "Add household items",
    kindVoucher: "Voucher",
    kindVoucherHint: "With value and expiry date – so none expires unused",
    kindMedicine: "Medicine",
    kindMedicineHint: "With an expiry date, e.g. ibuprofen, nasal spray, plasters",
    titleMedicine: "Add medicines",
    expiry: "Expiry date",
    expiryOptional: "Expiry date (optional)",
    createdMedicine: (n) => (n === 1 ? "1 medicine added." : `${n} medicines added.`),
    shopList: "Shopping list",
    shopListDefault: "Default list",
    packSize: "Pieces per pack",
    piece: "Unit, e.g. rolls",
    createdHousehold: (n) => (n === 1 ? "1 household item added." : `${n} household items added.`),
    stockPacks: (packs) => `${packs} ${packs === "1" ? "pack" : "packs"}`,
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
    usageLasts: (weeks, takes, months) => `lasts about ${weeks} · from ${takes} takes in ${months}`,
    suggestMin: (n) => `Suggested: at least ${n}`,
    priceEach: (p, est) => `${est ? "approx. " : ""}€${p} per pack${est ? " (Open Prices)" : ""}`,
    priceHistory: "Price history",
    valueOf: (v) => `value approx. €${v}`,
    stockValue: (v, n) => `Stock worth approx. €${v} (${n} products with a price)`,
    price: "€",
    againTitle: "💡 Time for … again?",
    againItem: (n) => `eaten ${n}× in the last 90 days, none left`,
    againShop: "🛒 Shopping list",
    againShopped: (c) => `${c} is on the shopping list.`,
    againDismiss: "Not now",
    lowTitle: "⏳ Running low",
    lowItem: (n, days) => `${n} left, lasts about ${days} ${days === 1 ? "day" : "days"}`,
    lowShopped: (c) => `${c} is on the shopping list.`,
    lowDismiss: "Hide for a week",
    recallTitle: "⚠️ Recall warning",
    recallIn: (list) => `In stock: ${list}`,
    recallVia: { barcode: "barcode", brand: "brand and name", name: "name" },
    recallMatched: (via) => `Matched by ${via} – please check the pack`,
    recallOpen: "Open warning",
    recallRead: "Read",
    reportTitle: (label) => `📅 ${label}`,
    codeTitle: "Barcode",
    openedMark: "🔓 opened",
    codeScan: "📷 Barcode",
    codeOldest: (place) => `Oldest first: ${place}`,
    codeNone: (name) => `${name || "This product"} is not in stock.`,
    codeAdd: "Add as a pack",
    codeLink: "🔗 Link to a product in stock",
    codeLinkTitle: "Assign barcode",
    codeLinkHint: (code) => `Which product in stock does ${code} belong to? Larder remembers the barcode, the next scan finds it.`,
    codeLinkNone: "There is no product in stock right now.",
    codeLinkSave: "Link",
    codeLinkFailed: "Linking failed.",
    codeLinked: (name) => `Barcode linked to ${name}.`,
    codeUnknown: (code) => `Nothing found for ${code}.`,
    replaceTitle: "🔁 Replace soon",
    replaceWhen: (days, date) => (days < 0 ? `overdue since ${date}` : days === 0 ? "due today" : `due ${date}`),
    replaced: "Replaced",
    replacedDone: (name) => `${name}: replaced, one piece taken.`,
    putAway: "Put away",
    putAwayHint: "Scan the bought products one after another: known ones go to their usual place as a pack, unknown ones you add together at the end.",
    putAwayScan: "Scan",
    putAwayCode: "Enter barcode",
    putAwayAddCode: "Put away",
    putAwayAdded: "Put away",
    putAwayNow: (n) => `now ${n}`,
    putAwayDate: "Price/date",
    putAwayPrice: "Price",
    putAwayTicked: "✓ ticked off",
    codeAdded: (place) => `One pack more in ${place}. Add price and date right away:`,
    boughtAdded: (name, place) => `${name} → ${place}`,
    putAwayUnknown: (n) => (n === 1 ? "1 unknown product" : `${n} unknown products`),
    putAwayAddPacks: (n) => (n === 1 ? "Add as a pack" : `Add ${n} as packs`),
    putAwayAddHousehold: (n) => (n === 1 ? "Add as a household item" : `Add ${n} as household items`),
    putAwayEmpty: "Nothing scanned yet.",
    putAwayDoneOne: (name, place) => `${name} → ${place}`,
    putAwayUnknownOne: (name) => `${name}: unknown, add it at the end`,
    codeUsed: "Used up",
    codeUsedPiece: "−1 piece",
    codeThrown: "Thrown away",
    codeOpen: "Open",
    codeMove: "Move",
    codeNewPack: "Add a new pack",
    codeUsedDone: (place) => `One pack from ${place} used up.`,
    codeUsedPieceDone: (place) => `Took one piece from ${place}.`,
    codeThrownDone: (place) => `One pack from ${place} thrown away.`,
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
    receiptJoined: (n) => (n === 1 ? "1 known product put at its usual place." : `${n} known products put at their usual place.`),
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

/** Duration in words: "3 Tage", "2 Wochen", "4 Monate" (or English). */
export function spanText(days, de, dative = false) {
  const d = Math.max(0, Math.round(days));
  if (d < 14) return de ? `${d} ${d === 1 ? "Tag" : dative ? "Tagen" : "Tage"}` : `${d} day${d === 1 ? "" : "s"}`;
  if (d < 60) {
    const w = Math.round(d / 7);
    return de ? `${w} Wochen` : `${w} weeks`;
  }
  const m = Math.round(d / 30);
  if (!de) return `${m} month${m === 1 ? "" : "s"}`;
  return `${m} ${m === 1 ? "Monat" : dative ? "Monaten" : "Monate"}`;
}

/** Amount with two decimals, in German with a comma. */
export function money(value, de) {
  const text = Number(value).toFixed(2);
  return de ? text.replace(".", ",") : text;
}

export function itemTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

/** Convert the rows of the dialog into the entries for `larder/create_items` (one bag per "count"). */
export function buildItems(kind, rows, vacuum = true) {
  const items = [];
  for (const row of rows) {
    const content = (row.content || "").trim();
    if (!content) continue;
    const item = { content };
    const quantity = parseInt(row.quantity, 10);
    if (kind === "household") {
      // household items are counted in pieces: packs × pieces per pack
      const size = Math.max(1, parseInt(row.packSize, 10) || 1);
      item.quantity = Math.max(1, quantity || 1) * size;
      item.unit = "pieces";
      const piece = (row.piece || "").trim();
      const product = { ...(row.product || {}) };
      if (size > 1) product.pack_size = size;
      if (piece) product.piece = piece;
      if (Object.keys(product).length) item.product = product;
    } else if (quantity > 0) {
      item.quantity = quantity;
      if (UNITS.includes(row.unit)) item.unit = row.unit;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) item.best_before = row.date; // household items: optional
    if (kind !== "household" && row.product) item.product = row.product;
    const price = parseFloat(String(row.price || "").replace(",", "."));
    if (price > 0) item.product = { ...(item.product || {}), price: Math.round(price * 100) / 100, price_source: row.priceSource || "own" };
    if (kind === "bag") item.vacuum = !!vacuum;
    if (row.receipt && kind === "pack") item.receipt = true; // 4.11.1: known products go to their usual place
    if (item.receipt && row.household) item.household = true; // 5.0: new ones become household items
    const copies = kind === "bag" ? Math.max(1, parseInt(row.count, 10) || 1) : 1;
    for (let i = 0; i < copies; i++) items.push({ ...item });
  }
  return items;
}

export function installItems(Dashboard, { el, isAdmin, listAreas, todoLists, scopeOfKind, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment }) {
  const proto = Dashboard.prototype;

  const fmtDate = (hass, iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? `${d}.${m}.${y}` : iso;
  };
  const placeName = (p, t) => [p.area, p.compartment].filter(Boolean).join(" · ") || t.noArea;

  /** Take a bought pack by barcode: shows all places, the one with the earliest date first. */
  proto.takeByCode = async function takeByCode(code, content = null) {
    const hass = this._hass;
    const t = itemTexts(hass);
    let res;
    try {
      // 5.0 (search): by the product name instead of a barcode
      res = await hass.callWS(content ? { type: `${DOMAIN}/stock_code`, content } : { type: `${DOMAIN}/stock_code`, code });
    } catch {
      res = null;
    }
    const form = this._form;
    const close = button("cancel", t.cancel, () => this._closeDialog());
    if (!res || !res.entries || !res.entries.length) {
      const parts = [el("h2", "", (res && res.name) || t.codeTitle)];
      const digits = String((res && res.code) || code).replace(/\D/g, "");
      const link = digits.length >= 8 ? button("", t.codeLink, () => this._linkCode(digits)) : null;
      if (link) link.dataset.role = "code-link";
      if (res && res.name) {
        parts.push(el("p", "hint", t.codeNone(res.name)));
        const add = button("submit", t.codeAdd, () =>
          this.openItemsDialog(res.product_type && res.product_type !== "food" ? "household" : "pack", {
            rows: [{ content: res.name, quantity: 1, product: res.product }],
          }),
        );
        add.dataset.role = "code-add";
        parts.push(buttonsRow(...[close, link, add].filter(Boolean)));
      } else {
        parts.push(el("p", "hint", t.codeUnknown((res && res.code) || code)), buttonsRow(...[close, link].filter(Boolean)));
      }
      form.replaceChildren(...parts);
      this._submit = null;
      this._overlay.hidden = false;
      return res;
    }
    // found: every place (opened and oldest first), each with what can be done with one pack there
    const list = el("div", "codelist");
    res.entries.forEach((entry, i) => {
      const hh = entry.kind === "household";
      const nonFood = hh || entry.kind === "medicine";
      const row = el("div", `coderow${i === 0 ? " oldest" : ""}`);
      const text = el("span", "text");
      text.append(
        el("span", "name", `${placeName(entry, t)}: ${entry.count}`),
        el("span", "sub", [entry.opened ? t.openedMark : null, entry.best_before ? t.codeDate(fmtDate(hass, entry.best_before)) : nonFood ? null : t.noDate].filter(Boolean).join(" · ")),
      );
      const take = (outcome, done) => async (ev) => {
        ev.currentTarget.disabled = true;
        await this._takeOne(entry, outcome);
        this._closeDialog();
        this.showNotice(done(placeName(entry, t)));
        if (this._view === "stock") this.loadStock();
      };
      const used = button(i === 0 ? "primary" : "", hh ? t.codeUsedPiece : t.codeUsed, take("eaten", hh ? t.codeUsedPieceDone : t.codeUsedDone));
      used.dataset.role = "code-take";
      const thrown = button("", t.codeThrown, take("thrown", t.codeThrownDone));
      thrown.dataset.role = "code-thrown";
      const actions = el("div", "codeactions");
      actions.append(used, thrown);
      if (!entry.opened) {
        const open = button("", t.codeOpen, () => this.openOpenDialog(entry.device_id));
        open.dataset.role = "code-open";
        actions.append(open);
      }
      const move = button("", t.codeMove, () => this.openMoveDialog(entry.device_id));
      move.dataset.role = "code-move";
      actions.append(move);
      row.append(text, actions);
      list.append(row);
    });
    const known = res.known;
    // the price goes into the price field (editable), the rest of the product data stays with the row
    const { price: knownPrice, ...knownProduct } = (known && known.product) || {};
    const newPackDialog = () =>
      this.openItemsDialog(known && ["household", "medicine"].includes(known.kind) ? known.kind : "pack", {
        rows: [{ content: (known && known.content) || res.name, quantity: 1, product: knownProduct, price: knownPrice }],
        area_id: known && known.area_id,
        compartment: known && known.compartment,
      });
    // 5.0 (#120): one pack more joins the pack at the usual place (like put away), then price and date
    const another = button("link", `＋ ${t.codeNewPack}`, async () => {
      if (!known || !(res.code || content)) {
        newPackDialog();
        return;
      }
      let added;
      try {
        added = await hass.callWS(res.code ? { type: `${DOMAIN}/put_away`, code: res.code } : { type: `${DOMAIN}/put_away`, content: known.content });
      } catch {
        added = null;
      }
      if (!added || added.status !== "added") {
        newPackDialog();
        return;
      }
      this._codeAdded(added);
    });
    another.dataset.role = "code-new";
    const parts = [el("h2", "", res.name), el("p", "lead", t.codeOldest(placeName(res.entries[0], t))), list, another];
    parts.push(buttonsRow(close));
    form.replaceChildren(...parts);
    this._submit = null;
    this._overlay.hidden = false;
    return res;
  };

  /** Barcode dialog: one pack more was put at its usual place – price and date right away, or move it. */
  proto._codeAdded = function _codeAdded(added) {
    const t = itemTexts(this._hass);
    const row = el("div", "putrow");
    const sub = el("span", "sub", `${placeName(added, t)} · ${t.putAwayNow(added.count)}`);
    const text = el("span", "text");
    text.append(el("span", "name", `${added.content} +1`), sub);
    row.append(text);
    const done = { ...added };
    const ok = button("submit", t.done, () => this._closeDialog());
    ok.dataset.role = "code-added-done";
    const move = button("", t.codeMove, () => this.openMoveDialog(done.device_id));
    move.dataset.role = "code-added-move";
    this._form.replaceChildren(el("h2", "", added.content), el("p", "lead", t.codeAdded(placeName(added, t))), row, buttonsRow(move, ok));
    this._shopDetails(done, row, () => {
      sub.textContent = [placeName(added, t), t.putAwayNow(added.count), done.details].filter(Boolean).join(" · ");
    });
    this._submit = null;
    this._overlay.hidden = false;
    if (this._view === "stock") this.loadStock();
  };

  /** Assign a barcode to a product in the stock (pack without EAN, e.g. created under another name). */
  proto._linkCode = async function _linkCode(code) {
    const hass = this._hass;
    const t = itemTexts(hass);
    let products = [];
    try {
      products = (((await hass.callWS({ type: `${DOMAIN}/stock` })) || {}).products || []).filter((p) => p.count > 0);
    } catch {
      products = [];
    }
    const select = el("select");
    select.dataset.f = "code-product";
    for (const p of products) {
      const o = el("option", "", [p.name, p.brand].filter(Boolean).join(" · "));
      o.value = p.name;
      select.append(o);
    }
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    const save = button("submit", t.codeLinkSave, async () => {
      if (!select.value) return;
      try {
        await hass.callWS({ type: `${DOMAIN}/stock_code_link`, code, content: select.value });
      } catch {
        error.textContent = t.codeLinkFailed;
        return;
      }
      this.showNotice(t.codeLinked(select.value));
      this.takeByCode(code);
    });
    save.dataset.role = "code-link-save";
    save.disabled = !products.length;
    this._form.replaceChildren(
      el("h2", "", t.codeLinkTitle),
      el("p", "hint", products.length ? t.codeLinkHint(code) : t.codeLinkNone),
      select,
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), save),
    );
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** Take one pack: count −1, the last one empties the entry (as eaten). */
  proto._takeOne = async function _takeOne(entry, outcome = "eaten") {
    const hass = this._hass;
    try {
      // one pack used up or thrown away; thrown away gets its own history entry (statistics, value)
      await hass.callWS({ type: `${DOMAIN}/pack_take`, device_id: entry.device_id, outcome });
      return;
    } catch {
      /* fall back to setting the count directly */
    }
    const row = this._rows().find((r) => r.id === entry.device_id);
    if (entry.count > 1 && row && row.dev.entities.number) {
      await hass.callService("number", "set_value", { entity_id: row.dev.entities.number, value: entry.count - 1 });
      return;
    }
    try {
      await hass.callWS({ type: `${DOMAIN}/empty`, device_id: entry.device_id, outcome });
    } catch {
      if (row && row.dev.entities.button) await hass.callService("button", "press", { entity_id: row.dev.entities.button });
    }
  };

  /**
   * Unknown products, collected while putting away, shopping or scanning (5.0, #121): one button for food packs
   * and one for household items, by the product type from the product databases (beauty, product → household).
   */
  proto._unknownButtons = function _unknownButtons(unknown, role, onOpen = null, foodLabel = null) {
    const t = itemTexts(this._hass);
    const isHousehold = (u) => u.kind === "household" || (u.product_type && u.product_type !== "food");
    const food = unknown.filter((u) => !isHousehold(u));
    const household = unknown.filter(isHousehold);
    const rows = (items) =>
      items.map((u) => ({
        content: u.name || u.content || "",
        quantity: 1,
        product: { ...(u.product || {}), ...(u.code && String(u.code).length >= 8 ? { ean: u.code } : {}) },
      }));
    const out = [];
    if (food.length) {
      const add = button("primary", (foodLabel || t.putAwayAddPacks)(food.length), () => {
        if (onOpen) onOpen();
        this.openItemsDialog("pack", { rows: rows(food) });
      });
      add.dataset.role = role;
      out.push(add);
    }
    if (household.length) {
      const add = button("primary", t.putAwayAddHousehold(household.length), () => {
        if (onOpen) onOpen();
        this.openItemsDialog("household", { rows: rows(household) });
      });
      add.dataset.role = `${role}-household`;
      out.push(add);
    }
    return out;
  };

  proto.putAwayTitle = function putAwayTitle() {
    return itemTexts(this._hass).putAway;
  };

  /**
   * Put away after shopping (#96): scan one product after another. Known products become one more pack at
   * their usual place right away; unknown ones are collected and added together at the end.
   */
  proto.openPutAway = function openPutAway() {
    const hass = this._hass;
    const t = itemTexts(hass);
    const state = { done: [], unknown: [], scanning: false };
    this._putAway = state;
    const form = this._form;
    const list = el("div", "putaway");
    const status = el("p", "hint");
    status.dataset.role = "putaway-status";
    const code = el("input");
    code.type = "text";
    code.inputMode = "numeric";
    code.dataset.f = "putaway-code";
    code.placeholder = t.putAwayCode;
    code.setAttribute("aria-label", t.putAwayCode);
    const placeOf = (r) => [r.area, r.compartment].filter(Boolean).join(" · ") || t.noArea;

    const render = () => {
      const parts = [];
      if (state.done.length) {
        parts.push(el("h3", "", t.putAwayAdded));
        for (const r of state.done) {
          const row = el("div", "putrow");
          row.dataset.id = r.device_id;
          const text = el("span", "text");
          text.append(
            el("span", "name", `${r.content} +${r.times}`),
            el("span", "sub", [placeOf(r), t.putAwayNow(r.count), r.ticked && r.ticked.length ? t.putAwayTicked : null, r.details].filter(Boolean).join(" · ")),
          );
          row.append(text);
          // 5.0 (#120): price and best-before date right here, like in the shopping mode
          if (!r.details) {
            const details = button("link", r.kind === "household" ? t.putAwayPrice : t.putAwayDate, () => {
              details.remove();
              this._shopDetails(r, row, render);
            });
            details.dataset.role = "putaway-details";
            row.append(details);
          }
          parts.push(row);
        }
      }
      if (state.unknown.length) {
        parts.push(el("h3", "", t.putAwayUnknown(state.unknown.length)));
        for (const u of state.unknown) parts.push(el("div", "putrow unknown", u.name || u.code));
        parts.push(...this._unknownButtons(state.unknown, "putaway-new"));
      }
      if (!parts.length) parts.push(el("p", "hint", t.putAwayEmpty));
      list.replaceChildren(...parts);
    };

    const handle = async (raw) => {
      const value = String(raw || "").trim();
      if (!value) return "";
      let res;
      try {
        res = await hass.callWS({ type: `${DOMAIN}/put_away`, code: value });
      } catch (err) {
        status.textContent = (err && err.message) || t.failed;
        return status.textContent;
      }
      let message;
      if (res.status === "added") {
        const known = state.done.find((r) => r.device_id === res.device_id);
        if (known) Object.assign(known, res, { times: known.times + 1, new_entry: known.new_entry || res.new_entry, details: "" });
        else state.done.unshift({ ...res, times: 1 });
        message = t.putAwayDoneOne(res.content, placeOf(res));
      } else {
        const digits = res.code || value;
        if (!state.unknown.some((u) => u.code === digits)) state.unknown.push({ ...res, code: digits });
        message = t.putAwayUnknownOne(res.name || digits);
      }
      status.textContent = message;
      render();
      if (this._view === "stock") this.loadStock();
      return message;
    };

    const add = button("", t.putAwayAddCode, async () => {
      await handle(code.value);
      code.value = "";
      code.focus();
    });
    add.dataset.role = "putaway-add";
    code.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        add.click();
      }
    });
    const manual = el("div", "putcode");
    manual.append(code, add);
    const parts = [el("h2", "", t.putAway), el("p", "hint", t.putAwayHint), manual];
    const canScan = this._classic._hasBarcodeScanner && this._classic._hasBarcodeScanner();
    if (canScan) {
      const scan = button("primary", `📷 ${t.putAwayScan}`, () => {
        state.scanning = this._classic.scanBarcodeSeries(handle, () => (state.scanning = false));
      });
      scan.dataset.role = "putaway-scan";
      parts.splice(2, 0, scan);
    }
    const done = button("submit", t.done, () => {
      this._closeDialog();
      if (state.done.length) this.loadBought(); // bought items of these products are taken care of
    });
    done.dataset.role = "putaway-done";
    form.replaceChildren(...parts, status, list, buttonsRow(done));
    this._submit = null;
    render();
    this._overlay.hidden = false;
    // in the app the scanner opens right away
    if (canScan) state.scanning = this._classic.scanBarcodeSeries(handle, () => (state.scanning = false));
    return handle;
  };

  /** Open the app's barcode scanner and take the scanned goods. */
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

  /** Start page: offer ticked-off items from the shopping list that Larder set as a pack. */
  proto._boughtBox = function _boughtBox(only = null) {
    const items = (this._bought || []).filter((item) => !only || only(item));
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
      const dialog = (kind = item.kind) =>
        this.openItemsDialog(["household", "medicine"].includes(kind) ? kind : "pack", {
          rows: [{ content: item.content, quantity: item.count || 1, product: item.product || null }],
          area_id: item.area_id,
          compartment: item.compartment,
          onCreated: () => dismiss(item),
        });
      // 5.0 (#120): a known product goes straight to its usual place; the dialog only for new ones
      const add = button("primary", t.boughtAdd, async () => {
        add.disabled = true;
        let res;
        try {
          res = await hass.callWS({ type: `${DOMAIN}/bought_add`, item_id: item.id });
        } catch {
          res = null;
        }
        add.disabled = false;
        if (!res || res.status !== "added") {
          dialog(res && res.kind);
          return;
        }
        this._bought = res.items || this._bought.filter((b) => b.id !== item.id);
        this.showNotice(t.boughtAdded(res.content, placeName(res, t)));
        this._sig = "";
        this._update();
      });
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

  proto.loadCookAgain = async function loadCookAgain() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._again = await hass.callWS({ type: `${DOMAIN}/cook_again` });
    } catch {
      this._again = null;
    }
    this._sig = "";
    this._update();
  };

  /** Start page: eaten often, not there right now → onto the shopping list or hide for 30 days. */
  proto._againBox = function _againBox() {
    const data = this._again;
    if (!data || !data.items || !data.items.length) return null;
    const hass = this._hass;
    const t = itemTexts(hass);
    const box = el("section", "stat again");
    box.append(el("h3", "", t.againTitle));
    for (const item of data.items) {
      const row = el("div", "boughtrow");
      const text = el("span", "name");
      text.append(el("span", "", item.content), el("span", "sub", t.againItem(item.count)));
      row.append(text);
      const act = async (action) => {
        try {
          const res = await hass.callWS({ type: `${DOMAIN}/cook_again_action`, content: item.content, action });
          this._again = { ...this._again, items: res.items || [] };
          if (action === "shop") this.showNotice(t.againShopped(item.content));
        } catch {
          /* stays as it is */
        }
        this._sig = "";
        this._update();
      };
      if (data.shopping_list) {
        const shop = button("primary", t.againShop, () => act("shop"));
        shop.dataset.role = "again-shop";
        row.append(shop);
      }
      const drop = button("", "✕", () => act("dismiss"));
      drop.dataset.role = "again-dismiss";
      drop.setAttribute("aria-label", t.againDismiss);
      drop.title = t.againDismiss;
      row.append(drop);
      box.append(row);
    }
    return box;
  };

  proto.loadRunningLow = async function loadRunningLow() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._low = await hass.callWS({ type: `${DOMAIN}/running_low` });
    } catch {
      this._low = null;
    }
    this._sig = "";
    this._update();
  };

  /** Start page: products with a minimum stock that will run out soon according to the forecast. */
  proto.loadReplaceDue = async function loadReplaceDue() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._replaceDue = ((await hass.callWS({ type: `${DOMAIN}/replace_due` })) || {}).items || [];
    } catch {
      this._replaceDue = [];
    }
    this._sig = "";
    this._update();
  };

  /** Start page (household): consumables to replace within a week (water filter, vacuum bags …). */
  proto._replaceBox = function _replaceBox() {
    const items = this._replaceDue || [];
    if (!items.length) return null;
    const hass = this._hass;
    const t = itemTexts(hass);
    const box = el("section", "stat replace");
    box.dataset.role = "replace-due";
    box.append(el("h3", "", t.replaceTitle));
    for (const item of items) {
      const row = el("div", "boughtrow");
      const text = el("span", "name");
      text.append(el("span", "", item.name), el("span", "sub", t.replaceWhen(item.days, fmtDate(hass, item.due))));
      const done = button("primary", t.replaced, async () => {
        done.disabled = true;
        try {
          const res = await hass.callWS({ type: `${DOMAIN}/replaced`, content: item.name });
          this._replaceDue = res.due || [];
          this.showNotice(t.replacedDone(item.name));
        } catch {
          done.disabled = false;
        }
        this._sig = "";
        this._update();
      });
      done.dataset.role = "replace-done";
      row.append(text, done);
      box.append(row);
    }
    return box;
  };

  proto._lowBox = function _lowBox(only = null) {
    const data = this._low && { ...this._low, items: (this._low.items || []).filter((item) => !only || only(item)) };
    if (!data || !data.items || !data.items.length) return null;
    const hass = this._hass;
    const t = itemTexts(hass);
    const box = el("section", "stat low");
    box.append(el("h3", "", t.lowTitle));
    for (const item of data.items) {
      const row = el("div", "boughtrow");
      row.dataset.key = item.key;
      const text = el("span", "name");
      text.append(el("span", "", item.name), el("span", "sub", t.lowItem(item.count, item.lasts_days)));
      row.append(text);
      const act = async (action) => {
        try {
          const res = await hass.callWS({ type: `${DOMAIN}/running_low_action`, content: item.name, action });
          this._low = { ...this._low, items: res.items || [] };
          if (action === "shop") this.showNotice(t.lowShopped(item.name));
        } catch {
          /* stays as it is */
        }
        this._sig = "";
        this._update();
      };
      if (data.shopping_list) {
        const shop = button("primary", t.againShop, () => act("shop"));
        shop.dataset.role = "low-shop";
        row.append(shop);
      }
      const drop = button("", "✕", () => act("dismiss"));
      drop.dataset.role = "low-dismiss";
      drop.setAttribute("aria-label", t.lowDismiss);
      drop.title = t.lowDismiss;
      row.append(drop);
      box.append(row);
    }
    return box;
  };

  proto.loadRecalls = async function loadRecalls() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._recalls = ((await hass.callWS({ type: `${DOMAIN}/recalls` })) || {}).items || [];
    } catch {
      this._recalls = [];
    }
    this._sig = "";
    this._update();
  };

  /** Start page: recall warnings with matches in the stock, until "Read". */
  proto._recallBox = function _recallBox() {
    const items = this._recalls || [];
    if (!items.length) return null;
    const hass = this._hass;
    const t = itemTexts(hass);
    const de = String(hass.language || "en").toLowerCase().startsWith("de");
    const box = el("section", "stat recall");
    box.setAttribute("role", "alert");
    box.append(el("h3", "", t.recallTitle));
    for (const w of items) {
      const card = el("div", "recallitem");
      card.dataset.id = w.id;
      const date = w.date ? (de ? w.date.split("-").reverse().join(".") : w.date) : "";
      card.append(el("div", "title", w.title));
      if (w.reason) card.append(el("div", "sub", w.reason));
      const places = w.items.map((i) => [i.content, [i.area, i.compartment].filter(Boolean).join(" · ")].filter(Boolean).join(" – "));
      card.append(el("div", "sub in", t.recallIn([...new Set(places)].join("; "))));
      const via = [...new Set(w.items.map((i) => t.recallVia[i.via] || i.via))].join(", ");
      card.append(el("div", "sub via", `${t.recallMatched(via)}${date ? ` · ${date}` : ""}`));
      const actions = el("div", "actions");
      const open = el("a", "link", t.recallOpen);
      open.href = w.link;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.dataset.role = "recall-open";
      const read = button("primary", t.recallRead, async () => {
        try {
          this._recalls = ((await hass.callWS({ type: `${DOMAIN}/recall_read`, recall_id: w.id })) || {}).items || [];
        } catch {
          this._recalls = this._recalls.filter((r) => r.id !== w.id);
        }
        this._sig = "";
        this._update();
      });
      read.dataset.role = "recall-read";
      actions.append(open, read);
      card.append(actions);
      box.append(card);
    }
    return box;
  };

  proto.loadReport = async function loadReport() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      const res = await hass.callWS({ type: "call_service", domain: DOMAIN, service: "get_monthly_report", service_data: {}, return_response: true });
      this._report = (res && res.response) || null;
    } catch {
      this._report = null;
    }
    this._sig = "";
    this._update();
  };

  /** Statistics: report of the previous month (as the blueprint "Monthly report" sends it). */
  proto._reportBox = function _reportBox() {
    const r = this._report;
    if (!r || r.empty || !r.label) return null;
    const t = itemTexts(this._hass);
    const box = el("section", "stat report");
    box.append(el("h3", "", t.reportTitle(r.label)));
    for (const line of String(r.summary || "").split("\n")) box.append(el("p", "line", line));
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

  /** Stock view: all products with stock, places and minimum stock (editable directly). */
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
      const putAway = button("", `📥 ${t.putAway}`, () => this.openPutAway());
      putAway.dataset.role = "stock-putaway";
      bar.append(el("span", "grow"), putAway, scan);
      frag.append(bar);
    }
    frag.prepend(this._scopeSwitch());
    const products = data.products.filter((p) => scopeOfKind(p.kind) === this._opts.scope);
    const valued = products.filter((p) => p.value);
    const value = Math.round(valued.reduce((sum, p) => sum + p.value, 0) * 100) / 100;
    frag.append(el("p", "note", t.stockIntro));
    if (value) {
      const de = String(hass.language || "").toLowerCase().startsWith("de");
      const total = el("p", "note", t.stockValue(money(value, de), valued.length));
      total.dataset.role = "stock-value";
      frag.append(total);
    }
    if (!data.shopping_list && products.some((p) => p.min > 0)) frag.append(el("p", "note warn", t.stockNoList));
    if (!products.length) frag.append(el("p", "note", t.stockEmpty));
    const list = el("div", "stocklist");
    for (const p of products) {
      const hh = p.kind === "household";
      const packs = String(p.packs ?? "").replace(".", String(hass.language || "").toLowerCase().startsWith("de") ? "," : ".");
      const item = el("section", `stockitem${p.low ? " low" : ""}`);
      item.dataset.key = p.key;
      const head = el("div", "stockhead");
      head.append(el("span", "name", p.name), el("span", "count", hh && p.piece ? `${p.count} ${p.piece}` : String(p.count)));
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
      const de = String(hass.language || "").toLowerCase().startsWith("de");
      const own = p.list && (hass.states || {})[p.list];
      const listName = own ? `🛒 ${(own.attributes && own.attributes.friendly_name) || p.list}` : null;
      const sub = [hh && p.pack_size > 1 ? t.stockPacks(packs) : null, p.brand, p.package, listName, p.earliest ? t.stockEarliest(fmtDate(hass, p.earliest)) : null].filter(Boolean).join(" · ");
      if (sub) item.append(el("div", "sub", sub));
      if (p.usage) {
        const line = el("div", "usage", t.usageLasts(spanText(p.usage.lasts_days, de), p.usage.takes, spanText(p.usage.days, de, true)));
        line.dataset.role = "stock-usage";
        item.append(line);
      }
      if (p.suggested_min && p.suggested_min !== p.min) {
        const suggest = button("link", t.suggestMin(p.suggested_min), async () => {
          min.value = String(p.suggested_min);
          min.dispatchEvent(new Event("change"));
        });
        suggest.dataset.role = "stock-suggest";
        item.append(suggest);
      }
      if (p.price) {
        const parts = [t.priceEach(money(p.price.price, de), p.price.source === "openprices")];
        if (p.value) parts.push(t.valueOf(money(p.value, de)));
        item.append(el("div", "sub price", parts.join(" · ")));
      }
      if (p.price_history && p.price_history.length > 1) {
        // 4.11: own prices over time, e.g. 1,79 € → 1,99 € → 2,49 €
        const line = el("div", "sub pricehistory", `${t.priceHistory}: ${p.price_history.map((h) => money(h.price, de)).join(" → ")}`);
        line.dataset.role = "stock-price-history";
        item.append(line);
      }
      const places = el("div", "places");
      for (const place of p.places) {
        const date = (place.best_before ? ` · ${fmtDate(hass, place.best_before)}` : "") + (place.opened ? " · 🔓" : "");
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

  /** Move or split a pack (a part to another place). */
  proto.openMoveDialog = function openMoveDialog(deviceId, onDone = null) {
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
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel, row.areaId, scopeOfKind(row.kind))]) {
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
        if (onDone) onDone();
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

  /** "＋": container (administrators only), bag, pack or household item. */
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
      choice("add-household", "🧻", t.kindHousehold, t.kindHouseholdHint, () => this.openItemsDialog("household")),
      choice("add-medicine", "💊", t.kindMedicine, t.kindMedicineHint, () => this.openItemsDialog("medicine")),
      choice("add-voucher", "🎟️", t.kindVoucher, t.kindVoucherHint, () => this.openVoucherDialog()),
    );
    this._form.replaceChildren(el("h2", "", t.addTitle), choices, buttonsRow(button("cancel", t.cancel, () => this._closeDialog())));
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** Create bags, packs or household items: several rows, one content per row. */
  proto.openItemsDialog = function openItemsDialog(kind, preset = null) {
    const hass = this._hass;
    const t = itemTexts(hass);
    const form = this._form;
    const bag = kind === "bag";
    const hh = kind === "household";
    const med = kind === "medicine";

    const area = el("select");
    area.dataset.f = "area";
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel, null, scopeOfKind(kind))]) {
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

    // own shopping list for these products (remembered per product; empty = the default list)
    let shopList = null;
    const lists = todoLists ? todoLists(hass) : [];
    if (lists.length > 1) {
      shopList = el("select");
      shopList.dataset.f = "shopping_list";
      for (const l of [{ id: "", name: t.shopListDefault }, ...lists]) {
        const o = el("option", "", l.name);
        o.value = l.id;
        shopList.append(o);
      }
    }

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
      const dateText = bag ? t.bestBeforeBag : med ? t.expiry : hh ? t.expiryOptional : t.bestBefore;
      const date = input("date", "date", dateText);
      date.title = dateText;
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
      const dateLabel = el("label", "datelabel", dateText);
      dateLabel.append(date);
      if (hh) {
        // packs × pieces per pack, e.g. 2 × 8 "Rollen"; no unit and no best-before date
        const product = values.product || {};
        const size = input("packSize", "number", t.packSize);
        size.min = "1";
        size.max = "999";
        size.inputMode = "numeric";
        size.title = t.packSize;
        size.value = product.pack_size > 1 ? String(product.pack_size) : "";
        const piece = input("piece", "text", t.piece);
        piece.maxLength = 30;
        piece.title = t.piece;
        piece.value = product.piece || "";
        quantity.title = t.packs;
        const times = el("label", "times", "×");
        times.prepend(quantity);
        second.append(times, size, piece);
      } else {
        second.append(quantity, unit);
      }
      if (!bag) {
        const price = input("price", "text", t.price);
        price.inputMode = "decimal";
        price.className = "price";
        price.title = t.price;
        if (values.price) {
          price.value = money(values.price, String(hass.language || "").startsWith("de"));
          price.dataset.source = values.priceSource || "own";
        }
        price.addEventListener("input", () => delete price.dataset.source);
        second.append(price);
      }
      second.append(dateLabel);
      const remove = button("remove", "✕", () => {
        if (rows.children.length > 1) row.remove();
        else content.value = "";
      });
      remove.setAttribute("aria-label", t.remove);
      const first = el("div", "itemmain");
      first.append(content, remove);
      row.append(first, second);
      // scanned product data (EAN, brand, nutrition) stays even if the name is changed:
      // this way a later scan of the same barcode finds the pack again
      row._product = values.product || null;
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
    if (!bag && !hh && !med && this._canGenerate() && hass.fetchWithAuth) {
      // take a photo of the receipt: the AI suggests products with their count
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
            const priceInput = row.querySelector('[data-i="price"]');
            if (priceInput && item.price) {
              priceInput.value = money(item.price, String(hass.language || "").startsWith("de"));
              priceInput.dataset.source = "receipt";
            }
            row._product = null;
            row._receipt = true;
            // 5.0 (#121): household goods from the receipt become household items (if new)
            row._household = !!item.household;
            row.classList.toggle("household", row._household);
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
      el("h2", "", bag ? t.titleBag : hh ? t.titleHousehold : med ? t.titleMedicine : t.titlePack),
      field(t.area, area),
      field(t.compartment, compartment),
      ...(shopList ? [field(t.shopList, shopList)] : []),
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
        const priceNode = row.querySelector('[data-i="price"]');
        return {
          content: v("content"), quantity: v("quantity"), unit: v("unit"), date: v("date"), count: v("count"), product: row._product,
          packSize: v("packSize"), piece: v("piece"),
          price: v("price"), priceSource: priceNode && priceNode.dataset.source, receipt: !!row._receipt, household: !!row._household,
        };
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
        // rows read from a receipt: known products go to their usual place and join a pack there (4.11.1)
        const fromReceipt = items.filter((i) => i.receipt).map(({ receipt, ...rest }) => rest);
        const typed = items.filter((i) => !i.receipt);
        const place = {};
        if (area.value) place.area_id = area.value;
        if (compartment.value.trim()) {
          place.compartment = compartment.value.trim();
          rememberCompartment(area.value, place.compartment);
        }
        let res = { items: [] };
        let joined = 0;
        if (fromReceipt.length) {
          const rec = await hass.callWS({ type: `${DOMAIN}/receipt_add`, items: fromReceipt, ...place });
          joined = (rec.added || []).length;
          res.items.push(...(rec.created || []));
        }
        if (typed.length) {
          const msg = { type: `${DOMAIN}/create_items`, kind, items: typed, ...place };
          if (shopList && shopList.value) msg.shopping_list = shopList.value;
          const created = await hass.callWS(msg);
          res.items.push(...((created && created.items) || []));
        }
        this._opts.itemArea = { ...(this._opts.itemArea || {}), [kind]: area.value };
        this._saveOptions();
        const contents = fromReceipt.length ? [] : items.map((i) => i.content);
        const created = ((res && res.items) || []).map((it, i) => ({ ...it, content: contents[i] || "" }));
        if (created.length) this._itemsCreated(kind, created);
        else {
          this.setScope(scopeOfKind(kind));
          this.setView("containers");
          this._closeDialog();
        }
        if (joined) this.showNotice(created.length ? `${t.receiptJoined(joined)} ${t.createdPack(created.length)}` : t.receiptJoined(joined));
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

  /** After creating: label the bags (NFC stickers one after another or print labels). */
  proto._itemsCreated = function _itemsCreated(kind, created) {
    const t = itemTexts(this._hass);
    this.setScope(scopeOfKind(kind));
    this.setView("containers");
    if (kind !== "bag") {
      this._closeDialog();
      this.showNotice(kind === "household" ? t.createdHousehold(created.length) : kind === "medicine" ? t.createdMedicine(created.length) : t.createdPack(created.length));
      return;
    }
    const ids = created.map((c) => c.device_id).filter(Boolean);
    const list = el("ul", "created");
    for (const c of created) list.append(el("li", "", `${c.name} · ${c.content}`));
    const actions = [];
    const nfc = button("", t.nfc, () => this.openNfcSeries(created)); // anyone labels bags (containers only administrators)
    nfc.dataset.role = "items-nfc";
    actions.push(nfc);
    const labels = button("", t.labels, () => this.openLabelDialog(ids));
    labels.dataset.role = "items-labels";
    actions.push(labels, button("submit", t.done, () => this._closeDialog()));
    this._form.replaceChildren(el("h2", "", t.createdBag(created.length)), el("p", "hint", t.createdHint), list, buttonsRow(...actions));
    this._submit = null;
    this._overlay.hidden = false;
  };

  /** NFC stickers for several bags one after another: write (app) or scan a written one. */
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
      // scan a sticker that is already written: link and go on
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

  /** Open a pack: choose an empty container, content and nutrition move into it. */
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
