# Python Sidecar — Document Intelligence (Phase 5A)

FastAPI service for construction document parsing. Runs alongside the Next.js app on port 8001.

## Setup

```bash
cd sidecar
python -m venv .venv

# Windows
.venv\Scripts\pip install -r requirements.txt

# macOS/Linux
.venv/bin/pip install -r requirements.txt
```

## Running

```bash
# From the sidecar directory
.venv/Scripts/uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Or from the project root
npm run dev:sidecar

# Both Next.js + sidecar together
npm run dev:all
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/parse/specs` | Parse a spec book PDF — returns CSI sections |
| POST | `/parse/specs/ai` | Same + Claude AI extraction per section |
| POST | `/parse/specs/async` | Queue large books for background processing |
| GET | `/parse/specs/status/{job_id}` | Check async job progress |
| GET | `/health` | Service status, GPU, memory |
| GET | `/docs` | Interactive API docs (Swagger UI) |

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `SIDECAR_API_KEY` | No | Shared secret with Next.js (dev mode allows all) |
| `ANTHROPIC_API_KEY` | For AI | Required for `/parse/specs/ai` endpoint |

## Architecture

- Bound to `127.0.0.1` only — never exposed externally
- File uploads streamed to temp files (handles 250MB+)
- PyMuPDF4LLM for primary PDF text extraction
- pdfplumber fallback for bordered tables
- Next.js falls back to pdfjs-dist if sidecar is unavailable
