"""Tests: Rezept aus Foto/PDF lesen (simulierter AI-Task-Dienst, echter HTTP-Upload)."""

from http import HTTPStatus
from pathlib import Path

import aiohttp
import pytest

from custom_components.larder.recipe_photo import URL, build_instructions, parse_recipe
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.exceptions import HomeAssistantError

from .test_recipes import _setup, auto_enable_custom_integrations  # noqa: F401

ANSWER = {
    "found": True,
    "title": "Omas Apfelkuchen",
    "minutes": 75,
    "servings": 12,
    "ingredients": ["500 g Äpfel", "200 g Mehl"],
    "steps": ["Teig kneten.", "Backen."],
}


def _fake_ai(hass: HomeAssistant, data=None, error: Exception | None = None) -> list[dict]:
    calls: list[dict] = []

    async def handler(call):
        record = dict(call.data)
        # Die Anhänge müssen während des Aufrufs auf der Platte liegen
        media = Path(hass.config.media_dirs["local"])
        record["files_present"] = [
            (media / a["media_content_id"].split("/local/", 1)[1]).exists() for a in call.data["attachments"]
        ]
        calls.append(record)
        if error:
            raise error
        return {"conversation_id": "x", "data": ANSWER if data is None else data}

    hass.services.async_register("ai_task", "generate_data", handler, supports_response=SupportsResponse.ONLY)
    return calls


@pytest.fixture
async def ready(hass: HomeAssistant, tmp_path):
    hass.config.media_dirs = {"local": str(tmp_path)}
    await _setup(hass, "AAAA")
    return tmp_path


def _form(*files, hint=None):
    form = aiohttp.FormData()
    for name, mime, content in files:
        form.add_field("file", content, filename=name, content_type=mime)
    if hint:
        form.add_field("hint", hint)
    return form


async def test_photo_is_read_sent_as_attachment_and_deleted(hass: HomeAssistant, hass_client, ready) -> None:
    calls = _fake_ai(hass)
    client = await hass_client()
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"\xff\xd8jpeg1"), ("b.jpg", "image/jpeg", b"\xff\xd8jpeg2"), hint="nur Seite 2 zählt"))
    assert resp.status == HTTPStatus.OK
    recipe = (await resp.json())["recipe"]
    assert recipe == {
        "title": "Omas Apfelkuchen",
        "minutes": 75,
        "ingredients": ["Servings: 12", "500 g Äpfel", "200 g Mehl"],
        "steps": ["Teig kneten.", "Backen."],
        "source": "photo",
    }
    (call,) = calls
    assert call["files_present"] == [True, True]
    assert [a["media_content_type"] for a in call["attachments"]] == ["image/jpeg", "image/jpeg"]
    assert all(a["media_content_id"].startswith("media-source://media_source/local/larder/recipe_photos/") for a in call["attachments"])
    assert "2 photos" in call["instructions"] and "nur Seite 2 zählt" in call["instructions"]
    assert list((ready / "larder" / "recipe_photos").iterdir()) == []  # aufgeräumt


async def test_pdf_is_accepted_other_types_are_not(hass: HomeAssistant, hass_client, ready) -> None:
    calls = _fake_ai(hass)
    client = await hass_client()
    resp = await client.post(URL, data=_form(("r.pdf", "application/pdf", b"%PDF-1.4")))
    assert resp.status == HTTPStatus.OK and calls[0]["attachments"][0]["media_content_id"].endswith(".pdf")
    resp = await client.post(URL, data=_form(("x.exe", "application/octet-stream", b"MZ")))
    assert resp.status == HTTPStatus.BAD_REQUEST
    resp = await client.post(URL, data=_form(*[(f"{i}.jpg", "image/jpeg", b"x") for i in range(5)]))
    assert resp.status == HTTPStatus.BAD_REQUEST
    resp = await client.post(URL, data=_form())
    assert resp.status == HTTPStatus.BAD_REQUEST
    assert len(calls) == 1


async def test_no_recipe_and_ai_errors_are_reported_and_files_are_cleaned_up(hass: HomeAssistant, hass_client, ready) -> None:
    client = await hass_client()
    _fake_ai(hass, data={"found": False})
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    assert resp.status == HTTPStatus.UNPROCESSABLE_ENTITY and (await resp.json())["error"] == "recipe_photo_none"

    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, error=HomeAssistantError("AI Task entity ai_task.x does not support attachments"))
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    assert (await resp.json())["error"] == "recipe_photo_unsupported"

    hass.services.async_remove("ai_task", "generate_data")
    _fake_ai(hass, error=HomeAssistantError("kein Guthaben"))
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    body = await resp.json()
    assert body["error"] == "recipe_photo_failed" and "kein Guthaben" in body["message"]
    assert list((ready / "larder" / "recipe_photos").iterdir()) == []

    hass.services.async_remove("ai_task", "generate_data")
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    assert (await resp.json())["error"] == "ai_unavailable"


async def test_only_admins_may_upload(hass: HomeAssistant, hass_client, hass_admin_user, ready) -> None:
    calls = _fake_ai(hass)
    hass_admin_user.groups = []  # kein Administrator mehr
    client = await hass_client()
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    assert resp.status == HTTPStatus.UNAUTHORIZED and calls == []


def test_parse_recipe_is_strict_about_empty_answers() -> None:
    with pytest.raises(HomeAssistantError):
        parse_recipe({"found": True, "title": "", "ingredients": ["x"]}, "de")
    with pytest.raises(HomeAssistantError):
        parse_recipe({"found": True, "title": "Nur Titel"}, "de")
    with pytest.raises(HomeAssistantError):
        parse_recipe("quatsch", "de")
    out = parse_recipe({"found": True, "title": "x" * 300, "minutes": 99999, "servings": 4, "steps": ["s" * 900]}, "de")
    assert len(out["title"]) == 120 and out["minutes"] is None
    assert out["ingredients"] == ["Portionen: 4"] and len(out["steps"][0]) == 300


def test_instructions() -> None:
    text = build_instructions("de", 1)
    assert "attached photo or document" in text and "'de'" in text and "not instructions" in text
