"""
Drawing set splitter — groups pages from a fullset PDF by discipline prefix.

Reads each page's text (fast OCR-free path via PyMuPDF), extracts the sheet
number prefix (A, S, M, P, E, C, FP), and groups pages by discipline.

For pages where text extraction fails (scanned drawings), falls back to
reading the title block region in the bottom-right corner.
"""

import re
from dataclasses import dataclass, field

import pymupdf  # PyMuPDF


# Sheet number patterns — prefix + number
# Matches: A-101, A101, A1.01, S-201, FP-001, C1.0, etc.
SHEET_NUM_RE = re.compile(
    r"\b(FP|A|S|M|P|E|C|L|I|T|G|D)-?(\d+(?:[.\-]\d+)?)\b"
)

# Map sheet prefix letters to discipline names
PREFIX_TO_DISCIPLINE: dict[str, str] = {
    "A": "ARCH",
    "S": "STRUCT",
    "M": "MECH",
    "P": "PLUMB",
    "E": "ELEC",
    "C": "CIVIL",
    "FP": "FP",
    "L": "CIVIL",       # Landscape → Civil
    "I": "INTERIOR",
    "T": "GENERAL",      # Title sheets
    "G": "GENERAL",      # General sheets
    "D": "GENERAL",      # Detail sheets
}

DISCIPLINE_LABELS: dict[str, str] = {
    "ARCH": "Architectural",
    "STRUCT": "Structural",
    "MECH": "Mechanical",
    "PLUMB": "Plumbing",
    "ELEC": "Electrical",
    "CIVIL": "Civil",
    "FP": "Fire Protection",
    "INTERIOR": "Interior",
    "GENERAL": "General",
    "UNKNOWN": "Unknown",
}


@dataclass
class PageInfo:
    page_number: int        # 1-based
    sheet_number: str | None  # e.g., "A-101"
    prefix: str | None      # e.g., "A"
    discipline: str         # e.g., "ARCH"
    title: str | None       # Sheet title if found


@dataclass
class DisciplineGroup:
    discipline: str
    label: str
    page_count: int
    pages: list[int]        # 1-based page numbers
    sheet_numbers: list[str]
    first_page: int
    last_page: int


def _extract_sheet_number_from_page(page: pymupdf.Page) -> tuple[str | None, str | None]:
    """
    Extract the sheet number from a page. Tries full-page text first,
    then focuses on the title block region (bottom-right quadrant).

    Returns (sheet_number, prefix) or (None, None).
    """
    # Try full-page text extraction
    text = page.get_text("text")

    if text.strip():
        # Look for sheet numbers in the text
        matches = list(SHEET_NUM_RE.finditer(text))
        if matches:
            # Prefer matches near the bottom of the text (title block area)
            best = matches[-1]
            prefix = best.group(1)
            number = best.group(2)
            sheet_num = f"{prefix}-{number}"
            return sheet_num, prefix

    # Fallback: try extracting text from the title block region only
    # Title block is typically in the bottom-right corner
    rect = page.rect
    title_block_rect = pymupdf.Rect(
        rect.width * 0.6,   # Right 40%
        rect.height * 0.8,  # Bottom 20%
        rect.width,
        rect.height,
    )
    tb_text = page.get_text("text", clip=title_block_rect)

    if tb_text.strip():
        matches = list(SHEET_NUM_RE.finditer(tb_text))
        if matches:
            best = matches[0]
            prefix = best.group(1)
            number = best.group(2)
            sheet_num = f"{prefix}-{number}"
            return sheet_num, prefix

    return None, None


def split_drawing_set(pdf_path: str) -> dict:
    """
    Split a fullset drawing PDF into discipline groups.

    Returns:
        {
            "total_pages": int,
            "disciplines": [
                {
                    "discipline": "ARCH",
                    "label": "Architectural",
                    "page_count": 32,
                    "pages": [1, 2, 3, ...],
                    "sheet_numbers": ["A-101", "A-102", ...],
                    "first_page": 1,
                    "last_page": 32
                },
                ...
            ],
            "unidentified_pages": [page_numbers...],
            "page_details": [
                {"page": 1, "sheet_number": "A-101", "discipline": "ARCH"},
                ...
            ]
        }
    """
    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)

    pages: list[PageInfo] = []
    for i in range(total_pages):
        page = doc[i]
        sheet_num, prefix = _extract_sheet_number_from_page(page)

        discipline = "UNKNOWN"
        if prefix:
            discipline = PREFIX_TO_DISCIPLINE.get(prefix, "UNKNOWN")

        pages.append(PageInfo(
            page_number=i + 1,
            sheet_number=sheet_num,
            prefix=prefix,
            discipline=discipline,
            title=None,
        ))

    doc.close()

    # Group by discipline
    groups: dict[str, DisciplineGroup] = {}
    unidentified: list[int] = []

    for p in pages:
        if p.discipline == "UNKNOWN":
            unidentified.append(p.page_number)
            continue

        if p.discipline not in groups:
            groups[p.discipline] = DisciplineGroup(
                discipline=p.discipline,
                label=DISCIPLINE_LABELS.get(p.discipline, p.discipline),
                page_count=0,
                pages=[],
                sheet_numbers=[],
                first_page=p.page_number,
                last_page=p.page_number,
            )

        g = groups[p.discipline]
        g.pages.append(p.page_number)
        g.page_count += 1
        if p.sheet_number:
            g.sheet_numbers.append(p.sheet_number)
        g.last_page = max(g.last_page, p.page_number)
        g.first_page = min(g.first_page, p.page_number)

    # Sort disciplines by first page appearance
    sorted_disciplines = sorted(groups.values(), key=lambda g: g.first_page)

    return {
        "total_pages": total_pages,
        "disciplines": [
            {
                "discipline": g.discipline,
                "label": g.label,
                "page_count": g.page_count,
                "pages": g.pages,
                "sheet_numbers": sorted(set(g.sheet_numbers)),
                "first_page": g.first_page,
                "last_page": g.last_page,
            }
            for g in sorted_disciplines
        ],
        "unidentified_pages": unidentified,
        "page_details": [
            {
                "page": p.page_number,
                "sheet_number": p.sheet_number,
                "discipline": p.discipline,
            }
            for p in pages
        ],
    }
