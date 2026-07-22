from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.error import URLError

from meeting_worker.client import (
    ChecksumMismatch,
    LeaseEnded,
    ProcessingResult,
    ProtocolError,
    RetryPolicy,
    WorkerApiClient,
)
from meeting_worker.contract import ToolVersions, TranscriptSegment, js_json_dumps, result_checksum

from tests.helpers import FakeOpener, FakeResponse, claim, json_response


def client(opener: FakeOpener, attempts: int = 1, sleeps: list[float] | None = None) -> WorkerApiClient:
    recorded_sleeps = sleeps if sleeps is not None else []
    return WorkerApiClient(
        "http://127.0.0.1:3000",
        "worker-secret",
        "worker-a",
        5,
        RetryPolicy(attempts, 0.25, 2),
        1024 * 1024,
        opener=opener,
        sleep=recorded_sleeps.append,
    )


def request_json(request: object) -> dict[str, object]:
    return json.loads(request.data.decode("utf-8"))  # type: ignore[attr-defined,union-attr]


def request_headers(request: object) -> dict[str, str]:
    return {key.lower(): value for key, value in request.header_items()}  # type: ignore[attr-defined]


class ClientTests(unittest.TestCase):
    def test_claim_request_matches_committed_route(self) -> None:
        opener = FakeOpener(
            json_response(
                {
                    "ok": True,
                    "jobId": 17,
                    "artifactId": 27,
                    "meetingId": 37,
                    "bidId": 47,
                    "mediaDownloadUrl": "/api/worker/meeting-intelligence/17/media",
                    "leaseToken": "lease-secret",
                    "leaseExpiresAt": "2026-07-22T18:00:00.000Z",
                }
            )
        )
        claimed = client(opener).claim()
        self.assertEqual(claimed, claim())
        request = opener.requests[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, "http://127.0.0.1:3000/api/worker/meeting-intelligence/claim")
        self.assertEqual(request_json(request), {"workerId": "worker-a"})
        self.assertEqual(request_headers(request)["x-meeting-worker-token"], "worker-secret")

    def test_no_job_polling_response(self) -> None:
        opener = FakeOpener(json_response({"ok": True, "jobId": None}))
        self.assertIsNone(client(opener).claim())

    def test_lease_token_propagates_in_json_and_media_header(self) -> None:
        media = b"media"
        digest = hashlib.sha256(media).hexdigest()
        opener = FakeOpener(
            json_response({"ok": True}),
            json_response({"ok": True}),
            FakeResponse(media, headers={"X-Content-SHA256": digest, "Content-Length": str(len(media))}),
        )
        api = client(opener)
        current = claim()
        api.heartbeat(current)
        api.progress(current, "transcribe", 65)
        with TemporaryDirectory() as temporary:
            api.download_media(current, Path(temporary) / "media")
        self.assertEqual(request_json(opener.requests[0]), {"leaseToken": "lease-secret"})
        self.assertEqual(request_json(opener.requests[1])["leaseToken"], "lease-secret")
        self.assertEqual(request_headers(opener.requests[2])["x-meeting-worker-lease"], "lease-secret")
        for request in opener.requests:
            self.assertEqual(request_headers(request)["x-meeting-worker-token"], "worker-secret")

    def test_checksum_success_streams_to_file(self) -> None:
        media = b"abcdef" * 20_000
        digest = hashlib.sha256(media).hexdigest()
        opener = FakeOpener(FakeResponse(media, headers={"X-Content-SHA256": digest}))
        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "media"
            actual = client(opener).download_media(claim(), destination)
            self.assertEqual(actual, digest)
            self.assertEqual(destination.read_bytes(), media)

    def test_checksum_mismatch_is_rejected(self) -> None:
        opener = FakeOpener(FakeResponse(b"tampered", headers={"X-Content-SHA256": "0" * 64}))
        with TemporaryDirectory() as temporary:
            with self.assertRaises(ChecksumMismatch):
                client(opener).download_media(claim(), Path(temporary) / "media")

    def test_media_route_cannot_change_origin(self) -> None:
        current = claim()
        unsafe = type(current)(
            current.job_id,
            current.artifact_id,
            current.meeting_id,
            current.bid_id,
            "https://untrusted.invalid/media",
            current.lease_token,
            current.lease_expires_at,
        )
        with TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(Exception, "media route"):
                client(FakeOpener()).download_media(unsafe, Path(temporary) / "media")

    def test_cancellation_response_aborts_lease(self) -> None:
        opener = FakeOpener(json_response({"ok": False, "reason": "canceled"}, status=409))
        with self.assertRaises(LeaseEnded) as raised:
            client(opener).heartbeat(claim())
        self.assertEqual(raised.exception.reason, "canceled")

    def test_completion_payload_and_checksum(self) -> None:
        opener = FakeOpener(json_response({"ok": True, "artifactId": 27, "alreadySubmitted": False}))
        result = ProcessingResult(
            transcript_text="Hello",
            segments=(TranscriptSegment("Hello", "SPEAKER_1", 0, 1, 1),),
            tool_versions=ToolVersions("fixture", "model", "1"),
            raw_artifact={"realAi": False},
        )
        api = client(opener)
        api.complete(claim(), "a" * 64, result)
        payload = request_json(opener.requests[0])
        expected = result_checksum("Hello", result.segments, result.tool_versions, js_json_dumps(result.raw_artifact))
        self.assertEqual(payload["leaseToken"], "lease-secret")
        self.assertEqual(payload["resultChecksum"], expected)
        self.assertEqual(payload["sourceMediaChecksum"], "a" * 64)
        self.assertEqual(payload["segments"][0]["segmentIndex"], 0)  # type: ignore[index]
        self.assertEqual(payload["toolVersions"]["transcriptionTool"], "fixture")  # type: ignore[index]

    def test_noncanonical_completion_is_rejected_before_http(self) -> None:
        opener = FakeOpener()
        result = ProcessingResult(
            transcript_text=" trailing space ",
            segments=(TranscriptSegment("text", "SPEAKER_1", 0, 1, 1),),
            tool_versions=ToolVersions("fixture", "model", "1"),
        )
        with self.assertRaises(ProtocolError):
            client(opener).complete(claim(), "a" * 64, result)
        self.assertEqual(opener.requests, [])

    def test_failure_payload_is_bounded(self) -> None:
        opener = FakeOpener(json_response({"ok": True, "willRetry": True, "nextAttempt": 2}))
        api = client(opener)
        api.fail(claim(), "media checksum mismatch", "x" * 700)
        payload = request_json(opener.requests[0])
        self.assertEqual(payload["errorCode"], "MEDIA_CHECKSUM_MISMATCH")
        self.assertEqual(len(payload["errorMessage"]), 500)

    def test_retry_uses_exponential_backoff(self) -> None:
        sleeps: list[float] = []
        opener = FakeOpener(URLError("offline"), URLError("offline"), json_response({"ok": True}))
        api = client(opener, attempts=3, sleeps=sleeps)
        api.heartbeat(claim())
        self.assertEqual(sleeps, [0.25, 0.5])
        self.assertEqual(len(opener.requests), 3)

    def test_claim_is_not_retried_after_ambiguous_transport_failure(self) -> None:
        sleeps: list[float] = []
        opener = FakeOpener(URLError("response lost"), json_response({"ok": True, "jobId": None}))
        with self.assertRaisesRegex(Exception, "transport failed"):
            client(opener, attempts=3, sleeps=sleeps).claim()
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(sleeps, [])


if __name__ == "__main__":
    unittest.main()
