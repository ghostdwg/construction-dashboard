"""
Portal adapters (Phase 5R + Phase 5O-2 stub) — OpenGov, Citizenserve, MyGov,
Iowa MNLR.

Each portal has its own search/listing format; this file provides a unified
fingerprint + skeleton extraction. Per-portal record parsing is per-installation
tuning work.

Endpoints:
- POST /market/scrape-portal — generic, takes platform + base_url
"""

import re
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
USER_AGENT = "NeuroGlitch-MarketBot/1.0"


class PortalRequest(BaseModel):
    platform: str             # "opengov" | "citizenserve" | "mygov" | "mnlr"
    base_url: str
    jurisdiction: str
    installation_id: Optional[str] = None    # Citizenserve uses this
    since: Optional[str] = None
    max_records: int = 100


class PortalRecord(BaseModel):
    permit_number: str
    description: str
    status: Optional[str]
    address: Optional[str]
    applied_date: Optional[str]
    issued_date: Optional[str]
    contractor_name: Optional[str]
    owner_name: Optional[str]
    valuation: Optional[float]
    source_url: str


class PortalResponse(BaseModel):
    items: list[PortalRecord]
    platform: str
    notes: str


KNOWN_PLATFORMS = {"opengov", "citizenserve", "mygov", "mnlr"}


@router.post("/market/scrape-portal", response_model=PortalResponse)
async def scrape_portal(req: PortalRequest):
    """Skeleton portal adapter — fingerprints + extraction stub.

    Each platform has its own search/result HTML shape. Per-portal record
    extraction is iterative tuning work as installations vary. This endpoint
    confirms reachability and returns a structural response."""
    if req.platform not in KNOWN_PLATFORMS:
        return PortalResponse(items=[], platform=req.platform,
                              notes=f"unknown platform: {req.platform}. Known: {KNOWN_PLATFORMS}")

    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        try:
            r = await client.get(req.base_url, timeout=15)
            reachable = r.status_code < 500
            note = f"HTTP {r.status_code}"
        except Exception as exc:
            reachable = False
            note = f"unreachable: {exc}"

    if not reachable:
        return PortalResponse(items=[], platform=req.platform,
                              notes=f"{req.platform}: {note}. May require Playwright fallback for JS-rendered pages, or DNS verification (some portals have moved hosts).")

    # Per-platform extraction goes here as installations get fingerprinted.
    return PortalResponse(items=[], platform=req.platform,
                          notes=f"{req.platform}: {note}. Record extraction not yet implemented for this platform/installation. See docs/architecture/INDEX_BY_PLATFORM.md.")
