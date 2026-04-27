"""
Meeting Minutes PDF Generator

Renders a US Letter PDF from meeting analysis data using Jinja2 + WeasyPrint.
"""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

PRIORITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
STATUS_ORDER   = {"OPEN": 0, "IN_PROGRESS": 1, "DEFERRED": 2, "CLOSED": 3}


def _date_fmt(value) -> str:
    if not value:
        return "—"
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.strftime("%m/%d/%y")
    except Exception:
        return str(value)


def _meeting_date_fmt(value) -> str:
    if not value:
        return "—"
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.strftime("%B %d, %Y")
    except Exception:
        return str(value)


def generate_meeting_export(data: dict) -> bytes:
    """
    Generate a meeting minutes / action item PDF.

    Expected keys in `data`:
      projectName     — string
      projectLocation — string | None
      meetingTitle    — string
      meetingDate     — ISO datetime string
      meetingType     — string (OAC, SAFETY, etc.)
      meetingLocation — string | None
      summary         — string | None
      participants    — list[{ name, role, company, isGcTeam }]
      keyDecisions    — list[string]
      actionItems     — list[{ description, assignedToName, dueDate, priority, status, isGcTask }]
      openIssues      — list[{ text, reason, carriedFrom }]
      redFlags        — list[{ tag, description }]
    """
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=False,
    )
    env.filters["date_fmt"]         = _date_fmt
    env.filters["meeting_date_fmt"] = _meeting_date_fmt

    template = env.get_template("meeting_export.html.j2")

    generated_at = datetime.now(timezone.utc)

    # Sort action items: priority first, then status (open before closed)
    action_items = sorted(
        data.get("actionItems", []),
        key=lambda a: (
            PRIORITY_ORDER.get(a.get("priority", "MEDIUM"), 2),
            STATUS_ORDER.get(a.get("status", "OPEN"), 0),
        ),
    )

    html_content = template.render(
        project_name=data.get("projectName", ""),
        project_location=data.get("projectLocation"),
        meeting_title=data.get("meetingTitle", "Meeting Minutes"),
        meeting_date=data.get("meetingDate"),
        meeting_type=data.get("meetingType", "GENERAL"),
        meeting_location=data.get("meetingLocation"),
        summary=data.get("summary"),
        participants=data.get("participants", []),
        key_decisions=data.get("keyDecisions", []),
        action_items=action_items,
        open_issues=data.get("openIssues", []),
        red_flags=data.get("redFlags", []),
        generated_at_fmt=generated_at.strftime("%B %d, %Y %I:%M %p UTC"),
    )

    try:
        from weasyprint import HTML
        return HTML(string=html_content).write_pdf()
    except ImportError:
        raise RuntimeError(
            "WeasyPrint is not installed. Run: pip install weasyprint"
        )
