from __future__ import annotations

import datetime as _dt
from typing import TypedDict

from ..settings import settings
from . import supabase_admin


class VideoQuotaStatus(TypedDict):
    used: int
    limit: int
    max_seconds: int
    remaining: int


def _start_of_month_iso() -> str:
    now = _dt.datetime.now(_dt.timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Use 'Z' suffix instead of '+00:00' because '+' in a URL query string
    # gets decoded to ' ' (space) by PostgREST, producing
    # "invalid input syntax for type timestamp with time zone".
    return start.isoformat().replace("+00:00", "Z")


async def get_video_quota_status(user_id: str) -> VideoQuotaStatus:
    """Return the user's monthly video analysis quota.

    Everyone gets the same baseline allowance (`settings.monthly_video`,
    `settings.max_video_seconds`). Per-user overrides on the `profiles`
    row — `monthly_video_override` and `max_video_seconds_override` —
    take priority so we can comp extra credits or longer clips to
    specific users (beta testers, contest winners, refunds) via the
    Supabase Table Editor without shipping code.
    """
    profile = await supabase_admin.get_profile(user_id)
    used = await supabase_admin.count_usage_events_since(
        user_id=user_id,
        kind="video",
        since_iso=_start_of_month_iso(),
    )

    limit = settings.monthly_video
    max_seconds = settings.max_video_seconds
    if profile:
        override_limit = profile.get("monthly_video_override")
        override_seconds = profile.get("max_video_seconds_override")
        if isinstance(override_limit, int) and override_limit >= 0:
            limit = override_limit
        if isinstance(override_seconds, int) and override_seconds > 0:
            max_seconds = override_seconds

    return VideoQuotaStatus(
        used=used,
        limit=limit,
        max_seconds=max_seconds,
        remaining=max(0, limit - used),
    )
