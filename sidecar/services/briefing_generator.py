"""
Phase 5E — Superintendent Initial Assessment PDF Generator

Renders a US Letter PDF from assembled project data using Jinja2 + WeasyPrint.
Document is framed as a one-time onboarding brief for the superintendent,
not a recurring status report.
"""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


def _date_fmt(value) -> str:
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
    Render the superintendent initial assessment and convert to PDF bytes.

    Expected keys in `data`:
      bid           — { projectName, location }
      asOfDate      — ISO datetime string
      lookaheadDays — int
      riskFlags     — list[str]  (from intelligence brief)
      specFlags     — list[{ csiNumber, csiTitle, flag, sectionSeverity }]
      inspections   — list[{ type, activity, standard, frequency, timing, who,
                             acceptance_criteria, csiNumber, csiTitle, sectionSeverity }]
      warranties    — list[{ duration, type, scope, csiNumber, csiTitle }]
      trainings     — list[{ audience, topic, requirement, duration, timing,
                             csiNumber, csiTitle }]
      closeouts     — list[{ type, description, quantity, timing,
                             csiNumber, csiTitle, sectionSeverity }]
      schedule      — { thisWeek, overdue, lookahead }
      submittals    — list of submittal objects
      actionItems   — list of action item objects
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
        lookahead_days=data.get("lookaheadDays", 30),
        risk_flags=data.get("riskFlags", []),
        spec_flags=data.get("specFlags", []),
        decisions=data.get("decisions", []),
        inspections=data.get("inspections", []),
        warranties=data.get("warranties", []),
        trainings=data.get("trainings", []),
        closeouts=data.get("closeouts", []),
        schedule=data.get("schedule", {"thisWeek": [], "overdue": [], "lookahead": []}),
        submittals=data.get("submittals", []),
        actionItems=data.get("actionItems", []),
    )

    try:
        from weasyprint import HTML
    except OSError as exc:
        raise RuntimeError(
            "WeasyPrint requires GTK system libraries which are not installed. "
            "See https://doc.courtbouillon.org/weasyprint/stable/first_steps.html"
        ) from exc

    return HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf()
