"""Fail-closed authentication for the WhisperX worker."""

import hmac
import json
import os
from typing import Awaitable, Callable, Optional

LOCAL_MODES = frozenset({"local", "development", "test"})


class ServiceAuthError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def service_auth_error(provided_key: Optional[str]) -> tuple[int, str] | None:
    expected_key = os.getenv("WHISPERX_API_KEY", "")
    app_env = os.getenv("APP_ENV", "").lower()
    if not expected_key:
        if app_env in LOCAL_MODES:
            return None
        return (503, "Service authentication is not configured")
    if not provided_key or not hmac.compare_digest(provided_key, expected_key):
        return (401, "Unauthorized")
    return None


def check_key(provided_key: Optional[str]) -> None:
    """Compatibility helper for non-ASGI callers and focused unit tests."""
    error = service_auth_error(provided_key)
    if error:
        raise ServiceAuthError(*error)


class WhisperXAuthMiddleware:
    """Authenticate at the ASGI boundary, before multipart body consumption."""

    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return

        provided_key = None
        for name, value in scope.get("headers", []):
            if name.lower() == b"x-api-key":
                provided_key = value.decode("latin-1")
                break

        error = service_auth_error(provided_key)
        if not error:
            await self.app(scope, receive, send)
            return

        status_code, message = error
        body = json.dumps({"error": message}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
