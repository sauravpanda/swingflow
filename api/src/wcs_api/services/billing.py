"""Stripe billing helpers — checkout, customer portal, webhook event handling."""

from __future__ import annotations

import datetime as _dt
from typing import Any

import stripe

from ..settings import settings
from . import supabase_admin

stripe.api_key = settings.stripe_secret_key

PLAN_PRO = "pro"
PLAN_FREE = "free"
ACTIVE_STATUSES = {"active", "trialing"}


def _ts_to_iso(ts: int | None) -> str | None:
    if ts is None:
        return None
    return _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc).isoformat()


async def get_or_create_customer(user_id: str, email: str | None) -> str:
    profile = await supabase_admin.get_profile(user_id)
    if profile and profile.get("stripe_customer_id"):
        return profile["stripe_customer_id"]
    customer = stripe.Customer.create(
        email=email,
        metadata={"supabase_user_id": user_id},
    )
    await supabase_admin.update_profile(
        user_id, {"stripe_customer_id": customer["id"]}
    )
    return customer["id"]


def create_checkout_session(
    customer_id: str,
    user_id: str,
    success_url: str,
    cancel_url: str,
) -> str:
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": settings.stripe_price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=user_id,
        allow_promotion_codes=True,
    )
    return session["url"]


def create_portal_session(customer_id: str, return_url: str) -> str:
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session["url"]


async def _upsert_subscription_record(user_id: str, sub: dict[str, Any]) -> None:
    items = sub.get("items", {}).get("data", [])
    price_id = items[0]["price"]["id"] if items else None
    record = {
        "id": sub["id"],
        "user_id": user_id,
        "status": sub.get("status", "unknown"),
        "price_id": price_id,
        "current_period_start": _ts_to_iso(sub.get("current_period_start")),
        "current_period_end": _ts_to_iso(sub.get("current_period_end")),
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
    }
    await supabase_admin.upsert_subscription(record)


def _plan_for_status(status: str | None) -> str:
    return PLAN_PRO if status in ACTIVE_STATUSES else PLAN_FREE


async def handle_event(event: dict[str, Any]) -> None:
    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type == "checkout.session.completed":
        user_id = obj.get("client_reference_id")
        customer_id = obj.get("customer")
        sub_id = obj.get("subscription")
        if not (user_id and sub_id):
            return
        sub = stripe.Subscription.retrieve(sub_id)
        await _upsert_subscription_record(user_id, dict(sub))
        await supabase_admin.update_profile(
            user_id,
            {"plan": PLAN_PRO, "stripe_customer_id": customer_id},
        )
        return

    if event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
    }:
        customer_id = obj.get("customer")
        profile = await supabase_admin.get_profile_by_customer_id(customer_id)
        if not profile:
            return
        await _upsert_subscription_record(profile["id"], obj)
        await supabase_admin.update_profile(
            profile["id"], {"plan": _plan_for_status(obj.get("status"))}
        )
        return

    if event_type == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        profile = await supabase_admin.get_profile_by_customer_id(customer_id)
        if not profile:
            return
        await _upsert_subscription_record(profile["id"], obj)
        await supabase_admin.update_profile(profile["id"], {"plan": PLAN_FREE})
        return
