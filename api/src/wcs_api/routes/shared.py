from fastapi import APIRouter, HTTPException, status

from ..services import supabase_admin

router = APIRouter(prefix="/shared", tags=["shared"])


@router.get("/{token}")
async def get_shared(token: str) -> dict:
    """Public endpoint — no JWT required. Returns a video analysis row
    keyed by its share_token, restricted to the public-safe field set
    (no user_id, no object_key). The client generates a random token
    when the user clicks Share, so the 'knowledge of the token' acts
    as the access control."""
    if not token or len(token) < 16:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid share token",
        )
    analysis = await supabase_admin.get_shared_analysis(token)
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="shared analysis not found or no longer shared",
        )
    return analysis
