"""Authenticated writes against `video_analyses`.

Closes #75 — the front-end used to hold the Supabase anon key and
mutate `deleted_at` / `share_token` directly from the browser. Those
writes are now scoped to the user via service-role queries on the
backend, which lets us tighten RLS to read-only for the browser
without breaking the delete + share flows.

Routes are kept narrow on purpose: only the two privacy-sensitive
columns the front-end actually needed to write. Anything else (level
edits, tag edits) still goes through the existing analyze pipeline
or future explicit endpoints — better to enumerate writes than to
ship a generic PATCH.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import verify_jwt
from ..services import supabase_admin

router = APIRouter(prefix="/analyses", tags=["analyses"])


class ShareTokenResponse(BaseModel):
    share_token: str


@router.delete("/{analysis_id}")
async def delete_analysis(
    analysis_id: str, user: dict = Depends(verify_jwt)
) -> dict:
    """Soft-delete one of the caller's analyses + revoke its share token.

    Returns 404 (not 403) when the row isn't owned by the caller so we
    don't leak existence to a probing client.
    """
    ok = await supabase_admin.soft_delete_analysis(
        analysis_id, user["sub"]
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="analysis not found",
        )
    return {"ok": True}


@router.post("/{analysis_id}/share", response_model=ShareTokenResponse)
async def enable_share(
    analysis_id: str, user: dict = Depends(verify_jwt)
) -> ShareTokenResponse:
    """Generate (or rotate) a share token for one of the caller's analyses.

    Token is a 128-bit URL-safe hex string; matches the front-end's
    prior `crypto.randomUUID().replace(/-/g, "")` shape so existing
    `/shared/{token}` consumers keep working.
    """
    token = secrets.token_hex(16)
    ok = await supabase_admin.set_analysis_share_token(
        analysis_id, user["sub"], token
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="analysis not found",
        )
    return ShareTokenResponse(share_token=token)


@router.delete("/{analysis_id}/share")
async def disable_share(
    analysis_id: str, user: dict = Depends(verify_jwt)
) -> dict:
    """Revoke share token. Idempotent — returns ok=true even if the
    row had no token to begin with."""
    ok = await supabase_admin.clear_analysis_share_token(
        analysis_id, user["sub"]
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="analysis not found",
        )
    return {"ok": True}
