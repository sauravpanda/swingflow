"""Supabase CRUD for peer_reviews via service role.

The reviewer endpoints are unauthenticated, so every write goes
through the service role. Reads from the requester side also go
through service role (rather than RLS) so we can consistently return
the same shape — the handler verifies requester ownership
explicitly against `user_id` before calling these.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

import httpx

from .supabase_admin import _headers, _rest


async def insert_request(
    *,
    analysis_id: str,
    token: str,
    requester_user_id: str,
) -> None:
    """Mint a new pending review request."""
    record: dict[str, Any] = {
        "analysis_id": analysis_id,
        "token": token,
        "requester_user_id": requester_user_id,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            _rest("peer_reviews"),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=record,
        )
        r.raise_for_status()


async def get_by_token(token: str) -> dict[str, Any] | None:
    """Look up a review by its opaque token. Returns None when the
    token doesn't exist."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(f"peer_reviews?token=eq.{token}&select=*"),
            headers=_headers(),
        )
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def submit(
    *,
    token: str,
    reviewer_name: str,
    reviewer_role: str,
    timing_score: float,
    technique_score: float,
    teamwork_score: float,
    presentation_score: float,
    overall_notes: str | None,
    per_moment_notes: list[dict[str, Any]],
    training_consent: bool,
    ai_result_snapshot: dict[str, Any] | None,
) -> None:
    """Patch the row identified by `token` with the reviewer's scores
    and mark submitted_at. Filters on `submitted_at.is.null` so a
    double-submit race lands with exactly one winner; the loser gets
    a no-op PATCH which the caller interprets via the 409 check it
    made before arriving here.

    Also freezes the AI result snapshot so future re-analyses don't
    desync the (human_score, ai_score) training pair, and stamps
    `consent_given_at` when the reviewer opted in to training use.
    """
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    update: dict[str, Any] = {
        "reviewer_name": reviewer_name[:80],
        "reviewer_role": reviewer_role,
        "timing_score": round(float(timing_score), 1),
        "technique_score": round(float(technique_score), 1),
        "teamwork_score": round(float(teamwork_score), 1),
        "presentation_score": round(float(presentation_score), 1),
        "overall_notes": overall_notes,
        "per_moment_notes": per_moment_notes,
        "training_consent": bool(training_consent),
        "consent_given_at": now if training_consent else None,
        "ai_result_snapshot": ai_result_snapshot,
        "submitted_at": now,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(
            _rest(
                f"peer_reviews?token=eq.{token}&submitted_at=is.null"
            ),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=update,
        )
        r.raise_for_status()


async def list_for_analysis(
    *,
    user_id: str,
    analysis_id: str,
) -> list[dict[str, Any]]:
    """Return all review requests for an analysis owned by `user_id`.
    The handler re-checks ownership via get_analysis_minimal before
    calling this — but we belt-and-suspenders by filtering on
    `requester_user_id` here too, so a bug up the stack can't leak
    someone else's rows.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(
                f"peer_reviews?analysis_id=eq.{analysis_id}"
                f"&requester_user_id=eq.{user_id}"
                "&select=id,token,requested_at,reviewer_name,reviewer_role,"
                "timing_score,technique_score,teamwork_score,presentation_score,"
                "overall_notes,per_moment_notes,submitted_at"
                "&order=requested_at.desc"
            ),
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


async def delete(review_id: str, user_id: str) -> None:
    """Delete a review request. Scoped to the requester so a caller
    with the wrong `review_id` can't delete someone else's row even
    if RLS would have allowed it."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(
            _rest(
                f"peer_reviews?id=eq.{review_id}"
                f"&requester_user_id=eq.{user_id}"
            ),
            headers={**_headers(), "Prefer": "return=minimal"},
        )
        r.raise_for_status()
