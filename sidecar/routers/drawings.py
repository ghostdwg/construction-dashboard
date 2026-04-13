"""
Drawing document router — /parse/drawings/*

Endpoints:
  POST /parse/drawings/split — Analyze a fullset PDF and group pages by discipline
"""

import os

from fastapi import APIRouter, UploadFile, File, HTTPException

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
