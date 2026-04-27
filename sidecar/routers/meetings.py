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
    upload_audio_to_assemblyai,
    submit_assemblyai_job,
    poll_assemblyai_status,
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
        "analysis_configured": bool(ANTHROPIC_API_KEY),
        "manual_supported": True,
    }


# ── Transcription ─────────────────────────────────────────────────────────────

@router.post("/meetings/transcribe")
async def start_transcription(audio: UploadFile = File(...)):
    """
    Upload audio file, push to AssemblyAI CDN, and submit transcription job
    with speaker diarization.

    Returns: { ok, transcriptionJobId, source }
    """
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail=(
                "AssemblyAI not configured. "
                "Add ASSEMBLYAI_API_KEY to sidecar/.env and restart."
            ),
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 500 MB)")
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        upload_url = await upload_audio_to_assemblyai(audio_bytes)
        job_id = await submit_assemblyai_job(upload_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AssemblyAI error: {e}")

    return {"ok": True, "transcriptionJobId": job_id, "source": "ASSEMBLYAI"}


@router.get("/meetings/transcribe/status/{job_id}")
async def get_transcription_status(job_id: str):
    """
    Poll AssemblyAI for transcription status.

    Returns one of:
      { status: "processing" }
      { status: "completed", transcript, rawTranscript, durationSeconds, participants }
      { status: "error", error }
    """
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=400, detail="AssemblyAI not configured")

    try:
        result = await poll_assemblyai_status(job_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AssemblyAI error: {e}")


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
        )
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")
