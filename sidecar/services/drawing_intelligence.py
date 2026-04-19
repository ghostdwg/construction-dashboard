"""
AI drawing analysis using Claude Vision.

Renders PDF pages to images using PyMuPDF and sends to Claude for
structured extraction. Used by the /parse/drawings/analyze endpoint.

Tiers:
  1 — Quick Scan:       Cover sheet + sheet index only (1-3 pages)
  2 — Scope Brief:      First sheet per discipline (up to 12 pages)
  3 — Full Intelligence: All pages
"""

import base64
import json
import os
import re

import anthropic
import fitz  # PyMuPDF

CLAUDE_MODELS = {
    "haiku":  "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus":   "claude-opus-4-6",
}

SHEET_PREFIX_RE = re.compile(r'\b([A-Z]{1,2})-?\d{3,4}\b')

PREFIX_TO_DISC = {
    "G": "GENERAL", "A": "ARCH", "S": "STRUCT",
    "M": "MECH",    "P": "PLUMB", "E": "ELEC",
    "C": "CIVIL",   "L": "CIVIL", "FP": "FP",
}

# ── Prompts ────────────────────────────────────────────────────────────────────

SYSTEM = """You are an expert construction analyst working for a general contractor.
You analyze drawing sets to help the GC understand project scope, flag bid risks,
and ensure every trade is covered.

Return valid JSON only. No markdown fences, no explanation outside the JSON."""

QUICK_SCAN_PROMPT = """Analyze these cover sheet / sheet index pages.

Return JSON:
{
  "projectDescription": "2-3 sentence plain-English summary",
  "projectType": "e.g. Medical Office, K-12 School, Warehouse",
  "estimatedSqft": 12500,
  "stories": 3,
  "disciplinesPresent": ["ARCH", "STRUCT", "MECH", "ELEC", "PLUMB", "FP", "CIVIL"],
  "specialSystems": ["e.g. Medical Gas", "BAS Controls", "Generator", "Clean Room"],
  "bidFlags": ["e.g. Phased construction", "Occupied facility", "Asbestos abatement"]
}

Use null for unknown numeric fields. Return only disciplines visible in the index."""

SCOPE_BRIEF_PROMPT = """Analyze these representative drawing sheets (first sheet per discipline).

Return JSON:
{
  "projectDescription": "2-3 sentence summary",
  "projectType": "building type",
  "disciplines": {
    "ARCH": {
      "scopeSummary": "one sentence",
      "notableItems": ["items worth calling out"],
      "bidRisks": ["estimator risk flags"]
    }
  },
  "coordinationNotes": ["cross-trade items"],
  "specialSystems": ["unusual scope"],
  "bidFlags": ["risk items for estimator attention"]
}

Include only disciplines you actually see drawings for."""

FULL_INTELLIGENCE_PROMPT = """Analyze this complete drawing set page by page.

Return JSON:
{
  "projectDescription": "3-4 sentence summary",
  "projectType": "building type",
  "totalSheets": 60,
  "disciplines": {
    "ARCH": {
      "scopeSummary": "paragraph summary",
      "keySheets": ["A-101", "A-201"],
      "notableItems": ["..."],
      "bidRisks": ["..."],
      "exclusionCandidates": ["scope subs typically exclude"]
    }
  },
  "coordinationNotes": ["MEP coordination, structural constraints"],
  "specialSystems": ["unusual scope items"],
  "bidAlternates": ["alternates called out in drawings"],
  "allowances": ["allowances found in drawings"],
  "nicItems": ["NIC or OFCI scope"],
  "rfiCandidates": ["unclear scope, conflicts, missing info"],
  "bidFlags": ["risk items, most severe first"]
}"""

TIER_PROMPTS = {1: QUICK_SCAN_PROMPT, 2: SCOPE_BRIEF_PROMPT, 3: FULL_INTELLIGENCE_PROMPT}
TIER_DPI    = {1: 100, 2: 150, 3: 150}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _render_pages(pdf_path: str, page_indices: list[int], dpi: int) -> list[dict]:
    """Render PDF pages to base64-encoded PNG image blocks."""
    doc = fitz.open(pdf_path)
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    blocks = []
    for idx in page_indices:
        if idx >= len(doc):
            continue
        pix = doc[idx].get_pixmap(matrix=mat)
        b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
        blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        })
    doc.close()
    return blocks


def _first_page_per_discipline(pdf_path: str) -> list[int]:
    """Scan PDF text and return the first page index for each discipline prefix."""
    doc = fitz.open(pdf_path)
    seen: dict[str, int] = {}
    for i, page in enumerate(doc):
        for m in SHEET_PREFIX_RE.finditer(page.get_text()):
            prefix = m.group(1)
            disc = PREFIX_TO_DISC.get(prefix)
            if disc and disc not in seen:
                seen[disc] = i
    doc.close()
    # Always include page 0 (cover / index)
    page_set = {0} | set(seen.values())
    return sorted(page_set)[:12]


def _parse_json(raw: str) -> dict:
    """Strip markdown fences if present and parse JSON."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw[:-3]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw, "_parseError": "Response was not valid JSON"}


# ── Public API ─────────────────────────────────────────────────────────────────

def analyze_drawings(pdf_path: str, tier: int, model: str) -> dict:
    """
    Analyze a drawing PDF with Claude Vision.

    Args:
        pdf_path: Absolute path to the PDF.
        tier:     1 (Quick Scan) | 2 (Scope Brief) | 3 (Full Intelligence)
        model:    "haiku" | "sonnet" | "opus"

    Returns:
        Parsed analysis dict including a _meta block.
    """
    if tier not in (1, 2, 3):
        raise ValueError(f"tier must be 1, 2, or 3 — got {tier}")
    model_id = CLAUDE_MODELS.get(model)
    if not model_id:
        raise ValueError(f"model must be haiku, sonnet, or opus — got {model}")

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    if tier == 1:
        page_indices = list(range(min(3, total_pages)))
    elif tier == 2:
        page_indices = _first_page_per_discipline(pdf_path)
    else:
        page_indices = list(range(total_pages))

    dpi = TIER_DPI[tier]
    image_blocks = _render_pages(pdf_path, page_indices, dpi)

    if not image_blocks:
        raise RuntimeError("No pages could be rendered from this PDF")

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    response = client.messages.create(
        model=model_id,
        max_tokens=4096,
        system=SYSTEM,
        messages=[{
            "role": "user",
            "content": image_blocks + [{"type": "text", "text": TIER_PROMPTS[tier]}],
        }],
    )

    result = _parse_json(response.content[0].text)
    result["_meta"] = {
        "tier": tier,
        "model": model,
        "pagesAnalyzed": len(image_blocks),
        "totalPages": total_pages,
        "inputTokens": response.usage.input_tokens,
        "outputTokens": response.usage.output_tokens,
    }
    return result
