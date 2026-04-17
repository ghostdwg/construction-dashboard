"""
Spec Intelligence Engine — AI-first spec book analysis.

Three-pass pipeline:
  Pass 1 (Haiku): Read TOC pages, identify EVERY CSI section in the book
  Pass 2 (Sonnet/Haiku tiered): Analyze each section — routed by division complexity
  Pass 3: Aggregate flags, build risk summary

Division routing:
  Sonnet (complex/high-risk): 03,05,07,08,14,21,22,23,26,27,28
  Haiku (straightforward): everything else

Every section gets reviewed. Every section gets a severity flag.
"""

import os
import re
import json
import anthropic
import pymupdf


# ── Model routing by CSI division ────────────────────────────────────────────

# Complex divisions that need Sonnet's deeper analysis
SONNET_DIVISIONS = {
    "03",  # Concrete — mix designs, testing, tolerances
    "05",  # Metals — structural connections, AISC certs
    "07",  # Thermal & Moisture — warranties, performance specs
    "08",  # Openings — curtain wall, storefront, hardware schedules
    "14",  # Conveying — elevators, long lead
    "21",  # Fire Suppression — life safety, code-driven
    "22",  # Plumbing — code-heavy, fixture schedules
    "23",  # HVAC — most complex, controls, TAB, refrigerant
    "26",  # Electrical — arc flash, panel schedules, code
    "27",  # Communications — low voltage, structured cabling
    "28",  # Electronic Safety — fire alarm, access control
}

HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-20250514"


def _model_for_division(csi: str) -> str:
    """Route a CSI section to the appropriate model based on division."""
    div = re.sub(r"\D", "", csi)[:2]
    return SONNET_MODEL if div in SONNET_DIVISIONS else HAIKU_MODEL


# ── Cost tracking ────────────────────────────────────────────────────────────

COST_RATES = {
    HAIKU_MODEL: {"input": 1.00 / 1_000_000, "output": 5.00 / 1_000_000},
    SONNET_MODEL: {"input": 3.00 / 1_000_000, "output": 15.00 / 1_000_000},
}


def _cost(model: str, inp: int, out: int) -> float:
    rates = COST_RATES.get(model, COST_RATES[SONNET_MODEL])
    return inp * rates["input"] + out * rates["output"]


def _extract_json_block(text: str) -> str:
    """
    Extract JSON from a Claude response that may be wrapped in markdown
    code blocks. Handles partial/truncated responses gracefully.
    """
    # Try ```json ... ``` first
    start_marker = text.find("```json")
    if start_marker >= 0:
        start = start_marker + 7
        end = text.find("```", start)
        return text[start:end] if end > start else text[start:]

    # Try plain ``` ... ```
    start_marker = text.find("```")
    if start_marker >= 0:
        start = start_marker + 3
        end = text.find("```", start)
        return text[start:end] if end > start else text[start:]

    # No code block — return as-is
    return text


# ── Pass 1: TOC-based section identification ─────────────────────────────────

IDENTIFY_SYSTEM = """You are a construction specification analyst. You read spec book text and identify every CSI MasterFormat section.

RULES:
- Identify EVERY real CSI spec section in the document (6-digit codes like 03 30 00, 22 40 00)
- Read the Table of Contents if present — it lists all sections
- Also scan the full text for SECTION headers that may not appear in the TOC
- IGNORE geotechnical reports, boring logs, soil test data, site surveys, civil engineering reports
- IGNORE the Table of Contents entries themselves — find the actual section bodies
- A real spec section has a CSI number (XX XX XX format) and a title
- Common divisions: 01-14 (general/architectural), 21-28 (MEP/fire/electrical), 31-33 (sitework)

Return a JSON array. Each object:
{
  "csi": "XX XX XX",
  "title": "Full Section Title as written in the spec"
}

Return ONLY the JSON array. Include ALL sections — missing even one is a failure."""

IDENTIFY_USER = """Identify every CSI MasterFormat specification section in this construction spec book.

The document is {page_count} pages. Here is the text (page breaks marked with [PAGE X]):

{text}"""


def _identify_sections(full_text: str, page_count: int, client: anthropic.Anthropic) -> tuple[list[dict], dict]:
    """
    Pass 1: Send TOC + sampling of full text to Haiku to identify ALL sections.
    Uses a smart truncation strategy: TOC pages + first lines of each page.
    """
    # Strategy: include the first 15 pages in full (where TOC lives)
    # plus the first 200 chars of every other page (catches section headers)
    pages = full_text.split("[PAGE ")
    smart_text_parts = []

    for i, page in enumerate(pages):
        if i == 0:
            smart_text_parts.append(page[:5000])
            continue

        if i <= 15:
            # Full text for first 15 pages (TOC + early sections)
            smart_text_parts.append(f"[PAGE {page[:8000]}")
        else:
            # First 300 chars of remaining pages (catches SECTION headers)
            smart_text_parts.append(f"[PAGE {page[:300]}")

    smart_text = "\n".join(smart_text_parts)

    # Cap at 190K chars for Haiku context window
    smart_text = smart_text[:190_000]

    model = HAIKU_MODEL
    import time as _time
    response = None
    for attempt in range(5):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=8000,  # Enough for 100+ sections
                system=IDENTIFY_SYSTEM,
                messages=[{
                    "role": "user",
                    "content": IDENTIFY_USER.format(text=smart_text, page_count=page_count),
                }],
            )
            break
        except anthropic.APIStatusError as e:
            if e.status_code in (429, 529) and attempt < 4:
                _time.sleep((attempt + 1) * 5)
                continue
            raise

    if response is None:
        raise RuntimeError("Failed to identify sections after 5 retries")

    text = response.content[0].text if response.content else "[]"
    text = _extract_json_block(text)

    try:
        sections = json.loads(text.strip())
    except json.JSONDecodeError:
        sections = []

    usage = {
        "model": model,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "cost": _cost(model, response.usage.input_tokens, response.usage.output_tokens),
    }

    return sections, usage


# ── Text extraction for identified sections ──────────────────────────────────

def _extract_section_text(csi: str, title: str, full_text: str) -> str:
    """
    Find the body text for a specific CSI section in the full document.
    Searches for "SECTION XX XX XX" or "SECTION XXXXXX" header and grabs
    text until the next section or END OF SECTION.

    Handles various CSI formatting: "21 00 00", "21 0000", "210000"
    """
    # Build a flexible CSI pattern that matches any spacing variant
    digits = re.sub(r"\D", "", csi)  # "210000"
    if len(digits) == 6:
        # Match: "21 00 00", "21 0000", "210000", "21  00  00" etc
        csi_pattern = rf"{digits[0:2]}\s*{digits[2:4]}\s*{digits[4:6]}"
    else:
        csi_pattern = re.escape(csi)

    # Search for "SECTION <csi>" in the text — prefer matches with "PART 1" nearby
    section_re = re.compile(
        rf"SECTION\s+{csi_pattern}\b",
        re.IGNORECASE,
    )

    matches = list(section_re.finditer(full_text))
    match = None

    # Prefer matches followed by "PART 1" or "GENERAL" (body, not TOC)
    for m in matches:
        peek = full_text[m.start():m.start() + 800].upper()
        if "PART 1" in peek or "GENERAL REQUIREMENTS" in peek or "GENERAL REQUIREMENT" in peek:
            match = m
            break

    # Fallback: last occurrence (usually the body, TOC is earlier)
    if not match and matches:
        match = matches[-1]

    if not match:
        return ""

    start = match.start()

    # Find the end: next "SECTION XX XX XX" or "END OF SECTION"
    end_pattern = re.compile(
        r"\bSECTION\s+\d{2}\s*\d{2}\s*\d{2,4}\b|\bEND\s+OF\s+SECTION\b",
        re.IGNORECASE,
    )
    end_match = end_pattern.search(full_text, start + 200)
    end = end_match.start() if end_match else min(start + 15000, len(full_text))

    # Include "END OF SECTION" text if that's what we found
    if end_match and "END OF SECTION" in full_text[end_match.start():end_match.end() + 25].upper():
        end = end_match.end() + 25

    raw = full_text[start:end].strip()
    return raw[:12000]  # Cap at 12K chars per section


# ── Pass 2: Per-section analysis (tiered by division) ────────────────────────

ANALYZE_SYSTEM = """You are a senior construction estimator reviewing a specification section for bid preparation.

Analyze this section and provide structured intelligence. Be SPECIFIC — reference actual requirements from the text.

Return JSON:
{{
  "description": "2-3 sentence scope summary",
  "severity": "CRITICAL|HIGH|MODERATE|LOW|INFO",
  "severity_reason": "Why this severity level",
  "submittals": [
    {{"type": "PRODUCT_DATA|SHOP_DRAWING|SAMPLE|MOCKUP|WARRANTY|O_AND_M|LEED|CERT|OTHER", "description": "...", "engineer_review": true/false}}
  ],
  "pain_points": [
    {{"issue": "Specific issue from the spec text", "severity": "HIGH|MEDIUM|LOW", "cost_impact": "How this affects pricing"}}
  ],
  "gaps": [
    {{"issue": "What's missing or vague", "recommendation": "What to ask or assume"}}
  ],
  "flags": ["Specific items the estimator MUST review before bid day"],
  "products": [
    {{"manufacturer": "...", "product": "...", "basis_of_design": true/false}}
  ],
  "warranty": [
    {{"duration": "...", "type": "MANUFACTURER|INSTALLER|SYSTEM", "scope": "..."}}
  ],
  "training": [
    {{
      "audience": "OWNER|MAINTENANCE|OPERATIONS|EMERGENCY|OTHER",
      "topic": "Short topic label (e.g., BMS operation, fire alarm panel, elevator controls)",
      "requirement": "Full training requirement as stated in the spec",
      "duration": "e.g., 8 hours, 2 days — null if not specified",
      "timing": "e.g., prior to substantial completion, within 30 days of occupancy — null if not specified"
    }}
  ],
  "inspections": [
    {{
      "type": "SPECIAL|THIRD_PARTY|OWNER_WITNESS|CONTRACTOR_QC|AHJ|OTHER",
      "activity": "What is being inspected (e.g., concrete placement, high-strength bolt installation, spray fireproofing)",
      "standard": "Reference standard or code section (e.g., ACI 318-19, ASTM A325, IBC §1705.3) — null if not specified",
      "frequency": "e.g., continuous, periodic, each pour, once at completion — null if not specified",
      "timing": "e.g., prior to concrete placement, before covering with gypsum board — null if not specified",
      "who": "Who performs inspection (e.g., special inspector, independent testing lab, AHJ, owner's representative) — null if not specified",
      "acceptance_criteria": "Pass/fail criteria or referenced table from the spec — null if not specified"
    }}
  ],
  "closeout": [
    {{
      "type": "RECORD_DRAWINGS|ATTIC_STOCK|MANUALS|KEYS|CERTIFICATIONS|BALANCING|COMMISSIONING|FINAL_CLEAN|OTHER",
      "description": "What must be delivered or completed at project closeout",
      "quantity": "e.g., 3 sets, 2 copies, 10% extra material, 1 complete set of keys — null if not specified",
      "timing": "e.g., at substantial completion, 30 days prior to turnover, with final pay application — null if not specified"
    }}
  ]
}}

Severity guide:
- CRITICAL: Sole-source, unusual warranty, LD triggers, life safety, items that WILL cause a change order
- HIGH: Tight tolerances, expensive testing, phasing constraints, long lead items
- MODERATE: Standard but noteworthy requirements, coordination items
- LOW: Typical requirements, minor submittals
- INFO: Standard boilerplate, no special attention needed

Be concise but complete. Think like an estimator with 2 weeks to bid day."""

ANALYZE_USER = """SECTION {csi} — {title}

{text}"""


def _analyze_section(
    csi: str,
    title: str,
    section_text: str,
    client: anthropic.Anthropic,
) -> tuple[dict, dict]:
    """
    Pass 2: Analyze a single spec section. Model is chosen by division complexity.
    """
    model = _model_for_division(csi)
    model_label = "Sonnet" if model == SONNET_MODEL else "Haiku"

    if not section_text.strip():
        return {
            "description": f"Section {csi} identified but body text not found in document.",
            "severity": "HIGH",
            "severity_reason": "Section body text could not be extracted — verify spec book is complete",
            "submittals": [],
            "pain_points": [{"issue": "Section text not found", "severity": "HIGH", "cost_impact": "Cannot price without specs"}],
            "gaps": [{"issue": "Section body missing from parsed text", "recommendation": "Verify PDF has full section content"}],
            "flags": [f"MISSING: Section {csi} text not extracted — check spec book manually"],
            "products": [],
            "warranty": [],
        }, {"model": model, "input_tokens": 0, "output_tokens": 0, "cost": 0}

    # Retry on overloaded (529) and rate limit (429) errors
    import time as _time
    response = None
    for attempt in range(5):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=2500,
                system=ANALYZE_SYSTEM,
                messages=[{
                    "role": "user",
                    "content": ANALYZE_USER.format(csi=csi, title=title, text=section_text[:8000]),
                }],
            )
            break
        except anthropic.APIStatusError as e:
            if e.status_code in (429, 529) and attempt < 4:
                wait = (attempt + 1) * 5  # 5, 10, 15, 20 seconds
                _time.sleep(wait)
                continue
            raise

    if response is None:
        raise RuntimeError(f"Failed to analyze section {csi} after 5 retries")

    text = response.content[0].text if response.content else "{}"
    text = _extract_json_block(text)

    try:
        analysis = json.loads(text.strip())
    except json.JSONDecodeError:
        analysis = {"_raw": text, "_parse_error": True, "severity": "HIGH"}

    # Tag with model used
    analysis["_model"] = model_label

    usage = {
        "model": model,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "cost": _cost(model, response.usage.input_tokens, response.usage.output_tokens),
    }

    return analysis, usage


# ── Section-PDF-based analysis (skips Pass 1 — uses split PDFs as source) ────

def analyze_split_sections(
    sections: list[dict],
    on_progress: callable = None,
) -> dict:
    """
    Analyze already-split spec sections. Each section has its own PDF file
    (from spec_splitter), so context is clean and isolated.

    Input: [{ csi, title, pdf_path }]
    Each PDF is opened, text extracted, then sent to Claude (tiered by division).

    Returns same shape as run_spec_intelligence.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    results = []
    usages = []
    total_cost = 0.0
    severity_counts = {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0, "INFO": 0}

    import time as _time
    for i, sec in enumerate(sections):
        csi = sec.get("csi", "")
        title = sec.get("title", "")
        pdf_path = sec.get("pdf_path", "")

        if on_progress:
            on_progress(i + 1, len(sections), csi)

        # Extract text from the per-section PDF
        section_text = ""
        if pdf_path and os.path.exists(pdf_path):
            try:
                doc = pymupdf.open(pdf_path)
                for page in doc:
                    section_text += page.get_text("text") + "\n"
                doc.close()
            except Exception as e:
                section_text = f"[extraction error: {e}]"

        # Throttle
        if i > 0:
            _time.sleep(2)

        analysis, usage = _analyze_section(csi, title, section_text, client)

        results.append({
            "csi": csi,
            "title": title,
            "pdf_path": pdf_path,
            "raw_text": section_text[:5000],
            "analysis": analysis,
            "model_tier": "Sonnet" if _model_for_division(csi) == SONNET_MODEL else "Haiku",
        })
        usages.append({"csi": csi, **usage})
        total_cost += usage["cost"]

        sev = analysis.get("severity", "MODERATE").upper()
        if sev in severity_counts:
            severity_counts[sev] += 1

    return {
        "sections": results,
        "section_count": len(results),
        "summary": {
            "total": len(results),
            **{k.lower(): v for k, v in severity_counts.items()},
        },
        "pass1_usage": None,  # No Pass 1 — splitter did section identification
        "pass2_usage": {
            "total_input": sum(u["input_tokens"] for u in usages),
            "total_output": sum(u["output_tokens"] for u in usages),
            "total_cost": round(total_cost, 4),
            "sections_analyzed": len(usages),
            "sonnet_sections": sum(1 for u in usages if "sonnet" in u["model"]),
            "haiku_sections": sum(1 for u in usages if "haiku" in u["model"]),
        },
        "total_cost": round(total_cost, 4),
    }


# ── Full pipeline ────────────────────────────────────────────────────────────

def run_spec_intelligence(
    pdf_path: str,
    analyze: bool = True,
    on_progress: callable = None,
) -> dict:
    """
    Full spec intelligence pipeline:
      1. Extract text with PyMuPDF4LLM
      2. Claude Haiku reads TOC + headers → identifies ALL CSI sections
      3. Extract body text for each section from the full document
      4. Route each section to Sonnet (complex) or Haiku (standard) for analysis
      5. Every section gets severity flag: CRITICAL / HIGH / MODERATE / LOW / INFO

    Returns:
        {
            sections: [{csi, title, raw_text, analysis, model_used}],
            summary: {total, critical, high, moderate, low, info},
            pass1_usage, pass2_usage, total_cost
        }
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    # Step 1: Extract text with PyMuPDF (fast raw text, not markdown)
    doc = pymupdf.open(pdf_path)
    page_texts = []
    for page in doc:
        page_texts.append(page.get_text("text"))
    doc.close()

    full_text_parts = []
    for i, pt in enumerate(page_texts):
        full_text_parts.append(f"\n[PAGE {i + 1}]\n{pt}")
    full_text = "".join(full_text_parts)
    page_count = len(page_texts)

    # Step 2: Identify ALL sections (Pass 1 — Haiku, cheap)
    identified, pass1_usage = _identify_sections(full_text, page_count, client)

    if not identified:
        return {
            "sections": [],
            "section_count": 0,
            "summary": {"total": 0, "critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0},
            "pass1_usage": pass1_usage,
            "pass2_usage": None,
            "total_cost": pass1_usage["cost"],
        }

    # Step 3: Extract body text for each section
    sections_with_text = []
    for sec in identified:
        csi = sec.get("csi", "")
        title = sec.get("title", "")

        raw_text = _extract_section_text(csi, title, full_text)

        sections_with_text.append({
            "csi": csi,
            "title": title,
            "raw_text": raw_text,
            "model_tier": "Sonnet" if _model_for_division(csi) == SONNET_MODEL else "Haiku",
        })

    # Step 4: Analyze each section (Pass 2 — tiered)
    pass2_usages = []
    total_pass2_cost = 0.0
    severity_counts = {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0, "INFO": 0}

    import time as _time
    for i, sec in enumerate(sections_with_text):
        if on_progress:
            on_progress(i + 1, len(sections_with_text), sec["csi"])

        if analyze:
            # Throttle: 2 second pause between API calls to avoid rate limits
            if i > 0:
                _time.sleep(2)

            analysis, usage = _analyze_section(
                sec["csi"], sec["title"], sec["raw_text"], client
            )
            sec["analysis"] = analysis
            pass2_usages.append({"csi": sec["csi"], "model": usage["model"], **usage})
            total_pass2_cost += usage["cost"]

            # Count severity
            sev = analysis.get("severity", "MODERATE").upper()
            if sev in severity_counts:
                severity_counts[sev] += 1
        else:
            sec["analysis"] = None

    pass2_summary = {
        "total_input": sum(u["input_tokens"] for u in pass2_usages),
        "total_output": sum(u["output_tokens"] for u in pass2_usages),
        "total_cost": round(total_pass2_cost, 4),
        "sections_analyzed": len(pass2_usages),
        "sonnet_sections": sum(1 for u in pass2_usages if "sonnet" in u["model"]),
        "haiku_sections": sum(1 for u in pass2_usages if "haiku" in u["model"]),
    }

    total_cost = pass1_usage["cost"] + total_pass2_cost

    return {
        "sections": sections_with_text,
        "section_count": len(sections_with_text),
        "summary": {
            "total": len(sections_with_text),
            **{k.lower(): v for k, v in severity_counts.items()},
        },
        "pass1_usage": pass1_usage,
        "pass2_usage": pass2_summary,
        "total_cost": round(total_cost, 4),
    }
