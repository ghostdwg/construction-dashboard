"""Command-line entry points for the worker loop and offline fixture."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys
from threading import Event

from .client import ProcessingResult, RetryPolicy, WorkerApiClient
from .config import ConfigurationError, WorkerConfig
from .contract import js_json_dumps, result_checksum
from .logging_utils import configure_logging
from .processor import DeterministicFixtureProcessor
from .worker import WorkerService


def _file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(64 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _completion_fixture(media_path: Path, job_id: int) -> dict[str, object]:
    processor = DeterministicFixtureProcessor()
    result: ProcessingResult = processor.process(media_path, job_id, Event(), lambda _stage, _percent: None)
    raw_json = js_json_dumps(result.raw_artifact) if result.raw_artifact is not None else None
    return {
        "transcriptText": result.transcript_text,
        "segments": [segment.as_payload(index) for index, segment in enumerate(result.segments)],
        "sourceMediaChecksum": _file_checksum(media_path),
        "resultChecksum": result_checksum(result.transcript_text, result.segments, result.tool_versions, raw_json),
        "toolVersions": result.tool_versions.as_payload(),
        "rawArtifact": result.raw_artifact,
    }


def _run_worker() -> int:
    try:
        config = WorkerConfig.from_env()
    except ConfigurationError as error:
        sys.stderr.write(f"configuration error: {error}\n")
        return 2
    logger = configure_logging(config.log_level, (config.worker_token,))
    retry = RetryPolicy(config.request_attempts, config.backoff_initial_seconds, config.backoff_max_seconds)
    client = WorkerApiClient(
        config.base_url,
        config.worker_token,
        config.worker_id,
        config.request_timeout_seconds,
        retry,
        config.max_media_bytes,
    )
    service = WorkerService(
        client,
        DeterministicFixtureProcessor(),
        config.scratch_directory,
        config.poll_interval_seconds,
        config.heartbeat_interval_seconds,
        config.backoff_initial_seconds,
        config.backoff_max_seconds,
        logger,
    )
    service.install_signal_handlers()
    service.run_forever()
    return 0


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="GroundworX outbound Meeting Intelligence worker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("run", help="poll the configured durable worker queue")
    fixture = subparsers.add_parser("fixture", help="emit an offline deterministic completion fixture")
    fixture.add_argument("--media", required=True, type=Path, help="local media fixture used only for its checksum")
    fixture.add_argument("--job-id", required=True, type=int)
    parsed = parser.parse_args(arguments)

    if parsed.command == "fixture":
        if parsed.job_id <= 0 or not parsed.media.is_file():
            parser.error("--job-id must be positive and --media must name a file")
        sys.stdout.write(js_json_dumps(_completion_fixture(parsed.media, parsed.job_id)) + "\n")
        return 0
    return _run_worker()


if __name__ == "__main__":
    raise SystemExit(main())
