"""
NeuroGlitch GPU Worker — WhisperX + Pyannote Diarization Service

Runs on the local GPU PC. The main sidecar routes audio here when
WHISPERX_URL is configured in sidecar/.env.

API (matches what meeting_intelligence.py expects):
  GET  /health              — service liveness + model status
  POST /transcribe          — submit audio job, returns { jobId }
  GET  /status/{job_id}     — poll job, returns { status, transcript, ... }

Setup (run once):
  pip install -r requirements.txt
  copy .env.example .env   # fill in HUGGINGFACE_TOKEN + GPU_WORKER_API_KEY

Bind: 0.0.0.0:8002 (reachable over Tailscale from the main PC)
Set in sidecar/.env:
  WHISPERX_URL=http://<tailscale-ip>:8002
  WHISPERX_API_KEY=<match GPU_WORKER_API_KEY below>
"""

import asyncio
import json
import os
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────────

GPU_WORKER_API_KEY = os.getenv("GPU_WORKER_API_KEY", "")
WHISPERX_MODEL     = os.getenv("WHISPERX_MODEL", "large-v3")
WHISPERX_LANGUAGE  = os.getenv("WHISPERX_LANGUAGE", "")  # blank = auto-detect
HUGGINGFACE_TOKEN  = os.getenv("HUGGINGFACE_TOKEN", "")
PORT               = int(os.getenv("PORT", "8002"))
MAX_AUDIO_BYTES    = 500 * 1024 * 1024  # 500 MB

# ── Model state ────────────────────────────────────────────────────────────────

_whisperx_model    = None
_align_models: dict[str, tuple] = {}
_diarize_model     = None
_device            = "cpu"
_compute_type      = "int8"
_models_loaded     = False
_model_load_error  = ""

# ── Job store ──────────────────────────────────────────────────────────────────

# job_id → { status, transcript, rawTranscript, durationSeconds, participants, error }
_jobs: dict[str, dict[str, Any]] = {}
_executor = ThreadPoolExecutor(max_workers=1)  # serialize GPU work


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="NeuroGlitch GPU Worker",
    version="1.0.0",
    docs_url="/docs",
)


@app.middleware("http")
async def verify_api_key(request: Request, call_next):
    if request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)
    if not GPU_WORKER_API_KEY:
        return await call_next(request)
    key = request.headers.get("X-API-Key", "")
    if key != GPU_WORKER_API_KEY:
        return JSONResponse(status_code=401, content={"error": "Invalid API key"})
    return await call_next(request)


# ── Model loading ──────────────────────────────────────────────────────────────

def _load_models():
    global _whisperx_model, _diarize_model, _device, _compute_type
    global _models_loaded, _model_load_error

    try:
        import torch
        import whisperx

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _compute_type = "float16" if _device == "cuda" else "int8"

        print(f"[gpu-worker] Loading WhisperX {WHISPERX_MODEL} on {_device} ({_compute_type})…")
        _whisperx_model = whisperx.load_model(
            WHISPERX_MODEL,
            _device,
            compute_type=_compute_type,
        )
        print("[gpu-worker] WhisperX model loaded.")

        if HUGGINGFACE_TOKEN:
            print("[gpu-worker] Loading pyannote speaker-diarization-3.1…")
            from pyannote.audio import Pipeline
            _diarize_model = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=HUGGINGFACE_TOKEN,
            )
            _diarize_model.to(torch.device(_device))
            print("[gpu-worker] Pyannote model loaded.")
        else:
            print("[gpu-worker] HUGGINGFACE_TOKEN not set — diarization disabled, mono transcript only.")

        _models_loaded = True

    except Exception as exc:
        _model_load_error = str(exc)
        print(f"[gpu-worker] Model load failed: {exc}")


# Load models at startup in a background thread so the service becomes
# available immediately for health checks.
_load_future = _executor.submit(_load_models)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize_speaker(raw: str) -> str:
    """SPEAKER_00 / SPEAKER_01 → SPEAKER_0 / SPEAKER_1"""
    if raw.startswith("SPEAKER_"):
        suffix = raw[len("SPEAKER_"):]
        try:
            return f"SPEAKER_{int(suffix)}"
        except ValueError:
            pass
    return raw


def _format_ts(seconds: float) -> str:
    total = int(seconds)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"


def _build_output(segments: list) -> tuple[str, list, int, str]:
    """
    Convert WhisperX segments into transcript text, participant list,
    duration in seconds, and raw JSON blob.

    Returns: (transcript, participants, duration_seconds, raw_transcript_json)
    """
    lines: list[str] = []
    speaker_stats: dict[str, dict] = {}

    for seg in segments:
        raw_spk = seg.get("speaker", "SPEAKER_0")
        speaker = _normalize_speaker(raw_spk)
        text = (seg.get("text") or "").strip()
        if not text:
            continue

        start = seg.get("start", 0.0)
        lines.append(f"[{_format_ts(start)}] {speaker}: {text}")

        if speaker not in speaker_stats:
            speaker_stats[speaker] = {
                "speakerLabel": speaker,
                "name": speaker,
                "wordCount": 0,
                "totalSeconds": 0.0,
                "segmentCount": 0,
            }
        speaker_stats[speaker]["wordCount"] += len(text.split())
        speaker_stats[speaker]["totalSeconds"] += seg.get("end", start) - start
        speaker_stats[speaker]["segmentCount"] += 1

    duration_sec = int(segments[-1].get("end", 0)) if segments else 0
    participants = sorted(speaker_stats.values(), key=lambda p: p["speakerLabel"])
    raw = json.dumps({"source": "whisperx", "segments": segments, "model": WHISPERX_MODEL})

    return "\n".join(lines), participants, duration_sec, raw


def _process_audio_sync(audio_path: str) -> dict:
    """
    Run full WhisperX pipeline synchronously.
    Called in ThreadPoolExecutor so the event loop is not blocked.
    """
    import whisperx

    # Wait for models if still loading
    _load_future.result(timeout=600)

    if not _models_loaded:
        raise RuntimeError(f"Models not loaded: {_model_load_error}")

    audio = whisperx.load_audio(audio_path)

    # ── Transcription ──────────────────────────────────────────────────────────
    lang = WHISPERX_LANGUAGE or None
    result = _whisperx_model.transcribe(audio, batch_size=16, language=lang)

    # ── Word-level alignment ───────────────────────────────────────────────────
    lang_code = result.get("language", "en")
    if lang_code not in _align_models:
        model_a, metadata = whisperx.load_align_model(
            language_code=lang_code, device=_device
        )
        _align_models[lang_code] = (model_a, metadata)
    model_a, metadata = _align_models[lang_code]
    result = whisperx.align(
        result["segments"], model_a, metadata, audio, _device,
        return_char_alignments=False,
    )

    # ── Diarization ───────────────────────────────────────────────────────────
    if _diarize_model is not None:
        diarize_segments = _diarize_model(audio_path)
        result = whisperx.assign_word_speakers(diarize_segments, result)

    transcript, participants, duration_sec, raw = _build_output(result["segments"])
    return {
        "transcript": transcript,
        "rawTranscript": raw,
        "durationSeconds": duration_sec,
        "participants": participants,
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    import torch
    gpu_name = None
    try:
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
    except Exception:
        pass

    return {
        "ok": True,
        "device": _device,
        "gpu": gpu_name,
        "models_loaded": _models_loaded,
        "whisperx_model": WHISPERX_MODEL,
        "diarization_enabled": _diarize_model is not None,
        "active_jobs": sum(1 for j in _jobs.values() if j.get("status") == "processing"),
        "model_load_error": _model_load_error or None,
    }


@app.post("/transcribe")
async def start_transcription(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 500 MB)")
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "createdAt": time.time()}

    # Save to temp file (WhisperX needs a file path, not bytes)
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(audio_bytes)
    tmp.flush()
    tmp.close()
    audio_path = tmp.name

    # Run in thread executor so the GPU work doesn't block the event loop
    loop = asyncio.get_event_loop()

    async def _run():
        try:
            result = await loop.run_in_executor(_executor, _process_audio_sync, audio_path)
            _jobs[job_id] = {"status": "completed", **result}
        except Exception as exc:
            _jobs[job_id] = {"status": "error", "error": str(exc)}
        finally:
            try:
                Path(audio_path).unlink(missing_ok=True)
            except Exception:
                pass

    asyncio.create_task(_run())

    return {"ok": True, "jobId": job_id}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    status = job.get("status")

    if status == "processing":
        return {"status": "processing"}

    if status == "error":
        return {"status": "error", "error": job.get("error", "Unknown error")}

    # completed
    return {
        "status": "completed",
        "transcript": job.get("transcript", ""),
        "rawTranscript": job.get("rawTranscript", ""),
        "durationSeconds": job.get("durationSeconds", 0),
        "participants": job.get("participants", []),
    }
