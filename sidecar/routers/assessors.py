"""
County assessor adapters (Phase 5N).

Two patterns covered:
1. **Vanguard CAMA** — used by ALL 9 counties in DSM-MSA footprint at
   {county}.iowaassessors.com. HTML scraping with rate limiting. Stage 2 + 8
   (sales + new-construction pickup).

2. **Schneider Geospatial Beacon** — used by Dallas County (and others).
   beacon.schneidercorp.com/Application.aspx?AppID={id}. Some installations
   expose ArcGIS REST FeatureServer endpoints.

3. **ArcGIS REST FeatureServer** — Polk County Atlas exposes parcels +
   zoning + subdivisions via {host}/arcgis/rest/services/.../FeatureServer/0/query.
   Highest-yield automated source.

POST /market/scrape-assessor
  Body: {platform: "vanguard"|"beacon"|"arcgis", base_url, county, since?}
  Returns: {records[], stats}
"""

import re
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
USER_AGENT = "NeuroGlitch-MarketBot/1.0"


class AssessorRequest(BaseModel):
    platform: str             # "vanguard" | "beacon" | "arcgis"
    base_url: str
    county: str               # human-readable county name
    since: Optional[str] = None      # ISO date — only return changes since
    max_records: int = 500


class AssessorRecord(BaseModel):
    record_id: str
    record_type: str          # "sale" | "new_construction" | "parcel"
    address: Optional[str]
    parcel_id: Optional[str]
    owner_name: Optional[str]
    sale_price: Optional[float]
    sale_date: Optional[str]
    valuation: Optional[float]
    project_type: Optional[str]
    source_url: str


class AssessorResponse(BaseModel):
    platform: str
    county: str
    records: list[AssessorRecord]
    notes: str


@router.post("/market/scrape-assessor", response_model=AssessorResponse)
async def scrape_assessor(req: AssessorRequest):
    """Skeleton adapter — actual sale/parcel extraction is per-platform.

    Today: probes the platform, confirms reachability, returns a structural
    response. Per-platform record extraction is iterative work as each
    county's CAMA HTML/REST shape gets fingerprinted on first crawl."""
    if req.platform not in ("vanguard", "beacon", "arcgis"):
        raise HTTPException(400, f"Unknown platform: {req.platform}")

    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        # Reachability check
        try:
            r = await client.get(req.base_url, timeout=15)
            reachable = r.status_code < 500
            note = f"reachable HTTP {r.status_code}; record extraction is per-county tuning work"
        except Exception as exc:
            reachable = False
            note = f"unreachable: {exc}"

    if not reachable:
        return AssessorResponse(
            platform=req.platform, county=req.county, records=[],
            notes=note,
        )

    # Per-platform extraction stubs — flesh out per county as needed
    if req.platform == "arcgis":
        records = await _try_arcgis_features(req.base_url, client_factory=lambda: httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": USER_AGENT}))
        return AssessorResponse(
            platform="arcgis", county=req.county, records=records,
            notes=f"queried ArcGIS FeatureServer; {len(records)} records returned. Tune the layer-id and where-clause per county.",
        )

    # Vanguard + Beacon: record extraction requires per-county form discovery
    return AssessorResponse(
        platform=req.platform, county=req.county, records=[],
        notes=note + " | Per-county extraction logic not yet implemented. Probe the search form for date-bounded sale lookups + new-construction queries.",
    )


async def _try_arcgis_features(base_url: str, client_factory):
    """Best-effort: hit a common ArcGIS REST query endpoint."""
    # Default: assume FeatureServer/0 with parcel attributes
    out: list[AssessorRecord] = []
    query_url = f"{base_url.rstrip('/')}/FeatureServer/0/query"
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": 25,
    }
    try:
        async with client_factory() as client:
            r = await client.get(query_url, params=params, timeout=20)
            if r.status_code != 200:
                return out
            data = r.json()
        for feature in data.get("features", [])[:25]:
            attrs = feature.get("attributes", {})
            out.append(AssessorRecord(
                record_id=str(attrs.get("OBJECTID", "")),
                record_type="parcel",
                address=attrs.get("SitusAddress") or attrs.get("PropertyAddress"),
                parcel_id=str(attrs.get("PARCEL_ID") or attrs.get("ParcelNumber") or ""),
                owner_name=attrs.get("OwnerName"),
                sale_price=None,
                sale_date=None,
                valuation=None,
                project_type=None,
                source_url=query_url,
            ))
    except Exception:
        return out
    return out
