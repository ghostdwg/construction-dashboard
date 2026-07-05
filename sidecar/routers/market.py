"""
Market Intelligence Scanner

POST /market/scan-document
  Accepts a city council meeting minutes URL or raw text.
  Claude extracts construction leads, contract awards, and GC/sub relationships.
  Returns structured signals + relationship edges ready for DB insertion.

POST /market/scrape-source
  Crawl a listing page; extract candidate document links; date-filter; dedupe;
  scan a bounded subset. Returns one ScrapedDoc per processed doc with raw_text
  preserved so the app can persist for traceability.
"""

import json
import os
import re
from datetime import datetime, date
from html.parser import HTMLParser
from typing import Optional, Tuple
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
import pymupdf
from fastapi import APIRouter, HTTPException
from playwright.async_api import async_playwright
from pydantic import BaseModel

from services import ai_gateway

router = APIRouter()

# Option A (docs/architecture/adr/0001-ai-credential-resolution.md,
# docs/architecture/adr/0002-remaining-sidecar-credential-targets.md): this
# router NEVER resolves its own Anthropic credential. There is deliberately no
# module-level client singleton and no import-time environment read of the
# Anthropic key. The TS caller resolves the key once (via getSetting) and
# forwards it as `api_key` in each request body; `_scan_text()` builds a
# call-scoped client from that value (or fails closed if it is missing).

MODEL = "claude-sonnet-4-6"
MAX_TEXT_CHARS = 60_000  # ~15k tokens — enough for a full council session

# ── Ollama prefilter (optional cost-control stage) ──────────────────────────
# Local LLM on the GPU PC strips boilerplate before Claude sees the doc. See
# CURRENT_STATE.md § Phase 5I and the per-source `prefilterMode` knob.
OLLAMA_URL       = os.getenv("OLLAMA_URL", "http://100.126.166.110:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")
OLLAMA_TIMEOUT_S = 180

# Per-chunk character budget. qwen2.5:14b has 128k context; we conservatively
# use ~80k tokens worth (≈100k chars) to leave room for the prompt + output.
OLLAMA_MAX_TEXT_CHARS    = 100_000
# Hard cap on what we feed to Ollama for any one doc (5 chunks worth).
# Long council packets above this lose the tail — rare in practice.
OLLAMA_INPUT_MAX_CHARS   = 500_000
# Token-level context window for the model. 32k handles ~25-30k chars cleanly.
OLLAMA_NUM_CTX           = 32768
# Overlap between chunks (prevents losing signals at boundaries).
OLLAMA_CHUNK_OVERLAP     = 1500
# How long Ollama keeps the model in VRAM between calls. "2m" lets WhisperX
# share the GPU when scrapes are idle; longer keeps the model hot for bulk
# nightly processing. Override via env.
OLLAMA_KEEP_ALIVE        = os.getenv("OLLAMA_KEEP_ALIVE", "2m")


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
      "signal_subtype": "<SUP_CUP|REZONING|PLAT|VARIANCE|SITE_PLAN|COMPREHENSIVE_PLAN|ANNEXATION|TIF|BOND|PERMIT_AWARD|CONTRACT_AWARD|UTILITY_EXPANSION|CORRIDOR_STUDY|INFRASTRUCTURE_PLAN|INDUSTRIAL_REZONING|CODE_ADOPTION|ORDINANCE_CHANGE|ZONING_REWRITE|DENSITY_EXPANSION|TIF_APPROVAL|MORATORIUM|INFRASTRUCTURE_FUNDING|OTHER>",
      "next_meeting_date": "<ISO date YYYY-MM-DD if this item was CONTINUED to a specific future date, else null>",
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
      "status": "<APPROVED|CONTINUED|DENIED|DISCUSSED_NO_VOTE|WITHDRAWN>"
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
- signal_subtype is REQUIRED — pick the closest match. SUP_CUP = special/conditional
  use permit. REZONING = zoning change. PLAT = preliminary or final plat. VARIANCE
  = variance from a code requirement. SITE_PLAN = site plan review. ANNEXATION =
  bringing land into the city. TIF = tax increment financing district item.
  BOND = bond authorization. PERMIT_AWARD = building permit explicitly granted.
  CONTRACT_AWARD = construction contract awarded to a specific GC.
  UTILITY_EXPANSION = sewer extension, water main, lift station, treatment
  plant capacity, water tower, sanitary district expansion — anything that
  materially extends municipal utility service area or capacity.
  CORRIDOR_STUDY = formal corridor study or growth-corridor planning document
  (e.g. "Northwest Corridor Study", transportation corridor plan).
  INFRASTRUCTURE_PLAN = capital improvement plan (CIP) line items,
  transportation improvement plans, streetscape improvement programs,
  comprehensive infrastructure planning — distinct from a single utility
  extension (use UTILITY_EXPANSION for those).
  INDUSTRIAL_REZONING = a REZONING item where the target zoning class is
  industrial / manufacturing / warehouse / distribution / logistics. Prefer
  this over plain REZONING when the industrial nature is explicit.
  CODE_ADOPTION = adoption of a new building / residential / fire / plumbing
  / mechanical / energy code (IBC, IRC, IFC, IPC, IMC, IECC, etc.).
  ORDINANCE_CHANGE = generic ordinance amendment that doesn't fit a more
  specific governance subtype below. Use the more specific one when applicable.
  ZONING_REWRITE = COMPREHENSIVE zoning-code rewrite or text amendment that
  reshapes the zoning framework city-wide — distinct from REZONING (which is
  a single-parcel zoning change). Examples: "Comprehensive Zoning Ordinance
  Update", "Zoning Text Amendment Chapter 10", new zoning ordinance adoption.
  DENSITY_EXPANSION = density-allowance increase: ADU policy, height limit
  raised, FAR increased, density bonus introduced, "missing middle" policy.
  TIF_APPROVAL = a NEW TIF DISTRICT is approved/established/extended, OR an
  existing one expanded. Distinct from the generic TIF subtype (which is for
  any TIF-related item).
  MORATORIUM = imposition of a moratorium or temporary pause/prohibition on
  development (or a category thereof). Positive signal even though it pauses
  dev — indicates impending policy shift.
  INFRASTRUCTURE_FUNDING = funding actually AWARDED for infrastructure (grant
  award, capital appropriation, ARPA disbursement). Distinct from BOND
  (which is bond AUTHORIZATION — funding mechanism approved, not awarded).
  OTHER for items that don't fit but are still construction-relevant.
- status uppercase: APPROVED | CONTINUED | DENIED | DISCUSSED_NO_VOTE | WITHDRAWN.
  CONTINUED means the item was tabled to a future meeting (set next_meeting_date
  if mentioned).
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
    api_key: str = ""                    # Option A: resolved TS-side, forwarded per-request; never persisted


class ScanResponse(BaseModel):
    signals_found: int
    relationships_found: int
    jurisdiction: Optional[str]
    document_date: Optional[str]
    signals: list[dict]
    relationships: list[dict]
    raw_text: Optional[str] = None       # the extracted text we sent to Claude
    char_count: int = 0
    cost_usd: float
    input_tokens: int
    output_tokens: int


PREFILTER_PROMPT = """You are a strict pre-filter for construction market intelligence. Read this municipal document and return ONLY the portions relevant to a commercial general contractor.

Return STRICT JSON with this exact shape:
{
  "has_relevant_content": true | false,
  "jurisdiction": "<city/county or null>",
  "document_date": "<YYYY-MM-DD or null>",
  "excerpts": [
    {"topic": "<short label>", "text": "<verbatim quote, up to 600 chars>"}
  ]
}

INCLUDE excerpts for:
- Commercial, multifamily, institutional, industrial, or infrastructure projects (any approval, award, planning)
- Contract awards naming GCs or specific firms
- Zoning / entitlement / plat approvals where the use is NOT single-family residential
- Bond measures or funding approvals that will generate construction

IGNORE (do not include):
- Routine business: agenda/minute approvals, roll calls, adjournments, elections, comments-only items
- Single-family residential permits, rezonings, plats
- HR items, utility approvals under $100K
- Public-comment statements with no project information

VERBATIM quotes only — do NOT paraphrase or summarize across sentences. If a section is partially relevant, quote the relevant sentence(s) only.

If nothing in the document is relevant, return {"has_relevant_content": false, "excerpts": [], "jurisdiction": null, "document_date": null}.

DOCUMENT:
"""


def _split_for_ollama(text: str) -> list[str]:
    """Split text into chunks fitting under OLLAMA_MAX_TEXT_CHARS, with
    overlap to preserve context across boundaries.

    Splits prefer paragraph breaks, fall back to line breaks, then raw cut.
    Caps total input at OLLAMA_INPUT_MAX_CHARS — the tail of unusually long
    docs (>500k chars) is dropped, which is rare in municipal data."""
    if len(text) <= OLLAMA_MAX_TEXT_CHARS:
        return [text]

    text = text[:OLLAMA_INPUT_MAX_CHARS]
    target = int(OLLAMA_MAX_TEXT_CHARS * 0.92)   # leave headroom for prompt

    chunks: list[str] = []
    pos = 0
    while pos < len(text):
        end = min(pos + target, len(text))
        if end < len(text):
            split_at = text.rfind("\n\n", pos + target // 2, end)
            if split_at <= pos:
                split_at = text.rfind("\n", pos + target // 2, end)
            if split_at > pos:
                end = split_at
        chunks.append(text[pos:end])
        if end >= len(text):
            break
        pos = end - OLLAMA_CHUNK_OVERLAP
        if pos < 0:
            pos = 0
    return chunks


async def _ollama_condense_single(text: str, model: Optional[str] = None) -> Optional[dict]:
    """One Ollama call. Returns parsed JSON dict or None on failure."""
    if not text.strip():
        return {"has_relevant_content": False, "excerpts": [], "jurisdiction": None, "document_date": None}

    prompt = PREFILTER_PROMPT + text[:OLLAMA_MAX_TEXT_CHARS]
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": model or OLLAMA_MODEL,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "keep_alive": OLLAMA_KEEP_ALIVE,
                    "options": {"temperature": 0.1, "num_ctx": OLLAMA_NUM_CTX},
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return None

    response_text = data.get("response", "{}")
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return None

    return {
        "has_relevant_content": bool(parsed.get("has_relevant_content")),
        "jurisdiction":   parsed.get("jurisdiction"),
        "document_date":  parsed.get("document_date"),
        "excerpts":       parsed.get("excerpts") or [],
    }


async def _ollama_condense(text: str, model: Optional[str] = None) -> Optional[dict]:
    """Run the Ollama prefilter. For docs that exceed OLLAMA_MAX_TEXT_CHARS,
    map-reduces across chunks so nothing gets truncated. Returns parsed JSON
    or None on total failure (all chunks failed → caller falls back to
    direct-to-Claude). Partial chunk failures are tolerated."""
    chunks = _split_for_ollama(text)

    if len(chunks) == 1:
        return await _ollama_condense_single(chunks[0], model)

    # Map: each chunk independently
    results: list[dict] = []
    for chunk in chunks:
        r = await _ollama_condense_single(chunk, model)
        if r is not None:
            results.append(r)

    if not results:
        return None

    # Reduce: any-relevant, first non-null hints, dedupe excerpts by text.
    has_relevant = any(r.get("has_relevant_content") for r in results)
    jurisdiction = next((r.get("jurisdiction")  for r in results if r.get("jurisdiction")),  None)
    doc_date     = next((r.get("document_date") for r in results if r.get("document_date")), None)

    seen: set[str] = set()
    merged_excerpts: list[dict] = []
    for r in results:
        for e in (r.get("excerpts") or []):
            t = (e.get("text") or "").strip()
            if not t or t in seen:
                continue
            seen.add(t)
            merged_excerpts.append(e)

    return {
        "has_relevant_content": has_relevant,
        "jurisdiction": jurisdiction,
        "document_date": doc_date,
        "excerpts": merged_excerpts,
    }


def _excerpts_to_doc(excerpts: list[dict]) -> str:
    """Render Ollama excerpts as a clean doc Claude can analyze."""
    parts = []
    for e in excerpts:
        topic = (e.get("topic") or "").strip()
        text  = (e.get("text")  or "").strip()
        if not text:
            continue
        if topic:
            parts.append(f"[{topic}]\n{text}")
        else:
            parts.append(text)
    return "\n\n".join(parts)


async def _scan_text(
    doc_text: str,
    jurisdiction_hint: Optional[str],
    source_date_hint: Optional[str],
    api_key: Optional[str] = None,
) -> dict:
    """Run Claude analysis on extracted text. Returns dict with signals/relationships + usage.

    api_key: Anthropic API key resolved by the TS caller (Option A — see
    docs/architecture/adr/0001-ai-credential-resolution.md and
    docs/architecture/adr/0002-remaining-sidecar-credential-targets.md). This
    router never resolves its own credential; there is no env fallback. All
    three endpoints (scan-document, scrape-source, analyze-text) forward the
    value they received in their request body into this single chokepoint,
    which builds a call-scoped client from it. Fails closed when absent."""
    if not api_key:
        raise HTTPException(
            503, "ANTHROPIC_API_KEY not configured — set it in Settings → AI Configuration"
        )

    client = ai_gateway.build_client(api_key)

    prompt = EXTRACT_PROMPT + doc_text
    try:
        result = ai_gateway.create_message(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            client=client,
        )
        response = result.raw
    except Exception as exc:
        raise HTTPException(500, f"Claude API error: {exc}")

    raw_json = response.content[0].text.strip()
    raw_json = re.sub(r"^```(?:json)?\s*", "", raw_json)
    raw_json = re.sub(r"\s*```$", "", raw_json)

    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Claude returned invalid JSON: {exc}\n{raw_json[:500]}")

    it = response.usage.input_tokens
    ot = response.usage.output_tokens
    cost = round((it * 3 + ot * 15) / 1_000_000, 4)

    return {
        "signals": data.get("signals", []),
        "relationships": data.get("relationships", []),
        "jurisdiction": jurisdiction_hint or data.get("jurisdiction"),
        "document_date": source_date_hint or data.get("document_date"),
        "input_tokens": it,
        "output_tokens": ot,
        "cost_usd": cost,
    }


@router.post("/market/scan-document", response_model=ScanResponse)
async def scan_document(req: ScanRequest):
    if not req.url and not req.text:
        raise HTTPException(400, "Provide url or text")

    if req.url:
        try:
            raw = await _fetch_url(req.url)
        except Exception as exc:
            raise HTTPException(422, f"Failed to fetch URL: {exc}")
    else:
        raw = req.text or ""

    if not raw.strip():
        raise HTTPException(422, "Document is empty after extraction")

    doc_text = raw[:MAX_TEXT_CHARS]
    if len(raw) > MAX_TEXT_CHARS:
        doc_text += f"\n\n[... document truncated at {MAX_TEXT_CHARS} chars ...]"

    result = await _scan_text(doc_text, req.jurisdiction, req.source_date, req.api_key)

    return ScanResponse(
        signals_found=len(result["signals"]),
        relationships_found=len(result["relationships"]),
        jurisdiction=result["jurisdiction"],
        document_date=result["document_date"],
        signals=result["signals"],
        relationships=result["relationships"],
        raw_text=doc_text,
        char_count=len(doc_text),
        cost_usd=result["cost_usd"],
        input_tokens=result["input_tokens"],
        output_tokens=result["output_tokens"],
    )


# ── Scraper — crawl a source listing page ────────────────────────────────────

_DOC_KEYWORDS = re.compile(
    r"minute|agenda|council|planning|commission|permit|packet|staff.?report",
    re.IGNORECASE,
)
# A document URL: either a .pdf|.htm|.html file, OR a platform-specific
# document-server pattern. CivicPlus AgendaCenter serves PDFs at /ViewFile/
# without an extension; CivicClerk serves them via /Meetings/GetMeetingFileStream(...).
_DOC_URL_PATTERN = re.compile(
    r"\.(pdf|htm|html)(\?.*)?$"
    r"|/AgendaCenter/ViewFile/"
    r"|/AgendaCenter/PreviousVersions/"
    r"|civicclerk\.com/.*?/Meetings/Get"
    r"|civicclerk\.com/.*?/Events/Get"
    r"|boarddocs\.com/.*?/Public",
    re.IGNORECASE,
)

_CIVICCLERK_TENANT_RE = re.compile(
    r"window\.(?:clerkEmbedProps|ClerkEmbedProps)\s*=\s*\{[^}]*"
    r"['\"]tenant['\"]\s*:\s*['\"]([a-z0-9_-]+)['\"]",
    re.IGNORECASE | re.DOTALL,
)
_CIVICCLERK_PORTAL_RE = re.compile(
    r"https?://([a-z0-9_-]+)\.(?:portal|api)\.civicclerk\.com",
    re.IGNORECASE,
)
_CIVICCLERK_HOST_RE = re.compile(
    r"^([a-z0-9_-]+)\.(?:portal|api)\.civicclerk\.com$",
    re.IGNORECASE,
)
_CIVICCLERK_KNOWN_TENANTS_BY_HOST = {
    "cityofbondurant.com": "bondurantia",
    "www.cityofbondurant.com": "bondurantia",
}
_CIVICCLERK_EVENT_PAGE_SIZE = 100
_CIVICCLERK_MAX_EVENT_PAGES = 25


class _LinkExtractor(HTMLParser):
    """Extract <a href> + the inner text for each anchor."""
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.links: list[Tuple[str, str]] = []   # (url, link_text)
        self._current_href: Optional[str] = None
        self._current_text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        if tag != "a":
            return
        for name, val in attrs:
            if name == "href" and val:
                href = val.strip()
                resolved: Optional[str] = None
                if href.startswith("http"):
                    resolved = href
                elif href.startswith("/"):
                    parsed = urlparse(self.base_url)
                    resolved = f"{parsed.scheme}://{parsed.netloc}{href}"
                elif not href.startswith("#") and not href.startswith("mailto"):
                    resolved = f"{self.base_url}/{href}"
                self._current_href = resolved
                self._current_text_parts = []

    def handle_data(self, data: str):
        if self._current_href is not None:
            stripped = data.strip()
            if stripped:
                self._current_text_parts.append(stripped)

    def handle_endtag(self, tag: str):
        if tag == "a" and self._current_href is not None:
            text = " ".join(self._current_text_parts).strip()
            self.links.append((self._current_href, text))
            self._current_href = None
            self._current_text_parts = []


def _extract_links(html: str, base_url: str) -> list[Tuple[str, str]]:
    extractor = _LinkExtractor(base_url)
    extractor.feed(html)
    return extractor.links


def _is_document_link(url: str, link_text: str = "") -> bool:
    """A link looks like a doc if (a) it has a doc-keyword in URL/text AND
    (b) it matches a known document URL pattern. We treat CivicPlus ViewFile
    and CivicClerk Meeting endpoints as doc URLs even though they lack a
    `.pdf` extension — those servers stream the PDF when you GET the URL."""
    combined = url + " " + link_text
    return bool(_DOC_KEYWORDS.search(combined)) and bool(_DOC_URL_PATTERN.search(url))


def _strip_query(url: str) -> str:
    """Canonical URL for dedup — drops query string + fragment.

    Many municipal CMSes append cache-busters like `?t=20260412171349`
    that change on every upload without the doc content changing."""
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))


_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

# MM.DD.YYYY or M.D.YYYY (Iowa P&Z pattern: 04.13.2026, 4.13.2026)
_DATE_RE_DOTS  = re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)")
# MM-DD-YYYY or M-D-YYYY
_DATE_RE_DASH  = re.compile(r"(?<!\d)(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)")
# MM/DD/YYYY or M/D/YYYY
_DATE_RE_SLASH = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)")
# YYYY-MM-DD (ISO)
_DATE_RE_ISO   = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
# "April 13, 2026" / "Apr 13 2026"
_DATE_RE_TEXT  = re.compile(
    r"(?<![A-Za-z])([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?![A-Za-z\d])"
)
# YYYYMMDD compact (e.g., Des Moines: ag20260518.pdf). Restricted to 20XX
# years so we don't match random 8-digit IDs.
_DATE_RE_COMPACT = re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)")
# CivicPlus AgendaCenter URL pattern: _MMDDYYYY-id (e.g., _05062026-1691).
# The underscore prefix + dash suffix makes this unambiguous.
_DATE_RE_CIVICPLUS = re.compile(r"_(\d{2})(\d{2})(20\d{2})-\d+")


def _parse_date_from_string(s: str) -> Optional[date]:
    """Try every supported date pattern; return the first parseable date.

    Order matters slightly: dots/dash/slash try MM-DD-YYYY first (US style)."""
    if not s:
        return None

    for rx in (_DATE_RE_DOTS, _DATE_RE_DASH, _DATE_RE_SLASH):
        m = rx.search(s)
        if m:
            mo, da, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return date(yr, mo, da)
            except ValueError:
                pass

    m = _DATE_RE_ISO.search(s)
    if m:
        yr, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(yr, mo, da)
        except ValueError:
            pass

    m = _DATE_RE_COMPACT.search(s)
    if m:
        yr, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(yr, mo, da)
        except ValueError:
            pass

    m = _DATE_RE_CIVICPLUS.search(s)
    if m:
        mo, da, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(yr, mo, da)
        except ValueError:
            pass

    m = _DATE_RE_TEXT.search(s)
    if m:
        month_word, da, yr = m.group(1).lower(), int(m.group(2)), int(m.group(3))
        mo = _MONTHS.get(month_word)
        if mo:
            try:
                return date(yr, mo, da)
            except ValueError:
                pass

    return None


def _parse_date_for_link(url: str, link_text: str) -> Optional[date]:
    """Look for a date in URL filename first, then link text."""
    p = urlparse(url)
    fname = p.path.rsplit("/", 1)[-1]
    d = _parse_date_from_string(fname)
    if d:
        return d
    return _parse_date_from_string(link_text)


def _parse_iso_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _extract_civicclerk_tenant(url: str, html: str) -> Optional[str]:
    """Find a CivicClerk tenant from either the source URL or embed markup.

    CivicClerk's new public portal injects meeting files client-side via:
      window.clerkEmbedProps = {"tenant": "SITEID"}
      https://civicclerkcdn.azureedge.net/publicportal-live/embed.js
    Static anchor scraping will see no documents, so we use the tenant to call
    the public portal API directly.
    """
    host = urlparse(url).netloc.lower()
    host_match = _CIVICCLERK_HOST_RE.match(host)
    if host_match:
        return host_match.group(1).lower()

    embed_match = _CIVICCLERK_TENANT_RE.search(html or "")
    if embed_match:
        return embed_match.group(1).lower()

    portal_match = _CIVICCLERK_PORTAL_RE.search(html or "")
    if portal_match:
        return portal_match.group(1).lower()

    return None


def _infer_civicclerk_tenants_from_url(url: str) -> list[str]:
    """Guess CivicClerk tenants when a municipal landing page is blocked."""
    host = urlparse(url).netloc.lower()
    if not host:
        return []

    candidates: list[str] = []
    known = _CIVICCLERK_KNOWN_TENANTS_BY_HOST.get(host)
    if known:
        candidates.append(known)

    host_base = host[4:] if host.startswith("www.") else host
    stem = host_base.split(".", 1)[0]
    for prefix in ("cityof", "city-of"):
        if stem.startswith(prefix):
            stem = stem[len(prefix):]
            break
    for suffix in ("iowa", "ia"):
        if stem.endswith(suffix) and len(stem) > len(suffix):
            stem = stem[:-len(suffix)]
            break

    stem = re.sub(r"[^a-z0-9_-]", "", stem)
    for tenant in (f"{stem}ia", stem):
        if tenant and tenant not in candidates:
            candidates.append(tenant)
    return candidates


def _civicclerk_file_url(tenant: str, file_info: dict) -> Optional[str]:
    file_id = file_info.get("fileId")
    if file_id is None:
        return None

    api_base = f"https://{tenant}.api.civicclerk.com/v1"
    stream_url = file_info.get("streamUrl")
    if stream_url:
        return stream_url if str(stream_url).startswith("http") else urljoin(api_base + "/", str(stream_url))

    try:
        file_type = int(file_info.get("fileType") or 0)
    except (TypeError, ValueError):
        file_type = 0

    if file_type == 3:
        return f"{api_base}/Meetings/GetAttachmentFile(fileId={file_id})"
    return f"{api_base}/Meetings/GetMeetingFileStream(fileId={file_id},plainText=false)"


def _civicclerk_title(event: dict, file_info: dict, event_date: Optional[date]) -> str:
    doc_type = (file_info.get("type") or "Document").strip()
    name = (
        file_info.get("name")
        or event.get("agendaName")
        or event.get("eventName")
        or f"{doc_type} {file_info.get('fileId')}"
    )
    category = event.get("eventCategoryName") or event.get("categoryName")
    event_name = event.get("eventName")

    parts = [doc_type, str(name).strip()]
    if category and str(category).lower() not in str(name).lower():
        parts.append(str(category).strip())
    if event_name and str(event_name).lower() not in str(name).lower():
        parts.append(str(event_name).strip())
    if event_date:
        parts.append(event_date.isoformat())
    return " - ".join(p for p in parts if p)


def _civicclerk_date_filter(date_from: Optional[date], date_to: Optional[date]) -> Optional[str]:
    filters: list[str] = []
    if date_from:
        filters.append(f"eventDate ge {date_from.isoformat()}T00:00:00Z")
    if date_to:
        filters.append(f"eventDate le {date_to.isoformat()}T23:59:59Z")
    return " and ".join(filters) if filters else None


async def _fetch_civicclerk_candidates(
    tenant: str,
    date_from: Optional[date],
    date_to: Optional[date],
    max_docs: int,
) -> list[Tuple[str, str]]:
    """Return document candidates from CivicClerk's public Events API.

    The website embed renders files from JSON, not from server-rendered links.
    Each event contains `publishedFiles`; the stream endpoint is the same
    endpoint used by the portal UI for PDF downloads.
    """
    url = f"https://{tenant}.api.civicclerk.com/v1/Events"
    params: Optional[dict[str, str]] = {
        "$orderby": "eventDate desc",
        "$top": str(_CIVICCLERK_EVENT_PAGE_SIZE),
    }
    date_filter = _civicclerk_date_filter(date_from, date_to)
    if date_filter:
        params["$filter"] = date_filter

    target_candidates = max(max_docs * 3, 50)
    candidates: list[Tuple[str, str]] = []
    pages = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        while url and pages < _CIVICCLERK_MAX_EVENT_PAGES and len(candidates) < target_candidates:
            r = await client.get(
                url,
                params=params,
                headers={"User-Agent": "Mozilla/5.0 (compatible; MarketBot/1.0)"},
            )
            r.raise_for_status()
            data = r.json()
            pages += 1

            for event in data.get("value") or []:
                event_date = _parse_iso_date(event.get("eventDate"))
                files = event.get("publishedFiles") or []
                files = sorted(files, key=lambda f: f.get("sort") or 0)
                for file_info in files:
                    doc_url = _civicclerk_file_url(tenant, file_info)
                    if not doc_url:
                        continue
                    candidates.append((doc_url, _civicclerk_title(event, file_info, event_date)))
                    if len(candidates) >= target_candidates:
                        break
                if len(candidates) >= target_candidates:
                    break

            url = data.get("@odata.nextLink")
            params = None

    return candidates


class ScrapeRequest(BaseModel):
    source_id: str
    url: str
    jurisdiction: str
    already_seen: list[str] = []           # canonical (query-stripped) URLs to skip
    max_docs: int = 5
    date_from: Optional[str] = None        # ISO YYYY-MM-DD inclusive
    date_to: Optional[str] = None          # ISO YYYY-MM-DD inclusive
    include_undated: bool = False          # if False, drop links with no parseable date
    # Ollama prefilter (cost control)
    prefilter_mode: str = "off"            # off | large | always
    prefilter_threshold: int = 30_000      # only used when mode = "large"
    prefilter_model: Optional[str] = None  # override OLLAMA_MODEL env default
    api_key: str = ""                      # Option A: resolved TS-side, forwarded per-request; never persisted


class ScrapedDoc(BaseModel):
    doc_url: str                 # canonical (query-stripped) — use as dedup key
    doc_url_full: str            # original including query string — use to refetch
    title: Optional[str] = None  # link text from listing page
    signals: list[dict]
    relationships: list[dict]
    jurisdiction: Optional[str]
    document_date: Optional[str]
    raw_text: Optional[str] = None
    char_count: int = 0
    cost_usd: float
    input_tokens: int
    output_tokens: int
    prefilter_used: str = "none"   # none | applied | skipped_empty | fallback_direct
    prefilter_chars_in: int = 0    # original char count before prefilter
    prefilter_chars_out: int = 0   # char count after prefilter (sent to Claude)
    error: Optional[str] = None


class ScrapeResponse(BaseModel):
    docs_found: int
    docs_in_range: int
    docs_scanned: int
    docs_skipped: int            # already seen
    docs_dropped_date: int       # out of date range
    docs_dropped_undated: int    # had no parseable date and include_undated=False
    docs_prefilter_applied: int = 0
    docs_prefilter_skipped: int = 0     # Ollama said has_relevant_content=false; Claude not called
    docs_prefilter_failed: int  = 0     # Ollama call failed; fell back to direct
    total_chars_saved: int      = 0     # input chars dropped by prefilter
    results: list[ScrapedDoc]
    total_cost_usd: float


@router.post("/market/scrape-source", response_model=ScrapeResponse)
async def scrape_source(req: ScrapeRequest):
    """Fetch listing page, date-filter links, dedupe, scan up to max_docs new ones."""
    html = ""
    listing_error: Optional[Exception] = None
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
            r = await client.get(
                req.url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; MarketBot/1.0)"},
            )
            r.raise_for_status()
            html = r.text
    except Exception as exc:
        listing_error = exc

    date_from = _parse_iso_date(req.date_from)
    date_to   = _parse_iso_date(req.date_to)

    candidates: list[Tuple[str, str]] = []
    civicclerk_tenants: list[str] = []
    if html:
        candidates = _extract_links(html, req.url)
        candidates = [(u, t) for (u, t) in candidates if _is_document_link(u, t)]
        civicclerk_tenant = _extract_civicclerk_tenant(req.url, html)
        if civicclerk_tenant:
            civicclerk_tenants.append(civicclerk_tenant)
    else:
        civicclerk_tenants.extend(_infer_civicclerk_tenants_from_url(req.url))

    civicclerk_error: Optional[Exception] = None
    for civicclerk_tenant in civicclerk_tenants:
        try:
            civicclerk_candidates = await _fetch_civicclerk_candidates(
                civicclerk_tenant,
                date_from,
                date_to,
                req.max_docs,
            )
        except Exception as exc:
            civicclerk_error = exc
            if html:
                raise HTTPException(422, f"Failed to fetch CivicClerk events for {civicclerk_tenant}: {exc}")
            continue
        candidates = civicclerk_candidates + candidates
        break

    if listing_error and not candidates:
        detail = f"Failed to fetch listing page: {listing_error}"
        if civicclerk_error:
            detail += f"; CivicClerk fallback failed: {civicclerk_error}"
        raise HTTPException(422, detail)

    # Dedup by canonical URL, keep first occurrence (preserves source order)
    seen_canon: set[str] = set()
    unique: list[Tuple[str, str, str]] = []   # (canonical, full, link_text)
    for full_url, link_text in candidates:
        canon = _strip_query(full_url)
        if canon in seen_canon:
            continue
        seen_canon.add(canon)
        unique.append((canon, full_url, link_text))

    docs_found = len(unique)
    already_seen_set = set(req.already_seen)

    # Apply date + dedup filters
    in_range: list[Tuple[str, str, str, Optional[date]]] = []
    dropped_date = 0
    dropped_undated = 0
    for canon, full_url, link_text in unique:
        if canon in already_seen_set:
            continue
        d = _parse_date_for_link(full_url, link_text)
        if d is None:
            if not req.include_undated:
                dropped_undated += 1
                continue
        else:
            if date_from and d < date_from:
                dropped_date += 1
                continue
            if date_to and d > date_to:
                dropped_date += 1
                continue
        in_range.append((canon, full_url, link_text, d))

    skipped_seen = sum(1 for (c, _f, _t) in unique if c in already_seen_set)

    to_scan = in_range[: req.max_docs]
    results: list[ScrapedDoc] = []
    total_cost = 0.0
    prefilter_applied = 0
    prefilter_skipped = 0
    prefilter_failed  = 0
    chars_saved       = 0

    for canon, full_url, link_text, parsed_date in to_scan:
        try:
            raw = await _fetch_url(full_url)
        except Exception as exc:
            results.append(ScrapedDoc(
                doc_url=canon, doc_url_full=full_url, title=link_text or None,
                signals=[], relationships=[],
                jurisdiction=req.jurisdiction,
                document_date=parsed_date.isoformat() if parsed_date else None,
                raw_text=None, char_count=0,
                cost_usd=0, input_tokens=0, output_tokens=0,
                error=str(exc),
            ))
            continue

        if not raw.strip():
            results.append(ScrapedDoc(
                doc_url=canon, doc_url_full=full_url, title=link_text or None,
                signals=[], relationships=[],
                jurisdiction=req.jurisdiction,
                document_date=parsed_date.isoformat() if parsed_date else None,
                raw_text=None, char_count=0,
                cost_usd=0, input_tokens=0, output_tokens=0,
                error="Empty document",
            ))
            continue

        # Three text budgets:
        #   - claude_text: 60k cap (Claude direct or post-prefilter input)
        #   - ollama_text: 500k cap with internal chunking (sees more of long packets)
        #   - stored_text: 200k cap, persisted to MarketSourceDoc.rawText for traceability
        claude_text = raw[:MAX_TEXT_CHARS]
        if len(raw) > MAX_TEXT_CHARS:
            claude_text += f"\n\n[... document truncated at {MAX_TEXT_CHARS} chars ...]"
        ollama_text = raw[:OLLAMA_INPUT_MAX_CHARS]
        stored_text = raw[:200_000]
        # original_chars reports the doc size we ACTUALLY saw (pre-truncation).
        original_chars = len(stored_text)

        # ── Ollama prefilter routing ─────────────────────────────────────
        prefilter_used = "none"
        text_for_claude = claude_text
        want_prefilter = (
            req.prefilter_mode == "always"
            or (req.prefilter_mode == "large" and len(raw) > req.prefilter_threshold)
        )

        if want_prefilter:
            condensed = await _ollama_condense(ollama_text, model=req.prefilter_model)
            if condensed is None:
                prefilter_used = "fallback_direct"
                prefilter_failed += 1
            elif not condensed.get("has_relevant_content"):
                prefilter_used = "skipped_empty"
                prefilter_skipped += 1
                chars_saved += original_chars
                results.append(ScrapedDoc(
                    doc_url=canon, doc_url_full=full_url, title=link_text or None,
                    signals=[], relationships=[],
                    jurisdiction=condensed.get("jurisdiction") or req.jurisdiction,
                    document_date=condensed.get("document_date")
                        or (parsed_date.isoformat() if parsed_date else None),
                    raw_text=stored_text,
                    char_count=original_chars,
                    cost_usd=0, input_tokens=0, output_tokens=0,
                    prefilter_used=prefilter_used,
                    prefilter_chars_in=original_chars,
                    prefilter_chars_out=0,
                ))
                continue
            else:
                rendered = _excerpts_to_doc(condensed.get("excerpts", []))
                if rendered.strip():
                    text_for_claude = rendered
                    prefilter_used = "applied"
                    prefilter_applied += 1
                    chars_saved += max(0, original_chars - len(rendered))
                else:
                    # Prefilter claimed relevance but produced no excerpts — direct
                    prefilter_used = "fallback_direct"
                    prefilter_failed += 1

        # ── Claude scan ──────────────────────────────────────────────────
        try:
            scan = await _scan_text(
                text_for_claude,
                req.jurisdiction,
                parsed_date.isoformat() if parsed_date else None,
                req.api_key,
            )
        except HTTPException as exc:
            results.append(ScrapedDoc(
                doc_url=canon, doc_url_full=full_url, title=link_text or None,
                signals=[], relationships=[],
                jurisdiction=req.jurisdiction,
                document_date=parsed_date.isoformat() if parsed_date else None,
                raw_text=stored_text, char_count=original_chars,
                cost_usd=0, input_tokens=0, output_tokens=0,
                prefilter_used=prefilter_used,
                prefilter_chars_in=original_chars,
                prefilter_chars_out=len(text_for_claude) if prefilter_used == "applied" else 0,
                error=f"Claude error: {exc.detail}",
            ))
            continue

        total_cost += scan["cost_usd"]
        results.append(ScrapedDoc(
            doc_url=canon, doc_url_full=full_url, title=link_text or None,
            signals=scan["signals"],
            relationships=scan["relationships"],
            jurisdiction=scan["jurisdiction"] or req.jurisdiction,
            document_date=scan["document_date"]
                or (parsed_date.isoformat() if parsed_date else None),
            raw_text=stored_text,
            char_count=original_chars,
            cost_usd=scan["cost_usd"],
            input_tokens=scan["input_tokens"],
            output_tokens=scan["output_tokens"],
            prefilter_used=prefilter_used,
            prefilter_chars_in=original_chars,
            prefilter_chars_out=len(text_for_claude) if prefilter_used == "applied" else 0,
        ))

    return ScrapeResponse(
        docs_found=docs_found,
        docs_in_range=len(in_range),
        docs_scanned=len(results),
        docs_skipped=skipped_seen,
        docs_dropped_date=dropped_date,
        docs_dropped_undated=dropped_undated,
        docs_prefilter_applied=prefilter_applied,
        docs_prefilter_skipped=prefilter_skipped,
        docs_prefilter_failed=prefilter_failed,
        total_chars_saved=chars_saved,
        results=results,
        total_cost_usd=round(total_cost, 4),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Dual-engine on-demand analysis (Phase 1 of "doc-as-artifact" pivot).
#
# The scrape flow auto-runs Claude. This endpoint lets the user fire either
# Claude or Ollama against an already-scraped doc's raw text. The app stores
# the response in MarketDocAnalysis so the same doc can be analyzed by
# multiple engines and the outputs compared.
# ─────────────────────────────────────────────────────────────────────────────


class AnalyzeTextRequest(BaseModel):
    text: str
    engine: str                          # "claude" | "ollama"
    model: Optional[str] = None          # override default per engine
    jurisdiction: Optional[str] = None
    source_date: Optional[str] = None
    api_key: str = ""                    # Option A: resolved TS-side for the claude branch; never persisted


class AnalyzeTextResponse(BaseModel):
    engine: str
    model: str
    duration_ms: int
    cost_usd: float
    input_tokens: int = 0
    output_tokens: int = 0
    signals_count: int
    leads_count: int = 0   # leads are derived later by the app; sidecar returns 0
    jurisdiction: Optional[str] = None
    document_date: Optional[str] = None
    raw_response: dict                    # full parsed JSON the engine returned
    error: Optional[str] = None


async def _analyze_with_ollama(doc_text: str, model: Optional[str]) -> dict:
    """Run the extraction prompt on Ollama with format=json. Reuses the
    Claude EXTRACT_PROMPT schema so downstream consumers don't care which
    engine produced the JSON."""
    chosen_model = model or OLLAMA_MODEL
    # Match prefilter's cap so we don't blow context on huge minutes.
    capped = doc_text[:OLLAMA_MAX_TEXT_CHARS]
    prompt = EXTRACT_PROMPT + capped

    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": chosen_model,
                "prompt": prompt,
                "format": "json",          # Ollama forces JSON output
                "stream": False,
                "keep_alive": OLLAMA_KEEP_ALIVE,
                "options": {"temperature": 0.1, "num_ctx": OLLAMA_NUM_CTX},
            },
        )
        r.raise_for_status()
        data = r.json()

    response_text = (data.get("response") or "").strip()
    response_text = re.sub(r"^```(?:json)?\s*", "", response_text)
    response_text = re.sub(r"\s*```$", "", response_text)
    try:
        parsed = json.loads(response_text) if response_text else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Ollama returned invalid JSON: {exc}\n{response_text[:500]}")

    return {
        "parsed": parsed,
        "model": chosen_model,
        "cost_usd": 0.0,                   # local inference
        "input_tokens": data.get("prompt_eval_count", 0) or 0,
        "output_tokens": data.get("eval_count", 0) or 0,
    }


@router.post("/market/analyze-text", response_model=AnalyzeTextResponse)
async def analyze_text(req: AnalyzeTextRequest):
    """On-demand engine analysis of arbitrary text. Engine = claude | ollama."""
    if not req.text or not req.text.strip():
        raise HTTPException(400, "text is required")
    engine = (req.engine or "").lower()
    if engine not in ("claude", "ollama"):
        raise HTTPException(400, "engine must be 'claude' or 'ollama'")

    started = _now_ms()
    try:
        if engine == "claude":
            doc_text = req.text[:MAX_TEXT_CHARS]
            if len(req.text) > MAX_TEXT_CHARS:
                doc_text += f"\n\n[... document truncated at {MAX_TEXT_CHARS} chars ...]"
            result = await _scan_text(doc_text, req.jurisdiction, req.source_date, req.api_key)
            duration_ms = _now_ms() - started
            return AnalyzeTextResponse(
                engine="claude",
                model=MODEL,
                duration_ms=duration_ms,
                cost_usd=result["cost_usd"],
                input_tokens=result["input_tokens"],
                output_tokens=result["output_tokens"],
                signals_count=len(result["signals"]),
                jurisdiction=result["jurisdiction"],
                document_date=result["document_date"],
                raw_response={
                    "jurisdiction": result["jurisdiction"],
                    "document_date": result["document_date"],
                    "signals": result["signals"],
                    "relationships": result["relationships"],
                },
            )
        else:
            out = await _analyze_with_ollama(req.text, req.model)
            parsed = out["parsed"]
            duration_ms = _now_ms() - started
            jurisdiction = req.jurisdiction or parsed.get("jurisdiction")
            document_date = req.source_date or parsed.get("document_date")
            return AnalyzeTextResponse(
                engine="ollama",
                model=out["model"],
                duration_ms=duration_ms,
                cost_usd=0.0,
                input_tokens=out["input_tokens"],
                output_tokens=out["output_tokens"],
                signals_count=len(parsed.get("signals") or []),
                jurisdiction=jurisdiction,
                document_date=document_date,
                raw_response=parsed,
            )
    except HTTPException:
        raise
    except Exception as exc:
        duration_ms = _now_ms() - started
        # Surface engine errors with status 502 — sidecar itself is fine,
        # the downstream LLM is what failed.
        raise HTTPException(502, f"{engine} analysis failed after {duration_ms}ms: {exc}")


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)
