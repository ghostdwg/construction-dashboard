"""
Tyler EnerGov adapter (Phase 5J)

Targets the public Customer Self Service (CSS) REST endpoint that backs the
search UI on Tyler EnerGov municipal portals. Tested against Des Moines:
  https://css.dmgov.org/EnerGov_Prod/SelfService

The portal POSTs to /api/energov/search/public with a JSON body. Results are
structured records (no PDFs) — bypasses the document-text pipeline entirely.
$0 LLM cost for primary extraction.

POST /market/scrape-energov
  Body: {url, modules, keywords, date_from?, date_to?, max_records?}
  Returns: {records[], stats}
"""

import os
import re
from datetime import datetime, date, timedelta
from typing import Optional
from urllib.parse import urlparse, urljoin

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

USER_AGENT = "Mozilla/5.0 (compatible; NeuroGlitch-MarketBot/1.0)"
DEFAULT_PAGE_SIZE = 25
MAX_PAGES = 40   # 40 * 25 = 1000 records hard ceiling per sweep
DELAY_S = 1.0    # polite throttle between requests

# EnerGov "SearchModule" codes (stable across installations)
MODULES = {
    "Permit":     1,
    "Plan":       2,
    "Inspection": 3,
    "Request":    5,
    "License":    6,
    "Project":    9,
}

# Keywords that indicate commercial construction
DEFAULT_KEYWORDS = [
    "new construction",
    "commercial",
    "shell building",
    "tenant improvement",
    "addition",
    "mixed use",
    "warehouse",
    "office",
    "retail",
    "industrial",
    "multi family",
    "multifamily",
    "apartment",
    "hotel",
    "restaurant",
]

# Commercial keywords for Tier-0 scoring
COMMERCIAL_VALUATION_FLOOR = 250_000   # ignore permits below this $ value
TIER0_HIGH_VALUE_FLOOR    = 1_000_000  # auto-lead at this $ value


class EnergovScrapeRequest(BaseModel):
    base_url: str                              # e.g. https://css.dmgov.org/EnerGov_Prod/SelfService
    modules: list[str] = ["Plan", "Permit"]    # Plan first (pre-permit Stage 5 signals)
    keywords: list[str] = DEFAULT_KEYWORDS
    date_from: Optional[str] = None            # ISO YYYY-MM-DD
    date_to: Optional[str] = None
    max_records: int = 500
    fetch_details: bool = False                # full owner/contractor — costs +1 API call each


class EnergovRecord(BaseModel):
    permit_number: str
    record_type: str          # permit | plan | inspection | request | license | project
    module: str               # human-readable module name
    status: str
    address: Optional[str]
    description: str
    valuation: Optional[float]
    owner_name: Optional[str]
    contractor_name: Optional[str]
    applied_date: Optional[str]
    issued_date: Optional[str]
    source_keyword: str       # which keyword surfaced this record
    source_url: str           # link to the public CSS detail page if guessable
    raw_id: Optional[str]     # internal PermitId for detail fetches


class EnergovStats(BaseModel):
    queried_modules: list[str]
    queried_keywords: int
    raw_records_returned: int
    unique_records: int
    commercial_records: int   # passed Tier-0 commercial filter
    high_value_records: int   # auto-lead threshold


class EnergovScrapeResponse(BaseModel):
    records: list[EnergovRecord]
    stats: EnergovStats


def _build_payload(keyword: str, module_id: int, page: int, page_size: int = DEFAULT_PAGE_SIZE) -> dict:
    return {
        "SearchModule":  module_id,
        "SearchText":    keyword,
        "ExactPhrase":   False,
        "PageNumber":    page,
        "PageSize":      page_size,
        "SortColumn":    "EnteredDate",
        "SortAscending": False,
    }


def _normalize_record(raw: dict, module: str, keyword: str, base_url: str) -> EnergovRecord:
    """Map a CSS API record to our normalized shape. Field names vary slightly
    between EnerGov versions — we try both common forms."""
    permit_number = (
        raw.get("PermitNumber")
        or raw.get("Number")
        or raw.get("PlanNumber")
        or raw.get("CaseNumber")
        or ""
    )
    valuation_raw = raw.get("JobValue") or raw.get("Valuation") or raw.get("EstimatedCost")
    try:
        valuation = float(valuation_raw) if valuation_raw is not None else None
    except (TypeError, ValueError):
        valuation = None

    record_id = raw.get("PermitId") or raw.get("Id") or raw.get("CaseId")

    return EnergovRecord(
        permit_number=str(permit_number)[:80],
        record_type=module.lower(),
        module=module,
        status=str(raw.get("StatusDescription") or raw.get("Status") or "")[:80],
        address=raw.get("Address") or raw.get("ProjectAddress"),
        description=str(raw.get("Description") or raw.get("ProjectDescription") or "")[:500],
        valuation=valuation,
        owner_name=raw.get("OwnerName"),
        contractor_name=raw.get("ContractorName"),
        applied_date=raw.get("ApplyDate") or raw.get("AppliedDate") or raw.get("EnteredDate"),
        issued_date=raw.get("IssueDate") or raw.get("IssuedDate"),
        source_keyword=keyword,
        source_url=f"{base_url.rstrip('/')}/Permit/Detail/{record_id}" if record_id else base_url,
        raw_id=str(record_id) if record_id else None,
    )


def _tier0_score(rec: EnergovRecord) -> tuple[bool, bool]:
    """Returns (is_commercial, is_high_value).

    Tier 0 = rules only. Reject single-family residential, ag, demo,
    sign-only permits. Auto-lead if valuation crosses high-value floor."""
    blob = (rec.description + " " + rec.permit_number).lower()
    if re.search(r"\b(single family|sfr|sfd|sign|demo|fence|deck|reroof|roof repair|residential addition)\b", blob):
        return False, False
    has_commercial_marker = bool(re.search(
        r"\b(commercial|shell|tenant improvement|warehouse|office|retail|industrial|multi family|multifamily|apartment|hotel|restaurant|new construction|mixed use)\b",
        blob,
    ))
    val_ok = rec.valuation is not None and rec.valuation >= COMMERCIAL_VALUATION_FLOOR
    is_commercial = has_commercial_marker or val_ok
    is_high_value = rec.valuation is not None and rec.valuation >= TIER0_HIGH_VALUE_FLOOR
    return is_commercial, is_high_value


async def _search_paginated(
    client: httpx.AsyncClient,
    api_url: str,
    keyword: str,
    module: str,
    module_id: int,
    max_records: int,
) -> list[dict]:
    """Sweep all pages for one keyword+module combo, bounded by max_records."""
    out: list[dict] = []
    page = 1
    while len(out) < max_records and page <= MAX_PAGES:
        payload = _build_payload(keyword, module_id, page)
        try:
            r = await client.post(api_url, json=payload, timeout=20)
            r.raise_for_status()
            data = r.json()
        except Exception:
            break
        records = data.get("Data") or data.get("Result") or []
        if not records:
            break
        out.extend(records)
        total = data.get("Total") or data.get("TotalCount") or 0
        if total and len(out) >= total:
            break
        if len(records) < DEFAULT_PAGE_SIZE:
            break
        page += 1
    return out[:max_records]


@router.post("/market/scrape-energov", response_model=EnergovScrapeResponse)
async def scrape_energov(req: EnergovScrapeRequest):
    """Sweep an EnerGov CSS portal for commercial records.

    No LLM calls. No PDFs downloaded. Structured records returned as JSON
    for the Next.js app to persist as MarketSignal rows."""
    base_url = req.base_url.rstrip("/")
    api_url = f"{base_url}/api/energov/search/public"

    invalid = [m for m in req.modules if m not in MODULES]
    if invalid:
        raise HTTPException(400, f"Unknown modules: {invalid}. Valid: {list(MODULES)}")

    headers = {
        "Accept":           "application/json, text/plain, */*",
        "Content-Type":     "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":       USER_AGENT,
        "Referer":          f"{base_url}/home",
    }

    all_raw: list[tuple[dict, str, str]] = []
    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        # Seed cookies + CSRF
        try:
            await client.get(f"{base_url}/home", timeout=15)
        except Exception:
            pass

        for module in req.modules:
            module_id = MODULES[module]
            for kw in req.keywords:
                raw = await _search_paginated(
                    client, api_url, kw, module, module_id, req.max_records,
                )
                for r in raw:
                    all_raw.append((r, module, kw))
                if len(all_raw) >= req.max_records:
                    break

    # Normalize + dedupe by permit_number
    seen: set[str] = set()
    normalized: list[EnergovRecord] = []
    for raw, module, kw in all_raw:
        rec = _normalize_record(raw, module, kw, base_url)
        if not rec.permit_number or rec.permit_number in seen:
            continue
        seen.add(rec.permit_number)
        normalized.append(rec)

    # Apply date filter
    date_from = _parse_iso(req.date_from)
    date_to   = _parse_iso(req.date_to)
    if date_from or date_to:
        normalized = [r for r in normalized if _in_range(r, date_from, date_to)]

    # Tier-0 commercial filter + high-value count
    commercial = []
    high_value = []
    for r in normalized:
        is_comm, is_hi = _tier0_score(r)
        if is_comm:
            commercial.append(r)
            if is_hi:
                high_value.append(r)

    return EnergovScrapeResponse(
        records=commercial,
        stats=EnergovStats(
            queried_modules=req.modules,
            queried_keywords=len(req.keywords),
            raw_records_returned=len(all_raw),
            unique_records=len(normalized),
            commercial_records=len(commercial),
            high_value_records=len(high_value),
        ),
    )


def _parse_iso(s: Optional[str]) -> Optional[date]:
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _in_range(rec: EnergovRecord, dfrom: Optional[date], dto: Optional[date]) -> bool:
    d = _parse_iso(rec.applied_date) or _parse_iso(rec.issued_date)
    if not d:
        return True   # undated records pass through
    if dfrom and d < dfrom: return False
    if dto and d > dto: return False
    return True
