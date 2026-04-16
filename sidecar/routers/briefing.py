"""
Phase 5E — Superintendent Briefing Router

Endpoint:
  POST /briefing/generate  — Accept JSON payload, generate PDF, return bytes
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from services.briefing_generator import generate_superintendent_briefing

router = APIRouter()


@router.post("/briefing/generate")
async def generate_briefing(request: Request):
    """
    Generate a superintendent briefing PDF from assembled project data.

    Accepts a JSON body with:
      bid, asOfDate, lookaheadDays, schedule, submittals, actionItems, riskFlags

    Returns a PDF file as application/pdf.
    """
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}")

    try:
        pdf_bytes = generate_superintendent_briefing(data)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {exc}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
    )
