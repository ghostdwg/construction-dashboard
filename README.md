# Construction Dashboard — Construction Intelligence Platform

Forked from bid-dashboard. Extends the 35-module preconstruction platform with Python-powered document intelligence, AI spec extraction, interactive scheduling, meeting analysis, and superintendent field briefings.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Server Components, Turbopack) |
| UI | React 19, Tailwind CSS v4, light/dark theme |
| Language | TypeScript 5 (strict mode) |
| Database | Prisma 7 + SQLite (libsql adapter) |
| AI | Anthropic Claude API (brief, gap analysis, addendum delta, spec intelligence) |
| Auth | Auth.js v5 (email/password, JWT sessions) |
| Email | Resend API + Generic SMTP (provider-abstracted) |
| Export | ExcelJS (XLSX), CSV (MSP, Procore, Outlook, Google, vCard) |
| Sidecar | Python 3.12 + FastAPI (port 8001) — PyMuPDF spec splitting, tiered Claude analysis |

## Inherited from bid-dashboard (35 modules)

The full preconstruction platform ships with this repo: job intake, scope intelligence, bid leveling, procurement, RFQ distribution, go/no-go gate, bid assembly, post-award handoff (H1–H8), settings hub, auth wall, and theme toggle. All 35 modules are COMPLETE.

See [ROADMAP.md Section 4 — Completed Modules](docs/architecture/ROADMAP.md) for the full inventory.

## Phase 5 — Construction Intelligence

| Sub-Phase | Status | Description |
|-----------|--------|-------------|
| **5A** | IN PROGRESS | Python FastAPI sidecar — spec book splitting, per-section AI analysis, webhook-based job completion |
| **5B** | QUEUED | Spec intelligence registers — submittals, warranties, training, closeout, testing |
| **5C** | QUEUED | Interactive Gantt (DHTMLX) with CPM, 4 dep types, weather calendar, MSP/P6 export |
| **5D** | QUEUED | Meeting intelligence — transcription, Claude action-item extraction |
| **5E** | QUEUED | Superintendent field briefing — auto-assembled PDF from all registers |
| **5F** | STRETCH | Drawing OCR, symbol detection, quantity takeoff |
| **5G** | QUEUED | Submittal Intelligence Layer — bridges 5A AI extractions into H3, schedule-tied due dates, distribution + workflow templates |

## Quick Start

### First-time setup

```bash
git clone https://github.com/ghostdwg/construction-dashboard.git
cd construction-dashboard
npm install

# Python sidecar setup (required for spec splitting + AI analysis)
cd sidecar
python -m venv .venv
.venv\Scripts\activate       # Windows (PowerShell: .\.venv\Scripts\Activate.ps1)
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
cd ..

# Env
cp .env.example .env.local   # or copy manually — see Environment Variables below
npx prisma migrate dev
```

### Daily dev loop

Run **both** servers — Next.js (port 3001) and the Python sidecar (port 8001):

```bash
npm run dev:all
```

Or run them separately in two terminals:

```bash
npm run dev          # Next.js only
npm run dev:sidecar  # Python sidecar only
```

Open [http://localhost:3001](http://localhost:3001).

Verify the sidecar:
```bash
curl http://127.0.0.1:8001/health
```

## Environment Variables

Put these in `.env.local` at the repo root:

```bash
# AI
ANTHROPIC_API_KEY=sk-ant-...

# Auth.js v5
AUTH_SECRET=...                  # generate: openssl rand -base64 32
AUTH_DISABLED=true               # skip login for solo dev

# Feature flags
BRIEF_STUB_MODE=false
GAP_STUB_MODE=false
ADDENDUM_STUB_MODE=true

# Python sidecar
SIDECAR_URL=http://127.0.0.1:8001
# SIDECAR_API_KEY=optional-key   # leave unset for dev

# Sidecar → Next.js webhook (so AI jobs persist when the browser is closed)
APP_URL=http://127.0.0.1:3001
SIDECAR_CALLBACK_TOKEN=dev-callback-token-change-in-prod
```

The sidecar reads `ANTHROPIC_API_KEY` from the same `.env.local` at the repo root.

## Spec Book Workflow (Phase 5A)

The Documents tab on any bid supports a three-step spec pipeline:

1. **Upload** — drop a spec book PDF (up to ~250 MB). Next.js streams it to `uploads/specbooks/{bidId}/`.
2. **Split into Sections** — clicks the green button. The sidecar scans the PDF, finds every CSI section header (supports both `03 30 00` MasterFormat and `03-300` KCG internal formats), and extracts each as a standalone per-section PDF under `uploads/specbooks/{bidId}/sections/`. Free — no AI.
3. **Run AI Analysis** — clicks the purple button. Each per-section PDF is analyzed by Claude with tiered model routing:
    - **Sonnet** for complex/high-risk divisions: 03, 05, 07, 08, 14, 21, 22, 23, 26, 27, 28
    - **Haiku** for everything else
    - Per-section output: severity, pain points, gaps, submittals, warranty terms, products, flags

Analysis runs in the background. If you close the browser mid-job, the sidecar continues and posts results back via webhook when done — data is always persisted.

## CSI MasterFormat Reference (Module CSI1)

The `CsiMasterformat` table holds ~3,995 Level 3 section codes from
MasterFormat 2020 — used for validating and enriching AI-extracted spec
section titles.

**To update when CSI publishes a new edition:**

1. Drop the new XLSX into `prisma/seed/data/` (replace `CSI_MasterFormat_2020.xlsx`)
2. Parse it to JSON:
   ```bash
   sidecar/.venv/Scripts/python.exe prisma/seed/parse_csi_masterformat.py
   ```
3. Upsert into the database:
   ```bash
   npx tsx prisma/seed/seedCsiMasterformat.ts
   ```

The seeder is idempotent — re-running only updates changed titles; existing
CSI code references elsewhere in the database stay intact.

## Architecture

Full architecture plan, three-stream build sequence, cost projections, and sync protocol: [ROADMAP.md](docs/architecture/ROADMAP.md)

Current delivered state: [CURRENT_STATE.md](docs/architecture/CURRENT_STATE.md)

## Deployment

Tested for single-estimator workload on a Hetzner CPX31 VPS (4 vCPU / 8 GB / 160 GB) — runs Next.js + sidecar + SQLite on one box. For production:
- Set `APP_URL=https://yourdomain.com`
- Generate a real `SIDECAR_CALLBACK_TOKEN`
- Put Caddy or Traefik in front for TLS
- `pm2` or a systemd unit per process (`next start` and `uvicorn main:app`)

## Parallel Repos

- **`ghostdwg/bid-dashboard`** — the stable production version, receives Tier F, auth fixes, and bug fixes from live jobs
- **`ghostdwg/construction-dashboard`** (this repo) — Phase 5 expansion, experimental work

## License

Private / Proprietary. All rights reserved.
