"""
Submittal Intelligence — cross-reference spec sections with drawing analysis.

Takes a list of covered CSI sections and a drawing analysisJson, then asks
Claude to identify scope items visible in the drawings that are NOT already
covered by a spec section. Returns drawing-sourced submittal additions only
— spec-derived submittals are handled by the local generateFromAiAnalysis
function and are not re-processed here.
"""

import os
import json
import anthropic

SONNET_MODEL = "claude-sonnet-4-6"

COST_RATES = {
    SONNET_MODEL: {"input": 3.00 / 1_000_000, "output": 15.00 / 1_000_000},
}

# ── Prompt ────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior construction project manager compiling a submittal register for a commercial project.

You have been given:
1. A list of CSI spec sections already covered by the spec book
2. Drawing set analysis — scope extracted from the actual drawing set

Your ONLY job: identify systems or scope items clearly visible in the drawings that have NO corresponding spec section. For each such gap, generate the submittal items that would be required.

Rules:
- ONLY generate submittals for scope in the drawings with no spec section coverage
- Do NOT re-list items already covered by the listed spec sections
- Do NOT generate generic boilerplate ("Product Data" with no specifics)
- Be specific — name the actual system, assembly, or product
- Maximum 25 items total
- If everything in the drawings appears to have spec section coverage, return an empty list

Return JSON (no prose, no markdown wrapper):
{
  "drawing_submittals": [
    {
      "type": "PRODUCT_DATA|SHOP_DRAWING|SAMPLE|MOCKUP|WARRANTY|O_AND_M|OTHER",
      "section_title": "Short system name (e.g. BAS Controls, VRF System, CCTV)",
      "title": "System – Submittal Type (e.g. BAS Controls – Shop Drawings)",
      "description": "Specific description of what is required",
      "engineer_review": false,
      "notes": "Source note (e.g. Identified in MECH drawing scope; no spec section found)"
    }
  ],
  "spec_coverage_gaps": ["Brief label for each drawing system with no spec coverage"],
  "project_summary": "1–2 sentences on drawing scope and key drawing-sourced requirements"
}"""


# ── Public function ───────────────────────────────────────────────────────────

def generate_submittal_intelligence(
    spec_sections: list[dict],
    drawing_analysis: dict,
    model: str = "sonnet",
) -> dict:
    """
    Cross-reference spec sections against drawing analysis.

    spec_sections: [{csi, title}] — sections already covered by the spec book
    drawing_analysis: parsed DrawingUpload.analysisJson

    Returns:
        {drawing_submittals, spec_coverage_gaps, project_summary,
         cost_usd, input_tokens, output_tokens}
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    # Build compact coverage list
    covered_lines = [
        f"  {s.get('csi', '')} — {s.get('title', '')}"
        for s in spec_sections[:150]          # guard against huge lists
    ]

    drawing_summary = _summarize_drawing_analysis(drawing_analysis)

    user_content = (
        f"SPEC SECTIONS ALREADY COVERED ({len(spec_sections)}):\n"
        + "\n".join(covered_lines)
        + "\n\nDRAWING SET ANALYSIS:\n"
        + drawing_summary
        + "\n\nIdentify scope in the drawing analysis NOT covered by the spec sections above."
    )

    import time as _time
    response = None
    for attempt in range(3):
        try:
            response = client.messages.create(
                model=SONNET_MODEL,
                max_tokens=4_000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_content}],
            )
            break
        except anthropic.APIStatusError as e:
            if e.status_code in (429, 529) and attempt < 2:
                _time.sleep((attempt + 1) * 5)
                continue
            raise

    if response is None:
        raise RuntimeError("Failed to get drawing intelligence after 3 retries")

    text = response.content[0].text if response.content else "{}"
    text = _extract_json_block(text)

    try:
        result = json.loads(text.strip())
    except json.JSONDecodeError:
        result = {}

    inp = response.usage.input_tokens
    out = response.usage.output_tokens
    cost = inp * COST_RATES[SONNET_MODEL]["input"] + out * COST_RATES[SONNET_MODEL]["output"]

    return {
        "drawing_submittals": result.get("drawing_submittals", []),
        "spec_coverage_gaps": result.get("spec_coverage_gaps", []),
        "project_summary": result.get("project_summary", ""),
        "cost_usd": round(cost, 4),
        "input_tokens": inp,
        "output_tokens": out,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _summarize_drawing_analysis(analysis: dict) -> str:
    """Convert drawing analysisJson into compact text for Claude."""
    lines: list[str] = []

    if desc := analysis.get("projectDescription"):
        lines.append(f"Project: {desc}")
    if pt := analysis.get("projectType"):
        lines.append(f"Type: {pt}")

    # Tier 1 format: disciplinesPresent + specialSystems at top level
    if discs := analysis.get("disciplinesPresent"):
        lines.append(f"Disciplines: {', '.join(discs)}")

    # Tier 2/3 format: per-discipline objects
    if disciplines := analysis.get("disciplines"):
        for disc, data in disciplines.items():
            if not isinstance(data, dict):
                continue
            summary = data.get("scopeSummary", "")
            notable = data.get("notableItems", [])
            if summary:
                lines.append(f"\n{disc}: {summary}")
            for item in notable[:5]:
                lines.append(f"  • {item}")

    # Special systems (appears in both tier formats)
    if special := analysis.get("specialSystems"):
        lines.append(f"\nSpecial Systems: {', '.join(special)}")

    if flags := analysis.get("bidFlags"):
        lines.append(f"Bid Flags: {', '.join(flags[:5])}")

    return "\n".join(lines) if lines else "(no drawing analysis data available)"


def _extract_json_block(text: str) -> str:
    """Extract JSON from a Claude response that may be wrapped in markdown."""
    start = text.find("```json")
    if start >= 0:
        s = start + 7
        e = text.find("```", s)
        return text[s:e] if e > s else text[s:]
    start = text.find("```")
    if start >= 0:
        s = start + 3
        e = text.find("```", s)
        return text[s:e] if e > s else text[s:]
    return text
