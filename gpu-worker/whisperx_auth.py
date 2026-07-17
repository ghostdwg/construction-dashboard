"""Fail-closed authentication for the WhisperX worker."""

import hmac
import os
from typing import Optional

LOCAL_MODES = frozenset({"local", "development", "test"})


class ServiceAuthError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def check_key(provided_key: Optional[str]) -> None:
    expected_key = os.getenv("WHISPERX_API_KEY", "")
    app_env = os.getenv("APP_ENV", "").lower()
    if not expected_key:
        if app_env in LOCAL_MODES:
            return
        raise ServiceAuthError(503, "Service authentication is not configured")
    if not provided_key or not hmac.compare_digest(provided_key, expected_key):
        raise ServiceAuthError(401, "Unauthorized")
