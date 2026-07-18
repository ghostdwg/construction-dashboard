"""Hermetic auth tests through whisperx_server's actual exported ASGI app."""

import asyncio
import importlib.util
import inspect
import json
import sys
import types
from pathlib import Path

import pytest


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class FakeJSONResponse:
    def __init__(self, content, status_code=200):
        self.content = content
        self.status_code = status_code


class FakeFastAPI:
    """Small ASGI-compatible FastAPI seam; server decorators remain real code."""

    def __init__(self, **_kwargs):
        self.routes = []
        self.middleware = []

    def add_middleware(self, middleware_cls, **options):
        self.middleware.append((middleware_cls, options))

    def get(self, path):
        return self._route("GET", path)

    def post(self, path):
        return self._route("POST", path)

    def _route(self, method, path):
        def register(handler):
            self.routes.append((method, path, handler))
            return handler

        return register

    async def _router(self, scope, receive, send):
        del receive
        path = scope["path"]
        method = scope.get("method", "GET")
        if path == "/docs":
            result = {"docs": True}
            status_code = 200
        else:
            match = None
            args = []
            for route_method, route_path, handler in self.routes:
                if route_method != method:
                    continue
                if route_path == path:
                    match = handler
                    break
                if route_path == "/status/{job_id}" and path.startswith("/status/"):
                    match = handler
                    args = [path.removeprefix("/status/")]
                    break
            if match is None:
                result = {"detail": "Not found"}
                status_code = 404
            else:
                try:
                    result = match(*args)
                    if inspect.isawaitable(result):
                        result = await result
                    status_code = getattr(result, "status_code", 200)
                    result = getattr(result, "content", result)
                except FakeHTTPException as exc:
                    status_code = exc.status_code
                    result = {"detail": exc.detail}

        body = json.dumps(result).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        app = self._router
        for middleware_cls, options in reversed(self.middleware):
            app = middleware_cls(app, **options)
        await app(scope, receive, send)


@pytest.fixture
def worker_app(monkeypatch):
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    whisperx = types.ModuleType("whisperx")
    whisperx.load_model = lambda *_args, **_kwargs: types.SimpleNamespace()

    fastapi = types.ModuleType("fastapi")
    fastapi.FastAPI = FakeFastAPI
    fastapi.UploadFile = object
    fastapi.File = lambda *_args, **_kwargs: None
    fastapi.Form = lambda *_args, **_kwargs: None
    fastapi.HTTPException = FakeHTTPException
    responses = types.ModuleType("fastapi.responses")
    responses.JSONResponse = FakeJSONResponse
    uvicorn = types.ModuleType("uvicorn")
    uvicorn.run = lambda *_args, **_kwargs: None

    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "whisperx", whisperx)
    monkeypatch.setitem(sys.modules, "fastapi", fastapi)
    monkeypatch.setitem(sys.modules, "fastapi.responses", responses)
    monkeypatch.setitem(sys.modules, "uvicorn", uvicorn)

    server_path = Path(__file__).with_name("whisperx_server.py")
    spec = importlib.util.spec_from_file_location(
        "whisperx_server_auth_integration_test", server_path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.app


def invoke(app, path, key=None, method="GET"):
    observed = {"receive_calls": 0, "messages": []}

    async def receive():
        observed["receive_calls"] += 1
        return {
            "type": "http.request",
            "body": b"synthetic multipart bytes",
            "more_body": False,
        }

    async def send(message):
        observed["messages"].append(message)

    headers = [] if key is None else [(b"x-api-key", key.encode("utf-8"))]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers,
    }
    asyncio.run(app(scope, receive, send))
    observed["status"] = observed["messages"][0]["status"]
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

    result = invoke(worker_app, "/jobs", "expected")

    assert result["status"] == 200


def test_exported_app_exempts_only_exact_health(worker_app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WHISPERX_API_KEY", "expected")

    assert invoke(worker_app, "/health")["status"] == 200
    for protected_path in ["/health/extra", "/docs", "/jobs", "/status/job-1"]:
        assert invoke(worker_app, protected_path)["status"] == 401
