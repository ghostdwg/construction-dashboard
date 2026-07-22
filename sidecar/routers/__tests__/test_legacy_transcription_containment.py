"""Offline proof for fail-closed legacy transcription provider selection."""

import asyncio
import json
import sys
import types
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


class APIRouter:
    def get(self, *args, **kwargs):
        return lambda function: function

    def post(self, *args, **kwargs):
        return lambda function: function


class BaseModel:
    def __init__(self, **values):
        for key, value in values.items():
            setattr(self, key, value)


def parameter(default=None, *args, **kwargs):
    return default


fastapi = types.ModuleType("fastapi")
fastapi.APIRouter = APIRouter
fastapi.HTTPException = HTTPException
fastapi.Request = object
fastapi.UploadFile = object
fastapi.File = parameter
fastapi.Form = parameter
sys.modules["fastapi"] = fastapi

fastapi_responses = types.ModuleType("fastapi.responses")
fastapi_responses.Response = object
sys.modules["fastapi.responses"] = fastapi_responses

pydantic = types.ModuleType("pydantic")
pydantic.BaseModel = BaseModel
sys.modules["pydantic"] = pydantic

sys.modules.setdefault("httpx", types.ModuleType("httpx"))

from services.legacy_transcription_policy import (  # noqa: E402
    external_transcription_enabled,
    legacy_transcription_enabled,
)


SYNTHETIC_SECRET = "synthetic-provider-secret-must-not-appear"
meetings = None
meeting_intelligence = None


@pytest.fixture(autouse=True)
def load_runtime_modules():
    # Import after pytest has collected neighboring offline harnesses. Several
    # of those deliberately install shared dependency stubs in sys.modules.
    global meetings, meeting_intelligence
    active_fastapi = sys.modules["fastapi"]
    active_fastapi.APIRouter = APIRouter
    active_fastapi.HTTPException = HTTPException
    active_fastapi.Request = object
    active_fastapi.UploadFile = object
    active_fastapi.File = parameter
    active_fastapi.Form = parameter
    sys.modules["fastapi.responses"] = fastapi_responses
    sys.modules["pydantic"].BaseModel = BaseModel
    from routers import meetings as meetings_module
    from services import meeting_intelligence as service_module

    meetings = meetings_module
    meeting_intelligence = service_module


class FakeUpload:
    filename = "synthetic.wav"

    def __init__(self):
        self.read_calls = 0

    async def read(self):
        self.read_calls += 1
        return b"synthetic audio bytes"


def run(coroutine):
    return asyncio.run(coroutine)


def enable_legacy(monkeypatch):
    monkeypatch.setenv("LEGACY_TRANSCRIPTION_ENABLED", "true")


def configure_providers(monkeypatch, *, whisperx_url="", assembly_key=""):
    monkeypatch.setattr(meetings, "WHISPERX_URL", whisperx_url)
    monkeypatch.setattr(meetings, "ASSEMBLYAI_API_KEY", assembly_key)


def test_missing_or_invalid_permissions_fail_closed():
    for value in (None, "", "false", "TRUE", "1", "enabled"):
        environment = {} if value is None else {"LEGACY_TRANSCRIPTION_ENABLED": value}
        assert legacy_transcription_enabled(environment) is False
        assert external_transcription_enabled(
            {"LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED": value}
        ) is False


def test_missing_legacy_gate_rejects_before_audio_or_provider_work(monkeypatch):
    monkeypatch.delenv("LEGACY_TRANSCRIPTION_ENABLED", raising=False)
    configure_providers(
        monkeypatch,
        whisperx_url="http://synthetic-whisperx.invalid",
        assembly_key=SYNTHETIC_SECRET,
    )
    upload = FakeUpload()
    whisperx = []
    assembly = []

    async def fake_whisperx(*args, **kwargs):
        whisperx.append((args, kwargs))

    async def fake_assembly(*args, **kwargs):
        assembly.append((args, kwargs))

    monkeypatch.setattr(meetings, "submit_whisperx_job", fake_whisperx)
    monkeypatch.setattr(meetings, "upload_audio_to_assemblyai", fake_assembly)

    with pytest.raises(HTTPException) as raised:
        run(meetings.start_transcription(upload, num_speakers=None))

    assert raised.value.status_code == 503
    assert raised.value.detail == "Legacy transcription processing is disabled."
    assert upload.read_calls == 0
    assert whisperx == []
    assert assembly == []
    assert SYNTHETIC_SECRET not in json.dumps(raised.value.detail)


def test_assemblyai_key_alone_never_grants_external_permission(monkeypatch):
    enable_legacy(monkeypatch)
    monkeypatch.delenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", raising=False)
    configure_providers(monkeypatch, assembly_key=SYNTHETIC_SECRET)
    assembly_calls = []

    async def fake_assembly(*args, **kwargs):
        assembly_calls.append((args, kwargs))

    monkeypatch.setattr(meetings, "upload_audio_to_assemblyai", fake_assembly)

    with pytest.raises(HTTPException) as raised:
        run(meetings.start_transcription(FakeUpload(), num_speakers=None))

    assert raised.value.status_code == 503
    assert "External transcription is disabled" in raised.value.detail
    assert assembly_calls == []
    assert SYNTHETIC_SECRET not in raised.value.detail


def test_service_layer_blocks_external_http_before_client_construction(monkeypatch):
    enable_legacy(monkeypatch)
    monkeypatch.delenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", raising=False)
    monkeypatch.setattr(
        meeting_intelligence,
        "ASSEMBLYAI_API_KEY",
        "synthetic-configured-key",
    )
    client_calls = []

    def forbidden_client(*args, **kwargs):
        client_calls.append((args, kwargs))
        raise AssertionError("HTTP client construction must not be reached")

    monkeypatch.setattr(
        meeting_intelligence.httpx,
        "AsyncClient",
        forbidden_client,
        raising=False,
    )

    with pytest.raises(ValueError, match="External transcription processing is disabled"):
        run(meeting_intelligence.upload_audio_to_assemblyai(b"synthetic audio"))

    assert client_calls == []


def test_explicit_external_permission_allows_assemblyai_without_whisperx(monkeypatch):
    enable_legacy(monkeypatch)
    monkeypatch.setenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", "true")
    configure_providers(monkeypatch, assembly_key="synthetic-configured-key")
    calls = []

    async def fake_upload(audio_bytes):
        calls.append(("upload", audio_bytes))
        return "https://synthetic.invalid/audio"

    async def fake_submit(upload_url):
        calls.append(("submit", upload_url))
        return "job-1"

    monkeypatch.setattr(meetings, "upload_audio_to_assemblyai", fake_upload)
    monkeypatch.setattr(meetings, "submit_assemblyai_job", fake_submit)

    result = run(meetings.start_transcription(FakeUpload(), num_speakers=None))

    assert result == {
        "ok": True,
        "transcriptionJobId": "AAI:job-1",
        "source": "ASSEMBLYAI",
    }
    assert [call[0] for call in calls] == ["upload", "submit"]


def test_whisperx_failure_never_falls_back_and_sanitizes_logs(monkeypatch, capsys):
    enable_legacy(monkeypatch)
    monkeypatch.setenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", "true")
    configure_providers(
        monkeypatch,
        whisperx_url="http://synthetic-whisperx.invalid",
        assembly_key="synthetic-configured-key",
    )
    assembly_calls = []

    async def failing_whisperx(*args, **kwargs):
        raise RuntimeError(f"worker failed with {SYNTHETIC_SECRET}")

    async def fake_assembly(*args, **kwargs):
        assembly_calls.append((args, kwargs))

    monkeypatch.setattr(meetings, "submit_whisperx_job", failing_whisperx)
    monkeypatch.setattr(meetings, "upload_audio_to_assemblyai", fake_assembly)

    with pytest.raises(HTTPException) as raised:
        run(meetings.start_transcription(FakeUpload(), num_speakers=None))

    captured = capsys.readouterr()
    assert raised.value.status_code == 502
    assert raised.value.detail == (
        "Local transcription service unavailable. External fallback was not attempted."
    )
    assert assembly_calls == []
    assert SYNTHETIC_SECRET not in raised.value.detail
    assert SYNTHETIC_SECRET not in captured.out
    assert SYNTHETIC_SECRET not in captured.err


def test_external_provider_failure_does_not_echo_secret(monkeypatch, capsys):
    enable_legacy(monkeypatch)
    monkeypatch.setenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", "true")
    configure_providers(monkeypatch, assembly_key="synthetic-configured-key")

    async def failing_assembly(*args, **kwargs):
        raise RuntimeError(f"external failure with {SYNTHETIC_SECRET}")

    monkeypatch.setattr(meetings, "upload_audio_to_assemblyai", failing_assembly)

    with pytest.raises(HTTPException) as raised:
        run(meetings.start_transcription(FakeUpload(), num_speakers=None))

    captured = capsys.readouterr()
    assert raised.value.status_code == 502
    assert raised.value.detail == "External transcription service unavailable."
    assert SYNTHETIC_SECRET not in raised.value.detail
    assert SYNTHETIC_SECRET not in captured.out
    assert SYNTHETIC_SECRET not in captured.err


def test_external_status_poll_requires_break_glass_permission(monkeypatch):
    enable_legacy(monkeypatch)
    monkeypatch.delenv("LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED", raising=False)
    calls = []

    async def fake_poll(job_id):
        calls.append(job_id)
        return {"status": "processing"}

    monkeypatch.setattr(meetings, "poll_assemblyai_status", fake_poll)

    with pytest.raises(HTTPException) as raised:
        run(meetings.get_transcription_status("AAI:job-1"))

    assert raised.value.status_code == 503
    assert raised.value.detail == "External transcription processing is disabled."
    assert calls == []
