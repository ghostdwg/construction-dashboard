"""Fail-closed service authentication shared by sidecar middleware/tests."""

import hmac
import os


LOCAL_MODES = frozenset({"local", "development", "test"})


def service_auth_error(provided_key: str | None) -> tuple[int, str] | None:
    expected_key = os.getenv("SIDECAR_API_KEY", "")
    app_env = os.getenv("APP_ENV", "").lower()

    if not expected_key:
        if app_env in LOCAL_MODES:
            return None
        return (503, "Service authentication is not configured")

    if not provided_key or not hmac.compare_digest(provided_key, expected_key):
        return (401, "Invalid or missing API key")
    return None
