"""
Module OPS6 (Phase 2) — consultant-stream PDF rendering.

Renders the cumulative consultant-stream report from STRUCTURED data the
Next.js app assembles (this service never touches the DB and never reads a
raw PDF). Every safety property the meetings precedent lacks is built
here, new:

  * autoescape=True — observation/response text is USER-TYPED; it renders
    as inert data, never as markup.
  * The WeasyPrint render runs in a SUBPROCESS with a hard deadline —
    WeasyPrint cannot be cancelled in-thread; killing the child is the
    only honest kill switch, it keeps the event loop free, and it
    contains OOM to the child process.
  * Mirrored payload caps (the app checks first; this is defense in
    depth): MAX_OBSERVATIONS and MAX_PAYLOAD_BYTES.

Pure helpers (validate_stream_payload, summarize_stream) are import-safe
on any host — jinja2/weasyprint load lazily inside the render path only.
"""

from __future__ import annotations

import json
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FuturesTimeout
from pathlib import Path
from typing import Any, Optional

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

MAX_OBSERVATIONS = 500
MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
RENDER_TIMEOUT_SECONDS = 90

SEVERITY_NOTE = "structured-data renderer; no provider call exists on this path"


# ── Pure helpers ──────────────────────────────────────────────────────────────

def validate_stream_payload(payload: dict[str, Any]) -> Optional[str]:
    """Mirrored defensive cap/shape check. Returns an error string or None."""
    if not isinstance(payload, dict):
        return "payload must be an object"
    reports = payload.get("reports")
    if not isinstance(reports, list):
        return "payload.reports must be a list"
    obs_count = sum(len(r.get("observations") or []) for r in reports if isinstance(r, dict))
    if obs_count == 0:
        return "nothing to render — zero observations after filters"
    if obs_count > MAX_OBSERVATIONS:
        return f"payload has {obs_count} observations; cap is {MAX_OBSERVATIONS}"
    size = len(json.dumps(payload))
    if size > MAX_PAYLOAD_BYTES:
        return f"payload is {size} bytes; cap is {MAX_PAYLOAD_BYTES}"
    return None


def summarize_stream(payload: dict[str, Any]) -> dict[str, int]:
    """Summary-page totals, computed here so the template stays logic-free."""
    totals = {
        "observations": 0,
        "open": 0,
        "acceptedNew": 0,
        "acceptedLinked": 0,
        "dismissed": 0,
        "responded": 0,
        "disposedApprove": 0,
        "disposedReject": 0,
        "disposedDefer": 0,
        "disposedVoid": 0,
    }
    responded_items: set[int] = set()
    for report in payload.get("reports") or []:
        for obs in report.get("observations") or []:
            totals["observations"] += 1
            state = obs.get("state")
            if state == "ENTERED":
                totals["open"] += 1
            elif state == "ACCEPTED_NEW_ITEM":
                totals["acceptedNew"] += 1
            elif state == "ACCEPTED_LINKED_ITEM":
                totals["acceptedLinked"] += 1
            elif state == "DISMISSED":
                totals["dismissed"] += 1
            item = obs.get("registerItem") or {}
            if item.get("formalResponse") and isinstance(item.get("id"), int):
                responded_items.add(item["id"])
            dispositions = obs.get("dispositions") or []
            if dispositions:
                current = dispositions[-1].get("dispositionType")
                key = {
                    "APPROVE": "disposedApprove",
                    "REJECT": "disposedReject",
                    "DEFER": "disposedDefer",
                    "VOID": "disposedVoid",
                }.get(str(current))
                if key:
                    totals[key] += 1
    totals["responded"] = len(responded_items)
    return totals


# ── Render (subprocess target must be module-level for pickling) ─────────────

def _render_html_to_pdf(html: str) -> bytes:
    from weasyprint import HTML  # lazy — only inside the child process

    return HTML(string=html).write_pdf()


def build_html(payload: dict[str, Any]) -> str:
    """Jinja2 render with autoescape ON. Import-safe lazily (jinja2 is a
    sidecar dependency; tests exercising only the pure helpers above never
    reach here)."""
    from jinja2 import Environment, FileSystemLoader, select_autoescape  # lazy

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(default=True, default_for_string=True),
    )

    def date_fmt(value: Any) -> str:
        if not value:
            return "—"
        s = str(value)
        return s.split("T")[0] if "T" in s else s

    env.filters["date_fmt"] = date_fmt
    template = env.get_template("consultant_stream.html.j2")
    return template.render(payload=payload, totals=summarize_stream(payload))


# One-render-at-a-time per worker process: a fresh single-worker pool per
# call keeps the semantics simple (the router holds an asyncio semaphore of
# 1, so at most one pool exists per uvicorn worker at any moment).
def render_stream_pdf(payload: dict[str, Any]) -> tuple[bytes, int]:
    """Render, bounded by RENDER_TIMEOUT_SECONDS via subprocess kill.
    Returns (pdf_bytes, elapsed_pages_estimate_unused). Raises
    TimeoutError on deadline, ValueError on invalid payload."""
    error = validate_stream_payload(payload)
    if error:
        raise ValueError(error)

    html = build_html(payload)

    executor = ProcessPoolExecutor(max_workers=1)
    try:
        future = executor.submit(_render_html_to_pdf, html)
        try:
            pdf = future.result(timeout=RENDER_TIMEOUT_SECONDS)
        except FuturesTimeout as exc:
            # Kill the child outright — WeasyPrint has no cooperative cancel.
            for proc in getattr(executor, "_processes", {}).values():
                proc.kill()
            raise TimeoutError(
                f"render exceeded {RENDER_TIMEOUT_SECONDS}s and was killed"
            ) from exc
        return pdf, 0
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
