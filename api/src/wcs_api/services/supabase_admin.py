"""Thin async wrapper around Supabase's PostgREST REST API.

Uses the service-role key, which bypasses RLS — only call this from
trusted server-side code (webhooks, quota enforcement, etc.).
"""

from __future__ import annotations

from typing import Any

import httpx

from ..settings import settings


def _headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _rest(path: str) -> str:
    return f"{settings.supabase_url}/rest/v1/{path}"


async def get_profile(user_id: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(f"profiles?id=eq.{user_id}&select=*"),
            headers=_headers(),
        )
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def update_profile(user_id: str, fields: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(
            _rest(f"profiles?id=eq.{user_id}"),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=fields,
        )
        r.raise_for_status()


async def insert_video_analysis(
    user_id: str,
    filename: str | None,
    duration: float | None,
    result: dict[str, Any],
    object_key: str | None = None,
    role: str | None = None,
    competition_level: str | None = None,
    event_name: str | None = None,
    event_date: str | None = None,
    stage: str | None = None,
    tags: list[str] | None = None,
    dancer_description: str | None = None,
    usage: dict[str, Any] | None = None,
) -> str | None:
    """Insert the analysis row and return its UUID on success.

    Returns None when the DB responded with an unexpected shape (e.g.
    RLS blocked the select). Caller should treat None as "row may
    or may not exist" and skip any navigation that requires the id.
    """
    record: dict[str, Any] = {
        "user_id": user_id,
        "filename": filename,
        "duration": duration,
        "result": result,
        "object_key": object_key,
    }
    if role:
        record["role"] = role
    if competition_level:
        record["competition_level"] = competition_level
    if event_name:
        record["event_name"] = event_name
    if event_date:
        record["event_date"] = event_date
    if stage:
        record["stage"] = stage
    if tags:
        record["tags"] = tags
    if dancer_description:
        record["dancer_description"] = dancer_description
    if usage:
        record["model"] = usage.get("model")
        record["prompt_tokens"] = usage.get("prompt_tokens")
        record["response_tokens"] = usage.get("response_tokens")
        record["cost_usd_micros"] = usage.get("cost_usd_micros")

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            # Select only `id` back — keeps the response small and
            # avoids shipping the full analysis payload twice over
            # the wire (we already have it locally).
            _rest("video_analyses") + "?select=id",
            headers={**_headers(), "Prefer": "return=representation"},
            json=record,
        )
        r.raise_for_status()
        try:
            rows = r.json()
            if isinstance(rows, list) and rows:
                row_id = rows[0].get("id")
                if isinstance(row_id, str):
                    return row_id
        except Exception:  # noqa: BLE001
            pass
    return None


async def insert_usage_event(
    user_id: str,
    kind: str,
    duration_sec: int | None = None,
    job_id: str | None = None,
    usage: dict[str, Any] | None = None,
) -> None:
    record: dict[str, Any] = {
        "user_id": user_id,
        "kind": kind,
        "duration_sec": duration_sec,
        "job_id": job_id,
    }
    if usage:
        record["model"] = usage.get("model")
        record["prompt_tokens"] = usage.get("prompt_tokens")
        record["response_tokens"] = usage.get("response_tokens")
        record["cost_usd_micros"] = usage.get("cost_usd_micros")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            _rest("usage_events"),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=record,
        )
        r.raise_for_status()


async def claim_video_quota(user_id: str, limit: int) -> str | None:
    """Atomically reserve a monthly video-quota slot. Returns the
    usage_events.id of the reservation row, or None if the user is
    already at or above limit. The RPC is serialized per-user via a
    transaction-scope advisory lock, so concurrent requests from the
    same user cannot both claim the last remaining slot (fixes #72).

    Callers MUST either `finalize_video_quota` (on success) or
    `release_video_quota` (on failure) the returned id — a dangling
    reservation still counts toward monthly usage, which is the
    intentional failure-mode: a partial failure costs the user one
    slot rather than silently overspending quota.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.supabase_url}/rest/v1/rpc/claim_video_quota",
            headers={**_headers(), "Prefer": "return=representation"},
            json={"p_user": user_id, "p_limit": limit},
        )
        r.raise_for_status()
        data = r.json()
        # PostgREST may return the scalar directly or as a 1-element
        # list depending on version. Accept both; treat null / None
        # as over-limit.
        if isinstance(data, list):
            data = data[0] if data else None
        if data in (None, "", False):
            return None
        return str(data)


async def finalize_video_quota(
    reservation_id: str,
    duration_sec: int | None,
    job_id: str | None = None,
    usage: dict[str, Any] | None = None,
) -> None:
    """Fill in the post-Gemini details on a previously-reserved
    usage_events row. Idempotent w.r.t. quota count — the row was
    already inserted at claim time; this just enriches it.
    """
    model = usage.get("model") if usage else None
    prompt_tokens = usage.get("prompt_tokens") if usage else None
    response_tokens = usage.get("response_tokens") if usage else None
    cost_usd_micros = usage.get("cost_usd_micros") if usage else None
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.supabase_url}/rest/v1/rpc/finalize_video_quota",
            headers={**_headers(), "Prefer": "return=minimal"},
            json={
                "p_id": reservation_id,
                "p_duration_sec": duration_sec,
                "p_job_id": job_id,
                "p_model": model,
                "p_prompt_tokens": prompt_tokens,
                "p_response_tokens": response_tokens,
                "p_cost_usd_micros": cost_usd_micros,
            },
        )
        r.raise_for_status()


async def release_video_quota(reservation_id: str) -> None:
    """Delete a reservation row so the user isn't charged for a
    failed analysis. Best-effort: a failure here leaves the
    reservation in place (user loses one slot), which is the safer
    direction than accidentally un-charging on a flaky call.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.supabase_url}/rest/v1/rpc/release_video_quota",
            headers={**_headers(), "Prefer": "return=minimal"},
            json={"p_id": reservation_id},
        )
        r.raise_for_status()


async def get_analysis_result(analysis_id: str) -> dict[str, Any] | None:
    """Service-role read of just the stored AI `result` blob for an
    analysis. Used when we need to freeze a snapshot of the AI output
    (e.g. when a peer review is submitted) so later re-analyses can't
    mutate the training pair retroactively.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(
                f"video_analyses?id=eq.{analysis_id}"
                "&select=result"
            ),
            headers=_headers(),
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return None
        result = rows[0].get("result")
        return result if isinstance(result, dict) else None


async def get_analysis_minimal(
    analysis_id: str, *, include_soft_deleted: bool = False
) -> dict[str, Any] | None:
    """Service-role read of an analysis row, returning just the fields
    the peer-review / admin code paths need. Used to (a) authorize a
    review-request mint against the owner's user_id and (b) hand the
    reviewer the playable video + user-supplied context without
    exposing the AI score.
    """
    query = (
        f"video_analyses?id=eq.{analysis_id}"
        "&select=id,user_id,filename,duration,object_key,role,"
        "competition_level,event_name,event_date,stage,"
        "dancer_description,deleted_at"
    )
    if not include_soft_deleted:
        query += "&deleted_at=is.null"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(_rest(query), headers=_headers())
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def get_shared_analysis(token: str) -> dict[str, Any] | None:
    """Unauthenticated read of a video analysis by its share token.
    Intentionally returns only the public-safe subset of fields (no
    user_id or object_key). Also returns the
    view counter columns so the owner sees them update in realtime."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(
                f"video_analyses?share_token=eq.{token}"
                "&deleted_at=is.null"
                "&select=id,filename,duration,result,role,"
                "competition_level,event_name,stage,tags,created_at,"
                "share_view_count,share_last_viewed_at"
            ),
            headers=_headers(),
        )
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def increment_share_view(token: str) -> int:
    """Atomically +1 the view count on the row matching the given
    share token; also stamps share_last_viewed_at = now(). Returns
    the new count. Safe to call concurrently — the RPC wraps the
    UPDATE, so two simultaneous views don't race on read-then-write.

    Best-effort: any HTTP error is swallowed and 0 returned so a
    flaky counter never breaks the public /shared/{token} page.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(
                f"{settings.supabase_url}/rest/v1/rpc/increment_share_view",
                headers={**_headers(), "Prefer": "return=representation"},
                json={"p_token": token},
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, int):
                return data
            if isinstance(data, list) and data and isinstance(data[0], int):
                return data[0]
            return 0
    except Exception:
        return 0


async def clear_video_analysis_object_key(
    object_key: str, user_id: str
) -> None:
    """When a user deletes their R2 video, clear the object_key on any of
    their video_analyses rows that referenced it so the UI knows the
    source is no longer available."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(
            _rest(
                f"video_analyses?user_id=eq.{user_id}"
                f"&object_key=eq.{object_key}"
            ),
            headers={**_headers(), "Prefer": "return=minimal"},
            json={"object_key": None},
        )
        r.raise_for_status()


async def count_usage_events_since(
    user_id: str,
    kind: str,
    since_iso: str,
) -> int:
    """Returns count via PostgREST's exact-count Prefer header."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(
                f"usage_events?user_id=eq.{user_id}&kind=eq.{kind}"
                f"&created_at=gte.{since_iso}&select=id"
            ),
            headers={**_headers(), "Prefer": "count=exact"},
        )
        r.raise_for_status()
        content_range = r.headers.get("content-range", "*/0")
        return int(content_range.split("/")[-1])
