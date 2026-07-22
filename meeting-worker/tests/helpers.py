from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from threading import Event
from typing import Any

from meeting_worker.client import Claim, ProcessingResult


class FakeResponse:
    def __init__(self, body: bytes = b"{}", status: int = 200, headers: dict[str, str] | None = None) -> None:
        self._body = BytesIO(body)
        self.status = status
        self.headers = headers or {}
        self.closed = False

    def read(self, amount: int = -1) -> bytes:
        return self._body.read(amount)

    def getcode(self) -> int:
        return self.status

    def close(self) -> None:
        self.closed = True


class FakeOpener:
    def __init__(self, *results: Any) -> None:
        self.results = list(results)
        self.requests: list[Any] = []

    def open(self, request: Any, timeout: float) -> FakeResponse:
        self.requests.append(request)
        if not self.results:
            raise AssertionError("unexpected HTTP request")
        result = self.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


def json_response(payload: dict[str, Any], status: int = 200) -> FakeResponse:
    return FakeResponse(json.dumps(payload).encode("utf-8"), status, {"Content-Type": "application/json"})


def claim(job_id: int = 17, lease_token: str = "lease-secret") -> Claim:
    return Claim(
        job_id=job_id,
        artifact_id=27,
        meeting_id=37,
        bid_id=47,
        media_download_url=f"/api/worker/meeting-intelligence/{job_id}/media",
        lease_token=lease_token,
        lease_expires_at="2026-07-22T18:00:00.000Z",
    )


class RecordingClient:
    def __init__(self, claimed: Claim | None, media: bytes = b"fixture-media") -> None:
        self.worker_id = "test-worker"
        self.claimed = claimed
        self.media = media
        self.heartbeats: list[Claim] = []
        self.progress_updates: list[tuple[str, int]] = []
        self.completions: list[tuple[str, ProcessingResult]] = []
        self.failures: list[tuple[str, str]] = []
        self.claim_calls = 0

    def claim(self) -> Claim | None:
        self.claim_calls += 1
        value, self.claimed = self.claimed, None
        return value

    def heartbeat(self, current: Claim) -> dict[str, Any]:
        self.heartbeats.append(current)
        return {"ok": True}

    def progress(self, current: Claim, stage: str, percent: int) -> dict[str, Any]:
        del current
        self.progress_updates.append((stage, percent))
        return {"ok": True}

    def download_media(self, current: Claim, destination: Path, cancel_event: Event | None = None) -> str:
        del current, cancel_event
        import hashlib

        destination.write_bytes(self.media)
        return hashlib.sha256(self.media).hexdigest()

    def complete(self, current: Claim, source_checksum: str, result: ProcessingResult) -> dict[str, Any]:
        del current
        self.completions.append((source_checksum, result))
        return {"ok": True}

    def fail(self, current: Claim, error_code: str, error_message: str) -> dict[str, Any]:
        del current
        self.failures.append((error_code, error_message))
        return {"ok": True}


class RaisingProcessor:
    def process(self, media_path: Path, job_id: int, cancel_event: Event, progress: Any) -> ProcessingResult:
        del media_path, job_id, cancel_event, progress
        raise RuntimeError("sensitive transcript-like diagnostic")
