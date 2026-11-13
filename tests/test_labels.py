"""Tests: QR-Etikettenbogen als PDF (Erzeugung, Auswahl der Dosen, HTTP-Endpunkt)."""

import re

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.larder.const import DOMAIN, scan_app_url
from custom_components.larder.labels import Label, build_pdf, collect_labels

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
    pdf = build_pdf([Label("Küche (1)", "x", "Sehr lange Bolognese-Sauce mit sehr viel Hackfleisch und Gemüse aus dem Garten", "24.12.2026")], language="de")
    assert b"K\xfcche \\(1\\)" in pdf
    assert b"MHD: 24.12.2026" in pdf
    assert b"\x85" in pdf  # … am Ende des gekürzten Inhalts


async def test_collect_labels_and_http_view(hass: HomeAssistant, hass_client) -> None:
    await _setup(hass, "BBBB")
    await _setup(hass, "AAAA")
    await _fill(hass, "AAAA", "Lachs", 2)
    labels = collect_labels(hass, None, with_content=False)
    assert [(l.name, l.qr, l.content) for l in labels] == [
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
    resp = await client.get(f"/api/larder/labels.pdf?device={device.id}&layout=2x4&content=1&border=1")
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
