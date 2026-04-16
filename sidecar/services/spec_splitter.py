"""
Spec Book Splitter — extracts each CSI section as a standalone PDF.

Uses PyMuPDF to:
  1. Scan every page for CSI section headers at the top of the page
  2. Detect section boundaries using "SECTION XX XX XX" and "END OF SECTION"
  3. Split the PDF by page ranges
  4. Save each section as a separate PDF with a clean filename

This replicates Procore's spec book architecture: one PDF per section,
each downloadable, linkable, and sendable as a complete document to AI.
"""

import re
import os
from pathlib import Path

import pymupdf


# Matches multiple CSI section header formats seen in real specs:
#   "SECTION 03 30 00 - CAST IN PLACE CONCRETE"      (standard MasterFormat 2004)
#   "SECTION 03 3000 CAST IN PLACE CONCRETE"          (compressed)
#   "SECTION 06-010 - ROUGH CARPENTRY"                (KCG internal: XX-NNN)
#   "SECTION 060010 ROUGH CARPENTRY"                  (no separators)
SECTION_HEADER_RE = re.compile(
    r"SECTION\s+"
    r"(?:"
        r"(\d{2})\s*(\d{2})\s*(\d{2,4})(?:\.\d+)?"   # standard: groups 1,2,3
        r"|"
        r"(\d{2})[-–—](\d{3,4})"                       # KCG internal: groups 4,5
    r")"
    r"(?:\s*[-–—]\s*|\s+)"
    r"([A-Z][A-Z0-9 ,&()\'/.:\-]{2,80})",
    re.IGNORECASE,
)

# End-of-section marker
END_SECTION_RE = re.compile(
    r"END\s+OF\s+SECTION(?:\s+\d{2}\s*\d{2}\s*\d{2,4})?",
    re.IGNORECASE,
)


def _normalize_csi_standard(g1: str, g2: str, g3: str) -> str:
    """Normalize standard 'SECTION XX XX XX' format groups to 'DD DD DD'."""
    if len(g3) == 4:
        return f"{g1} {g2} {g3[:2]}"  # "0000" → "00"
    return f"{g1} {g2} {g3}"


def _normalize_csi_kcg(div: str, sub: str) -> str:
    """
    Normalize KCG internal 'XX-NNN' format → 'DD DD 00'.
    Examples: '06-010' → '06 10 00', '07-012' → '07 12 00', '07-040' → '07 40 00'.
    """
    # Pad sub to at least 2 digits in the middle slot
    if len(sub) == 3:
        # "010" → middle "10", trailing "00"  (drop leading zero only if 3 digits)
        middle = sub[:2]
        trailing = "00"
    elif len(sub) == 4:
        middle = sub[:2]
        trailing = sub[2:]
    else:
        middle = sub.zfill(2)
        trailing = "00"
    return f"{div} {middle} {trailing}"


def _filename_safe(title: str) -> str:
    """Convert a section title to a filesystem-safe filename component."""
    safe = re.sub(r"[^\w\s-]", "", title).strip()
    safe = re.sub(r"[\s]+", "_", safe)
    return safe[:60].lower()


def _get_page_header_text(page: pymupdf.Page) -> str:
    """Get text from the top 35% of a page — where section headers appear."""
    rect = page.rect
    header_rect = pymupdf.Rect(0, 0, rect.width, rect.height * 0.35)
    return page.get_text("text", clip=header_rect)


SECTION_BODY_KEYWORDS = (
    "PART 1", "PART 2", "PART 3",
    "GENERAL", "SUBMITTALS", "PRODUCTS", "EXECUTION",
    "SUMMARY", "SCOPE", "REFERENCES", "QUALITY ASSURANCE",
    "DELIVERY", "WARRANTY", "MATERIALS", "MANUFACTURERS",
)


def _is_section_start(
    doc: pymupdf.Document, page_num: int
) -> tuple[str, str] | None:
    """
    Check if a page is the START of a new section (not TOC).
    Returns (csi, title) if yes, None if no.

    A real section start has:
      - SECTION header in the top portion of the page
      - One of the body keywords somewhere on this page OR the next 2 pages
        (some specs put "PART 1 - GENERAL" on page 2)
    """
    page = doc[page_num]
    header_text = _get_page_header_text(page)
    match = SECTION_HEADER_RE.search(header_text)
    if not match:
        return None

    # Verify it's a real section by checking up to 3 pages worth of body text
    # — many specs put "PART 1 - GENERAL" on the page after the section header
    end_check = min(page_num + 3, len(doc))
    combined = ""
    for pn in range(page_num, end_check):
        combined += doc[pn].get_text("text").upper()
    if not any(kw in combined for kw in SECTION_BODY_KEYWORDS):
        return None

    # Either standard format (groups 1,2,3) or KCG format (groups 4,5) matched
    if match.group(1):
        csi = _normalize_csi_standard(match.group(1), match.group(2), match.group(3))
    else:
        csi = _normalize_csi_kcg(match.group(4), match.group(5))
    title = match.group(6).strip().rstrip(".")

    # Clean trailing noise from title
    title_clean_patterns = [
        r"\s+PART\s+\d.*$",
        r"\s+SECTION\s+\d.*$",
        r"\s+\d+\.\d+.*$",
    ]
    for pat in title_clean_patterns:
        title = re.sub(pat, "", title, flags=re.IGNORECASE)

    return csi, title.strip()


def split_spec_book(pdf_path: str, output_dir: str) -> list[dict]:
    """
    Split a spec book PDF into per-section PDFs.

    Args:
        pdf_path: Source spec book PDF
        output_dir: Directory to save per-section PDFs

    Returns:
        List of dicts: {csi, title, pdf_path, page_start, page_end, page_count, text}
    """
    os.makedirs(output_dir, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)

    # Phase 1: Scan every page to find section starts
    section_starts: list[dict] = []
    for page_num in range(total_pages):
        result = _is_section_start(doc, page_num)
        if result:
            csi, title = result
            # Dedup — if same CSI appears twice as a start, keep the first body occurrence
            if any(s["csi"] == csi for s in section_starts):
                continue
            section_starts.append({
                "csi": csi,
                "title": title,
                "page_start": page_num,  # 0-indexed internally
            })

    if not section_starts:
        doc.close()
        return []

    # Phase 2: Determine end page for each section
    # Section N ends at (start of section N+1) - 1, OR at last "END OF SECTION" page
    for i, sec in enumerate(section_starts):
        # Default: end is one page before the next section starts
        if i + 1 < len(section_starts):
            sec["page_end"] = section_starts[i + 1]["page_start"] - 1
        else:
            sec["page_end"] = total_pages - 1

        # Try to find explicit "END OF SECTION" — more reliable
        # Scan within the section's page range
        for pg_num in range(sec["page_start"], sec["page_end"] + 1):
            page_text = doc[pg_num].get_text("text")
            if END_SECTION_RE.search(page_text):
                sec["page_end"] = pg_num
                break

    # Phase 3: Extract each section as a new PDF + text
    results = []
    for sec in section_starts:
        csi_compact = sec["csi"].replace(" ", "_")
        title_safe = _filename_safe(sec["title"])
        filename = f"{csi_compact}_{title_safe}.pdf"
        out_path = os.path.join(output_dir, filename)

        # Create new PDF with just this section's pages
        new_doc = pymupdf.open()
        new_doc.insert_pdf(
            doc,
            from_page=sec["page_start"],
            to_page=sec["page_end"],
        )
        new_doc.save(out_path, garbage=4, deflate=True)
        new_doc.close()

        # Extract full text from the section for AI analysis
        section_text = ""
        for pg_num in range(sec["page_start"], sec["page_end"] + 1):
            section_text += doc[pg_num].get_text("text") + "\n"

        results.append({
            "csi": sec["csi"],
            "title": sec["title"],
            "pdf_path": out_path,
            "filename": filename,
            "page_start": sec["page_start"] + 1,  # 1-indexed for display
            "page_end": sec["page_end"] + 1,
            "page_count": sec["page_end"] - sec["page_start"] + 1,
            "text": section_text.strip(),
        })

    doc.close()
    return results
