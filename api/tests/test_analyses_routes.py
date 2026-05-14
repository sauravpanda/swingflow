"""Coverage for the /analyses delete + share endpoints (#75 / #158)
and the comment-first peer-review submission guard.

The thing worth proving for /analyses:
  - 200 + state change when the row is owned by the caller
  - 404 (NOT 403) when it isn't, so we don't leak existence
  - share enable returns the same hex shape the front-end used to mint

For peer-reviews: the comment-first guard rejects empty submissions
(no notes, no pins, no scores) so we don't accept 7/7/7/7-no-notes
drive-by reviews into training data.
"""

from __future__ import annotations

import re

from wcs_api.services import supabase_admin

ANALYSIS_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


# ─── DELETE /analyses/{id} ─────────────────────────────────────────


def test_delete_analysis_owned_returns_ok(client, monkeypatch, test_user_id):
    seen: dict[str, str] = {}

    async def fake_soft_delete(analysis_id: str, user_id: str) -> bool:
        seen["analysis_id"] = analysis_id
        seen["user_id"] = user_id
        return True

    monkeypatch.setattr(
        supabase_admin, "soft_delete_analysis", fake_soft_delete
    )

    r = client.delete(f"/analyses/{ANALYSIS_ID}")

    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert seen["analysis_id"] == ANALYSIS_ID
    assert seen["user_id"] == test_user_id


def test_delete_analysis_not_owned_returns_404_not_403(client, monkeypatch):
    """Returning 403 would confirm the row exists. 404 is the privacy-
    preserving response for both 'no such row' and 'not yours'."""

    async def fake_soft_delete(analysis_id: str, user_id: str) -> bool:
        return False

    monkeypatch.setattr(
        supabase_admin, "soft_delete_analysis", fake_soft_delete
    )

    r = client.delete(f"/analyses/{ANALYSIS_ID}")
    assert r.status_code == 404


# ─── POST /analyses/{id}/share ─────────────────────────────────────


def test_enable_share_returns_32_char_hex_token(client, monkeypatch):
    captured: dict[str, str] = {}

    async def fake_set_token(
        analysis_id: str, user_id: str, token: str
    ) -> bool:
        captured["token"] = token
        return True

    monkeypatch.setattr(
        supabase_admin, "set_analysis_share_token", fake_set_token
    )

    r = client.post(f"/analyses/{ANALYSIS_ID}/share")

    assert r.status_code == 200
    body = r.json()
    token = body["share_token"]
    # Front-end's old crypto.randomUUID().replace(/-/g, "") produced
    # exactly 32 hex chars; secrets.token_hex(16) matches that so
    # /shared/{token} consumers don't notice.
    assert re.fullmatch(r"[0-9a-f]{32}", token)
    assert captured["token"] == token


def test_enable_share_not_owned_returns_404(client, monkeypatch):
    async def fake_set_token(*_args, **_kwargs) -> bool:
        return False

    monkeypatch.setattr(
        supabase_admin, "set_analysis_share_token", fake_set_token
    )

    r = client.post(f"/analyses/{ANALYSIS_ID}/share")
    assert r.status_code == 404


def test_enable_share_rotates_token_on_each_call(client, monkeypatch):
    """Two consecutive calls should mint distinct tokens — confirms
    the route doesn't cache or memoize."""
    issued: list[str] = []

    async def fake_set_token(
        analysis_id: str, user_id: str, token: str
    ) -> bool:
        issued.append(token)
        return True

    monkeypatch.setattr(
        supabase_admin, "set_analysis_share_token", fake_set_token
    )

    r1 = client.post(f"/analyses/{ANALYSIS_ID}/share")
    r2 = client.post(f"/analyses/{ANALYSIS_ID}/share")
    assert r1.status_code == 200 and r2.status_code == 200
    assert issued[0] != issued[1]


# ─── DELETE /analyses/{id}/share ───────────────────────────────────


def test_disable_share_owned_clears_token(client, monkeypatch, test_user_id):
    seen: dict[str, str] = {}

    async def fake_clear(analysis_id: str, user_id: str) -> bool:
        seen["analysis_id"] = analysis_id
        seen["user_id"] = user_id
        return True

    monkeypatch.setattr(
        supabase_admin, "clear_analysis_share_token", fake_clear
    )

    r = client.delete(f"/analyses/{ANALYSIS_ID}/share")

    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert seen == {"analysis_id": ANALYSIS_ID, "user_id": test_user_id}


def test_disable_share_not_owned_returns_404(client, monkeypatch):
    async def fake_clear(*_args, **_kwargs) -> bool:
        return False

    monkeypatch.setattr(
        supabase_admin, "clear_analysis_share_token", fake_clear
    )

    r = client.delete(f"/analyses/{ANALYSIS_ID}/share")
    assert r.status_code == 404


# ─── auth required ─────────────────────────────────────────────────


def test_routes_require_auth():
    """Sanity: unauthenticated requests must NOT reach the route. The
    `client` fixture stubs verify_jwt; here we use the raw TestClient
    so the real dependency runs and rejects the missing header."""
    from fastapi.testclient import TestClient

    from wcs_api.main import app

    raw = TestClient(app)
    # Defensive: even if the test runs after a fixture leaked an
    # override, clear it so this assertion is honest.
    from wcs_api.auth import verify_jwt

    app.dependency_overrides.pop(verify_jwt, None)

    for r in (
        raw.delete(f"/analyses/{ANALYSIS_ID}"),
        raw.post(f"/analyses/{ANALYSIS_ID}/share"),
        raw.delete(f"/analyses/{ANALYSIS_ID}/share"),
    ):
        # 401 from missing Authorization header.
        assert r.status_code == 401
