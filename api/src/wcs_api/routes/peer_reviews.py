"""Peer-review flow.

A logged-in dancer requests a review → we mint a one-time opaque token
→ dancer shares the `/review/<token>` link however they like →
reviewer hits the public endpoints (no auth) to see the video and
submit a score → dancer sees aggregated reviews alongside the AI
result on their analysis page.

Tokens are stored in `peer_reviews.token`. Single-use: once
`submitted_at` is set the public GET returns a thank-you state
instead of the form.
"""

from __future__ import annotations

import secrets
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ..auth import verify_jwt
from ..services import peer_reviews as peer_reviews_service
from ..services import r2, supabase_admin

router = APIRouter(prefix="/peer-reviews", tags=["peer-reviews"])


# ─────────────────────────────────────────────────────────────────────
# Requester (authenticated) endpoints
# ─────────────────────────────────────────────────────────────────────

class RequestBody(BaseModel):
    analysis_id: str = Field(..., min_length=1, max_length=64)


@router.post("/request")
async def request_review(
    body: RequestBody,
    user: dict = Depends(verify_jwt),
) -> dict[str, str]:
    """Mint a new review token for one of the user's own analyses.

    Authorization: we re-read the analysis row via service role and
    verify `user_id == auth.uid` before minting. Dancers can't
    generate review tokens for someone else's analysis.
    """
    analysis = await supabase_admin.get_analysis_minimal(body.analysis_id)
    if not analysis or analysis.get("user_id") != user["sub"]:
        raise HTTPException(status_code=404, detail="analysis not found")

    # Opaque token ~= same style as share_token: 32 hex chars, enough
    # entropy that guessing one is infeasible.
    token = secrets.token_hex(16)
    try:
        await peer_reviews_service.insert_request(
            analysis_id=body.analysis_id,
            token=token,
            requester_user_id=user["sub"],
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"could not create review request: {exc.response.text[:200]}",
        )

    return {"token": token}


@router.get("/for-analysis/{analysis_id}")
async def list_for_analysis(
    analysis_id: str,
    user: dict = Depends(verify_jwt),
) -> dict[str, Any]:
    """Return all review requests + submitted reviews for an analysis
    the caller owns. Caller identity is checked via RLS on the select."""
    try:
        rows = await peer_reviews_service.list_for_analysis(
            user_id=user["sub"],
            analysis_id=analysis_id,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"could not read reviews: {exc.response.text[:200]}",
        )
    # Split into pending (no submitted_at) vs submitted for the UI.
    pending: list[dict[str, Any]] = []
    submitted: list[dict[str, Any]] = []
    for row in rows:
        (submitted if row.get("submitted_at") else pending).append(row)
    return {"pending": pending, "submitted": submitted}


@router.delete("/{review_id}")
async def delete_review(
    review_id: str,
    user: dict = Depends(verify_jwt),
) -> dict[str, str]:
    """Revoke a pending request or delete a submitted review.

    Only the owner can call this — enforced via the delete RLS policy
    on peer_reviews. Returns ok either way; a no-op when the row
    doesn't exist or belongs to someone else (RLS filters it out).
    """
    try:
        await peer_reviews_service.delete(review_id, user["sub"])
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"could not delete review: {exc.response.text[:200]}",
        )
    return {"ok": "true"}


# ─────────────────────────────────────────────────────────────────────
# Public (reviewer, unauthenticated) endpoints
# ─────────────────────────────────────────────────────────────────────

@router.get("/public/{token}")
async def get_public_review(token: str) -> dict[str, Any]:
    """Public view of a review request. Returns the minimum the reviewer
    needs to do their job: video URL + user-supplied context (role,
    level, event, dancer_description). Deliberately does NOT include
    the AI score — we don't want to prime the reviewer's judgment.
    """
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="invalid token")

    review = await peer_reviews_service.get_by_token(token)
    if not review:
        raise HTTPException(status_code=404, detail="review not found")

    analysis = await supabase_admin.get_analysis_minimal(
        review["analysis_id"], include_soft_deleted=False
    )
    if not analysis:
        # Analysis was deleted after the request was sent.
        raise HTTPException(status_code=410, detail="the linked analysis is no longer available")

    video_url: str | None = None
    object_key = analysis.get("object_key")
    if object_key:
        try:
            video_url = r2.generate_presigned_get(
                object_key, expires_in=3600
            )
        except Exception:  # noqa: BLE001
            video_url = None

    return {
        "token": token,
        "already_submitted": review.get("submitted_at") is not None,
        "video_url": video_url,
        "filename": analysis.get("filename"),
        "duration": analysis.get("duration"),
        "context": {
            "role": analysis.get("role"),
            "competition_level": analysis.get("competition_level"),
            "event_name": analysis.get("event_name"),
            "event_date": analysis.get("event_date"),
            "stage": analysis.get("stage"),
            "dancer_description": analysis.get("dancer_description"),
        },
    }


class SubmitBody(BaseModel):
    reviewer_name: str = Field(..., min_length=1, max_length=80)
    reviewer_role: str = Field(default="other", max_length=20)
    timing_score: float = Field(..., ge=0.0, le=10.0)
    technique_score: float = Field(..., ge=0.0, le=10.0)
    teamwork_score: float = Field(..., ge=0.0, le=10.0)
    presentation_score: float = Field(..., ge=0.0, le=10.0)
    overall_notes: str | None = Field(default=None, max_length=4000)
    per_moment_notes: list[dict[str, Any]] = Field(default_factory=list)
    # Opt-in to let SwingFlow use this review to improve the AI
    # scoring. Defaults to False — we never train on reviews where
    # the reviewer didn't actively check the box.
    training_consent: bool = Field(default=False)

    @field_validator("reviewer_role")
    @classmethod
    def _coerce_role(cls, v: str) -> str:
        ok = {"dancer", "instructor", "judge", "friend", "other"}
        v = (v or "other").strip().lower()
        return v if v in ok else "other"

    @field_validator("per_moment_notes")
    @classmethod
    def _cap_moment_notes(
        cls, v: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        # Keep the payload bounded — a runaway reviewer form can't
        # flood jsonb storage.
        cleaned: list[dict[str, Any]] = []
        for entry in v[:50]:
            if not isinstance(entry, dict):
                continue
            try:
                ts = float(entry.get("timestamp_sec"))
            except (TypeError, ValueError):
                continue
            note = str(entry.get("note") or "").strip()[:500]
            if not note:
                continue
            cleaned.append({"timestamp_sec": round(ts, 2), "note": note})
        return cleaned


@router.post("/public/{token}/submit")
async def submit_public_review(
    token: str, body: SubmitBody
) -> dict[str, str]:
    """Reviewer submits their scores. Token is consumed on first
    successful submit; subsequent calls fail with 409.
    """
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="invalid token")

    review = await peer_reviews_service.get_by_token(token)
    if not review:
        raise HTTPException(status_code=404, detail="review not found")
    if review.get("submitted_at"):
        raise HTTPException(status_code=409, detail="review already submitted")

    # Snapshot the AI result as it stands RIGHT NOW so the training
    # pair is frozen. Best-effort: if the analysis was deleted between
    # the public GET and this POST, we still accept the review — the
    # snapshot is useful for training but not load-bearing for the
    # submit itself.
    ai_result_snapshot: dict[str, Any] | None = None
    try:
        ai_result_snapshot = await supabase_admin.get_analysis_result(
            review["analysis_id"]
        )
    except httpx.HTTPStatusError:
        ai_result_snapshot = None

    try:
        await peer_reviews_service.submit(
            token=token,
            reviewer_name=body.reviewer_name.strip(),
            reviewer_role=body.reviewer_role,
            timing_score=body.timing_score,
            technique_score=body.technique_score,
            teamwork_score=body.teamwork_score,
            presentation_score=body.presentation_score,
            overall_notes=(body.overall_notes or "").strip() or None,
            per_moment_notes=body.per_moment_notes,
            training_consent=body.training_consent,
            ai_result_snapshot=ai_result_snapshot,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"could not submit review: {exc.response.text[:200]}",
        )
    return {"ok": "true"}
