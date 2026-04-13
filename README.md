# Construction Dashboard — Construction Intelligence Platform

Forked from bid-dashboard. Extends the 35-module preconstruction platform with Python-powered document intelligence, AI spec extraction, interactive scheduling, meeting analysis, and superintendent field briefings.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Server Components, Turbopack) |
| UI | React 19, Tailwind CSS v4, light/dark theme |
| Language | TypeScript 5 (strict mode) |
| Database | Prisma 7 + SQLite (libsql adapter) |
| AI | Anthropic Claude API (brief, gap analysis, addendum delta, intelligence) |
| Auth | Auth.js v5 (email/password, JWT sessions) |
| Email | Resend API + Generic SMTP (provider-abstracted) |
| Export | ExcelJS (XLSX), CSV (MSP, Procore, Outlook, Google, vCard) |
| Planned | Python FastAPI sidecar (port 8001) — document intelligence, OCR, schedule export, PDF generation |

## Inherited from bid-dashboard (35 modules)

The full preconstruction platform ships with this repo: job intake, scope intelligence, bid leveling, procurement, RFQ distribution, go/no-go gate, bid assembly, post-award handoff (H1–H8), settings hub, auth wall, and theme toggle. All 35 modules are COMPLETE.

See [ROADMAP.md Section 4 — Completed Modules](docs/architecture/ROADMAP.md) for the full inventory.

## Phase 5 — Construction Intelligence (NEW)

| Sub-Phase | Description |
|-----------|-------------|
| **5A** | Python FastAPI sidecar — document parsing, OCR, schedule export, PDF generation, PostgreSQL migration |
| **5B** | Spec intelligence pipeline — five registers (submittals, warranties, training, closeout, testing) via AI extraction |
| **5C** | Interactive scheduling module — in-browser Gantt with CPM, DHTMLX, MSP/P6 export via sidecar |
| **5D** | Meeting intelligence pipeline — transcription, diarization, Claude analysis, structured action items |
| **5E** | Superintendent briefing — auto-assembled PDF from all registers (schedule, submittals, inspections, risks) |
| **5F** | Drawing OCR & quantity takeoff — symbol detection, room segmentation, scale detection (STRETCH) |

## Quick Start

```bash
git clone https://github.com/ghostdwg/construction-dashboard.git
cd construction-dashboard
npm install
cp .env.example .env.local
# Edit .env.local — add your ANTHROPIC_API_KEY for AI features
# Add AUTH_SECRET (generate with: openssl rand -base64 32)
# Set AUTH_DISABLED=true for solo dev mode (skips login)
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** The Python sidecar is not yet built. The app runs identically to bid-dashboard until Phase 5A begins.

## Architecture

Full architecture plan, three-stream build sequence, cost projections, and sync protocol: [ROADMAP.md](docs/architecture/ROADMAP.md)

## Parallel Repos

- **`ghostdwg/bid-dashboard`** — the stable production version, receives Tier F, auth fixes, and bug fixes from live jobs
- **`ghostdwg/construction-dashboard`** (this repo) — Phase 5 expansion, experimental work

## License

Private / Proprietary. All rights reserved.
