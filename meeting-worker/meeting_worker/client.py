"""Standard-library HTTP client for the durable Meeting Intelligence queue."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import time
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import OpenerDirector, Request, build_opener

from . import __version__
from .contract import TranscriptSegment, ToolVersions, js_json_dumps, result_checksum


TOKEN_HEADER = "X-Meeting-Worker-Token"
LEASE_HEADER = "X-Meeting-Worker-Lease"
CHECKSUM_HEADER = "X-Content-SHA256"
API_PREFIX = "/api/worker/meeting-intelligence"
_CHECKSUM = re.compile(r"^[a-f0-9]{64}$")
_SPEAKER = re.compile(r"^(?:SPEAKER_\d+|UNKNOWN_SPEAKER)$")


class WorkerClientError(RuntimeError):
    """Base error for bounded client failures."""


class ProtocolError(WorkerClientError):
    """The app response did not match the committed contract."""


class ChecksumMismatch(WorkerClientError):
    """Downloaded media did not match the application checksum."""


class ApiResponseError(WorkerClientError):
    def __init__(self, status: int, reason: str, transient: bool = False) -> None:
        self.status = status
        self.reason = _safe_reason(reason)
        self.transient = transient
        super().__init__(f"worker API returned HTTP {status} ({self.reason})")


class LeaseEnded(ApiResponseError):
    """The server reports cancellation or loss of the current lease."""


def _safe_reason(value: object) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(value).strip().lower()).strip("_")
    return normalized[:80] or "unknown"


@dataclass(frozen=True)
class Claim:
    job_id: int
    artifact_id: int
    meeting_id: int
    bid_id: int
    media_download_url: str
    lease_token: str
    lease_expires_at: str


@dataclass(frozen=True)
class ProcessingResult:
    transcript_text: str
    segments: tuple[TranscriptSegment, ...]
    tool_versions: ToolVersions
    raw_artifact: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class RetryPolicy:
    attempts: int
    initial_seconds: float
    maximum_seconds: float

    def delay(self, attempt_index: int) -> float:
        return min(self.maximum_seconds, self.initial_seconds * (2**attempt_index))


class WorkerApiClient:
    """Outbound-only client. This class creates requests and never binds a socket."""

    def __init__(
        self,
        base_url: str,
        worker_token: str,
        worker_id: str,
        timeout_seconds: float,
        retry_policy: RetryPolicy,
        max_media_bytes: int,
        opener: OpenerDirector | Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = worker_token
        self.worker_id = worker_id
        self._timeout = timeout_seconds
        self._retry = retry_policy
        self._max_media_bytes = max_media_bytes
        self._opener = opener or build_opener()
        self._sleep = sleep

    def _url(self, path: str) -> str:
        parsed = urlsplit(path)
        if not path.startswith("/") or path.startswith("//") or parsed.scheme or parsed.netloc:
            raise ProtocolError("worker API path must be relative to the configured origin")
        return f"{self._base_url}{path}"

    def _request(self, method: str, path: str, payload: Mapping[str, Any] | None = None, extra_headers: Mapping[str, str] | None = None) -> Request:
        headers = {
            TOKEN_HEADER: self._token,
            "Accept": "application/json",
            "User-Agent": f"groundworx-meeting-worker/{__version__}",
        }
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = js_json_dumps(payload).encode("utf-8")
        if extra_headers:
            headers.update(extra_headers)
        return Request(self._url(path), data=data, headers=headers, method=method)

    @staticmethod
    def _decode_json(data: bytes) -> Mapping[str, Any]:
        if len(data) > 1024 * 1024:
            raise ProtocolError("worker API JSON response exceeded 1 MiB")
        try:
            decoded = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProtocolError("worker API returned invalid JSON") from error
        if not isinstance(decoded, dict):
            raise ProtocolError("worker API returned a non-object JSON response")
        return decoded

    @staticmethod
    def _response_error(status: int, body: bytes) -> ApiResponseError:
        reason: object = "unknown"
        try:
            decoded = json.loads(body[:1024 * 1024].decode("utf-8"))
            if isinstance(decoded, dict):
                reason = decoded.get("reason", decoded.get("error", reason))
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        safe = _safe_reason(reason)
        transient = status in {408, 425, 429} or status >= 500
        if status == 409 and safe in {"canceled", "lease_lost"}:
            return LeaseEnded(status, safe, transient=False)
        return ApiResponseError(status, safe, transient=transient)

    def _open_json_once(self, request: Request) -> Mapping[str, Any]:
        try:
            response = self._opener.open(request, timeout=self._timeout)
            try:
                status = getattr(response, "status", response.getcode())
                body = response.read(1024 * 1024 + 1)
            finally:
                response.close()
        except HTTPError as error:
            body = error.read(1024 * 1024 + 1)
            raise self._response_error(error.code, body) from None
        if status < 200 or status >= 300:
            raise self._response_error(status, body)
        return self._decode_json(body)

    def _json(self, request_factory: Callable[[], Request], retryable: bool) -> Mapping[str, Any]:
        attempts = self._retry.attempts if retryable else 1
        for attempt in range(attempts):
            try:
                return self._open_json_once(request_factory())
            except ApiResponseError as error:
                if not error.transient or attempt + 1 >= attempts:
                    raise
            except (URLError, TimeoutError, OSError) as error:
                if attempt + 1 >= attempts:
                    raise WorkerClientError("worker API transport failed") from error
            self._sleep(self._retry.delay(attempt))
        raise AssertionError("unreachable retry loop")

    def claim(self) -> Claim | None:
        body = self._json(
            lambda: self._request("POST", f"{API_PREFIX}/claim", {"workerId": self.worker_id}),
            retryable=False,
        )
        if body.get("jobId") is None:
            return None
        required_ints = ("jobId", "artifactId", "meetingId", "bidId")
        if any(not isinstance(body.get(key), int) or isinstance(body.get(key), bool) or int(body[key]) <= 0 for key in required_ints):
            raise ProtocolError("claim response contained invalid identifiers")
        media_url = body.get("mediaDownloadUrl")
        expected_media_url = f"{API_PREFIX}/{body['jobId']}/media"
        if media_url != expected_media_url:
            raise ProtocolError("claim response contained an unexpected media route")
        if not isinstance(body.get("leaseToken"), str) or not body["leaseToken"]:
            raise ProtocolError("claim response omitted the lease token")
        if not isinstance(body.get("leaseExpiresAt"), str) or not body["leaseExpiresAt"]:
            raise ProtocolError("claim response omitted the lease expiry")
        return Claim(
            job_id=body["jobId"],
            artifact_id=body["artifactId"],
            meeting_id=body["meetingId"],
            bid_id=body["bidId"],
            media_download_url=media_url,
            lease_token=body["leaseToken"],
            lease_expires_at=body["leaseExpiresAt"],
        )

    def heartbeat(self, claim: Claim) -> Mapping[str, Any]:
        return self._json(
            lambda: self._request("POST", f"{API_PREFIX}/{claim.job_id}/heartbeat", {"leaseToken": claim.lease_token}),
            retryable=True,
        )

    def progress(self, claim: Claim, stage: str, percent: int) -> Mapping[str, Any]:
        return self._json(
            lambda: self._request(
                "POST",
                f"{API_PREFIX}/{claim.job_id}/progress",
                {"leaseToken": claim.lease_token, "stage": stage, "percent": percent},
            ),
            retryable=True,
        )

    def download_media(self, claim: Claim, destination: Path) -> str:
        if claim.media_download_url != f"{API_PREFIX}/{claim.job_id}/media":
            raise ProtocolError("media route no longer matches the claimed job")
        for attempt in range(self._retry.attempts):
            request = self._request(
                "GET",
                claim.media_download_url,
                extra_headers={LEASE_HEADER: claim.lease_token, "Accept": "application/octet-stream"},
            )
            try:
                response = self._opener.open(request, timeout=self._timeout)
                try:
                    status = getattr(response, "status", response.getcode())
                    if status < 200 or status >= 300:
                        body = response.read(1024 * 1024 + 1)
                        raise self._response_error(status, body)
                    expected = str(response.headers.get(CHECKSUM_HEADER, "")).lower()
                    if not _CHECKSUM.fullmatch(expected):
                        raise ProtocolError("media response omitted a valid SHA-256 checksum")
                    content_length = response.headers.get("Content-Length")
                    if content_length:
                        try:
                            declared_length = int(content_length)
                        except ValueError as error:
                            raise ProtocolError("media response contained an invalid content length") from error
                        if declared_length < 0 or declared_length > self._max_media_bytes:
                            raise ProtocolError("media response exceeded the configured size limit")
                    digest = hashlib.sha256()
                    total = 0
                    with destination.open("wb") as output:
                        while True:
                            chunk = response.read(64 * 1024)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > self._max_media_bytes:
                                raise ProtocolError("media response exceeded the configured size limit")
                            digest.update(chunk)
                            output.write(chunk)
                    actual = digest.hexdigest()
                    if actual != expected:
                        raise ChecksumMismatch("downloaded media checksum did not match the application header")
                    return actual
                finally:
                    response.close()
            except HTTPError as error:
                api_error = self._response_error(error.code, error.read(1024 * 1024 + 1))
                if isinstance(api_error, LeaseEnded) or not api_error.transient or attempt + 1 >= self._retry.attempts:
                    raise api_error from None
            except ChecksumMismatch:
                if attempt + 1 >= self._retry.attempts:
                    raise
            except (URLError, TimeoutError, OSError) as error:
                if attempt + 1 >= self._retry.attempts:
                    raise WorkerClientError("media transport failed") from error
            self._sleep(self._retry.delay(attempt))
        raise AssertionError("unreachable retry loop")

    def complete(self, claim: Claim, source_checksum: str, result: ProcessingResult) -> Mapping[str, Any]:
        if not _CHECKSUM.fullmatch(source_checksum.lower()):
            raise ProtocolError("completion source checksum is invalid")
        if not result.transcript_text or result.transcript_text.strip() != result.transcript_text or len(result.transcript_text) > 1_000_000:
            raise ProtocolError("completion transcript text is not canonical")
        if not result.segments or len(result.segments) > 20_000:
            raise ProtocolError("completion segment count is invalid")
        for index, segment in enumerate(result.segments):
            if not segment.text or segment.text.strip() != segment.text or len(segment.text) > 20_000:
                raise ProtocolError(f"completion segment {index} text is not canonical")
            if not _SPEAKER.fullmatch(segment.speaker_label):
                raise ProtocolError(f"completion segment {index} speaker label is invalid")
            for field_name, value in (("start", segment.start_sec), ("end", segment.end_sec)):
                if value is not None and (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or value < 0
                ):
                    raise ProtocolError(f"completion segment {index} {field_name} time is invalid")
            if segment.start_sec is not None and segment.end_sec is not None and segment.end_sec < segment.start_sec:
                raise ProtocolError(f"completion segment {index} end time precedes its start")
            if segment.confidence is not None and (
                isinstance(segment.confidence, bool)
                or not isinstance(segment.confidence, (int, float))
                or not math.isfinite(segment.confidence)
                or segment.confidence < 0
                or segment.confidence > 1
            ):
                raise ProtocolError(f"completion segment {index} confidence is invalid")
        tool_payload = result.tool_versions.as_payload()
        for required in ("transcriptionTool", "transcriptionModel", "transcriptionVersion"):
            value = tool_payload[required]
            if not value or value.strip() != value or len(value) > 120:
                raise ProtocolError(f"completion {required} is invalid")
        for optional in ("diarizationTool", "diarizationModel", "diarizationVersion"):
            value = tool_payload[optional]
            if value is not None and (not value or value.strip() != value or len(value) > 120):
                raise ProtocolError(f"completion {optional} is invalid")
        try:
            raw_artifact_json = js_json_dumps(result.raw_artifact) if result.raw_artifact is not None else None
        except (TypeError, ValueError) as error:
            raise ProtocolError("completion raw artifact is not JSON-serializable") from error
        if raw_artifact_json is not None and len(raw_artifact_json) > 2_000_000:
            raise ProtocolError("completion raw artifact exceeds the application limit")
        checksum = result_checksum(
            result.transcript_text,
            result.segments,
            result.tool_versions,
            raw_artifact_json,
        )
        payload: dict[str, Any] = {
            "leaseToken": claim.lease_token,
            "transcriptText": result.transcript_text,
            "segments": [segment.as_payload(index) for index, segment in enumerate(result.segments)],
            "sourceMediaChecksum": source_checksum.lower(),
            "resultChecksum": checksum,
            "toolVersions": tool_payload,
            "rawArtifact": result.raw_artifact,
        }
        return self._json(
            lambda: self._request("POST", f"{API_PREFIX}/{claim.job_id}/complete", payload),
            retryable=True,
        )

    def fail(self, claim: Claim, error_code: str, error_message: str) -> Mapping[str, Any]:
        payload = {
            "leaseToken": claim.lease_token,
            "errorCode": _safe_reason(error_code).upper()[:80],
            "errorMessage": error_message[:500],
        }
        return self._json(
            lambda: self._request("POST", f"{API_PREFIX}/{claim.job_id}/fail", payload),
            retryable=False,
        )
