"""
Drawing document router — /parse/drawings/*

Endpoints:
  POST /parse/drawings/split   — Analyze a fullset PDF and group pages by discipline
  POST /parse/drawings/analyze — Claude Vision analysis (tier 1/2/3)
"""

import os

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from services.drawing_splitter import split_drawing_set

router = APIRouter()

MAX_FILE_SIZE = 250 * 1024 * 1024  # 250MB


async def _save_upload(upload: UploadFile) -> str:
    """Stream an upload to a temp file and return the path."""
    import tempfile
    suffix = os.path.splitext(upload.filename or "upload.pdf")[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    size = 0
    try:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                tmp.close()
                os.unlink(tmp.name)
                raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE // (1024*1024)}MB")
            tmp.write(chunk)
    finally:
        tmp.close()
    return tmp.name


class AnalyzeRequest(BaseModel):
    file_path: str
    tier: int
    model: str


@router.post("/drawings/analyze")
async def analyze_drawing(body: AnalyzeRequest):
    """
    Run Claude Vision analysis on a drawing PDF.

    file_path — absolute path to the PDF on the server filesystem
    tier      — 1 (Quick Scan) | 2 (Scope Brief) | 3 (Full Intelligence)
    model     — haiku | sonnet | opus
    """
    from services.drawing_intelligence import analyze_drawings

    if not os.path.exists(body.file_path):
        raise HTTPException(404, f"File not found: {body.file_path}")
    if body.tier not in (1, 2, 3):
        raise HTTPException(400, "tier must be 1, 2, or 3")
    if body.model not in ("haiku", "sonnet", "opus"):
        raise HTTPException(400, "model must be haiku, sonnet, or opus")

    try:
        return analyze_drawings(body.file_path, body.tier, body.model)
    except Exception as e:
        raise HTTPException(422, f"Analysis failed: {str(e)}")


@router.post("/drawings/split")
async def split_fullset(file: UploadFile = File(...)):
    """
    Analyze a fullset drawing PDF and detect discipline groups.

    Reads each page's text, extracts sheet number prefixes (A, S, M, P, E, C, FP),
    and groups pages by discipline. Returns the breakdown for user confirmation
    before committing per-discipline uploads.

    Returns:
        total_pages, disciplines (with page counts and sheet numbers),
        unidentified_pages, page_details
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    tmp_path = await _save_upload(file)
    try:
        result = split_drawing_set(tmp_path)
        return result
    except Exception as e:
        raise HTTPException(422, f"Drawing analysis failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
