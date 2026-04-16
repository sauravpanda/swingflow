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


async def get_profile_by_customer_id(customer_id: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            _rest(f"profiles?stripe_customer_id=eq.{customer_id}&select=*"),
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


async def upsert_subscription(record: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            _rest("subscriptions"),
            headers={
                **_headers(),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=record,
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
    stage: str | None = None,
    tags: list[str] | None = None,
) -> None:
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
    if stage:
        record["stage"] = stage
    if tags:
        record["tags"] = tags

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            _rest("video_analyses"),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=record,
        )
        r.raise_for_status()


async def get_admin_stats() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{settings.supabase_url}/rest/v1/rpc/admin_stats",
            headers={**_headers(), "Prefer": "return=representation"},
            json={},
        )
        r.raise_for_status()
        return r.json()


async def insert_usage_event(
    user_id: str,
    kind: str,
    duration_sec: int | None = None,
    job_id: str | None = None,
) -> None:
    record = {
        "user_id": user_id,
        "kind": kind,
        "duration_sec": duration_sec,
        "job_id": job_id,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            _rest("usage_events"),
            headers={**_headers(), "Prefer": "return=minimal"},
            json=record,
        )
        r.raise_for_status()


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
