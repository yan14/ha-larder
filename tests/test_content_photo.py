"""Tests: Inhalt aus einem Foto erkennen (simulierter AI-Task-Dienst, echter HTTP-Upload)."""

from http import HTTPStatus

from custom_components.larder.content_photo import URL
from homeassistant.core import HomeAssistant

from .test_recipe_photo import _fake_ai, _form, ready  # noqa: F401
from .test_recipes import auto_enable_custom_integrations  # noqa: F401


async def test_content_from_photo(hass: HomeAssistant, hass_client, ready) -> None:  # noqa: F811
    calls = _fake_ai(hass, {"found": True, "content": "  Chili   con carne "})
    client = await hass_client()
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"\xff\xd8x")))
    assert resp.status == HTTPStatus.OK
    assert (await resp.json()) == {"content": "Chili con carne"}
    assert calls[0]["files_present"] == [True]
    assert not any(ready.rglob("*-content.jpg"))  # wieder gelöscht

    _fake_ai(hass, {"found": False})
    resp = await client.post(URL, data=_form(("a.jpg", "image/jpeg", b"x")))
    assert resp.status == HTTPStatus.UNPROCESSABLE_ENTITY
    assert (await resp.json())["error"] == "content_photo_none"

    resp = await client.post(URL, data=_form(("a.pdf", "application/pdf", b"%PDF")))
    assert resp.status == HTTPStatus.BAD_REQUEST
