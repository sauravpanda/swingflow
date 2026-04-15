from __future__ import annotations

import datetime as _dt
from typing import TypedDict

from ..settings import settings
from . import supabase_admin


class VideoQuotaStatus(TypedDict):
    plan: str
    used: int
    limit: int
    max_seconds: int
    remaining: int


def _start_of_month_iso() -> str:
    now = _dt.datetime.now(_dt.timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat()


async def get_video_quota_status(user_id: str) -> VideoQuotaStatus:
    profile = await supabase_admin.get_profile(user_id)
    plan = (profile or {}).get("plan", "free")
    used = await supabase_admin.count_usage_events_since(
        user_id=user_id,
        kind="video",
        since_iso=_start_of_month_iso(),
    )

    if plan == "pro":
        limit = settings.pro_monthly_video
        max_seconds = settings.pro_max_video_seconds
    else:
        plan = "free"
        limit = settings.free_monthly_video
        max_seconds = settings.free_max_video_seconds

    return VideoQuotaStatus(
        plan=plan,
        used=used,
        limit=limit,
        max_seconds=max_seconds,
        remaining=max(0, limit - used),
    )
