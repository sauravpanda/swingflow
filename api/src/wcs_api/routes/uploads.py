from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import verify_jwt
from ..services import r2, supabase_admin
from ..settings import settings

router = APIRouter(prefix="/uploads", tags=["uploads"])


class PresignBody(BaseModel):
    filename: str | None = None
    content_type: str = "application/octet-stream"


class ObjectKeyBody(BaseModel):
    object_key: str


@router.post("/delete")
async def delete_video(
    body: ObjectKeyBody, user: dict = Depends(verify_jwt)
) -> dict:
    """User-initiated delete: remove the R2 object and clear the
    reference on any of the user's video_analyses rows so the UI
    reflects the deletion immediately.

    Uses raise_on_error=True so a failed R2 delete surfaces as a
    500 to the client instead of the user seeing a silent success
    on a privacy-critical operation.
    """
    if not r2.object_key_belongs_to_user(body.object_key, user["sub"]):
        raise HTTPException(
            status_code=403, detail="object does not belong to user"
        )
    try:
        r2.delete_object(body.object_key, raise_on_error=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"R2 delete failed: {exc}",
        ) from exc
    try:
        await supabase_admin.clear_video_analysis_object_key(
            object_key=body.object_key, user_id=user["sub"]
        )
    except Exception:
        pass
    return {"ok": True}


class ViewBody(BaseModel):
    object_key: str


@router.post("/view")
async def presign_view(body: ViewBody, user: dict = Depends(verify_jwt)) -> dict:
    """Issue a short-lived presigned GET URL so the user can stream their
    own past upload from R2. Object-key prefix must match the user id."""
    if not r2.object_key_belongs_to_user(body.object_key, user["sub"]):
        raise HTTPException(status_code=403, detail="object does not belong to user")
    if (
        not settings.r2_account_id
        or not settings.r2_access_key_id
        or not settings.r2_secret_access_key
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="uploads not configured (R2_* env vars missing)",
        )
    url = r2.generate_presigned_get(body.object_key, expires_in=3600)
    return {"url": url, "expiresIn": 3600}


@router.post("/presign")
async def presign(body: PresignBody, user: dict = Depends(verify_jwt)) -> dict:
    if (
        not settings.r2_account_id
        or not settings.r2_access_key_id
        or not settings.r2_secret_access_key
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="uploads not configured (R2_* env vars missing)",
        )

    content_type = body.content_type or "application/octet-stream"
    if not (
        content_type.startswith("video/") or content_type == "application/octet-stream"
    ):
        raise HTTPException(
            status_code=400,
            detail=f"unsupported content type: {content_type}",
        )

    url, key = r2.generate_presigned_put(
        content_type=content_type,
        filename=body.filename,
        user_id=user["sub"],
    )
    return {
        "uploadUrl": url,
        "objectKey": key,
        "expiresIn": settings.r2_upload_ttl_seconds,
    }
