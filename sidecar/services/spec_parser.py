"""
Spec book PDF parser — extracts CSI sections from construction spec books.

Primary: PyMuPDF4LLM for structured markdown extraction (0.12s/page).
Fallback: pdfplumber for pages with complex bordered tables.

Returns a list of CSI sections with section number, title, raw text,
page range, and table count.
"""

import re
import tempfile
from pathlib import Path
from dataclasses import dataclass, asdict

import pymupdf4llm
import pdfplumber


@dataclass
class SpecSection:
    section_number: str  # "03 30 00"
    title: str  # "CAST-IN-PLACE CONCRETE"
    raw_text: str  # Full section text (up to 5000 chars)
    page_start: int  # 1-based
    page_end: int  # 1-based
    table_count: int  # Tables detected in this section
    page_count: int  # Pages in this section


# CSI MasterFormat header pattern — matches:
#   "SECTION 03 30 00 - CAST-IN-PLACE CONCRETE"
#   "03 30 00 - CAST-IN-PLACE CONCRETE"
#   "SECTION 033000 - CAST-IN-PLACE CONCRETE"
CSI_HEADER_RE = re.compile(
    r"(?:SECTION\s+)?"
    r"(\d{2}\s*\d{2}\s*\d{2})"
    r"(?:\s*[-–—]\s*|\s+)"
    r"([A-Z][A-Za-z0-9 ,&()\'/.:\-]{2,80})",
    re.MULTILINE,
)

# Division header pattern — matches "DIVISION 03" or "DIVISION 03 - CONCRETE"
DIVISION_HEADER_RE = re.compile(
    r"DIVISION\s+(\d{2})(?:\s*[-–—]\s*(.+))?",
    re.MULTILINE | re.IGNORECASE,
)


def normalize_csi(raw: str) -> str:
    """Normalize CSI number to 'DD DD DD' format."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 6:
        return f"{digits[0:2]} {digits[2:4]} {digits[4:6]}"
    return raw.strip()


def parse_spec_pdf(pdf_path: str, max_text_per_section: int = 5000) -> list[dict]:
    """
    Parse a spec book PDF and extract CSI sections.

    Uses PyMuPDF4LLM for primary text extraction (fast, structured).
    Falls back to pdfplumber for pages where PyMuPDF finds tables
    but can't extract their content well.

    Args:
        pdf_path: Path to the PDF file
        max_text_per_section: Max chars of raw text to keep per section

    Returns:
        List of section dicts matching the SpecSection shape
    """
    # Phase 1: Extract full text with PyMuPDF4LLM (markdown output)
    md_pages = pymupdf4llm.to_markdown(
        pdf_path,
        page_chunks=True,  # Returns list of per-page dicts
    )

    # Build full text and track page boundaries
    page_texts: list[str] = []
    for page in md_pages:
        text = page.get("text", "") if isinstance(page, dict) else str(page)
        page_texts.append(text)

    full_text = "\n".join(page_texts)

    # Phase 2: Find all CSI section headers
    # Collect all matches, then dedup. Keep the match with the most content
    # after it (body sections have "PART 1", TOC entries don't).
    all_matches: list[dict] = []

    for match in CSI_HEADER_RE.finditer(full_text):
        section_num = normalize_csi(match.group(1))
        raw_title = match.group(2).strip().rstrip(".")

        # Truncate title at any embedded "SECTION XX" (TOC artifact)
        trunc = re.search(r"\s+SECTION\s+\d{2}", raw_title)
        title = raw_title[:trunc.start()].strip() if trunc else raw_title

        all_matches.append({
            "section_number": section_num,
            "title": title,
            "offset": match.start(),
        })

    # Dedup: for each section number, keep the match whose following text
    # looks like actual spec content (contains "PART" or "GENERAL" or "SUBMITTALS")
    best_by_section: dict[str, dict] = {}
    for m in all_matches:
        sn = m["section_number"]
        # Peek at 500 chars after this match to score it
        peek = full_text[m["offset"]:m["offset"] + 500].upper()
        has_body = any(kw in peek for kw in ["PART 1", "GENERAL", "SUBMITTALS", "PRODUCTS", "EXECUTION"])
        m["_has_body"] = has_body

        if sn not in best_by_section:
            best_by_section[sn] = m
        elif has_body and not best_by_section[sn].get("_has_body"):
            # Prefer body matches over TOC matches
            best_by_section[sn] = m

    # Sort by offset to maintain document order
    headers: list[dict] = sorted(best_by_section.values(), key=lambda h: h["offset"])

    if not headers:
        return []

    # Phase 3: Extract text per section and compute page ranges
    sections: list[SpecSection] = []

    # Build cumulative char offsets per page for page-range lookups
    page_offsets: list[int] = []
    cumulative = 0
    for pt in page_texts:
        page_offsets.append(cumulative)
        cumulative += len(pt) + 1  # +1 for the \n join

    def offset_to_page(char_offset: int) -> int:
        """Convert a character offset in full_text to 1-based page number."""
        for i in range(len(page_offsets) - 1, -1, -1):
            if char_offset >= page_offsets[i]:
                return i + 1  # 1-based
        return 1

    for i, hdr in enumerate(headers):
        start = hdr["offset"]
        end = headers[i + 1]["offset"] if i + 1 < len(headers) else len(full_text)

        raw_text = full_text[start:end].strip()
        if len(raw_text) > max_text_per_section:
            raw_text = raw_text[:max_text_per_section]

        page_start = offset_to_page(start)
        page_end = offset_to_page(end - 1) if end > start else page_start

        # Count tables in this section's text (markdown tables have |---|)
        table_count = len(re.findall(r"\|[-:]+\|", raw_text))

        sections.append(SpecSection(
            section_number=hdr["section_number"],
            title=hdr["title"],
            raw_text=raw_text,
            page_start=page_start,
            page_end=page_end,
            table_count=table_count,
            page_count=page_end - page_start + 1,
        ))

    # Phase 4: For sections with tables, try pdfplumber for better extraction
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for section in sections:
                if section.table_count > 0:
                    # Extract tables from the section's page range
                    table_texts: list[str] = []
                    for pg_num in range(
                        section.page_start - 1,
                        min(section.page_end, len(pdf.pages)),
                    ):
                        page = pdf.pages[pg_num]
                        tables = page.extract_tables()
                        for table in tables:
                            rows = []
                            for row in table:
                                cells = [
                                    (c or "").strip()
                                    for c in row
                                    if c is not None
                                ]
                                if any(cells):
                                    rows.append(" | ".join(cells))
                            if rows:
                                table_texts.append("\n".join(rows))

                    if table_texts:
                        # Append pdfplumber table content to raw text
                        extra = "\n\n[TABLES]\n" + "\n\n".join(table_texts)
                        section.raw_text = (
                            section.raw_text + extra
                        )[:max_text_per_section]
    except Exception:
        # pdfplumber fallback is best-effort — don't fail the whole parse
        pass

    return [asdict(s) for s in sections]
