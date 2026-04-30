"""Coverage for the supabase_admin helpers we've recently touched.

Today: the UUID shape-gate fix (PR #153). The eval CLI uses
get_analysis_eval_row with either a row UUID or a clip filename like
'IMG_9577'. PostgREST returns 400 if you filter a uuid column with a
non-UUID string, so we shape-check first and skip the id query for
non-UUIDs. Without that, the filename fallback never runs.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from wcs_api.services import supabase_admin


def _resp(status: int, json_body: Any = None) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        json=json_body if json_body is not None else [],
        request=httpx.Request("GET", "https://test"),
    )


class _FakeClient:
    """Minimal async-context-manager that matches the surface area of
    httpx.AsyncClient(...) used by supabase_admin: __aenter__ /
    __aexit__ + .get(). Records every call so we can assert on what
    PostgREST query was constructed."""

    def __init__(self, responses: list[httpx.Response]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def get(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)


# ─── get_analysis_eval_row UUID shape-gate (PR #153) ───────────────


async def test_eval_row_lookup_skips_id_query_for_non_uuid(monkeypatch):
    """Non-UUID ref ('IMG_9577') must NOT hit the id= endpoint —
    PostgREST would return 400 and r.raise_for_status() would shadow
    the filename fallback."""
    fake = _FakeClient([_resp(200, [{"id": "x", "filename": "IMG_9577"}])])

    def _factory(*_a, **_kw):
        return fake

    monkeypatch.setattr(httpx, "AsyncClient", _factory)

    row = await supabase_admin.get_analysis_eval_row("IMG_9577")
    assert row is not None
    assert row["filename"] == "IMG_9577"
    # Only one HTTP call — the filename one. The id= path was skipped.
    assert len(fake.calls) == 1
    params = fake.calls[0].get("params") or {}
    assert "filename" in params
    assert "id" not in params


async def test_eval_row_lookup_uses_id_query_for_uuid(monkeypatch):
    uuid_ref = "11111111-2222-3333-4444-555555555555"
    fake = _FakeClient([_resp(200, [{"id": uuid_ref, "filename": "x.mov"}])])

    def _factory(*_a, **_kw):
        return fake

    monkeypatch.setattr(httpx, "AsyncClient", _factory)

    row = await supabase_admin.get_analysis_eval_row(uuid_ref)
    assert row is not None
    # First call should be the id= query, not the filename fallback.
    params = fake.calls[0].get("params") or {}
    assert params.get("id") == f"eq.{uuid_ref}"


async def test_eval_row_lookup_falls_back_to_filename_when_uuid_id_misses(
    monkeypatch,
):
    """Valid UUID, but no row matches → fall through to the filename
    query. Today this only matters if a user's filename happens to be
    UUID-shaped, but the fallback is still the right behavior."""
    uuid_ref = "11111111-2222-3333-4444-555555555555"
    fake = _FakeClient(
        [
            _resp(200, []),  # id query — empty
            _resp(200, [{"id": "different", "filename": uuid_ref}]),
        ]
    )

    def _factory(*_a, **_kw):
        return fake

    monkeypatch.setattr(httpx, "AsyncClient", _factory)

    row = await supabase_admin.get_analysis_eval_row(uuid_ref)
    assert row is not None
    assert len(fake.calls) == 2
    assert fake.calls[1]["params"]["filename"] == f"eq.{uuid_ref}"


async def test_eval_row_lookup_returns_none_when_neither_query_matches(
    monkeypatch,
):
    fake = _FakeClient([_resp(200, []), _resp(200, [])])

    def _factory(*_a, **_kw):
        return fake

    monkeypatch.setattr(httpx, "AsyncClient", _factory)

    row = await supabase_admin.get_analysis_eval_row("does-not-exist")
    assert row is None
