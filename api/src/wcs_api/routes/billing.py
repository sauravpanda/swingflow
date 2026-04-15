from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
import stripe

from ..auth import verify_jwt
from ..services import billing, supabase_admin
from ..settings import settings

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutBody(BaseModel):
    success_url: str
    cancel_url: str


class PortalBody(BaseModel):
    return_url: str


def _user_email(jwt_payload: dict) -> str | None:
    email = jwt_payload.get("email")
    if email:
        return email
    user_metadata = jwt_payload.get("user_metadata") or {}
    return user_metadata.get("email")


def _require_billing_configured() -> None:
    if not settings.stripe_secret_key or not settings.stripe_price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="billing not configured (STRIPE_SECRET_KEY or STRIPE_PRICE_ID missing)",
        )


@router.post("/checkout")
async def checkout(
    body: CheckoutBody,
    user: dict = Depends(verify_jwt),
) -> dict:
    _require_billing_configured()
    user_id = user["sub"]
    customer_id = await billing.get_or_create_customer(user_id, _user_email(user))
    try:
        url = billing.create_checkout_session(
            customer_id=customer_id,
            user_id=user_id,
            success_url=body.success_url,
            cancel_url=body.cancel_url,
        )
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")
    return {"url": url}


@router.post("/portal")
async def portal(
    body: PortalBody,
    user: dict = Depends(verify_jwt),
) -> dict:
    _require_billing_configured()
    user_id = user["sub"]
    profile = await supabase_admin.get_profile(user_id)
    if not profile or not profile.get("stripe_customer_id"):
        raise HTTPException(
            status_code=400,
            detail="no Stripe customer for this user — start a checkout first",
        )
    try:
        url = billing.create_portal_session(
            customer_id=profile["stripe_customer_id"],
            return_url=body.return_url,
        )
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")
    return {"url": url}


@router.post("/webhook")
async def webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict:
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="STRIPE_WEBHOOK_SECRET not configured",
        )
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="missing Stripe-Signature header")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.stripe_webhook_secret
        )
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail=f"invalid signature: {exc}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid payload: {exc}")

    try:
        await billing.handle_event(event)
    except Exception as exc:  # noqa: BLE001 — webhook handlers must not 500
        # Returning 200 prevents Stripe from retrying forever on a bug we
        # can't recover from. Logging is enough for visibility.
        print(f"[webhook] handler error for {event.get('type')}: {exc}")

    return {"received": True}
