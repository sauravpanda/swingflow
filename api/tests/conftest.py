"""Shared fixtures for the wcs_api test suite.

Two themes here:
  1. Stub `wcs_api.settings.settings` so importing the app doesn't
     require real Supabase / R2 / Gemini credentials.
  2. Provide a `client` that bypasses the real `verify_jwt` dependency
     and returns a known user payload, so route tests can focus on
     their own logic instead of JWT plumbing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

# Populate dummy env vars BEFORE importing wcs_api.settings — pydantic-
# settings raises at import if required values are missing.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
os.environ.setdefault("R2_ACCOUNT_ID", "test-account")
os.environ.setdefault("R2_ACCESS_KEY_ID", "test-key")
os.environ.setdefault("R2_SECRET_ACCESS_KEY", "test-secret")
os.environ.setdefault("R2_BUCKET", "test-bucket")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")

# Make the `src/` layout importable without an editable install.
SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from wcs_api.auth import verify_jwt  # noqa: E402
from wcs_api.main import app  # noqa: E402

TEST_USER_ID = "11111111-2222-3333-4444-555555555555"


def _fake_verify_jwt() -> dict[str, Any]:
    """Replaces the real JWT verification — every test request is
    authenticated as TEST_USER_ID. Tests that need to assert behavior
    on UNauthenticated requests should override this individually."""
    return {"sub": TEST_USER_ID, "email": "test@example.com"}


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient with verify_jwt stubbed to a fixed user.

    Uses dependency_overrides so each test gets a clean session — we
    pop the override after the test so a leak doesn't poison neighbors.
    """
    app.dependency_overrides[verify_jwt] = _fake_verify_jwt
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


@pytest.fixture
def test_user_id() -> str:
    return TEST_USER_ID
