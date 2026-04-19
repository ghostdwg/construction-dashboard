"""
Phase 5E — Superintendent Briefing PDF Generator

Renders a US Letter PDF briefing from assembled project data using
Jinja2 templating and WeasyPrint for PDF output.
"""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


def _date_fmt(value) -> str:
    """Convert ISO datetime string to MM/DD/YY format. Returns '—' for None/empty."""
    if not value:
        return "—"
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.strftime("%m/%d/%y")
    except Exception:
        return str(value)


def generate_superintendent_briefing(data: dict) -> bytes:
    """
    Render the superintendent briefing HTML template and convert to PDF bytes.

    Expected keys in `data`:
      bid            — object with projectName, location
      asOfDate       — ISO datetime string (defaults to now)
      lookaheadDays  — int (default 14)
      schedule       — { thisWeek: [...], overdue: [...], lookahead: [...] }
      submittals     — list of submittal objects
      actionItems    — list of action item objects
      riskFlags      — list of strings
    """
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=False,
    )
    env.filters["date_fmt"] = _date_fmt

    template = env.get_template("superintendent_briefing.html.j2")

    as_of_raw = data.get("asOfDate", datetime.now(timezone.utc).isoformat())
    as_of = datetime.fromisoformat(as_of_raw.replace("Z", "+00:00"))
    generated_at = datetime.now(timezone.utc)

    html_content = template.render(
        bid=data.get("bid", {}),
        as_of_date_fmt=as_of.strftime("%B %d, %Y"),
        generated_at_fmt=generated_at.strftime("%B %d, %Y %I:%M %p UTC"),
        lookahead_days=data.get("lookaheadDays", 14),
        schedule=data.get(
            "schedule",
            {"thisWeek": [], "overdue": [], "lookahead": []},
        ),
        submittals=data.get("submittals", []),
        actionItems=data.get("actionItems", []),
        riskFlags=data.get("riskFlags", []),
    )

    try:
        from weasyprint import HTML
    except OSError as exc:
        raise RuntimeError(
            "WeasyPrint requires GTK system libraries which are not installed. "
            "See https://doc.courtbouillon.org/weasyprint/stable/first_steps.html"
        ) from exc

    return HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
