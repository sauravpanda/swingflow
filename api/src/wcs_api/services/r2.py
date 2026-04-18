"""Thin wrapper over boto3 pointed at Cloudflare R2 for presigned uploads.

The browser uploads big video files straight to R2 via a presigned PUT URL,
bypassing Railway's edge proxy body-size limit. The API only ever HEADs,
GETs, and DELETEs objects server-to-server.
"""

from __future__ import annotations

import logging
import os
import tempfile
import uuid
from typing import Any

import boto3
from botocore.config import Config

from ..settings import settings

logger = logging.getLogger(__name__)


def _client():
    if not settings.r2_account_id:
        raise RuntimeError("R2_ACCOUNT_ID not configured")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def generate_presigned_put(
    content_type: str, filename: str | None, user_id: str
) -> tuple[str, str]:
    """Returns (presigned_url, object_key). Object key is prefixed with
    the user's id for traceability + RBAC friendliness."""
    ext = ""
    if filename:
        ext = os.path.splitext(os.path.basename(filename))[1].lower()
    key = f"uploads/{user_id}/{uuid.uuid4().hex}{ext}"
    url = _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=settings.r2_upload_ttl_seconds,
    )
    return url, key


def head_object(object_key: str) -> dict[str, Any] | None:
    try:
        return _client().head_object(Bucket=settings.r2_bucket, Key=object_key)
    except Exception:
        return None


def download_to_tempfile(object_key: str, suffix: str = "") -> str:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        _client().download_fileobj(settings.r2_bucket, object_key, tmp)
    finally:
        tmp.close()
    return tmp.name


def delete_object(object_key: str, *, raise_on_error: bool = False) -> None:
    """Delete an R2 object.

    By default this is best-effort: exceptions are logged (not
    swallowed silently) and suppressed so automatic post-scoring
    cleanup can't take down a successful analysis. The 24h bucket
    lifecycle rule is the backstop for anything we leaked here.

    Callers that are responding to a user's explicit delete request
    (e.g. the /uploads/delete endpoint) should pass
    `raise_on_error=True` so the error surfaces to the UI instead
    of the user seeing a silent "deleted" that actually left the
    object behind.
    """
    try:
        _client().delete_object(Bucket=settings.r2_bucket, Key=object_key)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "r2.delete_object failed for key=%s: %s", object_key, exc
        )
        if raise_on_error:
            raise


def generate_presigned_get(object_key: str, expires_in: int = 3600) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": object_key},
        ExpiresIn=expires_in,
    )


def object_key_belongs_to_user(object_key: str, user_id: str) -> bool:
    """Guard against a user analyzing another user's upload by key-guessing."""
    return object_key.startswith(f"uploads/{user_id}/")
