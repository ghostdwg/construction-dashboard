"""
Market Source Discovery

POST /market/discover-sources
  Given a geographic center + radius, find municipalities and their council/
  P&Z document index pages. Returns ranked candidates for user approval.

Pipeline:
  1. Geocode center (Nominatim) if a string was provided
  2. Find cities/towns within radius (Overpass API)
  3. For each, find the official website (OSM tag → URL guess fallback)
  4. Crawl homepage for council/planning/agenda/minutes links
  5. Validate each candidate page (count recent dated PDFs)
  6. Return ranked by viability + recency
"""

import asyncio
import math
import os
import re
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.market import (
    _DOC_KEYWORDS,
    _extract_links,
    _is_document_link,
    _parse_date_for_link,
    _extract_civicclerk_tenant,
    _infer_civicclerk_tenants_from_url,
    _fetch_civicclerk_candidates,
)

# Indicators that a page lazy-loads its document list via JS (CivicPlus, etc).
_JS_LOADER_HINT = re.compile(
    r"AgendaCenter|civicplus|civicengage|civicclerk|granicus|primegov|legistar",
    re.IGNORECASE,
)


async def _fetch_html_rendered(url: str) -> Optional[str]:
    """Fetch a page with a headless browser, return rendered HTML (post-JS).

    Used when the static HTML doesn't include a JS-loaded document list."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None

    browser = None
    context = None
    page = None
    try:
        async with async_playwright() as playwright:
            browserless_url = os.getenv("BROWSERLESS_URL")
            if browserless_url:
                browser = await playwright.chromium.connect(browserless_url)
            else:
                browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()
            await page.goto(url, wait_until="networkidle", timeout=25000)
            return await page.content()
    except Exception:
        return None
    finally:
        if page:
            try: await page.close()
            except: pass
        if context:
            try: await context.close()
            except: pass
        if browser:
            try: await browser.close()
            except: pass

router = APIRouter()

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OVERPASS_URL  = "https://overpass-api.de/api/interpreter"
USER_AGENT    = "NeuroGlitch-MarketDiscovery/1.0 ops@neuroglitch.dev"

DEFAULT_CONCURRENCY = 6
HOMEPAGE_TIMEOUT_S  = 15
CANDIDATE_TIMEOUT_S = 15

# Path/text patterns suggesting a council/planning page
_PAGE_KEYWORDS = re.compile(
    r"agenda|minute|council|planning|zoning|commission|board|meeting",
    re.IGNORECASE,
)
# Patterns we DON'T want (image galleries, news articles, etc.)
_PAGE_NEGATIVE = re.compile(
    r"news|press|gallery|photo|video|event(?!.*minute)|calendar",
    re.IGNORECASE,
)


# ── Geocoding ────────────────────────────────────────────────────────────────

class Center(BaseModel):
    lat: float
    lon: float
    label: Optional[str] = None


async def _geocode(query: str, client: httpx.AsyncClient) -> Optional[Center]:
    r = await client.get(
        f"{NOMINATIM_URL}/search",
        params={"q": query, "format": "json", "limit": 1, "addressdetails": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        return None
    hit = data[0]
    return Center(lat=float(hit["lat"]), lon=float(hit["lon"]), label=hit.get("display_name"))


# ── Overpass: cities/towns within radius ─────────────────────────────────────

def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))


class Municipality(BaseModel):
    name: str
    state: Optional[str] = None
    lat: float
    lon: float
    distance_miles: float
    osm_website: Optional[str] = None
    place_type: str           # city|town|village


async def _overpass_cities(center: Center, radius_miles: float, client: httpx.AsyncClient) -> list[Municipality]:
    radius_m = int(radius_miles * 1609.34)
    # Incorporated places only: city + town. Skip village/hamlet which in the
    # US are usually CDPs without their own government.
    query = f"""[out:json][timeout:30];
(
  node["place"~"^(city|town)$"](around:{radius_m},{center.lat},{center.lon});
  way["place"~"^(city|town)$"](around:{radius_m},{center.lat},{center.lon});
  relation["boundary"="administrative"]["admin_level"~"^(6|7|8)$"](around:{radius_m},{center.lat},{center.lon});
);
out tags center;"""
    r = await client.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    seen_names: set[str] = set()
    out: list[Municipality] = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name or name in seen_names:
            continue
        if el.get("type") == "way":
            lat = el.get("center", {}).get("lat")
            lon = el.get("center", {}).get("lon")
        else:
            lat = el.get("lat")
            lon = el.get("lon")
        if lat is None or lon is None:
            continue
        d = _haversine_miles(center.lat, center.lon, lat, lon)
        if d > radius_miles:
            continue
        seen_names.add(name)
        out.append(Municipality(
            name=name,
            state=tags.get("addr:state") or tags.get("is_in:state") or None,
            lat=lat, lon=lon,
            distance_miles=round(d, 1),
            osm_website=tags.get("website") or tags.get("contact:website"),
            place_type=tags.get("place", "city"),
        ))
    out.sort(key=lambda m: m.distance_miles)
    return out


# ── Website resolution ───────────────────────────────────────────────────────

async def _check_url_alive(url: str, client: httpx.AsyncClient) -> bool:
    try:
        r = await client.head(url, timeout=10, follow_redirects=True,
                              headers={"User-Agent": USER_AGENT})
        if r.status_code == 405:   # HEAD not allowed — fall back to GET
            r = await client.get(url, timeout=10, follow_redirects=True,
                                 headers={"User-Agent": USER_AGENT})
        return 200 <= r.status_code < 400
    except Exception:
        return False


async def _resolve_website(muni: Municipality, state_hint: Optional[str], client: httpx.AsyncClient) -> Optional[str]:
    if muni.osm_website:
        if await _check_url_alive(muni.osm_website, client):
            return muni.osm_website

    slug = muni.name.lower().replace(" ", "").replace("'", "").replace(".", "")
    state = (muni.state or state_hint or "").lower().strip(", .")
    if state in ("iowa", "ia"):
        state_short = "iowa"
    elif state:
        state_short = state
    else:
        state_short = "iowa"  # default for this deployment

    candidates = [
        f"https://www.{slug}.{state_short}.gov",
        f"https://{slug}.{state_short}.gov",
        f"https://www.cityof{slug}.com",
        f"https://www.cityof{slug}.org",
        f"https://www.{slug}{state_short}.gov",
        f"https://www.{slug}{state_short[:2]}.gov",
        f"https://www.{slug}.org",
        f"https://{slug}.org",
        f"https://www.{slug}{state_short}.org",
        f"https://www.{slug}.com",
    ]
    # Wikipedia fallback — fetch the article, find the official website link
    candidates.append(None)  # sentinel; handled below
    for c in candidates:
        if c is None:
            # Wikipedia fallback
            wiki = await _wikipedia_official_site(muni.name, state, client)
            if wiki and await _check_url_alive(wiki, client):
                return wiki
            continue
        if await _check_url_alive(c, client):
            return c
    return None


_WIKI_OFFICIAL_RE = re.compile(
    r'<th[^>]*>\s*Website\s*</th>\s*<td[^>]*>\s*<span[^>]*>\s*<a[^>]+href="([^"]+)"',
    re.IGNORECASE,
)


async def _wikipedia_official_site(muni_name: str, state_hint: str, client: httpx.AsyncClient) -> Optional[str]:
    """Look up the city's Wikipedia article and parse the infobox Website row."""
    if state_hint in ("iowa", "ia"):
        state_word = "Iowa"
    elif state_hint:
        state_word = state_hint.title()
    else:
        state_word = "Iowa"
    title = muni_name.replace(" ", "_") + "," + "_" + state_word
    try:
        r = await client.get(
            f"https://en.wikipedia.org/wiki/{title}",
            headers={"User-Agent": USER_AGENT},
            timeout=10,
            follow_redirects=True,
        )
        if r.status_code != 200:
            return None
        m = _WIKI_OFFICIAL_RE.search(r.text)
        if m:
            url = m.group(1)
            if url.startswith("//"):
                url = "https:" + url
            return url
    except Exception:
        pass
    return None


# ── Homepage crawl: find council/planning pages ─────────────────────────────

class CandidatePage(BaseModel):
    url: str
    link_text: Optional[str]
    inferred_type: str   # city_council|planning_commission|generic
    viable: bool = False
    recent_doc_count: int = 0
    last_doc_date: Optional[str] = None
    preview_titles: list[str] = []
    error: Optional[str] = None


def _infer_source_type(url: str, text: str) -> str:
    blob = (url + " " + (text or "")).lower()
    if re.search(r"plan|zone|commission|board", blob):
        return "planning_commission"
    if re.search(r"council|agenda|minute", blob):
        return "city_council"
    return "generic"


_WELL_KNOWN_DOC_PATHS = (
    "/AgendaCenter",                              # CivicPlus
    "/government/agendas-minutes",                 # generic municipal CMS
    "/agendas-minutes",
    "/agendas",
    "/minutes",
    "/meetings",
    "/city-council/agendas-and-minutes",
    "/planning-zoning/agendas-and-minutes",
    "/community-development/agendas-minutes",
    "/CityCouncil/Agendas",
    "/PlanningZoning/Agendas",
)


async def _probe_well_known_paths(homepage: str, client: httpx.AsyncClient) -> list[tuple[str, str]]:
    """Some municipal homepages don't link to /AgendaCenter directly even
    though the page exists. Probe a list of known doc-index paths and return
    any that resolve to HTTP 200 with a doc-keyword in the response."""
    from urllib.parse import urlparse
    parsed = urlparse(homepage)
    base = f"{parsed.scheme}://{parsed.netloc}"
    found: list[tuple[str, str]] = []
    for path in _WELL_KNOWN_DOC_PATHS:
        url = base + path
        try:
            r = await client.head(url, timeout=8, follow_redirects=True,
                                  headers={"User-Agent": USER_AGENT})
            if r.status_code == 405:   # server rejects HEAD — try GET
                r = await client.get(url, timeout=10, follow_redirects=True,
                                     headers={"User-Agent": USER_AGENT})
            if r.status_code < 400:
                # Heuristic name for inferred_type
                name_hint = path.lstrip("/").lower()
                found.append((str(r.url), name_hint))
        except Exception:
            continue
    return found


async def _find_candidate_pages(homepage: str, client: httpx.AsyncClient) -> list[CandidatePage]:
    try:
        r = await client.get(homepage, timeout=HOMEPAGE_TIMEOUT_S, follow_redirects=True,
                             headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
    except Exception as exc:
        return []

    links = _extract_links(r.text, homepage)
    cands: list[CandidatePage] = []
    seen: set[str] = set()
    for url, text in links:
        blob = url + " " + (text or "")
        if not _PAGE_KEYWORDS.search(blob):
            continue
        if _PAGE_NEGATIVE.search(blob) and not re.search(r"minute|agenda", blob, re.IGNORECASE):
            continue
        # Drop fragments, mailtos, etc.
        if not url.startswith("http"):
            continue
        # Drop PDFs themselves — we want index pages
        if url.lower().endswith(".pdf"):
            continue
        norm = url.split("#")[0]
        if norm in seen:
            continue
        seen.add(norm)
        cands.append(CandidatePage(
            url=norm,
            link_text=text or None,
            inferred_type=_infer_source_type(url, text or ""),
        ))
        if len(cands) >= 8:
            break

    # Append well-known-path probes the homepage didn't surface
    seen_norm = {c.url.split("#")[0] for c in cands}
    for probed_url, name_hint in await _probe_well_known_paths(homepage, client):
        norm = probed_url.split("#")[0]
        if norm in seen_norm:
            continue
        seen_norm.add(norm)
        cands.append(CandidatePage(
            url=norm,
            link_text=name_hint,
            inferred_type=_infer_source_type(probed_url, name_hint),
        ))
        if len(cands) >= 12:
            break
    return cands


# ── Viability validation ─────────────────────────────────────────────────────

async def _drill_for_docs(cand: CandidatePage, client: httpx.AsyncClient) -> CandidatePage:
    """If a candidate index page has no dated PDFs, look one level deeper.

    Many municipal sites have boards/commissions landing → sub-page per body →
    PDFs. This walks one hop forward when the first level returns empty."""
    try:
        r = await client.get(cand.url, timeout=CANDIDATE_TIMEOUT_S, follow_redirects=True,
                             headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
    except Exception:
        return cand

    same_host = urlparse(cand.url).netloc
    links = _extract_links(r.text, cand.url)
    sub_targets: list[tuple[str, str]] = []
    seen: set[str] = set()
    for url, text in links:
        if not url.startswith("http"): continue
        if url.lower().endswith(".pdf"): continue
        if urlparse(url).netloc != same_host: continue
        norm = url.split("#")[0]
        if norm == cand.url or norm in seen: continue
        blob = url + " " + (text or "")
        if not _PAGE_KEYWORDS.search(blob): continue
        if _PAGE_NEGATIVE.search(blob) and not re.search(r"minute|agenda|packet", blob, re.IGNORECASE): continue
        seen.add(norm)
        sub_targets.append((norm, text or ""))
        if len(sub_targets) >= 4:
            break

    if not sub_targets:
        return cand

    sub_cands = [CandidatePage(url=u, link_text=t or None,
                               inferred_type=_infer_source_type(u, t)) for (u, t) in sub_targets]
    drilled = await asyncio.gather(*[_validate_candidate(c, client) for c in sub_cands])
    # Keep the best drilled result if it beats the original
    best = max(drilled, key=lambda c: c.recent_doc_count, default=cand)
    if best.recent_doc_count > cand.recent_doc_count:
        return best
    return cand


async def _validate_candidate(cand: CandidatePage, client: httpx.AsyncClient) -> CandidatePage:
    try:
        r = await client.get(cand.url, timeout=CANDIDATE_TIMEOUT_S, follow_redirects=True,
                             headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
    except Exception as exc:
        cand.error = f"{type(exc).__name__}: {str(exc)[:120]}"
        return cand

    html = r.text
    links = _extract_links(html, cand.url)
    doc_links = [(u, t) for (u, t) in links if _is_document_link(u, t)]

    # If static HTML has no doc links but looks JS-driven, retry with browser
    if not doc_links and (_JS_LOADER_HINT.search(html) or len(html) > 50_000):
        rendered = await _fetch_html_rendered(cand.url)
        if rendered:
            links = _extract_links(rendered, cand.url)
            doc_links = [(u, t) for (u, t) in links if _is_document_link(u, t)]
            html = rendered

    # CivicClerk fallback: when the page is JS-driven and points to a CivicClerk
    # portal, the events API on `{tenant}.api.civicclerk.com/v1/Events` gives us
    # the published-files list directly. Try detected tenant first, then host
    # heuristic — same logic /market/scan-document uses.
    if not doc_links:
        tenants: list[str] = []
        detected = _extract_civicclerk_tenant(cand.url, html or "")
        if detected:
            tenants.append(detected)
        tenants.extend(t for t in _infer_civicclerk_tenants_from_url(cand.url) if t not in tenants)
        for tenant in tenants:
            try:
                cc_candidates = await _fetch_civicclerk_candidates(
                    tenant, date_from=None, date_to=None, max_docs=20,
                )
                if cc_candidates:
                    doc_links = cc_candidates
                    break
            except Exception:
                continue

    if not doc_links:
        return cand

    # Date-parse each doc, count recents
    from datetime import date, timedelta
    cutoff = date.today() - timedelta(days=365)
    dates: list[date] = []
    titles: list[str] = []
    undated_doc_count = 0
    for url, text in doc_links:
        d = _parse_date_for_link(url, text or "")
        if d and d >= cutoff:
            dates.append(d)
            if len(titles) < 5:
                titles.append((text or url.split("/")[-1])[:80])
        elif not d:
            undated_doc_count += 1
            if len(titles) < 5:
                titles.append((text or url.split("/")[-1])[:80])

    cand.recent_doc_count = len(dates)
    if dates:
        cand.last_doc_date = max(dates).isoformat()
    cand.preview_titles = titles
    # Viable if either:
    #   (a) we found ≥3 dated docs in the last year, OR
    #   (b) the page clearly is an active doc list (≥10 keyword-matched PDFs)
    #       even when dates can't be parsed from URLs/titles. The user can still
    #       add it; per-scrape config controls date filtering.
    cand.viable = len(dates) >= 3 or undated_doc_count >= 10
    return cand


# ── Top-level discovery ──────────────────────────────────────────────────────

def _dedupe_civicclerk_candidates(cands: list[CandidatePage]) -> list[CandidatePage]:
    """Collapse multiple candidates that all resolve to the same CivicClerk
    tenant (identical preview_titles + recent_doc_count). Keep the one with
    the most relevant inferred_type, prefer city_council > planning_commission > other."""
    if not cands:
        return cands
    by_sig: dict[tuple, list[CandidatePage]] = {}
    others: list[CandidatePage] = []
    for c in cands:
        # CivicClerk-backed candidates all share the same preview_titles list
        # because they pull from the same /Events feed.
        if c.viable and c.preview_titles and c.recent_doc_count >= 5:
            sig = (c.recent_doc_count, tuple(c.preview_titles[:3]))
            by_sig.setdefault(sig, []).append(c)
        else:
            others.append(c)
    type_priority = {"city_council": 0, "planning_commission": 1, "generic": 2}
    kept: list[CandidatePage] = []
    for sig, group in by_sig.items():
        if len(group) == 1:
            kept.extend(group)
            continue
        group.sort(key=lambda c: type_priority.get(c.inferred_type, 9))
        winner = group[0]
        # Mark dedupe so UI can show "(merged from N pages)"
        if winner.link_text and len(group) > 1:
            winner.link_text = f"{winner.link_text} (+{len(group)-1} aliases)"
        kept.append(winner)
    return kept + others


class DiscoverRequest(BaseModel):
    center: Optional[str] = None          # text query, e.g. "Des Moines, IA"
    lat: Optional[float] = None
    lon: Optional[float] = None
    radius_miles: float = 20
    state_filter: Optional[str] = None    # e.g. "IA" — used as fallback for URL guess
    max_municipalities: int = 30
    concurrency: int = DEFAULT_CONCURRENCY


class MunicipalityResult(BaseModel):
    name: str
    state: Optional[str]
    distance_miles: float
    website: Optional[str]
    candidates: list[CandidatePage]
    error: Optional[str] = None


class DiscoverResponse(BaseModel):
    center: Center
    radius_miles: float
    municipalities_found: int
    municipalities_with_candidates: int
    municipalities: list[MunicipalityResult]


async def _process_municipality(
    muni: Municipality,
    state_filter: Optional[str],
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
) -> MunicipalityResult:
    async with sem:
        try:
            website = await _resolve_website(muni, state_filter, client)
            if not website:
                return MunicipalityResult(
                    name=muni.name, state=muni.state, distance_miles=muni.distance_miles,
                    website=None, candidates=[], error="no website found",
                )
            cands = await _find_candidate_pages(website, client)
            # Validate up to 5 in parallel — let the outer semaphore bound total IO
            validated = await asyncio.gather(*[_validate_candidate(c, client) for c in cands[:5]])
            # Drill one level deeper for any that came back empty
            drilled: list[CandidatePage] = []
            for c in validated:
                if c.recent_doc_count == 0 and not c.error:
                    c = await _drill_for_docs(c, client)
                drilled.append(c)
            validated = drilled
            # Rank: viable first, then most recent
            validated.sort(key=lambda c: (
                0 if c.viable else 1,
                -(c.recent_doc_count or 0),
                c.last_doc_date or "",
            ))
            return MunicipalityResult(
                name=muni.name, state=muni.state, distance_miles=muni.distance_miles,
                website=website, candidates=_dedupe_civicclerk_candidates(validated),
            )
        except Exception as exc:
            return MunicipalityResult(
                name=muni.name, state=muni.state, distance_miles=muni.distance_miles,
                website=None, candidates=[], error=f"{type(exc).__name__}: {str(exc)[:120]}",
            )


@router.post("/market/discover-sources", response_model=DiscoverResponse)
async def discover_sources(req: DiscoverRequest):
    async with httpx.AsyncClient(http2=False) as client:
        # 1. Resolve center
        if req.lat is not None and req.lon is not None:
            center = Center(lat=req.lat, lon=req.lon, label=None)
        elif req.center:
            geo = await _geocode(req.center, client)
            if not geo:
                raise HTTPException(422, f"Could not geocode: {req.center}")
            center = geo
        else:
            raise HTTPException(400, "Provide center (string) or lat+lon")

        # 2. Overpass: cities/towns within radius
        try:
            munis = await _overpass_cities(center, req.radius_miles, client)
        except Exception as exc:
            raise HTTPException(502, f"Overpass query failed: {exc}")

        munis = munis[: req.max_municipalities]

        # 3+4+5. For each municipality: resolve website → find candidates → validate
        sem = asyncio.Semaphore(req.concurrency)
        results = await asyncio.gather(*[
            _process_municipality(m, req.state_filter, client, sem) for m in munis
        ])

    with_candidates = sum(1 for r in results if any(c.viable for c in r.candidates))

    return DiscoverResponse(
        center=center,
        radius_miles=req.radius_miles,
        municipalities_found=len(munis),
        municipalities_with_candidates=with_candidates,
        municipalities=results,
    )
