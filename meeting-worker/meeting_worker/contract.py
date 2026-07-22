"""Python representation of the committed v2 worker result contract."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import hashlib
import math
from typing import Any, Mapping, Sequence


def _quote(value: str) -> str:
    output = ['"']
    escapes = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    for character in value:
        codepoint = ord(character)
        if character in escapes:
            output.append(escapes[character])
        elif codepoint < 0x20 or 0xD800 <= codepoint <= 0xDFFF:
            output.append(f"\\u{codepoint:04x}")
        else:
            output.append(character)
    output.append('"')
    return "".join(output)


def _number(value: int | float) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        return "null"
    if value == 0:
        return "0"
    raw = repr(value).lower()
    decimal = Decimal(raw)
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        fixed = format(decimal, "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed
    coefficient, exponent = format(decimal.normalize(), "e").split("e")
    coefficient = coefficient.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    sign = "+" if exponent_value >= 0 else ""
    return f"{coefficient}e{sign}{exponent_value}"


def js_json_dumps(value: Any) -> str:
    """Serialize the contract's JSON-safe values like JavaScript JSON.stringify."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, Mapping):
        return "{" + ",".join(f"{_quote(str(key))}:{js_json_dumps(item)}" for key, item in value.items()) + "}"
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return "[" + ",".join(js_json_dumps(item) for item in value) + "]"
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")


@dataclass(frozen=True)
class TranscriptSegment:
    text: str
    speaker_label: str
    start_sec: float | int | None = None
    end_sec: float | int | None = None
    confidence: float | int | None = None

    def as_payload(self, index: int) -> dict[str, Any]:
        return {
            "segmentIndex": index,
            "startSec": self.start_sec,
            "endSec": self.end_sec,
            "text": self.text,
            "speakerLabel": self.speaker_label,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class ToolVersions:
    transcription_tool: str
    transcription_model: str
    transcription_version: str
    diarization_tool: str | None = None
    diarization_model: str | None = None
    diarization_version: str | None = None

    def as_payload(self) -> dict[str, str | None]:
        return {
            "transcriptionTool": self.transcription_tool,
            "transcriptionModel": self.transcription_model,
            "transcriptionVersion": self.transcription_version,
            "diarizationTool": self.diarization_tool,
            "diarizationModel": self.diarization_model,
            "diarizationVersion": self.diarization_version,
        }


def result_checksum(
    transcript_text: str,
    segments: Sequence[TranscriptSegment],
    tool_versions: ToolVersions,
    raw_artifact_json: str | None = None,
) -> str:
    canonical = {
        "transcriptText": transcript_text,
        "segments": [segment.as_payload(index) for index, segment in enumerate(segments)],
        "toolVersions": tool_versions.as_payload(),
        "rawArtifactJson": raw_artifact_json,
    }
    return hashlib.sha256(js_json_dumps(canonical).encode("utf-8")).hexdigest()
