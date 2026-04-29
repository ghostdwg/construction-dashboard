"""
Market Intelligence Scanner

POST /market/scan-document
  Accepts a city council meeting minutes URL or raw text.
  Claude extracts construction leads, contract awards, and GC/sub relationships.
  Returns structured signals + relationship edges ready for DB insertion.

POST /market/scan-url  (alias — same endpoint, URL-first convenience form)
"""

import json
import os
import re
from html.parser import HTMLParser
from typing import Optional

import httpx
import pymupdf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from playwright.async_api import async_playwright
from pydantic import BaseModel

router = APIRouter()
anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

MODEL = "claude-sonnet-4-5-20251001"
MAX_TEXT_CHARS = 60_000  # ~15k tokens — enough for a full council session


# ── Text extraction helpers ──────────────────────────────────────────────────

class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str):
        stripped = data.strip()
        if stripped:
            self._parts.append(stripped)

    def get_text(self) -> str:
        return "\n".join(self._parts)


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html)
    return s.get_text()


async def _fetch_url_browser(url: str) -> str:
    browser = None
    context = None
    page = None

    async with async_playwright() as playwright:
        try:
            browserless_url = os.getenv("BROWSERLESS_URL")
            if browserless_url:
                browser = await playwright.chromium.connect(browserless_url)
            else:
                browser = await playwright.chromium.launch(headless=True)

            context = await browser.new_context()
            page = await context.new_page()
            await page.goto(url, wait_until="networkidle", timeout=30000)
            return _strip_html(await page.content())
        finally:
            if page is not None:
                await page.close()
            if context is not None:
                await context.close()
            if browser is not None:
                await browser.close()


async def _fetch_url(url: str) -> str:
    """Fetch URL content, return plain text. Handles HTML and PDF."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MarketBot/1.0)"})
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        if "pdf" in ct or url.lower().endswith(".pdf"):
            doc = pymupdf.open(stream=r.content, filetype="pdf")
            pages = [page.get_text() for page in doc]
            return "\n".join(pages)
        raw = _strip_html(r.text)
        if "html" in ct.lower() and len(raw.strip()) < 800:
            return await _fetch_url_browser(url)
        return raw


# ── Claude analysis ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a construction market intelligence analyst for a commercial general contractor.
Your job is to extract competitive intelligence from public documents — city council meeting minutes,
planning commission agendas, permit records, contract award notices, and similar sources.

Extract only items relevant to a commercial GC looking for upcoming work or competitive intelligence.
Ignore routine municipal business, HR items, utility approvals under $100K, and residential single-family permits.

Focus on:
- Commercial, multifamily, institutional, or infrastructure projects being approved/awarded
- Contract awards that name a GC (who is winning work in this market)
- Zoning/entitlement approvals that signal a project entering the pipeline
- Bond measures or funding approvals that will generate future bids
- Any mention of specific GCs, subs, architects, or developers and how they're connected

Return valid JSON only — no prose, no markdown."""

EXTRACT_PROMPT = """Analyze the following document and return a JSON object with this exact structure:

{
  "jurisdiction": "<city or county name, or null if unclear>",
  "document_date": "<ISO date YYYY-MM-DD of the meeting/document, or null>",
  "signals": [
    {
      "signal_type": "MEETING_MINUTE",
      "headline": "<50-char max title for this project/item>",
      "description": "<2-3 sentence summary of what was approved/discussed>",
      "location": "<address or area if mentioned>",
      "estimated_value": <dollar amount as number, or null>,
      "project_type": "<residential_multi|residential_single|commercial|office|industrial|institutional|infrastructure|municipal|mixed_use|other>",
      "owner_name": "<owner or developer name, or null>",
      "architect_name": "<architect/design firm if mentioned, or null>",
      "gc_names": ["<list of GC names explicitly mentioned>"],
      "sub_names": ["<list of subcontractor names explicitly mentioned>"],
      "relevance_score": <0-100, how valuable is this for a commercial GC pursuing work>,
      "status": "<approved|pending|awarded|discussed|rejected|under_construction>"
    }
  ],
  "relationships": [
    {
      "from_type": "<GC|ARCHITECT|OWNER|DEVELOPER|ENGINEER|SUB>",
      "from_name": "<company name>",
      "to_type": "<GC|ARCHITECT|OWNER|DEVELOPER|ENGINEER|SUB>",
      "to_name": "<company name>",
      "relationship_type": "<BUILT|DESIGNED|PARTNERED|OWNED|COMPETING>",
      "project_name": "<project where this relationship was observed, or null>",
      "project_value": <dollar amount or null>,
      "confidence": "<LOW|MEDIUM|HIGH>"
    }
  ]
}

Rules:
- relevance_score: 80-100 = clear upcoming bid opportunity, 60-79 = useful intelligence,
  40-59 = worth monitoring, below 40 = marginal
- Only include signals with relevance_score >= 30
- Only extract relationships you can support from the text — don't infer
- gc_names and sub_names: only include names explicitly stated, not guessed
- If the document has no relevant construction content, return {"jurisdiction": null, "document_date": null, "signals": [], "relationships": []}

DOCUMENT:
"""


class ScanRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None
    jurisdiction: Optional[str] = None   # hint, overrides AI-detected
    source_date: Optional[str] = None    # ISO date hint


class ScanResponse(BaseModel):
    signals_found: int
    relationships_found: int
    jurisdiction: Optional[str]
    document_date: Optional[str]
    signals: list[dict]
    relationships: list[dict]
    cost_usd: float
    input_tokens: int
    output_tokens: int


@router.post("/market/scan-document", response_model=ScanResponse)
async def scan_document(req: ScanRequest):
    if not req.url and not req.text:
        raise HTTPException(400, "Provide url or text")

    # Acquire raw text
    if req.url:
        try:
            raw = await _fetch_url(req.url)
        except Exception as exc:
            raise HTTPException(422, f"Failed to fetch URL: {exc}")
    else:
        raw = req.text or ""

    if not raw.strip():
        raise HTTPException(422, "Document is empty after extraction")

    # Truncate to model budget
    doc_text = raw[:MAX_TEXT_CHARS]
    if len(raw) > MAX_TEXT_CHARS:
        doc_text += f"\n\n[... document truncated at {MAX_TEXT_CHARS} chars ...]"

    prompt = EXTRACT_PROMPT + doc_text

    try:
        response = anthropic.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        raise HTTPException(500, f"Claude API error: {exc}")

    raw_json = response.content[0].text.strip()
    # Strip any accidental markdown fences
    raw_json = re.sub(r"^```(?:json)?\s*", "", raw_json)
    raw_json = re.sub(r"\s*```$", "", raw_json)

    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Claude returned invalid JSON: {exc}\n{raw_json[:500]}")

    signals = data.get("signals", [])
    relationships = data.get("relationships", [])
    jurisdiction = req.jurisdiction or data.get("jurisdiction")
    document_date = req.source_date or data.get("document_date")

    # Pricing (Sonnet 4.5: $3/$15 per MTok in/out)
    it = response.usage.input_tokens
    ot = response.usage.output_tokens
    cost = round((it * 3 + ot * 15) / 1_000_000, 4)

    return ScanResponse(
        signals_found=len(signals),
        relationships_found=len(relationships),
        jurisdiction=jurisdiction,
        document_date=document_date,
        signals=signals,
        relationships=relationships,
        cost_usd=cost,
        input_tokens=it,
        output_tokens=ot,
    )


# ── Scraper — crawl a source listing page ────────────────────────────────────

# Keywords that suggest a link leads to a council/planning/permit document
_DOC_KEYWORDS = re.compile(
    r"minute|agenda|council|planning|commission|permit|packet|staff.?report",
    re.IGNORECASE,
)
# File extensions we can process
_DOC_EXT = re.compile(r"\.(pdf|htm|html)(\?.*)?$", re.IGNORECASE)


class _LinkExtractor(HTMLParser):
    """Extract all <a href> values from HTML."""
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        if tag != "a":
            return
        for name, val in attrs:
            if name == "href" and val:
                href = val.strip()
                if href.startswith("http"):
                    self.links.append(href)
                elif href.startswith("/"):
                    from urllib.parse import urlparse
                    parsed = urlparse(self.base_url)
                    self.links.append(f"{parsed.scheme}://{parsed.netloc}{href}")
                elif not href.startswith("#") and not href.startswith("mailto"):
                    self.links.append(f"{self.base_url}/{href}")


def _extract_links(html: str, base_url: str) -> list[str]:
    extractor = _LinkExtractor(base_url)
    extractor.feed(html)
    return extractor.links


def _is_document_link(url: str, link_text: str = "") -> bool:
    """Return True if this link looks like a council/planning document."""
    combined = url + " " + link_text
    return bool(_DOC_KEYWORDS.search(combined)) and bool(_DOC_EXT.search(url))


class ScrapeRequest(BaseModel):
    source_id: str          # MarketSource.id — for dedup tracking on Next.js side
    url: str                # listing page URL
    jurisdiction: str
    already_seen: list[str] = []   # doc URLs already in MarketSourceDoc — skip these
    max_docs: int = 5       # cap per run to control cost


class ScrapedDoc(BaseModel):
    doc_url: str
    signals: list[dict]
    relationships: list[dict]
    jurisdiction: Optional[str]
    document_date: Optional[str]
    cost_usd: float
    input_tokens: int
    output_tokens: int
    error: Optional[str] = None


class ScrapeResponse(BaseModel):
    docs_found: int
    docs_scanned: int
    docs_skipped: int      # already seen
    results: list[ScrapedDoc]
    total_cost_usd: float


@router.post("/market/scrape-source", response_model=ScrapeResponse)
async def scrape_source(req: ScrapeRequest):
    """
    Fetch the listing page at req.url, find document links, scan new ones.
    already_seen is a list of doc URLs already processed — they are skipped.
    """
    # Fetch listing page
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
            r = await client.get(
                req.url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; MarketBot/1.0)"},
            )
            r.raise_for_status()
            html = r.text
    except Exception as exc:
        raise HTTPException(422, f"Failed to fetch listing page: {exc}")

    # Extract candidate document links
    all_links = _extract_links(html, req.url)
    doc_links = [l for l in all_links if _is_document_link(l)]

    # Deduplicate while preserving order
    seen_in_run: set[str] = set()
    unique_links: list[str] = []
    for l in doc_links:
        if l not in seen_in_run:
            seen_in_run.add(l)
            unique_links.append(l)

    already_seen_set = set(req.already_seen)
    new_links = [l for l in unique_links if l not in already_seen_set]
    skipped = len(unique_links) - len(new_links)

    to_scan = new_links[: req.max_docs]
    results: list[ScrapedDoc] = []
    total_cost = 0.0

    for doc_url in to_scan:
        try:
            raw = await _fetch_url(doc_url)
        except Exception as exc:
            results.append(ScrapedDoc(
                doc_url=doc_url, signals=[], relationships=[],
                jurisdiction=req.jurisdiction, document_date=None,
                cost_usd=0, input_tokens=0, output_tokens=0,
                error=str(exc),
            ))
            continue

        if not raw.strip():
            results.append(ScrapedDoc(
                doc_url=doc_url, signals=[], relationships=[],
                jurisdiction=req.jurisdiction, document_date=None,
                cost_usd=0, input_tokens=0, output_tokens=0,
                error="Empty document",
            ))
            continue

        doc_text = raw[:MAX_TEXT_CHARS]
        prompt = EXTRACT_PROMPT + doc_text

        try:
            response = anthropic.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            results.append(ScrapedDoc(
                doc_url=doc_url, signals=[], relationships=[],
                jurisdiction=req.jurisdiction, document_date=None,
                cost_usd=0, input_tokens=0, output_tokens=0,
                error=f"Claude error: {exc}",
            ))
            continue

        raw_json = response.content[0].text.strip()
        raw_json = re.sub(r"^```(?:json)?\s*", "", raw_json)
        raw_json = re.sub(r"\s*```$", "", raw_json)

        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError:
            data = {"signals": [], "relationships": []}

        it = response.usage.input_tokens
        ot = response.usage.output_tokens
        cost = round((it * 3 + ot * 15) / 1_000_000, 4)
        total_cost += cost

        results.append(ScrapedDoc(
            doc_url=doc_url,
            signals=data.get("signals", []),
            relationships=data.get("relationships", []),
            jurisdiction=req.jurisdiction or data.get("jurisdiction"),
            document_date=data.get("document_date"),
            cost_usd=cost,
            input_tokens=it,
            output_tokens=ot,
        ))

    return ScrapeResponse(
        docs_found=len(unique_links),
        docs_scanned=len(results),
        docs_skipped=skipped,
        results=results,
        total_cost_usd=round(total_cost, 4),
    )
