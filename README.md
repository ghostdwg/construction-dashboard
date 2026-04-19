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
| **5A** | ✅ COMPLETE | Python FastAPI sidecar — spec book splitting, per-section AI analysis, webhook-based job completion |
| **5B** | ✅ COMPLETE | Spec intelligence pipeline — AI extraction, CSI MasterFormat model, submittal generation from spec analysis |
| **5C** | ✅ COMPLETE | CPM scheduling module — 9-phase template, full dependency engine, Gantt UI, AI Schedule Intelligence, MSP CSV export |
| **5D** | ✅ COMPLETE | Meeting intelligence — transcription, diarization, Claude analysis, action items |
| **5E** | ✅ COMPLETE | Superintendent field briefing — auto-assembled PDF from all registers via WeasyPrint |
| **5F** | STRETCH | Drawing OCR, symbol detection, quantity takeoff (GPU hardware required) |
| **5G** | ✅ COMPLETE | Submittal Intelligence Layer — 5G-1 through 5G-3.6 + drawing cross-reference for drawing-sourced submittal items |
| **5H** | ✅ COMPLETE (near-term) | Warranty, training, inspections, closeout registers derived from spec AI extractions |

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

## Schedule Builder (Phase 5C)

The Schedule Builder is a full-page CPM scheduling tool accessible from any bid's Schedule tab → **Open Schedule Builder →** button, or directly at `/bids/[id]/schedule`.

### What it produces

A 9-phase commercial GC CPM schedule seeded from your bid's trade roster:

| Phase | Coverage |
|-------|----------|
| 1.0 Preconstruction | NTP → permit → submittal register → long-lead kickoff |
| 2.0 Procurement & Long Lead | Auto-created per long-lead trade (structural, HVAC, storefront, electrical gear) with fabrication lead times |
| 3.0 Site Work | Mobilization → excavation → foundations → slab (includes footing, foundation wall, under-slab inspection milestones) |
| 4.0 Structure | Structural delivery → erection → alignment verification |
| 5.0 Building Envelope | Roof + wall panels → **Weather Tight milestone** → storefront/doors → sealants |
| 6.0 Interior Framing & Rough-In | Metal stud → MEP rough-in (SS+lag overlaps) → **In-Wall Inspection** → drywall |
| 7.0 Interior Finishes | Paint → ceiling → flooring → trim-out → **Final Paint** |
| 8.0 Exterior Site | Grading → flatwork → paving (weather-flagged) → landscaping |
| 9.0 Closeout | HVAC TAB → **Building Final Inspection** → punchlist → **Substantial Completion** → **Final Completion** |

### How to use it

**First time on a bid:**
1. Open the bid → Schedule tab → click **Open Schedule Builder →**
2. Click **Seed from Trades** in the toolbar — builds the full 9-phase template using your bid's trade roster
3. The schedule populates with ~65 activities, all dependencies wired, and dates computed from your construction start date (set in Job Intake)

**Editing activities:**
- **Double-click** any cell to edit inline (name, duration, notes)
- **Predecessors column** — type in MSP-style format: `P3080FS`, `P6020SS+2d`, `P6110FS-1d`, `P6070FF`
  - Supported types: `FS` (default), `SS`, `FF`, `SF`
  - Positive lag: `+Nd` — negative lag (lead time): `-Nd`
  - Multiple predecessors: comma-separated — `P6030FS, P6050FS, P6060FS`
- **Duration** — working days (Mon–Fri); milestones show `—` and cannot be edited
- **Status** — dropdown: Not Started / In Progress / Complete / On Hold
- Dates recompute automatically after every save (server-side CPM forward pass)

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| Double-click | Enter edit mode |
| Enter / Tab | Commit edit |
| Escape | Cancel edit |
| Ctrl+Z | Undo (50-step client-side history) |
| Ctrl+Y / Ctrl+Shift+Z | Redo |

**Adding / removing rows:**
- **Add Activity** button (toolbar) — appends a new row at the end
- **+ icon** on hover (row right side) — inserts a row below that activity
- **Trash icon** on hover — deletes the activity and rewires dates

**Collapse/expand phases:**
- Click the ▶/▼ chevron on any phase summary row to collapse/expand all activities in that phase

### Activity code system

| Prefix | Meaning |
|--------|---------|
| `M1000` | Notice to Proceed milestone |
| `P1010`–`P1050` | Phase 1 preconstruction activities |
| `P20xx` | Phase 2 procurement (auto-named from long-lead trades) |
| `P3010`–`P3180` | Phase 3 site work |
| `M3085`, `M3105`, `M3155` | Inspection hold-point milestones |
| `P4010`–`M4040` | Phase 4 structure |
| `P5010`–`M5030` | Phase 5 envelope / Weather Tight |
| `P6020`–`M6085` | Phase 6 framing + rough-in / In-Wall Inspection |
| `P7010`–`P7110` | Phase 7 interior finishes |
| `P8010`–`P8060` | Phase 8 exterior site |
| `M9040`, `M9070`, `M9090` | Building Final Inspection / Substantial / Final Completion |
| `Axxxx` | User-added activities (A1010, A1020, …) |

Activity codes in the Predecessors column are the same codes shown in the **ID** column. Milestones (`M-`) and phase summaries (`P-000`) are read-only for duration.

### Long-lead procurement detection

Trades with the following CSI divisions automatically generate a Phase 2 procurement activity with the industry-standard total lead time (submittal + review + fabrication):

| Division | Trade | Default Lead Time |
|----------|-------|------------------|
| 05 | Structural steel / PEMB | 52 working days |
| 07 | Curtainwall / building panels | 45 working days |
| 08 | Storefront / overhead doors | 37 working days |
| 23 | RTU / HVAC equipment | 50 working days |
| 26 | Switchgear / electrical gear | 40 working days |

The procurement activity's finish date becomes a predecessor to the corresponding field installation activity (e.g., structural procurement → Structural Delivery → Structural Erection).

### Scheduling spec compliance

The Schedule Builder is designed to meet GC contract scheduling requirements (AIA A201 §3.10, CSI MasterFormat 01 32 16, CMAA standards):

- CPM forward-pass date engine — all four dependency types (FS/SS/FF/SF) with positive and negative lag
- Inspection hold-point milestones at code-required stages (footing, foundation wall, under-slab, in-wall, building final)
- Weather-sensitive activity flags on paving and flatwork
- Activity codes and WBS hierarchy exportable to MSPDI XML (MS Project) — *export coming Phase 5C*
- Baseline schedule / version snapshot model in place — *UI coming Phase 5C*

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
