"""
Transcript Merger — Teams Hybrid

Merges a diarization result (from WhisperX/pyannote) with a Teams VTT
to produce a single speaker-labeled transcript.

Strategy:
  For each diarized speaker cluster, compute how much of their speaking
  time overlaps with each named VTT speaker's segments. If a cluster has
  ≥30% overlap with a named VTT speaker, they are "REMOTE" and assigned
  that speaker's name. Any remaining clusters are "IN_ROOM" and kept as
  SPEAKER_N for the user to name.

  This works because Teams records online participants with individual
  microphone channels (high signal clarity), while in-room participants
  share a room mic. The VTT accurately identifies the online speakers.

Returns:
  {
    transcript: str,             # full merged, time-sorted transcript lines
    participants: list[dict],    # all speakers (remote named + in-room clusters)
    clusters: list[dict],        # speaker cluster metadata for the naming UI
  }
"""

import json
from collections import defaultdict

from services.vtt_parser import VttSegment, parse_vtt


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    """Return the duration of overlap between two time intervals."""
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _assign_vtt_names(
    diarized_segs: list[dict],
    vtt_segs: list[VttSegment],
    time_offset: float = 0.0,
    overlap_threshold: float = 0.30,
) -> dict[str, dict]:
    """
    Returns cluster assignment data keyed by diarized speaker id.
    """
    # Accumulate overlap seconds: cluster_id → vtt_speaker → seconds
    overlap_acc: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    duration_acc: dict[str, float] = defaultdict(float)

    for seg in diarized_segs:
        spk  = seg.get("speaker", "SPEAKER_0")
        s    = seg.get("start", 0.0) + time_offset
        e    = seg.get("end",   0.0) + time_offset
        duration_acc[spk] += e - s

        for vtt in vtt_segs:
            if vtt.speaker == "Unknown":
                continue
            ov = _overlap(s, e, vtt.start, vtt.end)
            if ov > 0:
                overlap_acc[spk][vtt.speaker] += ov

    assignment: dict[str, dict] = {}
    for spk in set(seg.get("speaker", "SPEAKER_0") for seg in diarized_segs):
        total = duration_acc.get(spk, 0.0)
        votes = overlap_acc.get(spk, {})
        if not votes or total == 0:
            assignment[spk] = {"name": None, "vttOverlap": None}
            continue

        best_name = max(votes, key=lambda k: votes[k])
        best_ov   = votes[best_name]
        if total > 0 and best_ov / total >= overlap_threshold:
            assignment[spk] = {"name": best_name, "vttOverlap": best_name}
        else:
            assignment[spk] = {"name": None, "vttOverlap": best_name}

    return assignment


def _renumber_inroom(assignment: dict[str, dict], teams_sources: dict | None = None) -> dict[str, str]:
    """
    Reassign in-room cluster IDs to a clean SPEAKER_0, SPEAKER_1, ...
    sequence. Remote speakers keep their VTT name as the resolved key.
    """
    counter = 0
    result: dict[str, str] = {}
    for spk, data in sorted(assignment.items()):
        name = data.get("name")
        vtt_overlap = data.get("vttOverlap")
        source = (teams_sources or {}).get(vtt_overlap) if vtt_overlap else None
        if source and source.get("mode") == "SHARED_MIC":
            name = None
        if name is not None:
            result[spk] = name
        else:
            result[spk] = f"SPEAKER_{counter}"
            counter += 1
    return result


def merge_hybrid(
    raw_transcript_json: str,
    vtt_content: str,
    time_offset: float = 0.0,
    teams_sources: dict | None = None,
) -> dict:
    """
    Entry point for the sidecar merge-hybrid endpoint.

    Args:
      raw_transcript_json  — JSON string from GPU worker (has "segments" key)
      vtt_content          — Teams VTT text
      time_offset          — seconds to add to diarized timestamps to align
                             with VTT (positive = audio started after meeting began)

    Returns:
      {
        transcript: str,
        participants: list[dict],
        clusters: list[dict],    # for SpeakerNamingPanel
        durationSeconds: int,
      }
    """
    # ── Parse inputs ──────────────────────────────────────────────────────────
    raw = json.loads(raw_transcript_json)
    segments: list[dict] = raw.get("segments", [])
    vtt_segs = parse_vtt(vtt_content)

    # ── Assign VTT names to diarized clusters ─────────────────────────────────
    assignment = _assign_vtt_names(segments, vtt_segs, time_offset=time_offset)
    resolved   = _renumber_inroom(assignment, teams_sources)  # raw_speaker_id → display_name

    # ── Build merged transcript segments ─────────────────────────────────────
    merged_lines: list[tuple[float, str]] = []  # (start_sec, line)

    # Add diarized (WhisperX) segments with resolved speaker names
    speaker_stats: dict[str, dict] = {}

    for seg in segments:
        raw_spk = seg.get("speaker", "SPEAKER_0")
        vtt_overlap = assignment.get(raw_spk, {}).get("vttOverlap")
        source = (teams_sources or {}).get(vtt_overlap) if vtt_overlap else None
        if source and source.get("mode") == "IGNORE":
            continue
        display = resolved.get(raw_spk, raw_spk)
        text    = (seg.get("text") or "").strip()
        if not text:
            continue
        start   = seg.get("start", 0.0)
        end     = seg.get("end", start)

        # Format timestamp
        total = int(start)
        h = total // 3600
        m = (total % 3600) // 60
        s = total % 60
        ts = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"

        merged_lines.append((start, f"[{ts}] {display}: {text}"))

        if display not in speaker_stats:
            speaker_stats[display] = {
                "speakerLabel": display,
                "name": display,
                "wordCount": 0,
                "totalSeconds": 0.0,
                "segmentCount": 0,
            }
        speaker_stats[display]["wordCount"]    += len(text.split())
        speaker_stats[display]["totalSeconds"] += end - start
        speaker_stats[display]["segmentCount"] += 1

    # Sort by start time and join
    merged_lines.sort(key=lambda t: t[0])
    transcript = "\n".join(line for _, line in merged_lines)

    # ── Build cluster metadata for the naming UI ──────────────────────────────
    # Map raw speaker id → resolved display name + type
    raw_to_resolved = resolved  # { "SPEAKER_00": "John Smith" | "SPEAKER_0" }
    vtt_names = {seg.speaker for seg in vtt_segs if seg.speaker != "Unknown"}

    clusters: list[dict] = []
    seen_display: set[str] = set()

    for raw_spk, display in sorted(raw_to_resolved.items()):
        if display in seen_display:
            continue
        seen_display.add(display)

        vtt_overlap = assignment.get(raw_spk, {}).get("vttOverlap")
        source = (teams_sources or {}).get(vtt_overlap) if vtt_overlap else None
        if source and source.get("mode") == "IGNORE":
            continue
        is_remote = display in vtt_names and not (source and source.get("mode") == "SHARED_MIC")
        stats = speaker_stats.get(display, {})

        clusters.append({
            "id":           display,
            "rawId":        raw_spk,
            "type":         "REMOTE" if is_remote else "IN_ROOM",
            "resolvedName": display if is_remote else None,
            "totalSeconds": round(stats.get("totalSeconds", 0.0), 1),
            "segmentCount": stats.get("segmentCount", 0),
            "vttOverlap":   vtt_overlap,
        })

    # Remote first, then in-room sorted by total speaking time desc
    clusters.sort(key=lambda c: (0 if c["type"] == "REMOTE" else 1, -c["totalSeconds"]))

    duration_sec = int(segments[-1].get("end", 0)) if segments else 0

    participants = [
        {
            "speakerLabel": c["id"],
            "name":         c["resolvedName"] or c["id"],
            "speakerType":  c["type"],
            "wordCount":    speaker_stats.get(c["id"], {}).get("wordCount", 0),
        }
        for c in clusters
    ]

    return {
        "transcript":      transcript,
        "participants":    participants,
        "clusters":        clusters,
        "durationSeconds": duration_sec,
    }


def apply_speaker_names(transcript: str, mapping: dict[str, str]) -> str:
    """
    Replace SPEAKER_N labels in a transcript with user-supplied names.

    mapping: { "SPEAKER_0": "Mike Johnson", "SPEAKER_1": "Sarah Chen" }

    Only replaces labels that appear as a full word after ] and before :,
    so partial matches don't corrupt other speakers.
    """
    import re
    result = transcript
    # Sort by length desc to avoid partial replacement (SPEAKER_10 before SPEAKER_1)
    for label, name in sorted(mapping.items(), key=lambda kv: len(kv[0]), reverse=True):
        if not name.strip():
            continue
        # Pattern: ] SPEAKER_N:  →  ] Name:
        result = re.sub(
            r"(\]\s*)" + re.escape(label) + r"(\s*:)",
            r"\g<1>" + name.strip() + r"\g<2>",
            result,
        )
    return result
