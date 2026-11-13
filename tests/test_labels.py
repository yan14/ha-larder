"""Tests: QR-Etikettenbogen als PDF (Erzeugung, Auswahl der Dosen, HTTP-Endpunkt)."""

import re

from custom_components.larder.const import DOMAIN, scan_app_url
from custom_components.larder.labels import Label, build_pdf, collect_labels
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .test_recipes import _fill, _setup, auto_enable_custom_integrations  # noqa: F401


def _pages(pdf: bytes) -> int:
    return int(re.search(rb"/Count (\d+)", pdf).group(1))


def test_pdf_pages_skip_and_text() -> None:
    labels = [Label(f"Dose {i}", scan_app_url(f"HA-{i:08d}")) for i in range(25)]
    pdf = build_pdf(labels, "3x8")
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert _pages(pdf) == 2  # 24 pro Bogen
    assert _pages(build_pdf(labels[:23], "3x8", skip=1)) == 1
    assert _pages(build_pdf(labels[:23], "3x8", skip=2)) == 2
    assert _pages(build_pdf(labels[:8], "2x4", skip=99)) == 2  # skip wird auf 7 begrenzt
    # Text in Helvetica (WinAnsi): Umlaute als ein Byte, Klammern maskiert, lange Inhalte gekürzt
    pdf = build_pdf([Label("Küche (1)", "x", "Sehr lange Bolognese-Sauce mit sehr viel Hackfleisch und Gemüse aus dem Garten", "24.12.2026")], language="de", show_content=True, show_best_before=True)
    assert b"K\xfcche \\(1\\)" in pdf
    assert b"MHD: 24.12.2026" in pdf
    assert b"\x85" in pdf  # … am Ende des gekürzten Inhalts (nach zwei Zeilen)
    # Inhalt und MHD getrennt wählbar
    jar = Label("Dose 1", "x", "Zucker", "01.12.2026")
    only_content = build_pdf([jar], language="de", show_content=True)
    assert b"(Zucker) Tj" in only_content and b"MHD" not in only_content
    only_date = build_pdf([jar], language="de", show_best_before=True)
    assert b"MHD: 01.12.2026" in only_date and b"(Zucker)" not in only_date


def test_options_designs_and_label_printer() -> None:
    label = Label("Dose 1", scan_app_url("HA-00000001"), "Gulasch", "01.12.2026")
    with_qr = build_pdf([label], "3x8")
    without_qr = build_pdf([label], "3x8", show_qr=False, show_name=False, show_content=True)
    assert with_qr.count(b" re\n") > 50  # QR-Module als Rechtecke
    assert b" re\n" not in without_qr and b"(Gulasch) Tj" in without_qr and b"(Dose 1)" not in without_qr
    # nichts gewählt: wenigstens der Name
    assert b"(Dose 1) Tj" in build_pdf([label], show_qr=False, show_name=False)
    for design in ("frame", "notched", "handwritten"):
        pdf = build_pdf([label], design=design)
        assert b" c " in pdf  # Rundungen
        assert b" rg" not in pdf and b" RG" not in pdf  # immer schwarz-weiß
    hand = build_pdf([label], design="vintage")  # alter Name
    assert b"/FontFile2" in hand and b"/BaseFont /Kalam-Bold" in hand and b"/F3 " in hand
    assert b"/FontFile2" not in build_pdf([label], design="frame")
    # Nährwertzeile, gleicher Name/Inhalt nur einmal
    both = build_pdf([Label("Zucker", "x", "Zucker", "", "372 kcal/100 g")], show_content=True, show_nutrition=True)
    assert both.count(b"(Zucker) Tj") == 1 and b"(372 kcal/100 g) Tj" in both
    # lange Namen werden umgebrochen statt abgeschnitten
    long = build_pdf([Label("Chocolate Chunks dark", "x")])
    assert b"(Chocolate) Tj" in long and b"(Chunks dark) Tj" in long
    # Etikettendrucker: eine Seite pro Etikett im Etikettenformat
    pdf = build_pdf([label, label], "62x29")
    assert _pages(pdf) == 2 and b"/MediaBox [0 0 175.75 82.20]" in pdf


async def test_collect_labels_and_http_view(hass: HomeAssistant, hass_client) -> None:
    await _setup(hass, "BBBB")
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Lachs", 2)
    labels = collect_labels(hass, None, with_content=False)
    assert [(label.name, label.qr, label.content) for label in labels] == [
        ("Dose AAAA", scan_app_url("AAAA"), ""),
        ("Dose BBBB", scan_app_url("BBBB"), ""),
    ]
    with_content = collect_labels(hass, ["aaaa"], with_content=True)
    assert len(with_content) == 1 and with_content[0].content == "Lachs" and with_content[0].best_before

    client = await hass_client()
    resp = await client.get("/api/larder/labels.pdf")
    assert resp.status == 200
    assert resp.headers["Content-Type"] == "application/pdf"
    assert _pages(await resp.read()) == 1

    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "BBBB")})
    resp = await client.get(f"/api/larder/labels.pdf?device={device.id}&layout=2x4&content=1&border=1&qr=0&design=handwritten&nutrition=1")
    body = await resp.read()
    assert resp.status == 200 and b"Dose BBBB" in body and b"Dose AAAA" not in body

    resp = await client.get("/api/larder/labels.pdf?device=unknown")
    assert resp.status == 404


async def test_view_needs_login(hass: HomeAssistant, hass_client_no_auth) -> None:
    await _setup(hass, "AAAA")
    client = await hass_client_no_auth()
    resp = await client.get("/api/larder/labels.pdf")
    assert resp.status == 401


async def test_signed_url_with_options_works_without_login(hass: HomeAssistant, hass_client_no_auth, hass_admin_user) -> None:
    from datetime import timedelta

    from homeassistant.components.http.auth import async_sign_path

    await _setup(hass, "AAAA")
    refresh = await hass.auth.async_create_refresh_token(hass_admin_user, "https://example.com/")
    path = async_sign_path(hass, "/api/larder/labels.pdf?layout=3x7&skip=2&border=1", timedelta(minutes=5), refresh_token_id=refresh.id)
    client = await hass_client_no_auth()
    resp = await client.get(path)
    assert resp.status == 200
    tampered = path.replace("skip=2", "skip=3")
    assert (await client.get(tampered)).status == 401


def test_nutrition_line() -> None:
    from custom_components.larder.labels import nutrition_line

    attrs = {"kcal_100g": 372, "kcal_portion": 149.5, "nutri_score": "A", "allergens": "Gluten, Milch"}
    assert nutrition_line(attrs, "de") == "149,5 kcal/Portion · 372 kcal/100 g · Nutri-Score A · Gluten, Milch"
    assert nutrition_line({"kcal_100g": 200}, "en") == "200 kcal/100 g"
    assert nutrition_line({}, "de") == ""
