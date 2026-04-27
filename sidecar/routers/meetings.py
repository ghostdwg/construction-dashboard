"""
Phase 5D — Meeting Intelligence Router

Endpoints:
  GET  /meetings/config                      — check what's configured
  POST /meetings/transcribe                  — upload audio + start AssemblyAI job
  GET  /meetings/transcribe/status/{job_id}  — poll transcription status
  POST /meetings/analyze                     — analyze transcript with Claude
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from services.meeting_intelligence import (
    ASSEMBLYAI_API_KEY,
    ANTHROPIC_API_KEY,
    WHISPERX_URL,
    upload_audio_to_assemblyai,
    submit_assemblyai_job,
    poll_assemblyai_status,
    submit_whisperx_job,
    poll_whisperx_status,
    analyze_meeting_transcript,
    analyze_meeting_with_context,
)

router = APIRouter()

MAX_AUDIO_BYTES = 500 * 1024 * 1024  # 500 MB


# ── Config ────────────────────────────────────────────────────────────────────

@router.get("/meetings/config")
async def meetings_config():
    """Return which meeting intelligence sources are available."""
    return {
        "assemblyai_configured": bool(ASSEMBLYAI_API_KEY),
        "whisperx_configured": bool(WHISPERX_URL),
        "analysis_configured": bool(ANTHROPIC_API_KEY),
        "manual_supported": True,
    }


# ── Transcription ─────────────────────────────────────────────────────────────

@router.post("/meetings/transcribe")
async def start_transcription(audio: UploadFile = File(...)):
    """
    Upload audio file and start transcription with speaker diarization.

    Routes to GPU PC (WhisperX + pyannote) when WHISPERX_URL is configured,
    falls back to AssemblyAI automatically. If neither is available, returns
    400 so the caller can prompt for manual transcript entry.

    Returns: { ok, transcriptionJobId, source }
    Job IDs are prefixed: "WHISPERX:{id}" or "AAI:{id}" so the status
    endpoint knows which service to poll.
    """
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 500 MB)")
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")

    filename = audio.filename or "audio.wav"

    # ── Try GPU PC first ──────────────────────────────────────────────────────
    if WHISPERX_URL:
        try:
            raw_job_id = await submit_whisperx_job(audio_bytes, filename)
            return {
                "ok": True,
                "transcriptionJobId": f"WHISPERX:{raw_job_id}",
                "source": "WHISPERX",
            }
        except Exception as e:
            print(f"[sidecar] WhisperX unavailable ({e}), falling back to AssemblyAI")

    # ── Fallback: AssemblyAI ──────────────────────────────────────────────────
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail=(
                "No transcription service available. "
                "Configure WHISPERX_URL (GPU PC) or ASSEMBLYAI_API_KEY in sidecar/.env."
            ),
        )

    try:
        upload_url = await upload_audio_to_assemblyai(audio_bytes)
        job_id = await submit_assemblyai_job(upload_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AssemblyAI error: {e}")

    return {"ok": True, "transcriptionJobId": f"AAI:{job_id}", "source": "ASSEMBLYAI"}


@router.get("/meetings/transcribe/status/{job_id:path}")
async def get_transcription_status(job_id: str):
    """
    Poll transcription status. Job ID prefix determines which service to query:
      WHISPERX:{id} → GPU PC WhisperX service
      AAI:{id}      → AssemblyAI

    Returns one of:
      { status: "processing" }
      { status: "completed", transcript, rawTranscript, durationSeconds, participants }
      { status: "error", error }
    """
    try:
        if job_id.startswith("WHISPERX:"):
            raw_id = job_id[len("WHISPERX:"):]
            result = await poll_whisperx_status(raw_id)
        elif job_id.startswith("AAI:"):
            raw_id = job_id[len("AAI:"):]
            result = await poll_assemblyai_status(raw_id)
        else:
            # Legacy IDs without prefix — assume AssemblyAI
            result = await poll_assemblyai_status(job_id)

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription service error: {e}")


# ── Analysis ──────────────────────────────────────────────────────────────────

class OpenRfi(BaseModel):
    number: str
    title: str
    status: str = "open"
    dueDate: str | None = None


class OverdueSubmittal(BaseModel):
    specSection: str = ""
    title: str
    dueDate: str


class OpenTask(BaseModel):
    assignedTo: str = "Unassigned"
    description: str
    dueDate: str | None = None


class MeetingContext(BaseModel):
    speakerRoster: str = ""
    gcTeamMembers: list[str] = []
    priorOpenItems: str = "none"
    openRfis: list[OpenRfi] = []
    overdueSubmittals: list[OverdueSubmittal] = []
    openTasks: list[OpenTask] = []


class AnalyzeRequest(BaseModel):
    transcript: str
    meetingTitle: str
    meetingType: str = "GENERAL"
    projectName: str = ""
    mode: str = "full"
    context: MeetingContext = MeetingContext()
    apiKey: str = ""      # caller-supplied key overrides ANTHROPIC_API_KEY env var
    maxTokens: int = 8192  # output token budget — default raised for long transcripts


@router.post("/meetings/analyze")
async def analyze_meeting(body: AnalyzeRequest):
    """
    Context-injected 8-section meeting analysis.

    Accepts optional project context (open RFIs, overdue submittals, open
    action items, speaker roster, prior open issues) and runs the full
    8-section structured analysis through Claude.

    Returns:
      { ok, analysis, tokensUsed }
      where analysis is the raw 8-section JSON object for the caller to parse.
    """
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="transcript is required")

    ctx = body.context
    try:
        result = await analyze_meeting_with_context(
            transcript=body.transcript,
            project_name=body.projectName,
            speaker_roster=ctx.speakerRoster,
            gc_team_members=ctx.gcTeamMembers,
            prior_open_items=ctx.priorOpenItems,
            open_rfis=[r.model_dump() for r in ctx.openRfis],
            overdue_submittals=[s.model_dump() for s in ctx.overdueSubmittals],
            open_tasks=[t.model_dump() for t in ctx.openTasks],
            mode=body.mode,
            api_key=body.apiKey or None,
            max_tokens=body.maxTokens,
        )
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")
