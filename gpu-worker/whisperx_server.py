"""
NeuroGlitch WhisperX GPU Worker
Runs on the GPU PC. Exposes:
  POST /transcribe   — accept audio file, queue job, return jobId
  GET  /status/{id} — poll job result

Start: python whisperx_server.py
Requires: pip install fastapi uvicorn whisperx pyannote.audio python-multipart torch
Set env:  HF_TOKEN=<huggingface_token>   (for pyannote speaker diarization)
          WHISPERX_API_KEY=<secret>       (optional — must match sidecar WHISPERX_API_KEY)
"""

import os
import uuid
import asyncio
import threading
import json
from typing import Optional

import torch
import whisperx
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY     = os.getenv("WHISPERX_API_KEY", "")   # optional shared secret
HF_TOKEN    = os.getenv("HF_TOKEN", "")           # HuggingFace token for pyannote
DEVICE      = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE     = "float16" if DEVICE == "cuda" else "int8"
MODEL_SIZE  = os.getenv("WHISPERX_MODEL", "large-v2")   # base / medium / large-v2
PORT        = int(os.getenv("PORT", "8002"))

print(f"[worker] Device: {DEVICE}  Model: {MODEL_SIZE}  Compute: {COMPUTE}")

# Load model once at startup
_model = whisperx.load_model(MODEL_SIZE, DEVICE, compute_type=COMPUTE)
print("[worker] Model loaded.")

# In-memory job store  {jobId: {"status": ..., ...}}
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

app = FastAPI(title="WhisperX GPU Worker")


# ── Auth ──────────────────────────────────────────────────────────────────────

def _check_key(x_api_key: Optional[str]):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Background transcription ──────────────────────────────────────────────────

def _format_ms(ms: float) -> str:
    total = int(ms / 1000)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _run_transcription(
    job_id: str,
    audio_bytes: bytes,
    filename: str,
    num_speakers: Optional[int] = None,
):
    import tempfile, os as _os
    try:
        # Write to temp file (whisperx needs a path)
        suffix = _os.path.splitext(filename)[-1] or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        # 1. Transcribe
        result = _model.transcribe(tmp_path, batch_size=16)
        lang = result.get("language", "en")
        audio = whisperx.load_audio(tmp_path)

        # 2. Align
        align_model, align_meta = whisperx.load_align_model(
            language_code=lang, device=DEVICE
        )
        result = whisperx.align(
            result["segments"], align_model, align_meta, tmp_path, DEVICE,
            return_char_alignments=False,
        )

        # 3. Diarize (requires HF_TOKEN + pyannote)
        participants: dict[str, dict] = {}
        lines: list[str] = []

        if HF_TOKEN:
            try:
                DiarizationPipeline = whisperx.DiarizationPipeline
            except AttributeError:
                from whisperx.diarize import DiarizationPipeline  # type: ignore[no-redef]
            try:
                diarize_model = DiarizationPipeline(use_auth_token=HF_TOKEN, device=DEVICE)
            except TypeError:
                diarize_model = DiarizationPipeline(token=HF_TOKEN, device=DEVICE)
            if num_speakers is not None and num_speakers > 1:
                diarize_segments = diarize_model(
                    audio,
                    min_speakers=num_speakers,
                    max_speakers=num_speakers,
                )
            else:
                diarize_segments = diarize_model(audio)
            result = whisperx.assign_word_speakers(diarize_segments, result)

            for seg in result["segments"]:
                speaker = seg.get("speaker", "SPEAKER_00")
                text = seg.get("text", "").strip()
                if not text:
                    continue
                ts = _format_ms(seg.get("start", 0) * 1000)
                lines.append(f"[{ts}] {speaker}: {text}")

                if speaker not in participants:
                    participants[speaker] = {
                        "speakerLabel": speaker,
                        "name": f"Speaker {speaker.replace('SPEAKER_', '')}",
                        "wordCount": 0,
                    }
                participants[speaker]["wordCount"] += len(text.split())
        else:
            # No diarization — mono transcript
            for seg in result["segments"]:
                text = seg.get("text", "").strip()
                if text:
                    ts = _format_ms(seg.get("start", 0) * 1000)
                    lines.append(f"[{ts}] SPEAKER_00: {text}")

        # Duration from last segment
        segs = result.get("segments", [])
        duration = int(segs[-1].get("end", 0)) if segs else 0

        with _jobs_lock:
            _jobs[job_id] = {
                "status": "completed",
                "transcript": "\n".join(lines),
                "rawTranscript": json.dumps(result),
                "durationSeconds": duration,
                "participants": list(participants.values()),
            }

    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id] = {"status": "error", "error": str(exc)}
    finally:
        try:
            _os.unlink(tmp_path)
        except Exception:
            pass


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "model": MODEL_SIZE}


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    num_speakers: Optional[int] = Form(None),
    x_api_key: Optional[str] = Header(None),
):
    _check_key(x_api_key)
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty file")

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {"status": "processing"}

    # Run in background thread (whisperx is sync/CPU-heavy)
    thread = threading.Thread(
        target=_run_transcription,
        args=(job_id, audio_bytes, audio.filename or "audio.wav", num_speakers),
        daemon=True,
    )
    thread.start()

    return JSONResponse({"jobId": job_id})


@app.get("/jobs")
def list_jobs(x_api_key: Optional[str] = Header(None)):
    """List all job IDs and their statuses (no transcript data)."""
    _check_key(x_api_key)
    with _jobs_lock:
        summary = {
            jid: {"status": j.get("status"), "durationSeconds": j.get("durationSeconds")}
            for jid, j in _jobs.items()
        }
    return JSONResponse(summary)


@app.get("/status/{job_id}")
def status(job_id: str, x_api_key: Optional[str] = Header(None)):
    _check_key(x_api_key)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JSONResponse(job)


# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
