"""Authentication tests through whisperx_server's real FastAPI/Starlette app."""

import asyncio
import importlib
import importlib.util
import sys
import types
from pathlib import Path

import pytest


def _restore_real_module(name, required_attribute):
    """Undo offline collection stubs installed by unrelated legacy tests."""
    existing = sys.modules.get(name)
    if existing is not None and (
        not getattr(existing, "__file__", None)
        or not hasattr(existing, required_attribute)
    ):
        sys.modules.pop(name, None)
    return importlib.import_module(name)


# test_market_gateway installs module-only FastAPI/Pydantic stubs during full
# suite collection. Restore the installed packages before the real worker app
# is imported, while leaving that test's already-imported router objects alone.
_restore_real_module("pydantic", "BaseModel")
fastapi = _restore_real_module("fastapi", "FastAPI")


@pytest.fixture
def worker_app(monkeypatch):
    """Import the real worker app while stubbing only heavy runtime/model seams."""
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    whisperx = types.ModuleType("whisperx")
    whisperx.load_model = lambda *_args, **_kwargs: types.SimpleNamespace()

    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "whisperx", whisperx)

    server_path = Path(__file__).with_name("whisperx_server.py")
    spec = importlib.util.spec_from_file_location(
        "whisperx_server_auth_integration_test", server_path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert isinstance(module.app, fastapi.FastAPI)
    assert module.app.__class__.__module__ == "fastapi.applications"
    return module.app


def invoke(app, path, key=None, method="GET"):
    observed = {"receive_calls": 0, "messages": []}

    async def receive():
        observed["receive_calls"] += 1
        return {"type": "http.disconnect"}

    async def send(message):
        observed["messages"].append(message)

    headers = [] if key is None else [(b"x-api-key", key.encode("utf-8"))]
    if method == "POST":
        headers.extend(
            [
                (b"content-type", b"multipart/form-data; boundary=synthetic"),
                (b"content-length", b"25"),
            ]
        )
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "state": {},
    }
    asyncio.run(app(scope, receive, send))
    starts = [
        message
        for message in observed["messages"]
        if message["type"] == "http.response.start"
    ]
    assert len(starts) == 1
    observed["status"] = starts[0]["status"]
    return observed


def test_exported_app_denies_transcribe_before_body_consumption(worker_app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    missing = invoke(worker_app, "/transcribe", method="POST")
    wrong = invoke(worker_app, "/transcribe", "wrong", method="POST")

    assert missing["status"] == 401
    assert wrong["status"] == 401
    assert missing["receive_calls"] == 0
    assert wrong["receive_calls"] == 0


def test_exported_app_missing_config_fails_closed(worker_app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("WHISPERX_API_KEY", raising=False)

    result = invoke(worker_app, "/jobs")

    assert result["status"] == 503
    assert result["receive_calls"] == 0


def test_exported_app_valid_key_reaches_actual_jobs_handler(worker_app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    jobs = invoke(worker_app, "/jobs", "expected")
    missing_job = invoke(worker_app, "/status/missing", "expected")

    assert jobs["status"] == 200
    assert missing_job["status"] == 404


def test_exported_app_exempts_only_exact_health(worker_app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    assert invoke(worker_app, "/health")["status"] == 200
    for protected_path in ["/health/extra", "/docs", "/jobs", "/status/job-1"]:
        assert invoke(worker_app, protected_path)["status"] == 401
