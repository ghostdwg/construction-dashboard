from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest

from meeting_worker.contract import ToolVersions, TranscriptSegment, js_json_dumps, result_checksum
from meeting_worker.processor import DeterministicFixtureProcessor


class ContractTests(unittest.TestCase):
    def test_checksum_matches_typescript_json_stringify_vector(self) -> None:
        checksum = result_checksum(
            "Hello Ω",
            (TranscriptSegment("Hello Ω", "SPEAKER_1", 0, 1.25, 0.9),),
            ToolVersions("fixture", "model", "1"),
            '{"realAi":false}',
        )
        self.assertEqual(checksum, "3ef68db2e676517aa14e5ace82869ada83e03a00d1975d037d1526c9d53aaf02")

    def test_serializer_uses_javascript_number_boundaries(self) -> None:
        self.assertEqual(js_json_dumps([1.0, 1e-6, 1e-7, 1e20, -0.0]), "[1,0.000001,1e-7,100000000000000000000,0]")


class ProcessorTests(unittest.TestCase):
    def test_deterministic_transcript_fixture(self) -> None:
        with TemporaryDirectory() as temporary:
            media = Path(temporary) / "media"
            media.write_bytes(b"ignored fixture bytes")
            updates: list[tuple[str, int]] = []
            result = DeterministicFixtureProcessor().process(media, 23, Event(), lambda stage, percent: updates.append((stage, percent)))
        self.assertIn("PYTHON FIXTURE WORKER JOB 23", result.transcript_text)
        self.assertEqual(len(result.segments), 3)
        self.assertEqual(result.segments[1].speaker_label, "SPEAKER_1")
        self.assertEqual(updates, [("normalize", 30), ("transcribe", 65), ("diarize", 85)])
        self.assertEqual(result.raw_artifact["realAi"], False)


if __name__ == "__main__":
    unittest.main()
