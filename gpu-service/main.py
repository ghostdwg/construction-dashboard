"""
WhisperX + pyannote Transcription Service
GPU PC node — runs on your dedicated machine, reachable via Tailscale.

Provides the same response contract as the sidecar's AssemblyAI poller so
the main sidecar can swap sources without changing the Next.js app.

Setup:
  1. pip install -r requirements.txt
  2. Copy .env.example → .env and fill in HF_TOKEN
  3. uvicorn main:app --host 0.0.0.0 --port 8002

HuggingFace requirements:
  - Accept pyannote/speaker-diarization-3.1 license at hf.co/pyannote/speaker-diarization-3.1
  - Accept pyannote/segmentation-3.0 license at hf.co/pyannote/segmentation-3.0
  - Generate a token at hf.co/settings/tokens and set HF_TOKEN in .env
"""

import asyncio
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import torch
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

HF_TOKEN: str = os.getenv("HF_TOKEN", "")
GPU_SERVICE_API_KEY: str = os.getenv("GPU_SERVICE_API_KEY", "")
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "large-v3")

_device = "cuda" if torch.cuda.is_available() else "cpu"
_compute_type = "float16" if _device == "cuda" else "int8"

# Lazy-loaded model cache — loaded on first transcription request
_whisper_model = None
_align_models: dict[str, tuple] = {}
_diarize_pipeline = None

app = FastAPI(title="WhisperX GPU Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# In-memory job store — keyed by job UUID
_jobs: dict[str, dict] = {}


# ── Auth middleware ───────────────────────────────────────────────────────────

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        if GPU_SERVICE_API_KEY:
            key = request.headers.get("X-API-Key", "")
            if key != GPU_SERVICE_API_KEY:
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)


app.add_middleware(ApiKeyMiddleware)


# ── Model loaders ─────────────────────────────────────────────────────────────

def _load_whisper():
    global _whisper_model
    if _whisper_model is None:
        import whisperx
        _whisper_model = whisperx.load_model(
            WHISPER_MODEL, _device, compute_type=_compute_type
        )
    return _whisper_model


def _load_align(language: str):
    if language not in _align_models:
        import whisperx
        model_a, metadata = whisperx.load_align_model(
            language_code=language, device=_device
        )
        _align_models[language] = (model_a, metadata)
    return _align_models[language]


def _load_diarize():
    global _diarize_pipeline
    if _diarize_pipeline is None:
        if not HF_TOKEN:
            raise ValueError(
                "HF_TOKEN not set — required for pyannote speaker diarization. "
                "See README for setup instructions."
            )
        import whisperx
        _diarize_pipeline = whisperx.DiarizationPipeline(
            use_auth_token=HF_TOKEN, device=_device
        )
    return _diarize_pipeline


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_ms(ms: int) -> str:
    total = ms // 1000
    h, m, s = total // 3600, (total % 3600) // 60, total % 60
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ── Background job processor ──────────────────────────────────────────────────

async def _process_audio(job_id: str, audio_bytes: bytes, filename: str):
    suffix = Path(filename).suffix or ".wav"
    tmp_path: Optional[Path] = None

    try:
        import whisperx

        # Write to temp file (whisperx needs a path, not bytes)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio_bytes)
            tmp_path = Path(f.name)

        _jobs[job_id]["statusDetail"] = "transcribing"
        whisper = _load_whisper()
        audio = whisperx.load_audio(str(tmp_path))
        result = whisper.transcribe(audio, batch_size=16)
        language = result.get("language", "en")

        # Word-level alignment
        _jobs[job_id]["statusDetail"] = "aligning"
        model_a, metadata = _load_align(language)
        result = whisperx.align(result["segments"], model_a, metadata, audio, _device)

        # Speaker diarization
        _jobs[job_id]["statusDetail"] = "diarizing"
        try:
            diarize = _load_diarize()
            diarize_segments = diarize(audio)
            result = whisperx.assign_word_speakers(diarize_segments, result)
        except ValueError as exc:
            # HF_TOKEN missing — produce mono transcript without speaker labels
            print(f"[gpu-service] Diarization skipped: {exc}")

        # Build labeled transcript
        lines: list[str] = []
        participants: dict[str, dict] = {}

        for seg in result.get("segments", []):
            raw_speaker = seg.get("speaker", "A")
            # pyannote labels like "SPEAKER_00", "SPEAKER_01" — normalise to A/B/C
            short = raw_speaker.split("_")[-1].lstrip("0") or "0"
            label = f"SPEAKER_{chr(65 + int(short))}" if short.isdigit() else f"SPEAKER_{raw_speaker}"
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            ts = _fmt_ms(int(seg.get("start", 0) * 1000))
            lines.append(f"[{ts}] {label}: {text}")
            if label not in participants:
                participants[label] = {
                    "speakerLabel": label,
                    "name": f"Speaker {chr(65 + int(short)) if short.isdigit() else raw_speaker}",
                    "wordCount": 0,
                }
            participants[label]["wordCount"] += len(text.split())

        duration_sec = int(audio.shape[0] / 16000) if hasattr(audio, "shape") else 0

        _jobs[job_id] = {
            "status": "completed",
            "transcript": "\n".join(lines),
            "rawTranscript": "",
            "durationSeconds": duration_sec,
            "participants": list(participants.values()),
        }

    except Exception as exc:
        _jobs[job_id] = {"status": "error", "error": str(exc)}
        print(f"[gpu-service] Job {job_id} failed: {exc}")

    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "ok": True,
        "device": _device,
        "model": WHISPER_MODEL,
        "diarization": bool(HF_TOKEN),
    }


@app.post("/transcribe")
async def start_transcription(audio: UploadFile = File(...)):
    """
    Accept an audio file, start WhisperX + pyannote processing in the
    background, and return a job ID immediately for polling.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "statusDetail": "queued"}
    asyncio.create_task(_process_audio(job_id, audio_bytes, audio.filename or "audio.wav"))

    return {"ok": True, "jobId": job_id, "status": "processing"}


@app.get("/status/{job_id}")
def get_status(job_id: str):
    """
    Poll job status.

    Returns one of:
      { status: "processing", statusDetail: str }
      { status: "completed", transcript, rawTranscript, durationSeconds, participants }
      { status: "error", error: str }
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")
    return job
