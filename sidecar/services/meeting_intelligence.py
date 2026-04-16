"""
Phase 5D — Meeting Intelligence Service

Handles AssemblyAI transcription (with speaker diarization) and Claude
analysis for construction project meetings.

Requires in sidecar/.env:
  ASSEMBLYAI_API_KEY  — AssemblyAI account key ($0.15/hr, speaker labels included)
  ANTHROPIC_API_KEY   — for meeting analysis (already used by spec pipeline)
"""

import json
import os
import re
from pathlib import Path
from typing import Optional

import anthropic
import httpx

# ── Config ────────────────────────────────────────────────────────────────────

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ASSEMBLYAI_BASE = "https://api.assemblyai.com"

_analysis_rules: Optional[str] = None


def _load_analysis_rules() -> str:
    global _analysis_rules
    if _analysis_rules is not None:
        return _analysis_rules
    rules_path = Path(__file__).parent.parent / "MEETING_ANALYSIS_RULES.md"
    if rules_path.exists():
        _analysis_rules = rules_path.read_text(encoding="utf-8")
    else:
        _analysis_rules = (
            "Extract meeting action items, decisions, risks, and a summary. "
            "Return as structured JSON with keys: summary, actionItems, "
            "keyDecisions, risks, followUpItems."
        )
    return _analysis_rules


# ── Helpers ──────────────────────────────────────────────────────────────────

def _format_ms(ms: int) -> str:
    """Convert milliseconds to MM:SS or HH:MM:SS."""
    total_sec = ms // 1000
    h = total_sec // 3600
    m = (total_sec % 3600) // 60
    s = total_sec % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown code fences."""
    # Code-fenced block first
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    # Bare JSON
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    # First { ... } block
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    raise ValueError("No JSON object found in Claude response")


# ── AssemblyAI — Upload ───────────────────────────────────────────────────────

async def upload_audio_to_assemblyai(audio_bytes: bytes) -> str:
    """
    Upload raw audio bytes to AssemblyAI's CDN.
    Returns the upload_url to pass to submit_assemblyai_job().
    """
    if not ASSEMBLYAI_API_KEY:
        raise ValueError("ASSEMBLYAI_API_KEY not configured in sidecar/.env")

    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(
            f"{ASSEMBLYAI_BASE}/upload",
            headers={"Authorization": ASSEMBLYAI_API_KEY},
            content=audio_bytes,
        )
        resp.raise_for_status()
        return resp.json()["upload_url"]


# ── AssemblyAI — Submit ───────────────────────────────────────────────────────

async def submit_assemblyai_job(upload_url: str) -> str:
    """
    Submit a transcription job with speaker diarization enabled.
    Returns the AssemblyAI transcript_id for subsequent status polling.
    """
    if not ASSEMBLYAI_API_KEY:
        raise ValueError("ASSEMBLYAI_API_KEY not configured in sidecar/.env")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{ASSEMBLYAI_BASE}/v2/transcript",
            headers={
                "Authorization": ASSEMBLYAI_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "audio_url": upload_url,
                "speaker_labels": True,      # diarization — identifies distinct speakers
                "language_detection": True,  # handles bilingual job sites
                "punctuate": True,
                "format_text": True,
                "disfluencies": False,        # strip "um", "uh" — cleaner transcripts
            },
        )
        resp.raise_for_status()
        return resp.json()["id"]


# ── AssemblyAI — Poll ─────────────────────────────────────────────────────────

async def poll_assemblyai_status(transcript_id: str) -> dict:
    """
    Poll AssemblyAI for transcription status.

    Returns one of:
      { "status": "processing" }
      { "status": "completed", "transcript": str, "rawTranscript": str,
        "durationSeconds": int, "participants": list }
      { "status": "error", "error": str }
    """
    if not ASSEMBLYAI_API_KEY:
        raise ValueError("ASSEMBLYAI_API_KEY not configured in sidecar/.env")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(
            f"{ASSEMBLYAI_BASE}/v2/transcript/{transcript_id}",
            headers={"Authorization": ASSEMBLYAI_API_KEY},
        )
        resp.raise_for_status()
        data = resp.json()

    aai_status = data.get("status")  # queued | processing | completed | error

    if aai_status == "error":
        return {"status": "error", "error": data.get("error", "AssemblyAI error")}

    if aai_status != "completed":
        return {"status": "processing"}

    # Build speaker-labeled transcript from diarized utterances
    utterances = data.get("utterances") or []
    lines: list[str] = []
    participants: dict[str, dict] = {}

    for utt in utterances:
        speaker = (utt.get("speaker") or "A").upper()
        label = f"SPEAKER_{speaker}"
        text = (utt.get("text") or "").strip()
        if not text:
            continue
        ts = _format_ms(utt.get("start", 0))
        lines.append(f"[{ts}] {label}: {text}")

        if label not in participants:
            participants[label] = {
                "speakerLabel": label,
                "name": f"Speaker {speaker}",
                "wordCount": 0,
            }
        participants[label]["wordCount"] += len(text.split())

    # Fallback: no utterances → mono audio, use full text block
    if not lines and data.get("text"):
        lines = [data["text"]]

    return {
        "status": "completed",
        "transcript": "\n".join(lines),
        "rawTranscript": json.dumps(data),
        "durationSeconds": int(data.get("audio_duration") or 0),
        "participants": list(participants.values()),
    }


# ── Claude Analysis ───────────────────────────────────────────────────────────

async def analyze_meeting_transcript(
    transcript: str,
    meeting_title: str,
    meeting_type: str,
    project_name: str,
) -> dict:
    """
    Send meeting transcript to Claude for structured intelligence extraction.

    Returns:
      { summary, actionItems, keyDecisions, risks, followUpItems, tokensUsed }
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not configured in sidecar/.env")

    system_prompt = _load_analysis_rules()

    user_prompt = (
        f"Analyze the following construction meeting transcript "
        f"and return the structured JSON output.\n\n"
        f"MEETING TITLE: {meeting_title}\n"
        f"MEETING TYPE: {meeting_type}\n"
        f"PROJECT: {project_name}\n\n"
        f"TRANSCRIPT:\n{transcript}\n\n"
        f"Return only the JSON object as specified. No preamble."
    )

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    content = response.content[0].text
    result = _extract_json(content)

    return {
        "summary": result.get("summary", ""),
        "actionItems": result.get("actionItems", []),
        "keyDecisions": result.get("keyDecisions", []),
        "risks": result.get("risks", []),
        "followUpItems": result.get("followUpItems", []),
        "tokensUsed": {
            "input": response.usage.input_tokens,
            "output": response.usage.output_tokens,
        },
    }
