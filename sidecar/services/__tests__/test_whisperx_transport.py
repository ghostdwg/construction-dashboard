"""
Offline tests for the WhisperX sidecar transport layer:
  - submit_whisperx_job: camelCase "jobId" key (Bug 1 regression guard)
  - poll_whisperx_status: single GET /status/{id} contract (Bug 2 regression guard)
  - poll_whisperx_status: HTTP 404 → "Worker restarted" error (restart recovery)

No real network; httpx is monkeypatched throughout.

Runnable two ways:
  * plain stdlib:  python3 sidecar/services/__tests__/test_whisperx_transport.py
  * pytest:        pytest sidecar/services/__tests__/test_whisperx_transport.py
"""
import asyncio
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Stub httpx before importing the module under test.
_httpx_stub = types.ModuleType("httpx")


class _Response:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            exc = _httpx_stub.HTTPStatusError("error", request=None, response=self)
            raise exc


class _HTTPStatusError(Exception):
    def __init__(self, msg, *, request, response):
        super().__init__(msg)
        self.response = response


_httpx_stub.HTTPStatusError = _HTTPStatusError
# Placeholder — each test overwrites this via _patch_client() before calling into
# meeting_intelligence. Must exist on the module object so _patch_client's
# `original = _httpx_stub.AsyncClient` doesn't AttributeError.
_httpx_stub.AsyncClient = None  # type: ignore[assignment]

sys.modules["httpx"] = _httpx_stub

from services import meeting_intelligence  # noqa: E402

# Restore WHISPERX_URL for tests — the module reads it at import time.
meeting_intelligence.WHISPERX_URL = "http://fake-worker:8002"
meeting_intelligence.WHISPERX_API_KEY = ""


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeAsyncClient:
    """Context-manager fake for httpx.AsyncClient."""

    def __init__(self, responses: dict):
        # responses: {(method, path_suffix): _Response}
        self._responses = responses
        self.calls: list[tuple[str, str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        for (m, suffix), resp in self._responses.items():
            if m == "POST" and url.endswith(suffix):
                return resp
        raise AssertionError(f"Unexpected POST {url}")

    async def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        for (m, suffix), resp in self._responses.items():
            if m == "GET" and url.endswith(suffix):
                return resp
        raise AssertionError(f"Unexpected GET {url}")


def _patch_client(fake: _FakeAsyncClient):
    class _CM:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return fake

        async def __aexit__(self, *_):
            pass

    original = _httpx_stub.AsyncClient
    _httpx_stub.AsyncClient = _CM
    return original, lambda orig: setattr(_httpx_stub, "AsyncClient", orig)


# ── submit_whisperx_job ───────────────────────────────────────────────────────

def test_submit_reads_camelcase_jobId_from_worker_response():
    """Bug 1 regression: worker returns {"jobId": ...}, not {"job_id": ...}."""
    fake = _FakeAsyncClient({
        ("POST", "/transcribe"): _Response(200, {"jobId": "uuid-abc-123"}),
    })
    orig, restore = _patch_client(fake)
    try:
        job_id = _run(meeting_intelligence.submit_whisperx_job(b"audio", "meeting.wav"))
    finally:
        restore(orig)

    assert job_id == "uuid-abc-123", f"Expected 'uuid-abc-123', got {job_id!r}"


def test_submit_raises_on_snake_case_key_absence():
    """If the worker ever returned snake_case job_id, submit would raise KeyError."""
    fake = _FakeAsyncClient({
        ("POST", "/transcribe"): _Response(200, {"job_id": "uuid-should-not-work"}),
    })
    orig, restore = _patch_client(fake)
    raised = None
    try:
        _run(meeting_intelligence.submit_whisperx_job(b"audio", "meeting.wav"))
    except KeyError as e:
        raised = e
    finally:
        restore(orig)

    assert raised is not None, "Expected KeyError on missing 'jobId' key"
    assert "jobId" in str(raised), f"Expected 'jobId' in error, got {raised}"


def test_submit_sends_audio_as_multipart_field_named_audio():
    """Worker expects form field 'audio', not 'file'."""
    fake = _FakeAsyncClient({
        ("POST", "/transcribe"): _Response(200, {"jobId": "job-1"}),
    })
    orig, restore = _patch_client(fake)
    try:
        _run(meeting_intelligence.submit_whisperx_job(b"audio-bytes", "test.wav"))
    finally:
        restore(orig)

    assert len(fake.calls) == 1
    _, _, kwargs = fake.calls[0]
    files = kwargs.get("files", {})
    assert "audio" in files, f"Expected 'audio' field, got {list(files.keys())}"
    assert "file" not in files, "Must not use deprecated 'file' field name"


def test_submit_passes_num_speakers_when_positive():
    fake = _FakeAsyncClient({
        ("POST", "/transcribe"): _Response(200, {"jobId": "job-2"}),
    })
    orig, restore = _patch_client(fake)
    try:
        _run(meeting_intelligence.submit_whisperx_job(b"audio", "a.wav", num_speakers=3))
    finally:
        restore(orig)

    _, _, kwargs = fake.calls[0]
    assert kwargs.get("data", {}).get("num_speakers") == "3"


# ── poll_whisperx_status ──────────────────────────────────────────────────────

def test_poll_calls_single_status_endpoint_not_job_or_artifacts():
    """Bug 2 regression: /status/{id} only, never /job/{id} or /artifacts/{id}."""
    workers_payload = {
        "status": "processing",
    }
    fake = _FakeAsyncClient({
        ("GET", "/status/job-xyz"): _Response(200, workers_payload),
    })
    orig, restore = _patch_client(fake)
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("job-xyz"))
    finally:
        restore(orig)

    assert result == {"status": "processing"}
    urls_called = [url for (_, url, __) in fake.calls]
    assert any("/status/job-xyz" in u for u in urls_called), f"Expected /status/ call, got {urls_called}"
    assert not any("/job/" in u for u in urls_called), f"Must not call /job/: {urls_called}"
    assert not any("/artifacts/" in u for u in urls_called), f"Must not call /artifacts/: {urls_called}"


def test_poll_returns_completed_with_flat_worker_response():
    participants = [{"speakerLabel": "SPEAKER_00", "name": "Speaker 1", "wordCount": 42}]
    worker_resp = {
        "status": "completed",
        "transcript": "[00:01] SPEAKER_00: Hello team.",
        "rawTranscript": json.dumps({"segments": []}),
        "durationSeconds": 300,
        "participants": participants,
    }
    fake = _FakeAsyncClient({
        ("GET", "/status/job-1"): _Response(200, worker_resp),
    })
    orig, restore = _patch_client(fake)
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("job-1"))
    finally:
        restore(orig)

    assert result["status"] == "completed"
    assert result["transcript"] == "[00:01] SPEAKER_00: Hello team."
    assert result["durationSeconds"] == 300
    assert result["participants"] == participants


def test_poll_returns_error_on_worker_error_status():
    fake = _FakeAsyncClient({
        ("GET", "/status/job-fail"): _Response(200, {"status": "error", "error": "OOM"}),
    })
    orig, restore = _patch_client(fake)
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("job-fail"))
    finally:
        restore(orig)

    assert result["status"] == "error"
    assert "OOM" in result["error"]


def test_poll_returns_error_on_404_restart_recovery():
    """Worker restart: in-memory job lost → 404 → surface as error, not exception."""
    fake = _FakeAsyncClient({
        ("GET", "/status/lost-job"): _Response(404, {"detail": "Job not found"}),
    })
    orig, restore = _patch_client(fake)
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("lost-job"))
    finally:
        restore(orig)

    assert result["status"] == "error", f"Expected error, got {result}"
    assert "restart" in result["error"].lower() or "lost" in result["error"].lower(), result


def test_poll_raises_on_non_404_http_error():
    """5xx errors from the worker should propagate — not silently become errors."""
    fake = _FakeAsyncClient({
        ("GET", "/status/job-500"): _Response(503, {}),
    })
    orig, restore = _patch_client(fake)
    raised = None
    try:
        _run(meeting_intelligence.poll_whisperx_status("job-500"))
    except _httpx_stub.HTTPStatusError as e:
        raised = e
    finally:
        restore(orig)

    assert raised is not None, "Expected HTTPStatusError on 503"
    assert raised.response.status_code == 503


def test_poll_returns_processing_for_in_progress_jobs():
    fake = _FakeAsyncClient({
        ("GET", "/status/j"): _Response(200, {"status": "processing"}),
    })
    orig, restore = _patch_client(fake)
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("j"))
    finally:
        restore(orig)
    assert result == {"status": "processing"}


# ── Provider selection guard ──────────────────────────────────────────────────

def test_submit_raises_when_whisperx_url_not_configured():
    saved = meeting_intelligence.WHISPERX_URL
    meeting_intelligence.WHISPERX_URL = ""
    raised = None
    try:
        _run(meeting_intelligence.submit_whisperx_job(b"audio", "a.wav"))
    except ValueError as e:
        raised = e
    finally:
        meeting_intelligence.WHISPERX_URL = saved
    assert raised is not None
    assert "WHISPERX_URL" in str(raised)


def test_poll_returns_error_when_whisperx_url_not_configured():
    saved = meeting_intelligence.WHISPERX_URL
    meeting_intelligence.WHISPERX_URL = ""
    try:
        result = _run(meeting_intelligence.poll_whisperx_status("any"))
    finally:
        meeting_intelligence.WHISPERX_URL = saved
    assert result["status"] == "error"
    assert "WHISPERX_URL" in result["error"]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"  ok:   {t.__name__}")
        except Exception as e:
            failures += 1
            print(f"  FAIL: {t.__name__}: {e}")
    print(f"\ntest_whisperx_transport: {'PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    import sys as _sys
    _sys.exit(1 if failures else 0)
