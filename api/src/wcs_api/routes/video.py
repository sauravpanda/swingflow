import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ..auth import verify_jwt
from ..services import quota, r2, supabase_admin
from ..services.video_analyzer import (
    VideoAnalysisError,
    analyze_video_path,
    get_video_duration,
)
from ..settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analyze/video", tags=["analyze"])


class VideoAnalyzeBody(BaseModel):
    # Length caps on every free-text field are pure prompt-injection
    # defense: these values get interpolated into the Gemini prompt,
    # so we want to bound how much text an attacker could stuff in.
    # Picked generously — real WCS metadata comfortably fits within.
    object_key: str = Field(max_length=256)
    filename: str | None = Field(default=None, max_length=256)
    role: str | None = Field(default=None, max_length=40)
    competition_level: str | None = Field(default=None, max_length=40)
    event_name: str | None = Field(default=None, max_length=120)
    # ISO date string (YYYY-MM-DD) — validated loosely by max_length;
    # insert_video_analysis lets Postgres coerce the final value.
    event_date: str | None = Field(default=None, max_length=20)
    stage: str | None = Field(default=None, max_length=60)
    # Up to 10 tags, each ≤30 chars — well beyond any realistic use.
    tags: list[str] | None = Field(default=None, max_length=10)
    # Free-text description of which dancer / couple to focus on
    # when multiple people are in frame (e.g. "couple in the red
    # dress and blue shirt", "the lead on the far right"). Fed into
    # Gemini's DANCER IDENTIFICATION block.
    dancer_description: str | None = Field(default=None, max_length=200)
    # Opt-in video retention. Default False = we delete the R2
    # object after scoring (privacy-preserving default). True =
    # keep it so the user can replay the clip later against the
    # pattern timeline / off-beat markers. User can still click
    # "Delete video" on the history row to remove it any time.
    store_video: bool = False
    # When True, skip the pinned seed so Gemini returns a different
    # result than previous runs on the same video. Used by the
    # "Re-analyze" button so a second run actually tries again
    # instead of returning near-identical output (seed=42 +
    # temperature=0 is close to deterministic).
    fresh: bool = False

    @field_validator("tags")
    @classmethod
    def _cap_tag_length(cls, v: list[str] | None) -> list[str] | None:
        # Per-element length cap for tags. list-level cap is done
        # via Field(max_length=...), but pydantic doesn't enforce
        # element-length there.
        if v is None:
            return v
        return [t[:30] for t in v if t]


def _admin_error_to_http(exc: httpx.HTTPStatusError) -> HTTPException:
    code = exc.response.status_code
    if code in (401, 403):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "backend Supabase admin call rejected — check "
                "SUPABASE_SERVICE_ROLE_KEY on the API service"
            ),
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Supabase admin error: {code}",
    )


@router.get("/quota")
async def get_quota(user: dict = Depends(verify_jwt)) -> dict:
    try:
        return await quota.get_video_quota_status(user["sub"])
    except httpx.HTTPStatusError as exc:
        raise _admin_error_to_http(exc)


@router.post("")
async def analyze_video_endpoint(
    body: VideoAnalyzeBody,
    user: dict = Depends(verify_jwt),
) -> dict:
    user_id = user["sub"]

    # Authorization: key must belong to this user (prevents analyzing
    # someone else's upload by key-guessing).
    if not r2.object_key_belongs_to_user(body.object_key, user_id):
        raise HTTPException(status_code=403, detail="object does not belong to user")

    # Quota gate.
    try:
        quota_status = await quota.get_video_quota_status(user_id)
    except httpx.HTTPStatusError as exc:
        raise _admin_error_to_http(exc)
    if quota_status["remaining"] <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Monthly video quota reached "
                f"({quota_status['used']}/{quota_status['limit']} on "
                f"{quota_status['plan']} plan). Upgrade for more."
            ),
        )

    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="video analysis not configured (GEMINI_API_KEY missing)",
        )

    # Validate the object exists in R2 and check size.
    head = r2.head_object(body.object_key)
    if not head:
        raise HTTPException(
            status_code=404,
            detail="object not found — upload may have expired or failed",
        )

    content_length = int(head.get("ContentLength", 0))
    if content_length > settings.max_video_bytes:
        r2.delete_object(body.object_key)
        limit_mb = settings.max_video_bytes / (1024 * 1024)
        size_mb = content_length / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"file is {size_mb:.0f} MB, limit is {limit_mb:.0f} MB",
        )

    # Download to a tempfile and run the existing pipeline.
    suffix = os.path.splitext(body.filename or body.object_key)[1] or ".mp4"
    try:
        tmp_path = r2.download_to_tempfile(body.object_key, suffix=suffix)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"failed to download from R2: {exc}")

    try:
        try:
            duration = get_video_duration(tmp_path)
        except VideoAnalysisError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            )

        if duration > quota_status["max_seconds"]:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"video is {int(duration)}s, limit is "
                    f"{quota_status['max_seconds']}s on {quota_status['plan']} plan"
                ),
            )

        try:
            # Pass user-provided metadata as prompt context so the
            # model calibrates against self-reported tier. Duration
            # feeds the sanity-check heuristics (pattern density,
            # gap detection) downstream.
            result = analyze_video_path(
                tmp_path,
                duration_sec=duration,
                context={
                    "role": body.role,
                    "competition_level": body.competition_level,
                    "event_name": body.event_name,
                    "event_date": body.event_date,
                    "stage": body.stage,
                    "tags": body.tags,
                    "dancer_description": body.dancer_description,
                },
                fresh=body.fresh,
            )
        except VideoAnalysisError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        # Strip usage metadata from the user-facing response — we keep
        # cost tracking admin-only. The full `usage` dict (model,
        # tokens, cost_usd_micros) is persisted to Postgres below so
        # admin dashboards can aggregate it.
        usage = result.pop("usage", None)

        # Usage logging is analytics — if it fails, we still want to
        # return the analysis the user paid for. A Supabase hiccup
        # on the INSERT here should never throw away a completed
        # Gemini call. Quota enforcement already ran above; the only
        # downside to a missed usage_event is that the monthly count
        # is off by one, which is self-healing the next month.
        try:
            await supabase_admin.insert_usage_event(
                user_id=user_id,
                kind="video",
                duration_sec=int(duration),
                usage=usage,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "insert_usage_event failed for user=%s (analysis still returned): %s",
                user_id,
                exc,
            )
        analysis_id: str | None = None
        try:
            # Preserve the R2 object_key on the row only when the
            # user opted in to video retention. Otherwise the row
            # stores a null key and the clip is purged below.
            analysis_id = await supabase_admin.insert_video_analysis(
                user_id=user_id,
                filename=body.filename,
                duration=duration,
                result=result,
                object_key=body.object_key if body.store_video else None,
                role=body.role,
                competition_level=body.competition_level,
                event_name=body.event_name,
                event_date=body.event_date,
                stage=body.stage,
                tags=body.tags,
                dancer_description=body.dancer_description,
                usage=usage,
            )
        except Exception as exc:  # noqa: BLE001
            # Surface the failure in logs so a persistence bug is
            # observable. Analysis is still returned to the user —
            # the DB row is a convenience (history list), not the
            # primary artifact.
            logger.warning(
                "insert_video_analysis failed for user=%s (analysis still returned): %s",
                user_id,
                exc,
            )

        return {
            "duration": round(duration, 2),
            "result": result,
            "analysis_id": analysis_id,
            "quota": {
                "plan": quota_status["plan"],
                "used": quota_status["used"] + 1,
                "limit": quota_status["limit"],
                "remaining": quota_status["remaining"] - 1,
            },
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        # Delete from R2 by default — privacy-preserving. Users who
        # opted in to `store_video` keep their clip so they can
        # replay it against the pattern timeline later; they can
        # still remove it anytime via the Delete-video button on
        # the history row. The 24h bucket lifecycle rule is the
        # backstop for orphaned uploads on either path.
        if not body.store_video:
            r2.delete_object(body.object_key)
