import os
import tempfile

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..auth import verify_jwt
from ..services import quota, supabase_admin
from ..services.video_analyzer import (
    VideoAnalysisError,
    analyze_video_path,
    get_video_duration,
)
from ..settings import settings

router = APIRouter(prefix="/analyze/video", tags=["analyze"])


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
    file: UploadFile = File(...),
    user: dict = Depends(verify_jwt),
) -> dict:
    user_id = user["sub"]

    # 1) Quota gate — must be done before consuming the upload, so
    #    we don't burn bandwidth on requests we'll reject anyway.
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

    # 2) Read bytes and enforce size limit.
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty file")
    if len(content) > settings.max_video_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"file exceeds {settings.max_video_bytes} bytes",
        )

    # 3) Spool to a tempfile so ffprobe + Gemini File API can read by path.
    suffix = os.path.splitext(file.filename or "video")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 4) Duration check — second-level enforcement of the per-plan cap.
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

        # 5) Analyze (slow — ~30-60s for Gemini Flash on a 1-2 min clip).
        try:
            result = analyze_video_path(tmp_path)
        except VideoAnalysisError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        # 6) Record successful usage. We don't insert on failure so the
        #    user doesn't burn quota on a rejected/failed analysis.
        await supabase_admin.insert_usage_event(
            user_id=user_id,
            kind="video",
            duration_sec=int(duration),
        )

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
