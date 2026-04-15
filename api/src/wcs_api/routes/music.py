from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..auth import verify_jwt
from ..services.music_analyzer import analyze_music
from ..settings import settings

router = APIRouter(prefix="/analyze", tags=["analyze"])


@router.post("/music")
async def analyze_music_endpoint(
    file: UploadFile = File(...),
    user: dict = Depends(verify_jwt),
) -> dict:
    del user  # auth-only; quota enforcement lands with Stripe in Phase 2

    content = await file.read()
    if len(content) > settings.max_music_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"file exceeds {settings.max_music_bytes} bytes",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty file",
        )

    try:
        result = analyze_music(content, filename=file.filename or "audio")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    if result.duration > settings.max_music_seconds:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"audio longer than {settings.max_music_seconds}s",
        )

    return {
        "bpm": result.bpm,
        "duration": result.duration,
        "beats": result.beats,
        "downbeats": result.downbeats,
        "phrases": result.phrases,
        "anchor_beats": result.anchor_beats,
    }
