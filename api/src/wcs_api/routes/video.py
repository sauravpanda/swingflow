import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import verify_jwt
from ..services import quota, r2, supabase_admin
from ..services.video_analyzer import (
    VideoAnalysisError,
    analyze_video_path,
    get_video_duration,
)
from ..settings import settings

router = APIRouter(prefix="/analyze/video", tags=["analyze"])


class VideoAnalyzeBody(BaseModel):
    object_key: str
    filename: str | None = None


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
            result = analyze_video_path(tmp_path)
        except VideoAnalysisError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        await supabase_admin.insert_usage_event(
            user_id=user_id,
            kind="video",
            duration_sec=int(duration),
        )
        try:
            await supabase_admin.insert_video_analysis(
                user_id=user_id,
                filename=body.filename,
                duration=duration,
                result=result,
            )
        except Exception:
            pass

        return {
            "duration": round(duration, 2),
            "result": result,
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
        # Clean up the R2 object — the 24h lifecycle rule is a backstop.
        r2.delete_object(body.object_key)
