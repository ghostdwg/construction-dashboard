import asyncio

import pytest

from whisperx_auth import check_key, ServiceAuthError, WhisperXAuthMiddleware


def test_missing_key_fails_closed_outside_local(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)
    with pytest.raises(ServiceAuthError) as exc:
        check_key(None)
    assert exc.value.status_code == 503


def test_incorrect_key_is_denied(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")
    with pytest.raises(ServiceAuthError) as exc:
        check_key("incorrect")
    assert exc.value.status_code == 401


def test_valid_key_is_accepted(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")
    check_key("expected")


def test_explicit_test_mode_allows_synthetic_requests(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)
    check_key(None)


def _run_middleware(path: str, key: str | None = None):
    observed = {"app_called": False, "receive_calls": 0, "messages": []}

    async def inner_app(scope, receive, send):
        observed["app_called"] = True
        await receive()
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        observed["receive_calls"] += 1
        return {"type": "http.request", "body": b"synthetic multipart bytes"}

    async def send(message):
        observed["messages"].append(message)

    headers = [] if key is None else [(b"x-api-key", key.encode("utf-8"))]
    scope = {"type": "http", "path": path, "headers": headers}
    asyncio.run(WhisperXAuthMiddleware(inner_app)(scope, receive, send))
    return observed


def test_middleware_denies_before_multipart_body_is_consumed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    observed = _run_middleware("/transcribe", "incorrect")

    assert observed["app_called"] is False
    assert observed["receive_calls"] == 0
    assert observed["messages"][0]["status"] == 401


def test_middleware_missing_config_fails_before_body_is_consumed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)

    observed = _run_middleware("/transcribe")

    assert observed["app_called"] is False
    assert observed["receive_calls"] == 0
    assert observed["messages"][0]["status"] == 503


def test_middleware_valid_key_reaches_processing_route(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    observed = _run_middleware("/transcribe", "expected")

    assert observed["app_called"] is True
    assert observed["receive_calls"] == 1
    assert observed["messages"][0]["status"] == 204


def test_middleware_only_exact_health_is_exempt(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    health = _run_middleware("/health")
    health_suffix = _run_middleware("/health/extra")
    docs = _run_middleware("/docs")

    assert health["app_called"] is True
    assert health_suffix["app_called"] is False
    assert docs["app_called"] is False
