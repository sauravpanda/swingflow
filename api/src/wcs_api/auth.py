"""Verify Supabase user access tokens.

Supabase projects now sign access tokens with an asymmetric key (ES256 on
new projects, RS256 on some). The public key is published at
``{supabase_url}/auth/v1/.well-known/jwks.json`` and must be fetched to
verify the signature.

For backwards compatibility with legacy projects still on the shared
HS256 secret, we fall back to HS256 verification if the JWKS path fails.
"""

from __future__ import annotations

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from .settings import settings

_ASYMMETRIC_ALGS = ["ES256", "RS256"]

_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = (
            f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        )
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    return _jwks_client


def _decode_token(token: str) -> dict:
    last_err: Exception | None = None

    # Preferred path: JWKS-based asymmetric verification.
    if settings.supabase_url:
        try:
            signing_key = _jwks().get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=_ASYMMETRIC_ALGS,
                audience="authenticated",
            )
        except Exception as exc:  # noqa: BLE001
            last_err = exc

    # Legacy fallback: shared HS256 secret.
    if settings.supabase_jwt_secret:
        try:
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except Exception as exc:  # noqa: BLE001
            last_err = exc

    if isinstance(last_err, jwt.PyJWTError):
        raise last_err
    raise jwt.InvalidTokenError(
        f"no verification path succeeded: {last_err}"
        if last_err
        else "no verification key available"
    )


def verify_jwt(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization.split(" ", 1)[1].strip()

    try:
        payload = _decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token expired",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
        )

    if not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token missing subject",
        )
    return payload
