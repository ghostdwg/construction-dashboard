"""
Teams VTT Parser

Parses WebVTT transcripts exported from Microsoft Teams meetings.
Teams uses the <v SpeakerName> inline speaker tag format:

  WEBVTT

  00:00:00.000 --> 00:00:03.210
  <v John Smith>Hello everyone, thanks for joining.</v>

  00:00:04.100 --> 00:00:08.500
  <v Jane Doe>Good morning. Let's start with the agenda.</v>

Returns segments with start/end in seconds and the speaker name.
"""

import re
from dataclasses import dataclass


@dataclass
class VttSegment:
    start: float    # seconds from meeting start
    end: float      # seconds from meeting start
    speaker: str    # Teams display name, e.g. "John Smith"
    text: str       # utterance text, cleaned


# Matches timestamp lines: 00:00:00.000 --> 00:00:03.210
_TS_PATTERN = re.compile(
    r"^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})"
)

# Matches <v SpeakerName>text</v> or <v SpeakerName>text
_SPEAKER_TAG = re.compile(r"<v\s+([^>]+)>(.*?)(?:</v>)?$", re.IGNORECASE | re.DOTALL)

# Strip any remaining XML/HTML tags
_TAG_STRIP = re.compile(r"<[^>]+>")


def _ts_to_seconds(ts: str) -> float:
    """Convert HH:MM:SS.mmm or HH:MM:SS,mmm to float seconds."""
    ts = ts.replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def parse_vtt(vtt_text: str) -> list[VttSegment]:
    """
    Parse a Teams VTT string into a list of VttSegments.
    Unknown speaker lines (no <v> tag) are attributed to 'Unknown'.
    """
    segments: list[VttSegment] = []
    lines = vtt_text.splitlines()

    i = 0
    # Skip WEBVTT header and any NOTE blocks
    while i < len(lines) and not _TS_PATTERN.match(lines[i].strip()):
        i += 1

    while i < len(lines):
        line = lines[i].strip()
        ts_match = _TS_PATTERN.match(line)

        if not ts_match:
            i += 1
            continue

        start = _ts_to_seconds(ts_match.group(1))
        end   = _ts_to_seconds(ts_match.group(2))
        i += 1

        # Collect all text lines until blank line or EOF
        text_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            text_lines.append(lines[i].strip())
            i += 1

        full_text = " ".join(text_lines)
        speaker = "Unknown"
        clean_text = full_text

        spk_match = _SPEAKER_TAG.match(full_text)
        if spk_match:
            speaker    = spk_match.group(1).strip()
            clean_text = spk_match.group(2).strip()

        # Strip any residual tags
        clean_text = _TAG_STRIP.sub("", clean_text).strip()

        if clean_text:
            segments.append(VttSegment(
                start=start,
                end=end,
                speaker=speaker,
                text=clean_text,
            ))

    return segments


def vtt_speaker_set(segments: list[VttSegment]) -> set[str]:
    """Return the set of unique speaker names in a parsed VTT."""
    return {s.speaker for s in segments if s.speaker != "Unknown"}
