"""
Institutional construction adapters (Phase 5S).

- ISU FP&M Bid Dates page — critical for ISU capital construction
- DMACC Bid Opportunities — multi-campus capital projects
- K-12 school district board agendas (rely on existing CivicPlus scraper)
- DART, DSM Airport, DMWW capital project pages
"""

import re
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
USER_AGENT = "NeuroGlitch-MarketBot/1.0"


class InstitutionalItem(BaseModel):
    project_id: str
    title: str
    description: str
    owner: str            # "Iowa State University" | "DMACC" | etc.
    bid_date: Optional[str]
    estimated_cost: Optional[float]
    pre_bid_meeting: Optional[str]
    source_url: str


class InstitutionalResponse(BaseModel):
    items: list[InstitutionalItem]
    source: str
    notes: str


@router.post("/market/scrape-isu-fpm", response_model=InstitutionalResponse)
async def scrape_isu_fpm():
    """ISU Facilities Planning & Management — Project Bid Dates page.

    URL: https://www.fpm.iastate.edu/construction_projects/bid_dates.asp
    """
    url = "https://www.fpm.iastate.edu/construction_projects/bid_dates.asp"
    try:
        async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            r = await client.get(url, timeout=20)
            r.raise_for_status()
            html = r.text
    except Exception as exc:
        return InstitutionalResponse(items=[], source="ISU FP&M",
                                     notes=f"fetch failed: {exc}")

    items: list[InstitutionalItem] = []
    # ISU FP&M page is tabular — project name | bid date | estimate | drawings link
    # Extract any project linked from the page
    for m in re.finditer(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL):
        row = m.group(1)
        # Look for cells with project name + amount
        title_match = re.search(r'<td[^>]*>([^<]{15,200})</td>', row)
        cost_match  = re.search(r'\$\s*([\d,]+(?:\.\d+)?)', row)
        if not title_match: continue
        title = title_match.group(1).strip()
        if len(title) < 15: continue
        cost = None
        if cost_match:
            try: cost = float(cost_match.group(1).replace(",", ""))
            except ValueError: pass
        items.append(InstitutionalItem(
            project_id=title[:40].replace(" ", "_"),
            title=title[:160],
            description=title[:400],
            owner="Iowa State University",
            bid_date=None,
            estimated_cost=cost,
            pre_bid_meeting=None,
            source_url=url,
        ))

    return InstitutionalResponse(
        items=items[:30], source="ISU FP&M",
        notes=f"parsed {len(items)} table rows from bid_dates page. Per-project detail (pre-bid meeting, drawings link, project manager) requires per-project fetch.",
    )


@router.post("/market/scrape-dmacc", response_model=InstitutionalResponse)
async def scrape_dmacc():
    """DMACC — Des Moines Area Community College bid opportunities.

    URL: https://www.dmacc.edu/business/Pages/bid-opportunities.aspx (varies)
    """
    candidates = [
        "https://www.dmacc.edu/business/Pages/bid-opportunities.aspx",
        "https://www.dmacc.edu/business/bid_opportunities.html",
        "https://www.dmacc.edu/Pages/bid-opportunities.aspx",
    ]
    for url in candidates:
        try:
            async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
                r = await client.get(url, timeout=15)
                if r.status_code != 200:
                    continue
                return InstitutionalResponse(
                    items=[], source="DMACC",
                    notes=f"reached {url} (HTTP {r.status_code}); per-project extraction not yet implemented",
                )
        except Exception:
            continue
    return InstitutionalResponse(
        items=[], source="DMACC",
        notes="none of the candidate URLs reachable; verify DMACC bid opportunities URL",
    )
