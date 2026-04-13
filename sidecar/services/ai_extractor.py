"""
AI-enhanced spec section analysis using Claude.

Sends each CSI section to Claude (Sonnet) for structured extraction of:
- Submittals required
- Warranty requirements
- Training requirements
- Testing/inspection requirements
- Closeout deliverables
- Key products/manufacturers
- Performance criteria

Uses structured JSON output for machine-parseable results.
"""

import os
import json
from dataclasses import dataclass

import anthropic


EXTRACTION_TYPES = {
    "submittals",
    "warranties",
    "training",
    "testing",
    "closeout",
    "products",
    "performance",
}

SYSTEM_PROMPT = """You are a construction specification analyst. You read CSI MasterFormat spec sections and extract structured data.

RULES:
- Extract ONLY what is explicitly stated in the spec text. Do not infer or assume.
- If a category has no items, return an empty array.
- Keep descriptions concise (under 100 chars each).
- Never include pricing, cost, or bid information.
- Never include subcontractor names or company names.

Return valid JSON matching the requested schema."""

SECTION_PROMPT_TEMPLATE = """Analyze this construction specification section and extract the requested information.

SECTION: {section_number} — {title}

TEXT:
{raw_text}

Extract the following categories: {extract_types}

Return JSON with this exact structure:
{{
  "submittals": [
    {{"type": "PRODUCT_DATA|SHOP_DRAWING|SAMPLE|MOCKUP|WARRANTY|O_AND_M|LEED|CERT|OTHER", "description": "...", "action": "SUBMIT|REVIEW|APPROVE"}}
  ],
  "warranties": [
    {{"duration": "...", "type": "MANUFACTURER|INSTALLER|SYSTEM", "scope": "..."}}
  ],
  "training": [
    {{"system": "...", "hours": null, "qualifications": "..."}}
  ],
  "testing": [
    {{"type": "...", "party": "OWNER|CONTRACTOR|INDEPENDENT", "standard": "..."}}
  ],
  "closeout": [
    {{"deliverable": "...", "type": "O_AND_M|AS_BUILT|CERT|ATTIC_STOCK|OTHER"}}
  ],
  "products": [
    {{"manufacturer": "...", "product": "...", "basis_of_design": true|false}}
  ],
  "performance": [
    {{"criteria": "...", "standard": "...", "value": "..."}}
  ]
}}

Only include the categories that were requested. Omit unrequested categories entirely."""


@dataclass
class ExtractionResult:
    section_number: str
    title: str
    extractions: dict
    input_tokens: int
    output_tokens: int
    cost_usd: float


# Sonnet pricing per 1M tokens (as of 2025)
SONNET_INPUT_COST = 3.00 / 1_000_000
SONNET_OUTPUT_COST = 15.00 / 1_000_000


def extract_from_section(
    section: dict,
    extract_types: set[str] | None = None,
    model: str = "claude-sonnet-4-20250514",
) -> ExtractionResult:
    """
    Send a single spec section to Claude for structured extraction.

    Args:
        section: Dict with section_number, title, raw_text
        extract_types: Which categories to extract (default: all)
        model: Claude model to use

    Returns:
        ExtractionResult with parsed JSON and token usage
    """
    if extract_types is None:
        extract_types = EXTRACTION_TYPES

    # Filter to valid types only
    valid_types = extract_types & EXTRACTION_TYPES
    if not valid_types:
        valid_types = EXTRACTION_TYPES

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = SECTION_PROMPT_TEMPLATE.format(
        section_number=section["section_number"],
        title=section["title"],
        raw_text=section["raw_text"][:4000],  # Cap input to control cost
        extract_types=", ".join(sorted(valid_types)),
    )

    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    # Parse the response
    text = response.content[0].text if response.content else "{}"

    # Extract JSON from the response (may be wrapped in markdown code blocks)
    json_match = text
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        json_match = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        json_match = text[start:end].strip()

    try:
        extractions = json.loads(json_match)
    except json.JSONDecodeError:
        extractions = {"_raw": text, "_parse_error": True}

    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost = (input_tokens * SONNET_INPUT_COST) + (output_tokens * SONNET_OUTPUT_COST)

    return ExtractionResult(
        section_number=section["section_number"],
        title=section["title"],
        extractions=extractions,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=round(cost, 6),
    )


def extract_from_sections(
    sections: list[dict],
    extract_types: set[str] | None = None,
    model: str = "claude-sonnet-4-20250514",
) -> dict:
    """
    Process multiple sections sequentially and return aggregate results.

    Returns dict with:
        sections: list of per-section results
        total_input_tokens: int
        total_output_tokens: int
        total_cost_usd: float
    """
    results = []
    total_in = 0
    total_out = 0
    total_cost = 0.0

    for section in sections:
        result = extract_from_section(section, extract_types, model)
        results.append({
            "section_number": result.section_number,
            "title": result.title,
            "extractions": result.extractions,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cost_usd": result.cost_usd,
        })
        total_in += result.input_tokens
        total_out += result.output_tokens
        total_cost += result.cost_usd

    return {
        "sections": results,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_cost_usd": round(total_cost, 4),
    }
