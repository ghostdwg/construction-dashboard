"""
Document parsing router — /parse/*

Endpoints:
  POST /parse/specs          — Extract CSI sections from a spec book PDF
  POST /parse/specs/ai       — Same + Claude AI analysis per section
  POST /parse/specs/async    — Queue large spec books for background processing
  GET  /parse/specs/status/{job_id} — Check async job progress
"""

import os
import uuid
import asyncio
import tempfile
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Query, HTTPException
from fastapi.responses import JSONResponse

from services.spec_parser import parse_spec_pdf
from services.ai_extractor import extract_from_sections, EXTRACTION_TYPES
from services.spec_intelligence import run_spec_intelligence

router = APIRouter()

# ── In-memory job store (MVP — no Redis needed) ─────────────────────────────

_jobs: dict[str, dict] = {}

MAX_FILE_SIZE = 250 * 1024 * 1024  # 250MB


async def _save_upload(upload: UploadFile) -> str:
    """Stream an upload to a temp file and return the path."""
    suffix = os.path.splitext(upload.filename or "upload.pdf")[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    size = 0
    try:
        while True:
            chunk = await upload.read(1024 * 1024)  # 1MB chunks
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                tmp.close()
                os.unlink(tmp.name)
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds maximum size of {MAX_FILE_SIZE // (1024*1024)}MB",
                )
            tmp.write(chunk)
    finally:
        tmp.close()
    return tmp.name


def _cleanup(path: str):
    """Remove a temp file if it exists."""
    try:
        os.unlink(path)
    except OSError:
        pass


# ── POST /parse/specs ────────────────────────────────────────────────────────

@router.post("/specs")
async def parse_specs(
    file: UploadFile = File(...),
    max_text: int = Query(5000, ge=500, le=20000, description="Max chars per section"),
):
    """
    Parse a spec book PDF and extract CSI sections.

    Uses PyMuPDF4LLM for fast text extraction with pdfplumber fallback
    for pages with complex tables.

    Returns array of sections: {section_number, title, raw_text, page_start,
    page_end, table_count, page_count}
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    tmp_path = await _save_upload(file)
    try:
        sections = parse_spec_pdf(tmp_path, max_text_per_section=max_text)
        return {
            "sections": sections,
            "section_count": len(sections),
            "file_name": file.filename,
        }
    except Exception as e:
        raise HTTPException(422, f"PDF parsing failed: {str(e)}")
    finally:
        _cleanup(tmp_path)


# ── POST /parse/specs/ai ────────────────────────────────────────────────────

@router.post("/specs/ai")
async def parse_specs_ai(
    file: UploadFile = File(...),
    extract: Optional[str] = Query(
        None,
        description="Comma-separated extraction types: submittals,warranties,training,testing,closeout,products,performance",
    ),
    max_text: int = Query(5000, ge=500, le=20000),
):
    """
    Parse a spec book PDF, then send each section to Claude for
    structured extraction of submittals, warranties, training,
    testing, closeout, products, and performance criteria.

    Use ?extract=submittals,warranties to limit extraction types
    and save tokens.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(
            503,
            "ANTHROPIC_API_KEY not configured — AI parsing unavailable",
        )

    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    # Determine which extraction types to run
    extract_types = None
    if extract:
        requested = {t.strip().lower() for t in extract.split(",")}
        valid = requested & EXTRACTION_TYPES
        if valid:
            extract_types = valid

    tmp_path = await _save_upload(file)
    try:
        # Phase 1: Parse PDF
        sections = parse_spec_pdf(tmp_path, max_text_per_section=max_text)

        if not sections:
            return {
                "sections": [],
                "section_count": 0,
                "ai_results": {"sections": [], "total_cost_usd": 0},
                "file_name": file.filename,
            }

        # Phase 2: AI extraction
        ai_results = extract_from_sections(sections, extract_types)

        # Merge AI results back into sections
        ai_by_section = {
            r["section_number"]: r["extractions"]
            for r in ai_results["sections"]
        }
        for section in sections:
            section["ai_extractions"] = ai_by_section.get(
                section["section_number"], {}
            )

        response = JSONResponse(
            content={
                "sections": sections,
                "section_count": len(sections),
                "ai_results": {
                    "total_input_tokens": ai_results["total_input_tokens"],
                    "total_output_tokens": ai_results["total_output_tokens"],
                    "total_cost_usd": ai_results["total_cost_usd"],
                },
                "file_name": file.filename,
            }
        )
        # Cost info in headers for easy access
        response.headers["X-Tokens-Used"] = str(
            ai_results["total_input_tokens"] + ai_results["total_output_tokens"]
        )
        response.headers["X-Estimated-Cost"] = f"${ai_results['total_cost_usd']:.4f}"
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"AI parsing failed: {str(e)}")
    finally:
        _cleanup(tmp_path)


# ── POST /parse/specs/async ──────────────────────────────────────────────────

@router.post("/specs/async")
async def parse_specs_async(
    file: UploadFile = File(...),
    extract: Optional[str] = Query(None),
    max_text: int = Query(5000, ge=500, le=20000),
):
    """
    Queue a large spec book for background processing.
    Returns a job_id immediately. Poll /parse/specs/status/{job_id}
    for progress and results.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    tmp_path = await _save_upload(file)

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "total_sections": 0,
        "sections_processed": 0,
        "result": None,
        "error": None,
        "file_name": file.filename,
    }

    # Determine extraction types
    extract_types = None
    if extract:
        requested = {t.strip().lower() for t in extract.split(",")}
        valid = requested & EXTRACTION_TYPES
        if valid:
            extract_types = valid

    # Fire background task
    asyncio.create_task(
        _process_async(job_id, tmp_path, max_text, extract_types)
    )

    return {"job_id": job_id, "status": "processing"}


async def _process_async(
    job_id: str,
    tmp_path: str,
    max_text: int,
    extract_types: set[str] | None,
):
    """Background task for async spec parsing."""
    try:
        # Parse PDF (sync, runs in thread pool)
        loop = asyncio.get_event_loop()
        sections = await loop.run_in_executor(
            None, parse_spec_pdf, tmp_path, max_text
        )

        _jobs[job_id]["total_sections"] = len(sections)

        if extract_types and os.getenv("ANTHROPIC_API_KEY"):
            # AI extraction — process one at a time so we can track progress
            from services.ai_extractor import extract_from_section

            ai_results = []
            total_cost = 0.0

            for i, section in enumerate(sections):
                try:
                    result = await loop.run_in_executor(
                        None, extract_from_section, section, extract_types
                    )
                    section["ai_extractions"] = result.extractions
                    total_cost += result.cost_usd
                    ai_results.append(result)
                except Exception as e:
                    section["ai_extractions"] = {"_error": str(e)}

                _jobs[job_id]["sections_processed"] = i + 1
                _jobs[job_id]["progress"] = round(
                    (i + 1) / len(sections) * 100, 1
                )

            _jobs[job_id]["result"] = {
                "sections": sections,
                "section_count": len(sections),
                "ai_cost_usd": round(total_cost, 4),
            }
        else:
            _jobs[job_id]["result"] = {
                "sections": sections,
                "section_count": len(sections),
            }
            _jobs[job_id]["progress"] = 100
            _jobs[job_id]["sections_processed"] = len(sections)

        _jobs[job_id]["status"] = "complete"

    except Exception as e:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)
    finally:
        _cleanup(tmp_path)


# ── GET /parse/specs/status/{job_id} ─────────────────────────────────────────

@router.get("/specs/status/{job_id}")
async def parse_specs_status(job_id: str):
    """Check the status of an async spec parsing job."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "total_sections": job["total_sections"],
        "sections_processed": job["sections_processed"],
        "file_name": job["file_name"],
    }

    if job["status"] == "complete":
        response["result"] = job["result"]
    elif job["status"] == "error":
        response["error"] = job["error"]

    return response


# ── POST /parse/specs/intelligent ────────────────────────────────────────────

@router.post("/specs/intelligent")
async def parse_specs_intelligent(file: UploadFile = File(...)):
    """
    AI-first spec intelligence — async. Returns a job_id immediately.
    Poll /parse/specs/intelligent/status/{job_id} for progress and results.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    tmp_path = await _save_upload(file)

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "total_sections": 0,
        "sections_processed": 0,
        "current_section": None,
        "result": None,
        "error": None,
        "file_name": file.filename,
        "type": "intelligent",
    }

    asyncio.create_task(_run_intelligent(job_id, tmp_path))

    return {"job_id": job_id, "status": "processing"}


async def _run_intelligent(job_id: str, tmp_path: str):
    """Background task for intelligent spec analysis with progress tracking."""
    try:
        loop = asyncio.get_event_loop()

        def on_progress(current: int, total: int, csi: str):
            _jobs[job_id]["sections_processed"] = current
            _jobs[job_id]["total_sections"] = total
            _jobs[job_id]["current_section"] = csi
            _jobs[job_id]["progress"] = round(current / total * 100, 1) if total > 0 else 0

        result = await loop.run_in_executor(
            None,
            lambda: run_spec_intelligence(tmp_path, analyze=True, on_progress=on_progress),
        )

        _jobs[job_id]["result"] = result
        _jobs[job_id]["status"] = "complete"
        _jobs[job_id]["progress"] = 100

    except Exception as e:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)
    finally:
        _cleanup(tmp_path)


@router.get("/specs/intelligent/status/{job_id}")
async def intelligent_status(job_id: str):
    """Poll progress of an intelligent spec analysis job."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "total_sections": job["total_sections"],
        "sections_processed": job["sections_processed"],
        "current_section": job.get("current_section"),
        "file_name": job["file_name"],
    }

    if job["status"] == "complete":
        response["result"] = job["result"]
    elif job["status"] == "error":
        response["error"] = job["error"]

    return response
