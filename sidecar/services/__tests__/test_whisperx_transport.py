"""Synthetic contract tests for Sidecar-to-WhisperX transport."""

import asyncio
import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# The production sidecar image installs httpx. Keep this contract suite runnable
# in the repository's minimal Python test environment without network/package
# installation, matching the neighboring meeting-intelligence tests.
if "httpx" not in sys.modules:
    sys.modules["httpx"] = types.ModuleType("httpx")
httpx = sys.modules["httpx"]


class HTTPStatusError(Exception):
    def __init__(self, response):
        super().__init__(f"HTTP {response.status_code}")
        self.response = response


class StubResponse:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self.body = body

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise HTTPStatusError(self)


httpx.HTTPStatusError = HTTPStatusError

from services import meeting_intelligence  # noqa: E402


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.responses[("POST", url.rsplit("/", 1)[-1])]

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.responses[("GET", url.split("/status/", 1)[-1])]


def http_response(method: str, url: str, status: int, body: dict):
    del method, url
    return StubResponse(status, body)


def install_client(monkeypatch, fake):
    monkeypatch.setattr(
        meeting_intelligence.httpx,
        "AsyncClient",
        lambda **_kwargs: fake,
        raising=False,
    )


def configure_worker(monkeypatch, key="synthetic-worker-key", app_env="production"):
    monkeypatch.setenv("LEGACY_TRANSCRIPTION_ENABLED", "true")
    monkeypatch.setattr(
        meeting_intelligence, "WHISPERX_URL", "http://synthetic-worker:8002"
    )
    monkeypatch.setattr(meeting_intelligence, "WHISPERX_API_KEY", key)
    monkeypatch.setenv("APP_ENV", app_env)


def run(coro):
    return asyncio.run(coro)


def test_submit_uses_audio_field_camelcase_job_id_and_api_key(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/transcribe"
    fake = FakeClient(
        {("POST", "transcribe"): http_response("POST", url, 200, {"jobId": "j-1"})}
    )
    install_client(monkeypatch, fake)

    job_id = run(
        meeting_intelligence.submit_whisperx_job(
            b"synthetic audio", "meeting.wav", num_speakers=3
        )
    )

    assert job_id == "j-1"
    _, called_url, kwargs = fake.calls[0]
    assert called_url == url
    assert set(kwargs["files"]) == {"audio"}
    assert kwargs["data"] == {"num_speakers": "3"}
    assert kwargs["headers"] == {"X-API-Key": "synthetic-worker-key"}


def test_submit_rejects_deprecated_snakecase_response(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/transcribe"
    fake = FakeClient(
        {("POST", "transcribe"): http_response("POST", url, 200, {"job_id": "j-1"})}
    )
    install_client(monkeypatch, fake)

    with pytest.raises(KeyError, match="jobId"):
        run(meeting_intelligence.submit_whisperx_job(b"audio", "meeting.wav"))


def test_submit_fails_closed_before_http_when_worker_key_missing(monkeypatch):
    configure_worker(monkeypatch, key="", app_env="staging")

    def forbidden_client(**_kwargs):
        raise AssertionError("HTTP client must not be constructed")

    monkeypatch.setattr(
        meeting_intelligence.httpx, "AsyncClient", forbidden_client, raising=False
    )

    with pytest.raises(RuntimeError, match="WHISPERX_API_KEY"):
        run(meeting_intelligence.submit_whisperx_job(b"audio", "meeting.wav"))


def test_submit_explicit_local_mode_allows_keyless_synthetic_call(monkeypatch):
    configure_worker(monkeypatch, key="", app_env="local")
    url = "http://synthetic-worker:8002/transcribe"
    fake = FakeClient(
        {("POST", "transcribe"): http_response("POST", url, 200, {"jobId": "j-1"})}
    )
    install_client(monkeypatch, fake)

    run(meeting_intelligence.submit_whisperx_job(b"audio", "meeting.wav"))

    assert fake.calls[0][2]["headers"] == {}


def test_poll_uses_single_status_endpoint_with_api_key(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/status/j-1"
    fake = FakeClient(
        {("GET", "j-1"): http_response("GET", url, 200, {"status": "processing"})}
    )
    install_client(monkeypatch, fake)

    result = run(meeting_intelligence.poll_whisperx_status("j-1"))

    assert result == {"status": "processing"}
    assert fake.calls == [
        (
            "GET",
            url,
            {"headers": {"X-API-Key": "synthetic-worker-key"}},
        )
    ]
    assert "/job/" not in fake.calls[0][1]
    assert "/artifacts/" not in fake.calls[0][1]


def test_poll_returns_flat_completed_payload(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/status/j-1"
    participants = [
        {"speakerLabel": "SPEAKER_00", "name": "Speaker 00", "wordCount": 3}
    ]
    worker_payload = {
        "status": "completed",
        "transcript": "[00:01] SPEAKER_00: Synthetic text",
        "rawTranscript": json.dumps({"segments": []}),
        "durationSeconds": 42,
        "participants": participants,
    }
    fake = FakeClient(
        {("GET", "j-1"): http_response("GET", url, 200, worker_payload)}
    )
    install_client(monkeypatch, fake)

    result = run(meeting_intelligence.poll_whisperx_status("j-1"))

    assert result == worker_payload


def test_poll_maps_worker_error(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/status/j-1"
    fake = FakeClient(
        {
            ("GET", "j-1"): http_response(
                "GET", url, 200, {"status": "error", "error": "synthetic OOM"}
            )
        }
    )
    install_client(monkeypatch, fake)

    result = run(meeting_intelligence.poll_whisperx_status("j-1"))

    assert result == {"status": "error", "error": "synthetic OOM"}


def test_poll_maps_404_to_worker_restart_recovery(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/status/lost"
    fake = FakeClient(
        {("GET", "lost"): http_response("GET", url, 404, {"detail": "not found"})}
    )
    install_client(monkeypatch, fake)

    result = run(meeting_intelligence.poll_whisperx_status("lost"))

    assert result["status"] == "error"
    assert "restarted" in result["error"]


def test_poll_propagates_non_404_http_error(monkeypatch):
    configure_worker(monkeypatch)
    url = "http://synthetic-worker:8002/status/j-1"
    fake = FakeClient(
        {("GET", "j-1"): http_response("GET", url, 503, {"detail": "busy"})}
    )
    install_client(monkeypatch, fake)

    with pytest.raises(HTTPStatusError) as raised:
        run(meeting_intelligence.poll_whisperx_status("j-1"))

    assert raised.value.response.status_code == 503


def test_poll_fails_closed_before_http_when_worker_key_missing(monkeypatch):
    configure_worker(monkeypatch, key="", app_env="production")

    def forbidden_client(**_kwargs):
        raise AssertionError("HTTP client must not be constructed")

    monkeypatch.setattr(
        meeting_intelligence.httpx, "AsyncClient", forbidden_client, raising=False
    )

    with pytest.raises(RuntimeError, match="WHISPERX_API_KEY"):
        run(meeting_intelligence.poll_whisperx_status("j-1"))
