"""Polling lifecycle for the outbound-only worker client."""

from __future__ import annotations

from pathlib import Path
import signal
import tempfile
from threading import Event, Thread
from typing import Any

from .client import (
    ChecksumMismatch,
    Claim,
    LeaseEnded,
    RetryPolicy,
    TransferCanceled,
    WorkerApiClient,
    WorkerClientError,
)
from .logging_utils import StructuredLogger
from .processor import ProcessingCanceled, Processor


class CompositeEvent:
    def __init__(self, *events: Event) -> None:
        self._events = events

    def is_set(self) -> bool:
        return any(event.is_set() for event in self._events)


class HeartbeatLifecycle:
    def __init__(
        self,
        client: WorkerApiClient,
        claim: Claim,
        interval_seconds: float,
        cancel_event: Event,
        logger: StructuredLogger,
    ) -> None:
        self._client = client
        self._claim = claim
        self._interval = interval_seconds
        self._cancel_event = cancel_event
        self._logger = logger
        self._stop = Event()
        self._thread: Thread | None = None
        self.failure: Exception | None = None

    def start(self) -> None:
        self._thread = Thread(target=self._run, name=f"meeting-heartbeat-{self._claim.job_id}", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._client.heartbeat(self._claim)
                self._logger.info("worker_heartbeat", job_id=self._claim.job_id)
            except Exception as error:
                self.failure = error
                self._cancel_event.set()
                return

    def raise_if_failed(self) -> None:
        if self.failure is not None:
            raise self.failure

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()


class WorkerService:
    def __init__(
        self,
        client: WorkerApiClient,
        processor: Processor,
        scratch_directory: Path,
        poll_interval_seconds: float,
        heartbeat_interval_seconds: float,
        backoff_initial_seconds: float,
        backoff_max_seconds: float,
        logger: StructuredLogger,
        shutdown_event: Event | None = None,
    ) -> None:
        self._client = client
        self._processor = processor
        self._scratch = scratch_directory
        self._poll_interval = poll_interval_seconds
        self._heartbeat_interval = heartbeat_interval_seconds
        self._backoff_initial = backoff_initial_seconds
        self._backoff_max = backoff_max_seconds
        self._logger = logger
        self.shutdown_event = shutdown_event or Event()

    def request_shutdown(self, *_unused: Any) -> None:
        self.shutdown_event.set()
        self._logger.info("worker_shutdown_requested", worker_id=self._client.worker_id)

    def install_signal_handlers(self) -> None:
        signal.signal(signal.SIGINT, self.request_shutdown)
        signal.signal(signal.SIGTERM, self.request_shutdown)

    def _progress(self, claim: Claim, heartbeat: HeartbeatLifecycle, stage: str, percent: int) -> None:
        if self.shutdown_event.is_set():
            raise ProcessingCanceled("worker shutdown requested")
        heartbeat.raise_if_failed()
        self._client.progress(claim, stage, percent)
        heartbeat.raise_if_failed()
        self._logger.info("worker_progress", job_id=claim.job_id, stage=stage, percent=percent)

    def _submit_failure(self, claim: Claim, error_code: str, message: str) -> None:
        try:
            self._client.fail(claim, error_code, message)
            self._logger.warning("worker_failure_submitted", job_id=claim.job_id, error_code=error_code)
        except LeaseEnded as error:
            self._logger.info("worker_job_aborted", job_id=claim.job_id, error_code=error.reason)
        except WorkerClientError as error:
            self._logger.error(
                "worker_failure_submission_failed",
                job_id=claim.job_id,
                error_type=type(error).__name__,
            )

    def _process_claim(self, claim: Claim) -> None:
        self._scratch.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._scratch.chmod(0o700)
        job_cancel = Event()
        heartbeat = HeartbeatLifecycle(
            self._client,
            claim,
            self._heartbeat_interval,
            job_cancel,
            self._logger,
        )
        heartbeat_started = False
        try:
            with tempfile.TemporaryDirectory(prefix=f"job-{claim.job_id}-", dir=self._scratch) as temporary:
                media_path = Path(temporary) / "source-media"
                self._client.heartbeat(claim)
                heartbeat.start()
                heartbeat_started = True
                self._progress(claim, heartbeat, "media_fetch", 10)
                cancel = CompositeEvent(self.shutdown_event, job_cancel)
                source_checksum = self._client.download_media(claim, media_path, cancel)
                heartbeat.raise_if_failed()
                result = self._processor.process(
                    media_path,
                    claim.job_id,
                    cancel,
                    lambda stage, percent: self._progress(claim, heartbeat, stage, percent),
                )
                self._progress(claim, heartbeat, "persist", 95)
                if cancel.is_set():
                    raise ProcessingCanceled("job canceled before completion")
                heartbeat.raise_if_failed()
                self._client.complete(claim, source_checksum, result)
                self._logger.info("worker_job_completed", job_id=claim.job_id)
        except LeaseEnded as error:
            self._logger.info("worker_job_aborted", job_id=claim.job_id, error_code=error.reason)
        except ChecksumMismatch:
            self._submit_failure(
                claim,
                "MEDIA_CHECKSUM_MISMATCH",
                "Downloaded media failed checksum verification",
            )
        except (ProcessingCanceled, TransferCanceled):
            heartbeat_failure = heartbeat.failure
            if isinstance(heartbeat_failure, LeaseEnded):
                self._logger.info("worker_job_aborted", job_id=claim.job_id, error_code=heartbeat_failure.reason)
            elif self.shutdown_event.is_set():
                self._submit_failure(claim, "WORKER_SHUTDOWN", "Worker stopped during local processing")
            else:
                self._submit_failure(claim, "HEARTBEAT_FAILED", "Worker heartbeat failed during local processing")
        except WorkerClientError as error:
            self._submit_failure(claim, "WORKER_CLIENT_FAILURE", "Worker client could not complete the job")
            self._logger.error("worker_job_failed", job_id=claim.job_id, error_type=type(error).__name__)
        except Exception as error:
            self._submit_failure(claim, "PROCESSING_FAILED", "Local processing failed")
            self._logger.error("worker_job_failed", job_id=claim.job_id, error_type=type(error).__name__)
        finally:
            if heartbeat_started:
                heartbeat.stop()

    def run_once(self) -> bool:
        if self.shutdown_event.is_set():
            return False
        claim = self._client.claim()
        if claim is None:
            self._logger.info("worker_poll_empty", worker_id=self._client.worker_id)
            return False
        self._logger.info("worker_job_claimed", job_id=claim.job_id, worker_id=self._client.worker_id)
        self._process_claim(claim)
        return True

    def run_forever(self) -> None:
        failures = 0
        self._logger.info("worker_started", worker_id=self._client.worker_id)
        while not self.shutdown_event.is_set():
            try:
                had_job = self.run_once()
                failures = 0
                if not had_job:
                    self.shutdown_event.wait(self._poll_interval)
            except WorkerClientError as error:
                delay = RetryPolicy(1, self._backoff_initial, self._backoff_max).delay(failures)
                failures += 1
                self._logger.warning(
                    "worker_poll_failed",
                    worker_id=self._client.worker_id,
                    error_type=type(error).__name__,
                    delay_seconds=delay,
                )
                self.shutdown_event.wait(delay)
        self._logger.info("worker_stopped", worker_id=self._client.worker_id)
