from __future__ import annotations

from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest

from meeting_worker.client import ChecksumMismatch, LeaseEnded
from meeting_worker.logging_utils import configure_logging
from meeting_worker.processor import DeterministicFixtureProcessor, ProcessingCanceled
from meeting_worker.worker import HeartbeatLifecycle, WorkerService

from tests.helpers import RecordingClient, RaisingProcessor, claim


def service(client: RecordingClient, processor: object, scratch: Path, shutdown: Event | None = None) -> WorkerService:
    return WorkerService(
        client,  # type: ignore[arg-type]
        processor,  # type: ignore[arg-type]
        scratch,
        poll_interval_seconds=0.01,
        heartbeat_interval_seconds=60,
        backoff_initial_seconds=0.01,
        backoff_max_seconds=0.1,
        logger=configure_logging("INFO", ("lease-secret",), StringIO()),
        shutdown_event=shutdown,
    )


class WorkerLifecycleTests(unittest.TestCase):
    def test_progress_completion_and_temporary_file_cleanup(self) -> None:
        with TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            api = RecordingClient(claim())
            self.assertTrue(service(api, DeterministicFixtureProcessor(), scratch).run_once())
            self.assertEqual(
                api.progress_updates,
                [("media_fetch", 10), ("normalize", 30), ("transcribe", 65), ("diarize", 85), ("persist", 95)],
            )
            self.assertEqual(len(api.heartbeats), 1)
            self.assertEqual(len(api.completions), 1)
            self.assertEqual(api.failures, [])
            self.assertEqual(list(scratch.iterdir()), [])

    def test_processing_failure_submits_bounded_failure_and_cleans_up(self) -> None:
        with TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            api = RecordingClient(claim())
            service(api, RaisingProcessor(), scratch).run_once()
            self.assertEqual(api.failures, [("PROCESSING_FAILED", "Local processing failed")])
            self.assertEqual(list(scratch.iterdir()), [])

    def test_checksum_mismatch_submits_specific_failure_and_cleans_up(self) -> None:
        class MismatchClient(RecordingClient):
            def download_media(self, current: object, destination: Path) -> str:
                del current
                destination.write_bytes(b"tampered")
                raise ChecksumMismatch("mismatch")

        with TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            api = MismatchClient(claim())
            service(api, DeterministicFixtureProcessor(), scratch).run_once()
            self.assertEqual(
                api.failures,
                [("MEDIA_CHECKSUM_MISMATCH", "Downloaded media failed checksum verification")],
            )
            self.assertEqual(list(scratch.iterdir()), [])

    def test_shutdown_during_processing_is_reported_then_stops_polling(self) -> None:
        shutdown = Event()

        class ShutdownProcessor:
            def process(self, media_path: Path, job_id: int, cancel_event: Event, progress: object) -> object:
                del media_path, job_id, cancel_event, progress
                shutdown.set()
                raise ProcessingCanceled("shutdown")

        with TemporaryDirectory() as temporary:
            api = RecordingClient(claim())
            worker = service(api, ShutdownProcessor(), Path(temporary) / "scratch", shutdown)
            self.assertTrue(worker.run_once())
            self.assertEqual(api.failures, [("WORKER_SHUTDOWN", "Worker stopped during local processing")])
            self.assertFalse(worker.run_once())
            self.assertEqual(api.claim_calls, 1)

    def test_no_job_returns_without_processing(self) -> None:
        with TemporaryDirectory() as temporary:
            api = RecordingClient(None)
            self.assertFalse(service(api, DeterministicFixtureProcessor(), Path(temporary) / "scratch").run_once())
            self.assertEqual(api.progress_updates, [])

    def test_heartbeat_lifecycle_observes_cancellation(self) -> None:
        canceled = Event()

        class CancelingClient(RecordingClient):
            def heartbeat(self, current: object) -> dict[str, object]:
                del current
                canceled.set()
                raise LeaseEnded(409, "canceled")

        api = CancelingClient(None)
        job_cancel = Event()
        lifecycle = HeartbeatLifecycle(
            api,  # type: ignore[arg-type]
            claim(),
            0.01,
            job_cancel,
            configure_logging("INFO", (), StringIO()),
        )
        lifecycle.start()
        self.assertTrue(canceled.wait(1))
        lifecycle.stop()
        self.assertTrue(job_cancel.is_set())
        with self.assertRaises(LeaseEnded):
            lifecycle.raise_if_failed()


if __name__ == "__main__":
    unittest.main()
