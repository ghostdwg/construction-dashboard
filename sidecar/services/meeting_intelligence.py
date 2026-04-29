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

# GPU PC WhisperX service — set WHISPERX_URL in sidecar/.env to enable
# Example: WHISPERX_URL=http://100.x.x.x:8002  (Tailscale IP)
WHISPERX_URL = os.getenv("WHISPERX_URL", "")
WHISPERX_API_KEY = os.getenv("WHISPERX_API_KEY", "")

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


# ── WhisperX GPU PC ──────────────────────────────────────────────────────────

async def submit_whisperx_job(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    num_speakers: int | None = None,
) -> str:
    """
    Upload audio to the GPU PC WhisperX service and return the job ID.
    Raises ValueError if WHISPERX_URL is not configured.
    Raises httpx.HTTPError on network/service failure — caller catches and falls back.
    """
    if not WHISPERX_URL:
        raise ValueError("WHISPERX_URL not configured")

    headers = {}
    if WHISPERX_API_KEY:
        headers["X-API-Key"] = WHISPERX_API_KEY

    async with httpx.AsyncClient(timeout=600.0) as client:
        kwargs = {
            "headers": headers,
            "files": {"audio": (filename, audio_bytes)},
        }
        if num_speakers is not None and num_speakers > 0:
            kwargs["data"] = {"num_speakers": str(num_speakers)}
        resp = await client.post(f"{WHISPERX_URL}/transcribe", **kwargs)
        resp.raise_for_status()
        return resp.json()["jobId"]


async def poll_whisperx_status(job_id: str) -> dict:
    """
    Poll the GPU PC WhisperX service for job status.

    Returns one of:
      { "status": "processing" }
      { "status": "completed", "transcript", "rawTranscript",
        "durationSeconds", "participants" }
      { "status": "error", "error": str }
    """
    if not WHISPERX_URL:
        return {"status": "error", "error": "WHISPERX_URL not configured"}

    headers = {}
    if WHISPERX_API_KEY:
        headers["X-API-Key"] = WHISPERX_API_KEY

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{WHISPERX_URL}/status/{job_id}",
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    wx_status = data.get("status")
    if wx_status == "completed":
        return {
            "status": "completed",
            "transcript": data.get("transcript", ""),
            "rawTranscript": data.get("rawTranscript", ""),
            "durationSeconds": data.get("durationSeconds", 0),
            "participants": data.get("participants", []),
        }
    if wx_status == "error":
        return {"status": "error", "error": data.get("error", "WhisperX error")}
    return {"status": "processing"}


# ── Prompt builder ────────────────────────────────────────────────────────────

def build_analysis_prompt(
    transcript: str,
    project_name: str,
    speaker_roster: str = "",
    gc_team_members: Optional[list] = None,
    prior_open_items: str = "none",
    open_rfis: Optional[list] = None,
    overdue_submittals: Optional[list] = None,
    open_tasks: Optional[list] = None,
    mode: str = "full",
) -> str:
    """
    Build the full 8-section meeting analysis prompt with injected project context.
    Mirrors lib/meeting-analysis.ts buildAnalysisPrompt.
    """
    gc_team_members = gc_team_members or []
    open_rfis = open_rfis or []
    overdue_submittals = overdue_submittals or []
    open_tasks = open_tasks or []

    if mode == "actions_only":
        sections = "sections 5 and 8 only"
    elif mode == "flags_only":
        sections = "section 7 only"
    else:
        sections = "all 8 sections"

    gc_team_line = (
        f"GC team members (mark isGcTeam: true): {', '.join(gc_team_members)}"
        if gc_team_members
        else "GC team members: not specified — use role and company context to infer"
    )

    # Project context block
    context_lines: list[str] = []
    if open_rfis:
        context_lines.append(f"Open RFIs ({len(open_rfis)}):")
        for rfi in open_rfis[:15]:
            due = f" (due {rfi.get('dueDate')})" if rfi.get("dueDate") else ""
            context_lines.append(
                f"  - RFI #{rfi.get('number', '?')}: {rfi.get('title', '')} "
                f"[{rfi.get('status', 'open')}]{due}"
            )
    if overdue_submittals:
        context_lines.append(f"\nOverdue Submittals ({len(overdue_submittals)}):")
        for sub in overdue_submittals[:15]:
            spec = f"{sub.get('specSection', '')} " if sub.get("specSection") else ""
            context_lines.append(f"  - {spec}{sub.get('title', '')} (was due {sub.get('dueDate', '')})")
    if open_tasks:
        context_lines.append(f"\nOpen Action Items ({len(open_tasks)}):")
        for task in open_tasks[:20]:
            due = f" [due {task.get('dueDate')}]" if task.get("dueDate") else ""
            assignee = task.get("assignedTo") or "Unassigned"
            context_lines.append(f"  - {assignee}: {task.get('description', '')}{due}")

    project_context_block = "\n".join(context_lines) if context_lines else "none"

    return f"""You are a construction project meeting analyst for a commercial GC.

Analyze the transcript below and return a JSON object containing {sections}.
Return ONLY valid JSON — no markdown fences, no commentary outside the JSON.

The JSON must match this exact schema:
{{
  "section1": {{ "date": "YYYY-MM-DD", "projectName": "string", "durationMinutes": number | null }},
  "section2": [{{"speakerId": "string", "name": "string", "role": "string", "company": "string|null", "confidence": "HIGH|MEDIUM|LOW", "isGcTeam": boolean, "speakerType": "REMOTE|IN_ROOM|UNKNOWN"}}],
  "section3": "2-3 sentence overview string",
  "section4": ["decision string", ...],
  "section5": [{{"person": "string", "task": "string", "dueDate": "YYYY-MM-DD|null", "isGcTask": boolean, "carriedFromDate": "YYYY-MM-DD|null", "evidenceText": "string|null"}}],
  "section6": [{{"text": "string", "reason": "string", "carriedFrom": "YYYY-MM-DD|null"}}],
  "section7": [{{"tag": "DELAY|COST|RISK|DISPUTE|SAFETY|COMPLIANCE", "description": "string"}}],
  "section8": [same shape as section5, GC tasks only]
}}

Rules:
- Ignore all [UNKNOWN] speaker lines
- Ignore filler lines (Yeah. / Okay. / Right. / Sure. / Uh-huh.)
- Do not quote transcript text verbatim — paraphrase everything in evidenceText
- Do not invent content — use "[unclear]" for ambiguous items
- section8 is a filtered subset of section5 where isGcTask is true
- Items in section4 must NOT appear in section6
- Flag items carried from prior meetings with the originating date in carriedFromDate / carriedFrom
- When a meeting discussion references an open RFI or overdue submittal from the context below, note it in the relevant section

{gc_team_line}

Speaker roster: {speaker_roster or "not provided"}
Prior open items (section 6 from last meeting): {prior_open_items or "none"}

Project context (cross-reference meeting discussions against live project state):
{project_context_block}

Transcript:
{transcript}"""


# ── Claude Analysis ───────────────────────────────────────────────────────────

async def analyze_meeting_transcript(
    transcript: str,
    meeting_title: str,
    meeting_type: str,
    project_name: str,
) -> dict:
    """
    Legacy simple wrapper — transcript + basic metadata only.
    Used by standalone sidecar calls without project context.

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


async def analyze_meeting_with_context(
    transcript: str,
    project_name: str,
    speaker_roster: str = "",
    gc_team_members: Optional[list] = None,
    prior_open_items: str = "none",
    open_rfis: Optional[list] = None,
    overdue_submittals: Optional[list] = None,
    open_tasks: Optional[list] = None,
    mode: str = "full",
    api_key: Optional[str] = None,
    max_tokens: int = 8192,
) -> dict:
    """
    Context-injected 8-section meeting analysis.

    Builds a full project-aware prompt (open RFIs, overdue submittals,
    open action items, prior open issues, speaker roster) and returns
    the raw 8-section Claude JSON object for the Next.js route to parse
    and persist.

    api_key: caller-supplied key takes precedence over ANTHROPIC_API_KEY env var,
    allowing the Next.js route to pass the key stored in app settings.

    Returns:
      { analysis: dict (8-section object), tokensUsed: { input, output } }
    """
    effective_key = api_key or ANTHROPIC_API_KEY
    if not effective_key:
        raise ValueError(
            "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
        )

    prompt = build_analysis_prompt(
        transcript=transcript,
        project_name=project_name,
        speaker_roster=speaker_roster,
        gc_team_members=gc_team_members,
        prior_open_items=prior_open_items,
        open_rfis=open_rfis,
        overdue_submittals=overdue_submittals,
        open_tasks=open_tasks,
        mode=mode,
    )

    client = anthropic.Anthropic(api_key=effective_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )

    content = response.content[0].text
    analysis = _extract_json(content)

    return {
        "analysis": analysis,
        "tokensUsed": {
            "input": response.usage.input_tokens,
            "output": response.usage.output_tokens,
        },
    }
