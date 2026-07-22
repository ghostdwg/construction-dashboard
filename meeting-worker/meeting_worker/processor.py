"""Processor seam and deterministic offline fixture implementation."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Protocol

from .client import ProcessingResult
from .contract import ToolVersions, TranscriptSegment


class ProcessingCanceled(RuntimeError):
    """Raised when shutdown or lease cancellation interrupts processing."""


ProgressCallback = Callable[[str, int], None]


class CancellationSignal(Protocol):
    def is_set(self) -> bool: ...


class Processor(Protocol):
    def process(
        self,
        media_path: Path,
        job_id: int,
        cancel_event: CancellationSignal,
        progress: ProgressCallback,
    ) -> ProcessingResult: ...


class DeterministicFixtureProcessor:
    """Canned contract fixture. It performs no inference and reads no media content."""

    TOOL_VERSIONS = ToolVersions(
        transcription_tool="groundworx-deterministic-python-fixture",
        transcription_model="canned-fixture",
        transcription_version="1",
        diarization_tool="groundworx-deterministic-python-fixture",
        diarization_model="fixed-speaker-labels",
        diarization_version="1",
    )

    @staticmethod
    def _check(cancel_event: CancellationSignal) -> None:
        if cancel_event.is_set():
            raise ProcessingCanceled("processing canceled")

    def process(
        self,
        media_path: Path,
        job_id: int,
        cancel_event: CancellationSignal,
        progress: ProgressCallback,
    ) -> ProcessingResult:
        del media_path
        self._check(cancel_event)
        progress("normalize", 30)
        self._check(cancel_event)
        progress("transcribe", 65)
        self._check(cancel_event)
        progress("diarize", 85)
        self._check(cancel_event)

        opening = f"PYTHON FIXTURE WORKER JOB {job_id}. This is deterministic development output, not AI transcription."
        action = "The contractor will submit the revised RFI response by 2026-07-30."
        decision = "The team decided to use the alternate flashing detail."
        segments = (
            TranscriptSegment(opening, "UNKNOWN_SPEAKER", 0, 4, 1),
            TranscriptSegment(action, "SPEAKER_1", 4, 9, 1),
            TranscriptSegment(decision, "SPEAKER_2", 9, 13, 1),
        )
        return ProcessingResult(
            transcript_text="\n".join((opening, action, decision)),
            segments=segments,
            tool_versions=self.TOOL_VERSIONS,
            raw_artifact={
                "status": "fixture",
                "realAi": False,
                "source": "deterministic-canned-development-output",
            },
        )
