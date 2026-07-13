"""
Module OPS6 (Phase 2) — report rendering router.

POST /reports/consultant-stream-pdf — structured observation data in, PDF
bytes out. NO provider call exists on this path (pure rendering); no API
key is accepted or needed. Concurrency: an asyncio semaphore of 1 per
uvicorn worker (2 workers → at most 2 renders platform-wide); a saturated
worker answers 429 immediately instead of queueing. The render itself
runs in a subprocess with a hard 90s kill (see consultant_stream_pdf.py).
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response as FastAPIResponse

from services.consultant_stream_pdf import (
    MAX_OBSERVATIONS,
    render_stream_pdf,
    validate_stream_payload,
)

router = APIRouter()

_render_slot = asyncio.Semaphore(1)


@router.post("/consultant-stream-pdf")
async def consultant_stream_pdf(request: Request):
    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Invalid JSON body: {exc}")

    error = validate_stream_payload(payload)
    if error:
        status = 413 if "cap is" in error else 400
        raise HTTPException(status, error)

    if _render_slot.locked():
        raise HTTPException(
            429, "A stream export is already rendering — try again in a minute"
        )

    async with _render_slot:
        loop = asyncio.get_event_loop()
        try:
            pdf, _ = await loop.run_in_executor(None, render_stream_pdf, payload)
        except TimeoutError as exc:
            raise HTTPException(504, str(exc))
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except ImportError:
            raise HTTPException(
                501, "WeasyPrint is not installed. Run: pip install weasyprint"
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"PDF generation failed: {str(exc)[:300]}")

    return FastAPIResponse(
        content=pdf,
        media_type="application/pdf",
        headers={"X-Max-Observations": str(MAX_OBSERVATIONS)},
    )
