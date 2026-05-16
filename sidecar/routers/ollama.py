"""
Ollama Management

GET    /ollama/health           — endpoint reachability + version
GET    /ollama/models           — installed models + suggestions catalog
POST   /ollama/pull             — start a model pull (streams NDJSON progress)
DELETE /ollama/models/{name}    — remove an installed model
"""

import json
import os
import re
from typing import AsyncGenerator, Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://100.126.166.110:11434")
OLLAMA_DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")
OLLAMA_TIMEOUT_S = 30
OLLAMA_PULL_TIMEOUT_S = 1800   # 30 min for big-model pulls

# Curated suggestions tailored to the prefilter use case (municipal text → JSON
# excerpt extraction). Ordered roughly best→worst for this workload at typical
# VRAM constraints. Tokens-per-second numbers are rough estimates for a single
# consumer GPU; treat them as ballpark.
SUGGESTED_MODELS = [
    {
        "name": "qwen2.5:14b",
        "size_gb": 8.4,
        "context": 131072,
        "note": "Current default. Strong instruction-following, 128k context. ~60-90s per typical doc.",
        "recommended": True,
        "use_case": "Best balance for municipal text extraction.",
    },
    {
        "name": "qwen2.5:32b",
        "size_gb": 19,
        "context": 131072,
        "note": "Bigger Qwen — noticeably better on long, messy docs. ~3-4 min per doc on a single 24GB GPU.",
        "recommended": False,
        "use_case": "Try when 14b misses signals in long staff reports.",
    },
    {
        "name": "gpt-oss:20b",
        "size_gb": 12,
        "context": 8192,
        "note": "Strong extractor. ~2 min per doc. Smaller context — may need to chunk 60K+ char docs.",
        "recommended": False,
        "use_case": "A/B test against qwen for accuracy.",
    },
    {
        "name": "llama3.1:8b",
        "size_gb": 4.7,
        "context": 131072,
        "note": "Faster (~30s per doc) but more hallucinations on names, addresses, dollar amounts.",
        "recommended": False,
        "use_case": "When throughput matters more than precision.",
    },
    {
        "name": "qwen2.5:7b",
        "size_gb": 4.4,
        "context": 131072,
        "note": "Smallest qwen2.5. Decent on short structured minutes; weaker on multi-page packets.",
        "recommended": False,
        "use_case": "Constrained VRAM situations.",
    },
    {
        "name": "gemma2:27b",
        "size_gb": 16,
        "context": 8192,
        "note": "Google's strong open model. Smaller context window may bite on long packets.",
        "recommended": False,
        "use_case": "Alternative to qwen2.5:32b.",
    },
    {
        "name": "deepseek-r1:14b",
        "size_gb": 9,
        "context": 131072,
        "note": "Reasoning model — may produce more thoughtful excerpts but slower and more verbose.",
        "recommended": False,
        "use_case": "Experimental — try if both qwen and gemma miss something subtle.",
    },
]


class ModelInfo(BaseModel):
    name: str
    size_gb: Optional[float] = None
    modified_at: Optional[str] = None
    digest: Optional[str] = None
    parameter_size: Optional[str] = None
    quantization: Optional[str] = None
    family: Optional[str] = None
    context_length: Optional[int] = None
    loaded: bool = False          # currently in VRAM


class HealthResponse(BaseModel):
    reachable: bool
    url: str
    default_model: str
    version: Optional[str] = None
    error: Optional[str] = None


class ModelsResponse(BaseModel):
    health: HealthResponse
    installed: list[ModelInfo]
    suggestions: list[dict]


@router.get("/ollama/health", response_model=HealthResponse)
async def ollama_health():
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
            r = await client.get(f"{OLLAMA_URL}/api/version")
            r.raise_for_status()
            data = r.json()
        return HealthResponse(
            reachable=True, url=OLLAMA_URL, default_model=OLLAMA_DEFAULT_MODEL,
            version=data.get("version"),
        )
    except Exception as exc:
        return HealthResponse(
            reachable=False, url=OLLAMA_URL, default_model=OLLAMA_DEFAULT_MODEL,
            error=f"{type(exc).__name__}: {str(exc)[:200]}",
        )


@router.get("/ollama/models", response_model=ModelsResponse)
async def ollama_models():
    """List installed models + which are currently loaded in VRAM."""
    health: HealthResponse
    installed: list[ModelInfo] = []
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
            # Health + tags + ps in parallel-ish (httpx async, sequential here for simplicity)
            v = await client.get(f"{OLLAMA_URL}/api/version")
            v.raise_for_status()
            tags = await client.get(f"{OLLAMA_URL}/api/tags")
            tags.raise_for_status()
            ps = await client.get(f"{OLLAMA_URL}/api/ps")
            ps_data = ps.json() if ps.status_code == 200 else {"models": []}

        health = HealthResponse(
            reachable=True, url=OLLAMA_URL, default_model=OLLAMA_DEFAULT_MODEL,
            version=v.json().get("version"),
        )
        loaded_names = {m.get("name") for m in ps_data.get("models", [])}

        for m in tags.json().get("models", []):
            details = m.get("details") or {}
            size_bytes = m.get("size", 0)
            installed.append(ModelInfo(
                name=m.get("name"),
                size_gb=round(size_bytes / 1024**3, 2) if size_bytes else None,
                modified_at=m.get("modified_at"),
                digest=(m.get("digest") or "")[:12] or None,
                parameter_size=details.get("parameter_size"),
                quantization=details.get("quantization_level"),
                family=details.get("family"),
                loaded=m.get("name") in loaded_names,
            ))
        installed.sort(key=lambda x: (not x.loaded, x.name))
    except Exception as exc:
        health = HealthResponse(
            reachable=False, url=OLLAMA_URL, default_model=OLLAMA_DEFAULT_MODEL,
            error=f"{type(exc).__name__}: {str(exc)[:200]}",
        )

    # Mark suggestions that are already installed
    installed_names = {m.name for m in installed}
    suggestions = []
    for s in SUGGESTED_MODELS:
        suggestions.append({**s, "installed": s["name"] in installed_names})

    return ModelsResponse(health=health, installed=installed, suggestions=suggestions)


class PullRequest(BaseModel):
    model: str   # e.g. "qwen2.5:32b"


_SAFE_MODEL_NAME = re.compile(r"^[A-Za-z0-9._:/-]+$")


@router.post("/ollama/pull")
async def ollama_pull(req: PullRequest):
    """Stream the Ollama /api/pull NDJSON response to the client.

    Each line is a JSON object Ollama emits during the pull (manifests,
    layers, progress). The client should read line-by-line and render
    progress."""
    if not _SAFE_MODEL_NAME.match(req.model or "") or len(req.model) > 200:
        raise HTTPException(400, "Invalid model name")

    async def event_stream() -> AsyncGenerator[bytes, None]:
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_PULL_TIMEOUT_S) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/pull",
                    json={"model": req.model, "stream": True},
                ) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        yield (line + "\n").encode("utf-8")
        except Exception as exc:
            yield json.dumps({"error": f"{type(exc).__name__}: {str(exc)[:200]}"}).encode("utf-8") + b"\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


class DeleteRequest(BaseModel):
    model: str


@router.delete("/ollama/models/{model_name:path}")
async def ollama_delete(model_name: str):
    if not _SAFE_MODEL_NAME.match(model_name) or len(model_name) > 200:
        raise HTTPException(400, "Invalid model name")
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
            r = await client.request(
                "DELETE",
                f"{OLLAMA_URL}/api/delete",
                json={"model": model_name},
            )
            r.raise_for_status()
        return {"deleted": model_name}
    except Exception as exc:
        raise HTTPException(502, f"Ollama delete failed: {exc}")
