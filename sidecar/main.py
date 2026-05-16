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


# ── App ──────────────────────────────────────────────────────────────────────

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
    if request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)

    if not SIDECAR_API_KEY:
        return await call_next(request)

    key = request.headers.get("X-API-Key", "")
    if key != SIDECAR_API_KEY:
        return JSONResponse(
            status_code=401,
            content={"error": "Invalid or missing API key"},
        )

    return await call_next(request)


# ── Routers ──────────────────────────────────────────────────────────────────

from routers.parse import router as parse_router  # noqa: E402
from routers.drawings import router as drawings_router  # noqa: E402
from routers.meetings import router as meetings_router  # noqa: E402
from routers.briefing import router as briefing_router  # noqa: E402
from routers.market import router as market_router  # noqa: E402
from routers.discover import router as discover_router  # noqa: E402
from routers.ollama import router as ollama_router  # noqa: E402
from routers.credentials import router as credentials_router  # noqa: E402
from routers.energov import router as energov_router  # noqa: E402
from routers.press import router as press_router  # noqa: E402
from routers.assessors import router as assessors_router  # noqa: E402
from routers.state_procurement import router as state_procurement_router  # noqa: E402
from routers.institutional import router as institutional_router  # noqa: E402
from routers.portal import router as portal_router  # noqa: E402
from routers.beeline import router as beeline_router  # noqa: E402
from routers.tier1 import router as tier1_router  # noqa: E402

app.include_router(parse_router, prefix="/parse", tags=["Spec Parsing"])
app.include_router(drawings_router, prefix="/parse", tags=["Drawing Analysis"])
app.include_router(meetings_router, tags=["Meeting Intelligence"])
app.include_router(briefing_router, tags=["Briefing"])
app.include_router(market_router, tags=["Market Intelligence"])
app.include_router(discover_router, tags=["Market Discovery"])
app.include_router(ollama_router, tags=["Ollama Management"])
app.include_router(credentials_router, tags=["Credentials Vault"])
app.include_router(energov_router, tags=["EnerGov Adapter"])
app.include_router(press_router, tags=["Press Feed"])
app.include_router(assessors_router, tags=["County Assessors"])
app.include_router(state_procurement_router, tags=["State Procurement"])
app.include_router(institutional_router, tags=["Institutional"])
app.include_router(portal_router, tags=["Portal Adapters"])
app.include_router(beeline_router, tags=["Beeline"])
app.include_router(tier1_router, tags=["Tier 1 Ollama"])


# ── Health ───────────────────────────────────────────────────────────────────

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

    credential_vault_ready = False
    try:
        from services.credentials import assert_master_key_configured
        assert_master_key_configured()
        credential_vault_ready = True
    except Exception:
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
        "credential_vault_ready": credential_vault_ready,
    }
