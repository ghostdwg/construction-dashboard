"""
Iowa state procurement adapters (Phase 5P).

Endpoints:
- POST /market/scrape-iowa-dot — pulls current Iowa DOT lettings
- POST /market/scrape-iowa-das — pulls Iowa DAS Bidopportunities

Iowa DOT lettings are published as ZIP files + HTML schedule pages. Lettings
happen 3rd Tuesday of each month. Stage 5-6 civil/horizontal.

Iowa DAS Bidopportunities is a public HTML listing of state agency bids
(DAS facilities, DNR, DOC, etc.). Filter by agency in the UI.

Today's implementation: probes both portals, parses the HTML index pages,
returns structured items. No LLM cost — direct extraction.
"""

import re
from datetime import datetime
from html.parser import HTMLParser
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
USER_AGENT = "NeuroGlitch-MarketBot/1.0"


class IowaProjectItem(BaseModel):
    project_id: str           # county-project or letting #
    title: str
    description: str
    agency: str               # "Iowa DOT" | "Iowa DAS" | agency name
    project_type: Optional[str]
    let_date: Optional[str]
    response_due: Optional[str]
    location: Optional[str]
    estimated_cost: Optional[float]
    source_url: str


class IowaProjectResponse(BaseModel):
    items: list[IowaProjectItem]
    source: str
    notes: str


@router.post("/market/scrape-iowa-dot", response_model=IowaProjectResponse)
async def scrape_iowa_dot():
    """Pull current month's Iowa DOT lettings.

    Index page: https://iowadot.gov/consultants-contractors/contracts/current-lettings
    Each letting has a project number + county + brief description.
    """
    url = "https://iowadot.gov/consultants-contractors/contracts/current-lettings"
    try:
        async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            r = await client.get(url, timeout=20)
            r.raise_for_status()
            html = r.text
    except Exception as exc:
        return IowaProjectResponse(items=[], source="Iowa DOT",
                                   notes=f"fetch failed: {exc}")

    items: list[IowaProjectItem] = []
    # Pattern: Iowa DOT lettings are tabular. Each row has a project number
    # like "IM-080-1(123)456--13-77" + county + work type + estimate
    # The current-lettings page is dynamic; provide a stub that confirms
    # reachability + parses what it can.
    for m in re.finditer(r'<a\s+href="([^"]+\.zip)"[^>]*>([^<]+)</a>', html):
        href, label = m.group(1), m.group(2).strip()
        items.append(IowaProjectItem(
            project_id=href.rsplit("/", 1)[-1].replace(".zip", "")[:80],
            title=label[:160],
            description=label[:400],
            agency="Iowa DOT",
            project_type="civil/horizontal",
            let_date=None,
            response_due=None,
            location=None,
            estimated_cost=None,
            source_url=href if href.startswith("http") else f"https://iowadot.gov{href}",
        ))

    return IowaProjectResponse(
        items=items[:50], source="Iowa DOT",
        notes=f"parsed {len(items)} ZIP-link rows from current-lettings page. Per-letting detail extraction (county, work type, estimate) requires per-letting fetch — iterative work.",
    )


@router.post("/market/scrape-iowa-das", response_model=IowaProjectResponse)
async def scrape_iowa_das():
    """Pull Iowa DAS state agency bidding opportunities.

    Index page: https://bidopportunities.iowa.gov/
    """
    url = "https://bidopportunities.iowa.gov/"
    try:
        async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            r = await client.get(url, timeout=20)
            r.raise_for_status()
            html = r.text
    except Exception as exc:
        return IowaProjectResponse(items=[], source="Iowa DAS",
                                   notes=f"fetch failed: {exc}")

    items: list[IowaProjectItem] = []
    # Iowa DAS uses a structured listing with bidId GUIDs
    for m in re.finditer(r'Home/BidInfo\?bidId=([0-9a-fA-F\-]+)[^>]*>([^<]{10,200})</a>', html):
        bid_id, label = m.group(1), m.group(2).strip()
        items.append(IowaProjectItem(
            project_id=bid_id,
            title=label[:160],
            description=label[:400],
            agency="Iowa DAS",
            project_type=None,
            let_date=None,
            response_due=None,
            location=None,
            estimated_cost=None,
            source_url=f"https://bidopportunities.iowa.gov/Home/BidInfo?bidId={bid_id}",
        ))

    return IowaProjectResponse(
        items=items[:50], source="Iowa DAS",
        notes=f"parsed {len(items)} bidId links. Per-bid detail extraction requires per-bid fetch — iterative work.",
    )
