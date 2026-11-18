/**
 * Larder dashboard (4.8): vouchers – add, show (value, valid until, place, code for administrators),
 * redeem all or part of it, mark expired.
 *
 * `installVouchers` attaches the methods to the dashboard class (like larder-dashboard-items.js).
 */

const TEXT = {
  de: {
    titleNew: "Gutschein hinzufügen",
    titleEdit: "Gutschein",
    name: "Laden oder Name",
    namePlaceholder: "z. B. Thalia",
    value: "Wert (€)",
    validUntil: "Gültig bis",
    area: "Bereich",
    noArea: "Kein Bereich",
    compartment: "Fach",
    compartmentHint: "z. B. Schublade",
    code: "Code (nur für Administratoren sichtbar)",
    codeHint: "optional",
    photo: "📷 Vom Foto lesen",
    photoBusy: "Die KI liest den Gutschein …",
    photoDone: "Übernommen – bitte prüfen.",
    photoFailed: "Der Gutschein konnte nicht gelesen werden.",
    save: "Speichern",
    create: "Hinzufügen",
    cancel: "Abbrechen",
    close: "Schließen",
    needName: "Bitte einen Namen eingeben.",
    failed: "Speichern fehlgeschlagen.",
    created: (name) => `Gutschein ${name} hinzugefügt.`,
    left: (value, initial) => (initial && initial > value ? `${money(value, true)} von ${money(initial, true)} übrig` : `Wert ${money(value, true)}`),
    noValue: "Ohne Wert",
    until: (date, days) => `Gültig bis ${date}${days === null ? "" : days < 0 ? " · abgelaufen" : days === 0 ? " · läuft heute ab" : ` · noch ${days} ${days === 1 ? "Tag" : "Tage"}`}`,
    noDate: "Ohne Ablaufdatum",
    place: "Liegt in",
    showCode: "Code anzeigen",
    redeem: "Einlösen",
    redeemAll: "Ganz eingelöst",
    redeemPart: "Teilweise einlösen",
    amount: "Eingelöster Betrag (€)",
    expired: "Verfallen",
    edit: "Bearbeiten",
    redeemed: (name, rest) => (rest ? `${name}: noch ${money(rest, true)} übrig.` : `${name}: eingelöst.`),
    lost: (name) => `${name}: als verfallen eingetragen.`,
    stats: (s) => `${s.count} ${s.count === 1 ? "Gutschein" : "Gutscheine"} · ${money(s.open_value, true)} offen`,
    statsLost: (v) => `Verfallen (12 Monate): ${money(v, true)}`,
    statsRedeemed: (v) => `eingelöst (12 Monate): ${money(v, true)}`,
  },
  en: {
    titleNew: "Add a voucher",
    titleEdit: "Voucher",
    name: "Shop or name",
    namePlaceholder: "e.g. Waterstones",
    value: "Value (€)",
    validUntil: "Valid until",
    area: "Area",
    noArea: "No area",
    compartment: "Compartment",
    compartmentHint: "e.g. drawer",
    code: "Code (visible to administrators only)",
    codeHint: "optional",
    photo: "📷 Read from a photo",
    photoBusy: "The AI is reading the voucher …",
    photoDone: "Filled in – please check.",
    photoFailed: "The voucher could not be read.",
    save: "Save",
    create: "Add",
    cancel: "Cancel",
    close: "Close",
    needName: "Please enter a name.",
    failed: "Saving failed.",
    created: (name) => `Voucher ${name} added.`,
    left: (value, initial) => (initial && initial > value ? `${money(value)} of ${money(initial)} left` : `Value ${money(value)}`),
    noValue: "No value",
    until: (date, days) => `Valid until ${date}${days === null ? "" : days < 0 ? " · expired" : days === 0 ? " · expires today" : ` · ${days} ${days === 1 ? "day" : "days"} left`}`,
    noDate: "No expiry date",
    place: "Kept in",
    showCode: "Show code",
    redeem: "Redeem",
    redeemAll: "Fully redeemed",
    redeemPart: "Redeem part",
    amount: "Amount redeemed (€)",
    expired: "Expired",
    edit: "Edit",
    redeemed: (name, rest) => (rest ? `${name}: ${money(rest)} left.` : `${name}: redeemed.`),
    lost: (name) => `${name}: recorded as expired.`,
    stats: (s) => `${s.count} ${s.count === 1 ? "voucher" : "vouchers"} · ${money(s.open_value)} open`,
    statsLost: (v) => `Expired (12 months): ${money(v)}`,
    statsRedeemed: (v) => `redeemed (12 months): ${money(v)}`,
  },
};

export function money(value, de = false) {
  const n = Number(value) || 0;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return de ? `${text.replace(".", ",")} €` : `€${text}`;
}

export function voucherTexts(hass) {
  return String((hass && hass.language) || "en").toLowerCase().startsWith("de") ? TEXT.de : TEXT.en;
}

function parseMoney(text) {
  const n = parseFloat(String(text || "").replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function installVouchers(Dashboard, { el, isAdmin, listAreas, DOMAIN, attachCompartmentChips, knownCompartments, rememberCompartment }) {
  const proto = Dashboard.prototype;
  const de = (hass) => String((hass && hass.language) || "en").toLowerCase().startsWith("de");
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
  const input = (type, f, value = "") => {
    const i = el("input");
    i.type = type;
    i.dataset.f = f;
    i.value = value;
    return i;
  };
  const buttonsRow = (...buttons) => {
    const row = el("div", "buttons");
    row.append(...buttons);
    return row;
  };
  const fmtDate = (hass, iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(String(hass.language || "en"), { day: "numeric", month: "short", year: "numeric" });
  };

  proto.loadVoucherStats = async function loadVoucherStats() {
    const hass = this._hass;
    if (!hass || !hass.callWS) return;
    try {
      this._voucherStats = await hass.callWS({ type: `${DOMAIN}/voucher_stats` });
    } catch {
      this._voucherStats = null;
    }
    this._sig = "";
    this._update();
  };

  /** Larder page, vouchers: open value and what expired in the last 12 months. */
  proto._voucherStatsBox = function _voucherStatsBox() {
    const s = this._voucherStats;
    if (!s || !s.count && !s.lost_value && !s.redeemed_value) return null;
    const t = voucherTexts(this._hass);
    const box = el("p", "note");
    box.dataset.role = "voucher-stats";
    const parts = [t.stats(s)];
    const year = [s.lost_value ? t.statsLost(s.lost_value) : null, s.redeemed_value ? t.statsRedeemed(s.redeemed_value) : null].filter(Boolean);
    if (year.length) parts.push(year.join(" · "));
    box.textContent = parts.join("\n");
    box.style.whiteSpace = "pre-line";
    return box;
  };

  /** Add a voucher, or edit one (`row` from the dashboard). */
  proto.openVoucherDialog = async function openVoucherDialog(row = null) {
    const hass = this._hass;
    const t = voucherTexts(hass);
    const states = hass.states || {};
    const attrs = row ? (states[row.dev.entities.text] || {}).attributes || {} : {};
    const name = input("text", "voucher-name", row ? row.content : "");
    name.maxLength = 255;
    name.placeholder = t.namePlaceholder;
    const value = input("text", "voucher-value", attrs.value !== undefined ? String(attrs.value).replace(".", de(hass) ? "," : ".") : "");
    value.inputMode = "decimal";
    const dateState = row ? states[row.dev.entities.date] : null;
    const until = input("date", "voucher-until", dateState && /^\d{4}-\d{2}-\d{2}$/.test(dateState.state) ? dateState.state : "");
    const area = el("select");
    area.dataset.f = "voucher-area";
    for (const a of [{ id: "", name: t.noArea }, ...listAreas(hass, this._classic.larderLabel, row ? row.areaId : null, "voucher")]) {
      const o = el("option", "", a.name);
      o.value = a.id;
      area.append(o);
    }
    const remembered = row ? row.areaId || "" : (this._opts.itemArea || {}).voucher || "";
    if ([...area.options].some((o) => o.value === remembered)) area.value = remembered;
    const compartment = input("text", "voucher-compartment", row ? row.compartment : "");
    compartment.maxLength = 60;
    compartment.placeholder = t.compartmentHint;
    const admin = isAdmin(hass);
    let code = null;
    if (admin) {
      code = input("text", "voucher-code", "");
      code.maxLength = 200;
      code.placeholder = t.codeHint;
      code.autocomplete = "off";
      if (row) {
        try {
          code.value = (await hass.callWS({ type: `${DOMAIN}/voucher_code`, device_id: row.id })).code || "";
        } catch {
          /* stays empty */
        }
      }
    }
    const error = el("div", "error");
    error.setAttribute("role", "alert");
    // 4.9: read shop, value, date and code from a photo (AI Task); the code comes back for administrators only
    const extras = [];
    if (!row && hass.services && hass.services.ai_task && hass.fetchWithAuth) {
      const file = el("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;
      file.dataset.role = "voucher-photo-file";
      const status = el("p", "hint");
      status.hidden = true;
      status.dataset.role = "voucher-photo-status";
      const photo = button("link", t.photo, () => file.click());
      photo.dataset.role = "voucher-photo";
      file.addEventListener("change", async () => {
        const picked = file.files && file.files[0];
        file.value = "";
        if (!picked) return;
        status.hidden = false;
        status.textContent = t.photoBusy;
        photo.disabled = true;
        try {
          const body = new FormData();
          body.append("file", picked, picked.name || "voucher.jpg");
          const res = await hass.fetchWithAuth(`/api/${DOMAIN}/voucher_photo`, { method: "POST", body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || t.photoFailed);
          if (data.shop) name.value = data.shop;
          if (data.value) value.value = String(data.value).replace(".", de(hass) ? "," : ".");
          if (data.valid_until) until.value = data.valid_until;
          if (code && data.code) code.value = data.code;
          status.textContent = t.photoDone;
        } catch (err) {
          status.textContent = (err && err.message) || t.photoFailed;
        } finally {
          photo.disabled = false;
        }
      });
      extras.push(photo, file, status);
    }
    const submit = button("submit", row ? t.save : t.create, null, "submit");
    this._form.replaceChildren(
      el("h2", "", row ? t.titleEdit : t.titleNew),
      ...extras,
      ...(row ? [] : [field(t.name, name)]),
      field(t.value, value),
      field(t.validUntil, until),
      ...(row ? [] : [field(t.area, area), field(t.compartment, compartment)]),
      ...(code ? [field(t.code, code)] : []),
      error,
      buttonsRow(button("cancel", t.cancel, () => this._closeDialog()), submit),
    );
    if (!row) {
      const refresh = attachCompartmentChips(compartment, () => knownCompartments(hass, this._classic._devices, area.value), () => {});
      area.addEventListener("change", refresh);
    }
    this._submit = async () => {
      error.textContent = "";
      const amount = parseMoney(value.value);
      submit.disabled = true;
      try {
        if (row) {
          const msg = { type: `${DOMAIN}/voucher_update`, device_id: row.id, valid_until: until.value || null };
          if (amount !== null) msg.value = amount;
          if (code) msg.code = code.value.trim();
          await hass.callWS(msg);
          this._closeDialog();
          this.loadVoucherStats();
          return;
        }
        const content = name.value.trim();
        if (!content) {
          error.textContent = t.needName;
          return;
        }
        const item = { content, quantity: 1, unit: "pieces" };
        if (until.value) item.best_before = until.value;
        if (amount) item.product = { value: amount, value_initial: amount };
        const msg = { type: `${DOMAIN}/create_items`, kind: "voucher", items: [item] };
        if (area.value) msg.area_id = area.value;
        if (compartment.value.trim()) {
          msg.compartment = compartment.value.trim();
          rememberCompartment(area.value, msg.compartment);
        }
        const res = await hass.callWS(msg);
        const created = (res && res.items && res.items[0]) || null;
        if (code && code.value.trim() && created && created.device_id) {
          await hass.callWS({ type: `${DOMAIN}/voucher_update`, device_id: created.device_id, code: code.value.trim() });
        }
        this._opts.itemArea = { ...(this._opts.itemArea || {}), voucher: area.value };
        this._saveOptions();
        this._closeDialog();
        this.setScope("voucher");
        this.setView("containers");
        this.showNotice(t.created(content));
        this.loadVoucherStats();
      } catch (err) {
        error.textContent = (err && err.message) || t.failed;
      } finally {
        submit.disabled = false;
      }
    };
    this._overlay.hidden = false;
    (row ? value : name).focus();
  };

  /** A voucher: value, valid until, place, code (administrators); redeem, expired, edit. */
  proto.openVoucher = function openVoucher(row) {
    const hass = this._hass;
    const t = voucherTexts(hass);
    const states = hass.states || {};
    const attrs = (states[row.dev.entities.text] || {}).attributes || {};
    const dateState = states[row.dev.entities.date];
    const iso = dateState && /^\d{4}-\d{2}-\d{2}$/.test(dateState.state) ? dateState.state : null;
    const value = Number(attrs.value) || 0;
    const info = el("div", "voucherinfo");
    info.append(
      el("p", "lead", value ? t.left(value, Number(attrs.value_initial) || 0) : t.noValue),
      el("p", "", iso ? t.until(fmtDate(hass, iso), row.days) : t.noDate),
    );
    const place = [row.areaName, row.compartment].filter(Boolean).join(" · ");
    if (place) info.append(el("p", "", `${t.place}: ${place}`));
    if (isAdmin(hass)) {
      const codeLine = el("p", "code");
      codeLine.dataset.role = "voucher-code";
      const show = button("link", t.showCode, async () => {
        try {
          const res = await hass.callWS({ type: `${DOMAIN}/voucher_code`, device_id: row.id });
          codeLine.textContent = res.code || "–";
        } catch {
          codeLine.textContent = "–";
        }
      });
      show.dataset.role = "voucher-show-code";
      codeLine.append(show);
      info.append(codeLine);
    }
    const done = (msg) => {
      this._closeDialog();
      this.showNotice(msg);
      this.loadVoucherStats();
    };
    const redeem = async (amount = null) => {
      const msg = { type: `${DOMAIN}/voucher_redeem`, device_id: row.id };
      if (amount !== null) msg.amount = amount;
      const res = await hass.callWS(msg);
      done(t.redeemed(row.content, res && !res.removed ? res.value : 0));
    };
    const all = button("primary", t.redeemAll, () => redeem());
    all.dataset.role = "voucher-redeem-all";
    const part = button("", t.redeemPart, () => {
      const amount = input("text", "voucher-amount", "");
      amount.inputMode = "decimal";
      const ok = button("primary", t.redeem, async () => {
        const n = parseMoney(amount.value);
        if (!n) return;
        await redeem(n);
      });
      ok.dataset.role = "voucher-redeem-part-ok";
      partBox.replaceChildren(field(t.amount, amount), ok);
      amount.focus();
    });
    part.dataset.role = "voucher-redeem-part";
    const partBox = el("div", "voucherpart");
    const expired = button("", t.expired, async () => {
      await hass.callWS({ type: `${DOMAIN}/voucher_redeem`, device_id: row.id, expired: true });
      done(t.lost(row.content));
    });
    expired.dataset.role = "voucher-expired";
    const edit = button("link", t.edit, () => this.openVoucherDialog(row));
    edit.dataset.role = "voucher-edit";
    const actions = el("div", "buttons");
    actions.append(...(value ? [part] : []), expired, all);
    this._form.replaceChildren(
      el("h2", "", `🎟️ ${row.content}`),
      info,
      partBox,
      actions,
      buttonsRow(edit, button("cancel", t.close, () => this._closeDialog())),
    );
    this._submit = null;
    this._overlay.hidden = false;
  };
}
