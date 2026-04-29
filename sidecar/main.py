"""
Construction Dashboard — Python Sidecar (Phase 5A)

FastAPI service for document intelligence, PDF parsing, and future
endpoints (OCR, schedule export, PDF generation, transcription).

Bound to 127.0.0.1:8001 — never exposed externally.
Authenticated via shared API key in X-API-Key header.
"""

import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

load_dotenv(override=True)

# ── Lifespan ────────────────────────────────────────────────────────────────

_start_time: float = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _start_time
    _start_time = time.time()
    yield


def get_uptime() -> float:
    return time.time() - _start_time


# ── App ──────────────────────────────────────────────────────────────────���──

app = FastAPI(
    title="Construction Dashboard Sidecar",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# ── Auth middleware ──────────────────────────────────────────────────────────

SIDECAR_API_KEY = os.getenv("SIDECAR_API_KEY", "")


@app.middleware("http")
async def verify_api_key(request: Request, call_next):
    # Health endpoint is public
    if request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)

    if not SIDECAR_API_KEY:
        # No key configured — allow all (dev mode)
        return await call_next(request)

    key = request.headers.get("X-API-Key", "")
    if key != SIDECAR_API_KEY:
        return JSONResponse(
            status_code=401,
            content={"error": "Invalid or missing API key"},
        )

    return await call_next(request)


# ── Routers ──────────────────────────────────��──────────────────────────────
# Structured for future endpoints: /ocr/*, /export/*, /transcribe

from routers.parse import router as parse_router  # noqa: E402
from routers.drawings import router as drawings_router  # noqa: E402
from routers.meetings import router as meetings_router  # noqa: E402
from routers.briefing import router as briefing_router  # noqa: E402
from routers.market import router as market_router  # noqa: E402

app.include_router(parse_router, prefix="/parse", tags=["Spec Parsing"])
app.include_router(drawings_router, prefix="/parse", tags=["Drawing Analysis"])
app.include_router(meetings_router, tags=["Meeting Intelligence"])
app.include_router(briefing_router, tags=["Briefing"])
app.include_router(market_router, tags=["Market Intelligence"])


# ── Health ───────────��──────────────────────────────────────────────────────

@app.get("/health")
async def health():
    gpu_available = False
    try:
        import torch
        gpu_available = torch.cuda.is_available()
    except ImportError:
        pass

    mem_used_mb = None
    mem_total_mb = None
    try:
        import psutil
        mem = psutil.virtual_memory()
        mem_used_mb  = round(mem.used  / 1024 / 1024, 0)
        mem_total_mb = round(mem.total / 1024 / 1024, 0)
    except ImportError:
        pass

    return {
        "status": "ok",
        "version": app.version,
        "uptime_seconds": round(get_uptime(), 1),
        "gpu_available": gpu_available,
        "memory_used_mb": mem_used_mb,
        "memory_total_mb": mem_total_mb,
        "anthropic_key_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "assemblyai_key_configured": bool(os.getenv("ASSEMBLYAI_API_KEY")),
    }
