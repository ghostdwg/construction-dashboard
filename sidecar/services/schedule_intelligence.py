"""
Schedule Intelligence Engine — AI-driven schedule calibration.

Takes spec sections + drawing analysis, returns targeted modifications
to apply over the 9-phase CPM skeleton. Claude is given the full
project context and asked to return only the changes that matter —
not a schedule from scratch.

Models:
  sonnet  → claude-sonnet-4-6          ($3 / $15 per MTok)
  opus46  → claude-opus-4-6            ($15 / $75 per MTok)
  opus47  → claude-opus-4-7-20260401   (estimated same rate; update at release)
"""

import json
import os
import anthropic

# ── Model map ────────────────────────────────────────────────────────────────

MODEL_MAP = {
    "sonnet": "claude-sonnet-4-6",
    "opus46": "claude-opus-4-6",
    "opus47": "claude-opus-4-7-20260401",  # placeholder — update at GA release
}

COST_RATES: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6":        {"input": 3.00  / 1_000_000, "output": 15.00 / 1_000_000},
    "claude-opus-4-6":          {"input": 15.00 / 1_000_000, "output": 75.00 / 1_000_000},
    "claude-opus-4-7-20260401": {"input": 15.00 / 1_000_000, "output": 75.00 / 1_000_000},
}

# ── Compact template reference ────────────────────────────────────────────────
# Sent as context so Claude knows the existing activity codes / defaults.

TEMPLATE_SUMMARY = """\
PHASE 1 PRECONSTRUCTION
  M1000  Notice to Proceed                  0d  milestone
  P1010  Contract Execution                 5d
  P1020  Permit / AHJ Review               20d
  P1030  Submittal Register Setup           5d
  P1040  Baseline Schedule Development      5d
  P1050  Long Lead Procurement Kickoff      3d

PHASE 2 PROCUREMENT & LONG LEAD  (auto-populated per project spec divisions)
  P20xx  Procurement — [Trade]             varies

PHASE 3 MOBILIZATION & SITE WORK
  P3010  Mobilization                       3d
  P3020  Layout / Survey Control            2d
  P3030  Erosion Control / SWPPP Install    2d
  P3040  Clearing / Strip Topsoil           4d
  P3050  Building Pad Excavation            5d  Div 31
  P3060  Underground Utilities              8d  Div 33
  P3070  Footing Excavation                 3d  Div 31
  P3080  Footing Form / Reinforce           4d  Div 03
  M3085  Footing Inspection                 0d  milestone
  P3090  Footing Concrete Placement         2d  Div 03
  P3100  Foundation Wall Form / Reinforce   5d  Div 03
  M3105  Foundation Wall Inspection         0d  milestone
  P3110  Foundation Wall Concrete           2d  Div 03
  P3120  Damp Proofing / Waterproofing      3d  Div 07
  P3130  Backfill Foundations               4d
  P3140  Under Slab Prep / Stone / Vapor    4d
  P3150  Under Slab MEP Rough-In            4d  Div 22
  M3155  Under Slab Inspection              0d  milestone
  P3160  Slab Reinforcement / Prep          3d  Div 03
  P3170  Slab Placement                     2d  Div 03
  P3180  Slab Cure / Protection             5d  Div 03

PHASE 4 STRUCTURE
  P4010  Structural Delivery                2d  Div 05
  P4020  Structural Erection               10d  Div 05
  P4030  Anchor / Alignment Verification    1d
  M4040  Roof Structure Completion          0d  milestone

PHASE 5 BUILDING ENVELOPE
  P5010  Roof Panels Install                6d  Div 07
  P5020  Wall Panels Install                8d  Div 07
  M5030  Weather Tight                      0d  milestone
  P5040  Storefront Installation            5d  Div 08
  P5050  Overhead Door Installation         4d  Div 08
  P5060  Sealants / Exterior Closure        4d  Div 07

PHASE 6 INTERIOR FRAMING & ROUGH-IN
  P6010  Interior Layout                    2d
  P6020  Interior Metal Stud Framing        8d  Div 06
  P6030  In-Wall Blocking                   3d  Div 06
  P6040  Above Ceiling MEP Coordination     2d
  P6050  Plumbing Rough-In                  5d  Div 22
  P6060  HVAC Rough-In                      6d  Div 23
  P6070  Electrical Rough-In               6d  Div 26
  P6080  Low Voltage Rough-In               4d  Div 27
  M6085  In-Wall Inspection                 0d  milestone
  P6090  Insulation                         3d  Div 07
  P6100  Drywall Hang                       5d  Div 09
  P6110  Drywall Finish                     6d  Div 09

PHASE 7 INTERIOR FINISHES
  P7010  Prime / First Coat Paint           4d  Div 09
  P7020  Ceiling Grid Install               4d
  P7030  Ceiling Tile Install               3d
  P7040  Casework / Millwork Install        4d
  P7050  Flooring Prep                      2d
  P7060  Flooring Install                   4d
  P7070  Finish Electrical Devices          4d  Div 26
  P7080  Finish Plumbing Trim               3d  Div 22
  P7090  HVAC Startup Prep                  2d  Div 23
  P7100  Bathroom Accessories / Specialties 2d  Div 10
  P7110  Final Paint / Touchup              3d  Div 09

PHASE 8 EXTERIOR SITE IMPROVEMENTS
  P8010  Fine Grading                       4d  Div 31
  P8020  Sidewalks / Exterior Flatwork      4d  Div 32
  P8030  Pavement Prep                      3d  Div 32
  P8040  Asphalt / Paving                   3d  Div 32
  P8050  Striping / Signage                 2d
  P8060  Landscaping                        3d

PHASE 9 STARTUP, INSPECTIONS & CLOSEOUT
  P9010  HVAC Startup / TAB                 4d  Div 23
  P9020  Fire Alarm / Life Safety Testing   2d  Div 28
  P9030  Final MEP Inspections              2d
  M9040  Building Final Inspection          0d  milestone
  P9050  Punchlist                          5d
  P9060  Punchlist Completion               4d
  M9070  Substantial Completion             0d  milestone
  P9080  Closeout Docs / O&M / Training     5d
  M9090  Final Completion                   0d  milestone
"""

SYSTEM_PROMPT = """\
You are an expert GC scheduler helping calibrate a 9-phase commercial \
construction CPM schedule template against a specific project's spec book \
and drawing set.

Your job is NOT to generate a schedule from scratch. You receive:
  1. A summary of the project drawings (building type, disciplines, special systems)
  2. The project spec book — every CSI section with its title and key AI extractions
  3. The 9-phase CPM skeleton template with default activity codes and durations

Return ONLY a valid JSON object — no markdown fences, no text outside the JSON.
Be conservative with duration changes (prefer adding buffer over compressing).
Only override activities where the specs clearly indicate a different scope or \
complexity vs. the template default."""


def _extract_json(text: str) -> dict:
    """Extract the outermost JSON object from a Claude response."""
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in response")
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("Unterminated JSON object in response")


def _build_user_prompt(spec_sections: list[dict], drawing_analysis: dict | None) -> str:
    parts: list[str] = []

    # ── Drawing analysis ────────────────────────────────────────────────────
    if drawing_analysis:
        da = drawing_analysis
        parts.append("=== PROJECT DRAWINGS ===")
        if da.get("projectDescription"):
            parts.append(f"Description: {da['projectDescription']}")
        if da.get("projectType"):
            parts.append(f"Type: {da['projectType']}")
        if da.get("estimatedSqft"):
            parts.append(f"Area: ~{da['estimatedSqft']:,} SF")
        if da.get("stories"):
            parts.append(f"Stories: {da['stories']}")
        if da.get("disciplinesPresent"):
            parts.append(f"Disciplines: {', '.join(da['disciplinesPresent'])}")
        if da.get("specialSystems"):
            parts.append(f"Special systems: {', '.join(da['specialSystems'])}")
        if da.get("bidFlags"):
            parts.append(f"Scheduling flags: {', '.join(da['bidFlags'])}")
        parts.append("")

    # ── Spec sections ────────────────────────────────────────────────────────
    parts.append(f"=== SPEC BOOK ({len(spec_sections)} SECTIONS) ===")
    for s in spec_sections:
        csi = s.get("csi", "")
        title = s.get("canonical_title") or s.get("title", "")
        line = f"{csi}  {title}"

        # Surface high-value scheduling hints from AI extractions
        extractions = s.get("ai_extractions")
        if extractions:
            try:
                ext = (
                    json.loads(extractions)
                    if isinstance(extractions, str)
                    else extractions
                )
                hints: list[str] = []
                if ext.get("long_lead"):
                    hints.append("LONG LEAD")
                if ext.get("procurement"):
                    hints.append(f"procurement: {str(ext['procurement'])[:80]}")
                if ext.get("special_requirements"):
                    hints.append(str(ext["special_requirements"])[:100])
                if ext.get("testing"):
                    hints.append("testing/commissioning required")
                if hints:
                    line += f"  // {'; '.join(hints)}"
            except Exception:
                pass

        parts.append(line)

    parts.append("")
    parts.append("=== 9-PHASE SKELETON TEMPLATE ===")
    parts.append(TEMPLATE_SUMMARY)

    parts.append(
        """
Based on the spec book and drawings above, return a JSON object:

{
  "project_summary": "2–3 sentences on key scheduling implications for this project",
  "estimated_weeks": 38,

  "activity_overrides": [
    // Update name, duration, or notes on an existing template activity.
    // Only include when the change is material (>2d or meaningfully better name).
    // Omit fields you are not changing.
    {
      "code": "P3090",
      "name": "CMU Foundation Walls",
      "duration_days": 12,
      "notes": "Bond beam reinforcement per 04 22 00 adds 2-day cycle"
    }
  ],

  "new_activities": [
    // Project-specific activities clearly present in specs but missing from template.
    // Insert after the specified template code.
    {
      "insert_after_code": "P7040",
      "name": "Loading Dock Equipment Install",
      "duration_days": 3,
      "csi_code": "11 13 00",
      "notes": "Dock levelers + bumpers per spec 11 13 00"
    }
  ],

  "procurement_activities": [
    // Override Phase 2 procurement. Only include divisions with genuine long-lead
    // fabrication (>3 weeks). Skip standard-stock trades (03, 06, 09, 31, 32, 33).
    {
      "csi_div": "05",
      "name": "Procurement — Structural Steel",
      "duration_days": 52,
      "notes": "Standard AISC W-shapes — verify fab lead with fabricator"
    }
  ]
}

Rules:
- Be conservative — most estimators prefer buffer over compression
- Only override activities where specs clearly indicate different scope/complexity
- Only add new_activities for systems clearly present in specs but absent from template
- Keep activity names concise (under 50 chars)
- durations are in working days
"""
    )

    return "\n".join(parts)


def generate_schedule_intelligence(
    spec_sections: list[dict],
    drawing_analysis: dict | None,
    model: str,
) -> dict:
    """
    Call Claude with spec + drawing context, return schedule modifications.

    Returns dict with keys:
      activity_overrides, new_activities, procurement_activities,
      project_summary, estimated_weeks, cost_usd, input_tokens, output_tokens
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    model_id = MODEL_MAP.get(model, MODEL_MAP["sonnet"])
    client = anthropic.Anthropic(api_key=api_key)
    user_prompt = _build_user_prompt(spec_sections, drawing_analysis)

    response = client.messages.create(
        model=model_id,
        max_tokens=8_000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text if response.content else ""
    usage = response.usage
    rates = COST_RATES.get(model_id, COST_RATES["claude-sonnet-4-6"])
    cost_usd = usage.input_tokens * rates["input"] + usage.output_tokens * rates["output"]

    try:
        result = _extract_json(raw)
    except Exception as exc:
        raise RuntimeError(
            f"Claude returned unparseable JSON: {exc}\nRaw (first 500 chars): {raw[:500]}"
        ) from exc

    return {
        "activity_overrides": result.get("activity_overrides", []),
        "new_activities": result.get("new_activities", []),
        "procurement_activities": result.get("procurement_activities", []),
        "project_summary": result.get("project_summary", ""),
        "estimated_weeks": result.get("estimated_weeks"),
        "cost_usd": round(cost_usd, 4),
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
    }


def estimate_input_tokens(section_count: int, has_drawings: bool) -> int:
    """
    Rough input-token estimate for pre-run cost display.
    ~400 tokens per spec section + 3 500 for drawings + 3 000 for template + prompt.
    """
    return section_count * 400 + (3_500 if has_drawings else 0) + 3_000
