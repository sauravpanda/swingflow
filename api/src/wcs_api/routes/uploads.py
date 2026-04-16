from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import verify_jwt
from ..services import r2
from ..settings import settings

router = APIRouter(prefix="/uploads", tags=["uploads"])


class PresignBody(BaseModel):
    filename: str | None = None
    content_type: str = "application/octet-stream"


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
