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

class AnalyzeRequest(BaseModel):
    transcript: str
    meetingTitle: str
    meetingType: str = "GENERAL"
    projectName: str = ""


@router.post("/meetings/analyze")
async def analyze_meeting(body: AnalyzeRequest):
    """
    Send meeting transcript to Claude for structured intelligence extraction.

    Returns:
      { ok, summary, actionItems, keyDecisions, risks, followUpItems, tokensUsed }
    """
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="transcript is required")

    try:
        result = await analyze_meeting_transcript(
            transcript=body.transcript,
            meeting_title=body.meetingTitle,
            meeting_type=body.meetingType,
            project_name=body.projectName,
        )
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")
