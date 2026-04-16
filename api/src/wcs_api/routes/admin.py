from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import verify_jwt
from ..services import supabase_admin
from ..settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(user: dict = Depends(verify_jwt)) -> dict:
    email = user.get("email") or (user.get("user_metadata") or {}).get("email")
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if not email or email.lower() not in admin_list:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin access required",
        )
    return user


@router.get("/stats")
async def get_stats(_user: dict = Depends(_require_admin)) -> dict:
    return await supabase_admin.get_admin_stats()
