"""
Press release watcher (Phase 5Q).

Aggregates Stage 1 rumor/news from:
  - Iowa Economic Development Authority (IEDA) — opportunityiowa.gov press releases
  - Iowa Governor — governor.iowa.gov press releases
  - Greater DSM Partnership — PR Newswire mirror
  - Business Record (Des Moines) — RSS if available

Returns structured news items the app persists as MarketSignal rows with
signalType=MEETING_MINUTE (placeholder, no better type yet) and a
provenance metadata field.

No LLM calls. Pure RSS / HTML parsing.
"""

import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

USER_AGENT = "NeuroGlitch-PressBot/1.0"


class PressItem(BaseModel):
    title: str
    url: str
    published_at: Optional[str]
    summary: str
    source: str
    location_hint: Optional[str] = None
    dollar_hint: Optional[float] = None
    company_hint: Optional[str] = None


class PressFeedResponse(BaseModel):
    items: list[PressItem]
    sources_polled: list[str]
    sources_failed: list[str]


# ── Simple HTML/RSS parsers ─────────────────────────────────────────────────

class _RssStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items: list[dict] = []
        self._current: Optional[dict] = None
        self._tag: Optional[str] = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, _attrs):
        if tag == "item":
            self._current = {}
        if self._current is not None:
            self._tag = tag
            self._buf = []

    def handle_endtag(self, tag):
        if self._current is None:
            return
        text = "".join(self._buf).strip()
        if tag in ("title", "link", "description", "pubdate"):
            self._current[tag] = text
        if tag == "item":
            self.items.append(self._current)
            self._current = None
        self._tag = None
        self._buf = []

    def handle_data(self, data):
        if self._current is not None and self._tag:
            self._buf.append(data)


def _parse_rss(xml: str) -> list[dict]:
    p = _RssStripper()
    p.feed(xml.lower().replace("</item>", "</item>"))  # lowercase tag names
    return p.items


# ── Dollar / location heuristics ────────────────────────────────────────────

_DOLLAR_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|m|b)?", re.IGNORECASE)
_LOCATION_HINTS = re.compile(
    r"\b(Des Moines|West Des Moines|Ankeny|Urbandale|Waukee|Indianola|Norwalk|Altoona|Bondurant|Polk City|Johnston|Grimes|Pleasant Hill|Windsor Heights|Clive|Newton|Pella|Ames|Boone|Madrid)\b",
    re.IGNORECASE,
)
# Common Iowa company suffix patterns
_COMPANY_HINTS = re.compile(
    r"\b([A-Z][A-Za-z&\-\.\']+(?:\s+[A-Z][A-Za-z&\-\.\']+){0,3})\s+(?:Inc|LLC|Corp|Corporation|Co\.|Holdings|Group|Properties|Realty|Development|Construction|Industries)\b"
)


def _extract_dollar(text: str) -> Optional[float]:
    m = _DOLLAR_RE.search(text)
    if not m: return None
    try:
        n = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    suffix = (m.group(2) or "").lower()
    if suffix in ("million", "m"):  n *= 1_000_000
    if suffix in ("billion", "b"):  n *= 1_000_000_000
    return n


def _extract_location(text: str) -> Optional[str]:
    m = _LOCATION_HINTS.search(text)
    return m.group(1) if m else None


def _extract_company(text: str) -> Optional[str]:
    m = _COMPANY_HINTS.search(text)
    return m.group(0) if m else None


# ── Source-specific parsers ─────────────────────────────────────────────────

async def _fetch_governor(client: httpx.AsyncClient) -> list[PressItem]:
    """Iowa Governor press releases — HTML index page."""
    url = "https://governor.iowa.gov/press-releases"
    r = await client.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    html = r.text

    items: list[PressItem] = []
    # Find each press release block: title link + date
    # Pattern is fragile to template changes — extract any <a> with /press-release/ in href
    for m in re.finditer(r'<a\s+href="(/press-release/[^"]+)"[^>]*>([^<]{10,200})</a>', html, re.IGNORECASE):
        href, title = m.group(1), m.group(2).strip()
        full_url = urljoin(url, href)
        # Try to extract a YYYY-MM-DD from the href
        d = re.search(r'/(\d{4}-\d{2}-\d{2})/', href)
        published = d.group(1) if d else None
        items.append(PressItem(
            title=title,
            url=full_url,
            published_at=published,
            summary=title,
            source="Iowa Governor",
            location_hint=_extract_location(title),
            dollar_hint=_extract_dollar(title),
            company_hint=_extract_company(title),
        ))
        if len(items) >= 30:
            break
    return items


async def _fetch_ieda(client: httpx.AsyncClient) -> list[PressItem]:
    """IEDA press releases — opportunityiowa.gov news index."""
    url = "https://opportunityiowa.gov/about/news"
    r = await client.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    html = r.text

    items: list[PressItem] = []
    for m in re.finditer(r'<a\s+href="(/press-release/[^"]+)"[^>]*>([^<]{10,200})</a>', html, re.IGNORECASE):
        href, title = m.group(1), m.group(2).strip()
        full_url = urljoin(url, href)
        d = re.search(r'/(\d{4}-\d{2}-\d{2})/', href)
        published = d.group(1) if d else None
        items.append(PressItem(
            title=title,
            url=full_url,
            published_at=published,
            summary=title,
            source="IEDA",
            location_hint=_extract_location(title),
            dollar_hint=_extract_dollar(title),
            company_hint=_extract_company(title),
        ))
        if len(items) >= 30:
            break
    return items


async def _fetch_partnership_pr(client: httpx.AsyncClient) -> list[PressItem]:
    """Greater Des Moines Partnership press via PR Newswire."""
    url = "https://www.prnewswire.com/news/greater-des-moines-partnership/"
    r = await client.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    html = r.text

    items: list[PressItem] = []
    # PR Newswire uses card containers; titles are usually <a href="/news-releases/...">
    for m in re.finditer(r'<a[^>]+href="(/news-releases/[^"]+)"[^>]*>([^<]{10,200})</a>', html):
        href, title = m.group(1), m.group(2).strip()
        if "greater-des-moines" not in href.lower() and "des-moines" not in href.lower() and "iowa" not in href.lower():
            continue
        full_url = urljoin(url, href)
        items.append(PressItem(
            title=title,
            url=full_url,
            published_at=None,
            summary=title,
            source="GDMP via PR Newswire",
            location_hint=_extract_location(title),
            dollar_hint=_extract_dollar(title),
            company_hint=_extract_company(title),
        ))
        if len(items) >= 20:
            break
    return items


async def _fetch_business_record_rss(client: httpx.AsyncClient) -> list[PressItem]:
    """Business Record RSS — Des Moines daily trade source."""
    url = "https://www.businessrecord.com/feed/"
    try:
        r = await client.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
    except Exception:
        return []
    items: list[PressItem] = []
    for raw in _parse_rss(r.text):
        title = raw.get("title", "").strip()
        link  = raw.get("link", "").strip()
        if not title or not link:
            continue
        items.append(PressItem(
            title=title,
            url=link,
            published_at=raw.get("pubdate"),
            summary=(raw.get("description") or title)[:400],
            source="Business Record",
            location_hint=_extract_location(title + " " + (raw.get("description") or "")),
            dollar_hint=_extract_dollar(title + " " + (raw.get("description") or "")),
            company_hint=_extract_company(title + " " + (raw.get("description") or "")),
        ))
        if len(items) >= 30:
            break
    return items


SOURCES = {
    "governor":          _fetch_governor,
    "ieda":              _fetch_ieda,
    "partnership_pr":    _fetch_partnership_pr,
    "business_record":   _fetch_business_record_rss,
}


class PressFeedRequest(BaseModel):
    sources: list[str] = list(SOURCES.keys())


@router.post("/market/press-feed", response_model=PressFeedResponse)
async def press_feed(req: PressFeedRequest):
    invalid = [s for s in req.sources if s not in SOURCES]
    if invalid:
        raise HTTPException(400, f"Unknown sources: {invalid}. Valid: {list(SOURCES)}")

    items: list[PressItem] = []
    failed: list[str] = []
    polled: list[str] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for name in req.sources:
            try:
                got = await SOURCES[name](client)
                items.extend(got)
                polled.append(name)
            except Exception:
                failed.append(name)

    # Dedupe by URL
    seen: set[str] = set()
    unique = []
    for it in items:
        if it.url in seen:
            continue
        seen.add(it.url)
        unique.append(it)

    return PressFeedResponse(items=unique, sources_polled=polled, sources_failed=failed)
