"""
Tier 1 Ollama-only extraction (no Claude).

Uses the local Ollama model to do the FULL signal extraction (relevance,
project_type, owner, GC, etc.) that Claude does today. Trade-off: ~85% of
Claude quality, $0 LLM cost.

POST /market/tier1-extract
  Body: {text, jurisdiction?, document_date?, model?}
  Returns: same shape as /market/scan-document, no cost_usd / input_tokens
"""

import json
import os
import re
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://100.126.166.110:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")


TIER1_PROMPT = """You are a construction market intelligence analyst for a commercial GC.

Extract structured signals + relationships from the document below. Return STRICT JSON only.

{
  "jurisdiction": "<city/county or null>",
  "document_date": "<YYYY-MM-DD or null>",
  "signals": [
    {
      "signal_type": "MEETING_MINUTE",
      "signal_subtype": "<SUP_CUP|REZONING|PLAT|VARIANCE|SITE_PLAN|COMPREHENSIVE_PLAN|ANNEXATION|TIF|BOND|PERMIT_AWARD|CONTRACT_AWARD|OTHER>",
      "next_meeting_date": "<YYYY-MM-DD if CONTINUED to specific date, else null>",
      "headline": "<≤80 char title>",
      "description": "<2-3 sentence summary>",
      "location": "<address or null>",
      "estimated_value": <dollar number or null>,
      "project_type": "<commercial|industrial|institutional|infrastructure|mixed_use|office|municipal|residential_multi|residential_single|other>",
      "owner_name": "<owner/developer or null>",
      "architect_name": "<architect or null>",
      "gc_names": ["<GC names explicitly mentioned>"],
      "sub_names": ["<subcontractor names>"],
      "relevance_score": <0-100>,
      "status": "<APPROVED|CONTINUED|DENIED|DISCUSSED_NO_VOTE|WITHDRAWN>"
    }
  ],
  "relationships": [
    {"from_type":"<GC|ARCHITECT|OWNER|DEVELOPER|ENGINEER|SUB>","from_name":"...","to_type":"...","to_name":"...","relationship_type":"<BUILT|DESIGNED|PARTNERED|COMPETING|OWNED>","project_name":"...","project_value":null,"confidence":"<LOW|MEDIUM|HIGH>"}
  ]
}

Rules:
- Only include signals with relevance_score >= 30
- Ignore: routine business, single-family residential, HR items, utility approvals under $100K
- Verbatim names only — no inference
- If nothing relevant, return empty signals + relationships arrays

DOCUMENT:
"""


class Tier1Request(BaseModel):
    text: str
    jurisdiction: Optional[str] = None
    document_date: Optional[str] = None
    model: Optional[str] = None


class Tier1Response(BaseModel):
    signals_found: int
    relationships_found: int
    jurisdiction: Optional[str]
    document_date: Optional[str]
    signals: list[dict]
    relationships: list[dict]
    model_used: str
    cost_usd: float = 0.0


@router.post("/market/tier1-extract", response_model=Tier1Response)
async def tier1_extract(req: Tier1Request):
    """Run Ollama for the full extraction. No Claude call."""
    if not req.text.strip():
        raise HTTPException(400, "text is required")

    model = req.model or OLLAMA_MODEL
    prompt = TIER1_PROMPT + req.text[:100_000]

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.1, "num_ctx": 32768},
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        raise HTTPException(502, f"Ollama call failed: {exc}")

    try:
        parsed = json.loads(data.get("response", "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Ollama returned invalid JSON: {exc}")

    return Tier1Response(
        signals_found=len(parsed.get("signals", [])),
        relationships_found=len(parsed.get("relationships", [])),
        jurisdiction=req.jurisdiction or parsed.get("jurisdiction"),
        document_date=req.document_date or parsed.get("document_date"),
        signals=parsed.get("signals", []),
        relationships=parsed.get("relationships", []),
        model_used=model,
    )
