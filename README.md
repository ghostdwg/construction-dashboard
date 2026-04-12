# Bid Dashboard — Preconstruction Intelligence Platform

A modular preconstruction intelligence system covering the full project lifecycle, from bid intake through post-award handoff. Designed for a solo estimator managing multiple bids simultaneously, the platform removes manual re-entry, catches scope gaps before bid day, and generates day-1 deliverables (handoff packets, budgets, schedules, contact exports) so the project team hits the ground running after award.

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

## Features

### Phase 1 — Pursuit

| Wing | Capability |
|------|-----------|
| **Job Intake** | 14-field project context capture branching AI analysis, compliance gates, and risk scoring |
| **Scope Intelligence** | Spec book + drawing upload, CSI extraction, AI brief generation, per-trade gap analysis, addendum delta processing |
| **Bid Leveling** | Estimate intake with pricing boundary, scope leveling engine, AI-drafted questions, bid spread analysis, scope-cost correlation |
| **Procurement** | Timeline engine, trade tier classification, RFI register, public bid compliance checklist |
| **RFQ Distribution** | Templated email via Resend or SMTP, delivery tracking, per-sub status badges |
| **Go/No-Go Gate** | Five-gate widget: timeline, coverage, documents, risk, compliance |
| **Bid Assembly** | Submission snapshot, frozen JSON artifacts, outcome tracking, post-bid analytics |

### Phase 2 — Award Gate

Bid status transitions to **awarded**. The sidebar shifts from pursuit modules to post-award modules. All pursuit data carries forward.

### Phase 3 — Post-Award Handoff (Tier E)

| Module | Capability |
|--------|-----------|
| **Handoff Packet** | 8-sheet XLSX export compiling project summary, trade awards, buyout, submittals, schedule, open items, contacts, documents |
| **Buyout Tracker** | Per-trade contract lifecycle (7 stages), committed/paid/remaining/retainage rollup |
| **Submittal Register** | Regex seeder from spec book, 8-stage lifecycle, Procore CSV export |
| **Schedule Seed** | Canonical CSI sequence, working-day math, FS predecessor chain, MS Project CSV export |
| **Owner Estimate** | Trade-level XLSX with GC markup, contingency, exclusions |
| **Budget Creation** | Cost codes, trade + GC lines, XLSX for ERP import |
| **Contact Handoff** | Outlook CSV, Google Contacts CSV, vCard 3.0 export |
| **Award Notifications** | Sub award + internal team emails via provider abstraction |

### Operations

| Feature | Description |
|---------|-----------|
| **Settings Hub** | Hot-applied credentials (no restart), email provider switching, AI cost observability |
| **AI Token Config** | Per-call max_tokens presets with live cost estimates |
| **Cost Previews** | Real-time cost chips on AI buttons with calibrated output ratios |
| **Theme Toggle** | Full light/dark mode coverage across all pages |
| **Auth Wall** | Email/password login, JWT sessions, AUTH_DISABLED bypass for solo dev |

### Queued

| Item | Status |
|------|--------|
| **Tier F — Procore Bridge** | F1 CSV exports (partially shipped), F2 REST API, F3 bidirectional sync |
| **Auth Level B+C** | Multi-tenancy + role-based access (deferred until second user) |

## Module Count

**35 modules shipped.** Platform is functionally complete for a solo estimator.

## Quick Start

```bash
git clone https://github.com/ghostdwg/bid-dashboard.git
cd bid-dashboard
npm install
cp .env.example .env.local
# Edit .env.local — add your ANTHROPIC_API_KEY for AI features
# Add AUTH_SECRET (generate with: openssl rand -base64 32)
# Set AUTH_DISABLED=true for solo dev mode (skips login)
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

Core variables are configured in `.env.local`. Additional credentials (Resend API key, SMTP settings, estimator profile) can be set through the in-app **Settings** page at `/settings` — they persist to the database and take effect immediately without a restart.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path (default: `file:./dev.db`) |
| `ANTHROPIC_API_KEY` | For AI | Claude API key — also settable in Settings UI |
| `AUTH_SECRET` | For auth | Auth.js session signing key |
| `AUTH_DISABLED` | No | Set `true` to bypass login (solo dev mode) |

### Solo Dev Mode

Set `AUTH_DISABLED=true` in `.env.local` to skip authentication entirely. All routes are accessible without login. This is the intended mode for a single estimator — auth exists for future multi-user scenarios.

## Repository Notes

- **This repo** (`ghostdwg/bid-dashboard`) is the stable production version
- **`ghostdwg/construction-dashboard`** is the expansion repo for Phase 5+ work
- Architecture docs live in `docs/architecture/`:
  - [ROADMAP.md](docs/architecture/ROADMAP.md) — full build sequence, module specs, and queued items
  - [CURRENT_STATE.md](docs/architecture/CURRENT_STATE.md) — authoritative build status and technical known-state

## License

Private / Proprietary. All rights reserved.
