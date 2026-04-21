# Current State — Construction Intelligence Platform
# Last Updated: 2026-04-25 (GWX-006)

## Repository Context
- This is **construction-dashboard**, forked from bid-dashboard on 2026-04-12
- 35 modules carried forward from bid-dashboard (all COMPLETE)
- This repo adds **Phase 5: construction intelligence expansion**
- Parallel repo `ghostdwg/bid-dashboard` remains active for Tier F, auth, bug fixes
- Sync protocol: pull `bid-dashboard/main` into this repo before starting new Phase 5 work
- See `docs/architecture/ROADMAP.md` v2.1 for full three-stream plan

## Repository
- GitHub: ghostdwg/construction-dashboard — main branch
- Local: c:/Users/jjcou/construction-dashboard
- Stack: Next.js 16, React 19, TypeScript 5, Tailwind CSS v4, Prisma 7/SQLite, Claude API, Auth.js v5

## Repository Status

- **All planned phases complete** — 35 base modules + full Phase 5 construction intelligence stack
- Last shipped: Drawing cross-reference for submittal generation (Phase 5G extension) on 2026-04-18
- Tier E (Post-Award Handoff): **COMPLETE** — all 8 modules (H1-H8) shipped
- Phase 5A–5H: **COMPLETE** — Python sidecar, spec AI pipeline, CPM scheduling, meeting intelligence, super briefing, submittal intelligence (5G-1 through 5G-3.6 + drawing cross-reference), near-term closeout registers
- Operations (SET1, SET1+, Auth Wall Level A): **COMPLETE**
- UI Nav Refactor (two-level sidebar): **COMPLETE**
- Remaining work:
  - Phase 5F: Drawing OCR + Quantity Takeoff — STRETCH (GPU hardware required)
  - Phase 5G-4: Submittal Workflow Templates — DEFERRED
  - Tier F F5: Daily Log weather claim integration — NOT STARTED
  - Auth Wall Level B+C (multi-tenancy + role-based access) — DEFERRED until second user
  - ~10 minor enhancements (see ROADMAP.md A4)

## Architecture — Three Wings + Lifecycle

The system is structured as three pursuit wings plus a post-award handoff layer:

- **Wing 1 — Job Intake (Module INT1):** project context capture before AI runs
- **Wing 2 — Scope Intelligence (Modules 14, 15, 15a, 15b):** what specs require vs what subs cover
- **Wing 3 — Bid Leveling (Modules 6a-6c, Tier C, Tier D):** apples-to-apples comparison + post-bid analytics
- **Tier E — Post-Award Handoff:** carry data forward into project execution (COMPLETE)
- **Tier F — Procore Bridge:** CSV export then API integration (queued)

## Build Status

| Module | Description | Status |
|--------|-------------|--------|
| Tiers 1–3 | Foundation, Intelligence, Workflow | ✅ Complete |
| Module 2b | Subcontractor Intelligence Layer | ✅ Complete |
| Module 6a | Estimate Intake | ✅ Complete |
| Module 6b | Scope Leveling Engine | ✅ Complete |
| Module 6c | Leveling Questions + Export | ✅ Complete |
| Audit Session | Full workflow debug + error handling | ✅ Complete |
| Module 14 | Document Intelligence (14a + 14b combined) | ✅ Complete |
| Module 5b | Estimate Sanitization — redaction engine | ✅ Complete |
| Module 15 | AI Review + Gap Analysis (15a + 15b) | ✅ Complete |
| Module GNG1 | Go/No-Go Gate Widget | ✅ Complete |
| Module 16a | Addendum Delta Processing | ✅ Complete |
| **Tier A** | **All modules complete** | **✅ Complete** |
| Module P1 | Procurement Timeline Engine | ✅ Complete |
| Module P2 | Trade Tier Classification UI | ✅ Complete |
| Module P3 | RFI Register Upgrade | ✅ Complete |
| Module P4 | Public Bid Compliance Checklist | ✅ Complete |
| **Tier C** | **Estimate Intelligence Layer** | **✅ Complete** |
| Module C1 | Bid Spread Analysis | ✅ Complete |
| Module C2 | Scope-Cost Correlation | ✅ Complete |
| Module C3 | Estimate Intelligence Summary | ✅ Complete |
| **Tier D** | **Bid Assembly + Post-Bid Intelligence** | **✅ Complete** |
| Module D1 | Bid Submission Snapshot | ✅ Complete |
| Module D2 | Award Outcome Tracking | ✅ Complete |
| Module D3 | Post-Bid Analytics Dashboard | ✅ Complete |
| **Operations** | **Cross-cutting infrastructure** | **✅ Complete** |
| Procore CSV Import | Subcontractor import + isPreferred + dedup | ✅ Complete |
| AI Token Config | Per-call max_tokens UI with cost estimates | ✅ Complete |
| Editable Due Date | Click-to-edit on Overview, field on New Bid modal | ✅ Complete |
| Theme Toggle | Light/dark mode with full app dark coverage | ✅ Complete |
| Module RFQ1 | RFQ Email Distribution via Resend | ✅ Complete |
| Module INT1 | Job Intake — Wing 1 project context capture | ✅ Complete |
| **Tier E** | **Post-Award Handoff Layer** | **✅ Complete** |
| Module H1 | Handoff Packet — Tier E entry point | ✅ Complete |
| Module H1 + | Project Contacts (owner / architect / engineer / internal team) | ✅ Complete |
| Module H2 | Buyout Tracker (sub contracts, POs, committed cost) | ✅ Complete |
| Module H3 | Submittal Register (regex seeder, lifecycle, Procore CSV export) | ✅ Complete |
| Module H4 | Schedule Seed (canonical CSI sequence, FS chain, MSP CSV export) | ✅ Complete |
| Module H7 | Contact Handoff (Outlook/Google CSV + vCard export) | ✅ Complete |
| Module H5 | Owner-Facing Estimate (trade-level XLSX with GC markup, contingency, exclusions) | ✅ Complete |
| Module H6 | Budget Creation (cost codes, trade + GC lines, XLSX for ERP import) | ✅ Complete |
| Module H8 | Award Notifications (sub award + internal team emails via provider abstraction) | ✅ Complete |
| **Module SET1** | **Settings & Cost Observability — shell, email/AI cards, usage logging, cost previews** | **✅ Complete** |
| **Module SET1+** | **Email provider abstraction — Resend + Generic SMTP (Gmail/Outlook/Yahoo/iCloud/Fastmail/Custom)** | **✅ Complete** |
| **UI Nav Refactor** | **Two-level sidebar with pursuit/post-award grouping** | **✅ Complete** |
| **Auth Wall A** | **Email/password login, JWT sessions, route protection, AUTH_DISABLED bypass** | **✅ Complete** |
| **GWX-002** | **Admin-only settings enforcement — proxy redirect + API 401/403 guards on all /settings routes** | **✅ Complete** |
| **GWX-003** | **Durable background job model — BackgroundJob schema, service layer, spec analysis flow wired** | **✅ Complete** |
| **GWX-004** | **Encrypted provider credentials — AES-256-GCM at rest for all secret AppSettings; transparent decrypt on read; lazy migration of legacy plaintext rows** | **✅ Complete** |
| **GWX-005** | **First automation-triggered durable job — `triggerSpecAnalysis` service, `findActiveJobForBid` duplicate guard, `POST /api/automation/spec-analysis` admin-only trigger endpoint** | **✅ Complete** |
| **GWX-006** | **Audit metadata for automation writes — `SubmittalItem.sourceJobId` FK to `BackgroundJob`; stamped by `generateSubmittalsFromAiAnalysis` when called from the sidecar webhook; automation vs manual writes now distinguishable and queryable** | **✅ Complete** |
| **GWX-007** | **Morning summary panel — `GET /api/bids/[id]/jobs` + `JobHistoryPanel` on Overview tab; shows job type, trigger source, status, timing, result/error; auto-opens on failures or automation runs** | **✅ Complete** |
| **Phase 5A** | **Python FastAPI sidecar — spec splitting, per-section AI analysis, webhook jobs** | **✅ Complete** |
| **Phase 5B** | **Spec intelligence pipeline — CSI MasterFormat model, AI extraction, submittal generation** | **✅ Complete** |
| **Phase 5C** | **CPM scheduling — 9-phase template, full dependency engine, Gantt UI, MSP CSV export, AI Schedule Intelligence** | **✅ Complete** |
| **Phase 5D** | **Meeting intelligence — transcription, diarization, Claude analysis, action items** | **✅ Complete** |
| **Phase 5E** | **Superintendent briefing — auto-assembled PDF field report via WeasyPrint** | **✅ Complete** |
| **Phase 5G-1** | **SubmittalItem.specSectionId auto-linkage from AI extractions** | **✅ Complete** |
| **Phase 5G-2** | **Schedule-tied due dates — backward math from install activity** | **✅ Complete** |
| **Phase 5G-3** | **Distribution templates, routing panel** | **✅ Complete** |
| **Phase 5G-3.5** | **SubmittalPackage model, package-grouped register** | **✅ Complete** |
| **Phase 5G-3.6** | **Bulk-edit grid UI with inline editing** | **✅ Complete** |
| **Phase 5G-Extension** | **Drawing cross-reference — drawing-sourced submittal items via sidecar AI** | **✅ Complete** |
| **Phase 5H near-term** | **Warranty, training, inspections, closeout registers from aiExtractions** | **✅ Complete** |
| **Queued** | **Future expansion** | **🔜 Planned** |
| Tier F F5 | Daily Log weather claim integration | 🔜 Not Started |
| Phase 5F | Drawing OCR + Quantity Takeoff | 🔜 Stretch |
| Phase 5G-4 | Submittal Workflow Templates | 🔜 Deferred |
| Auth Wall B+C | Multi-tenancy + role-based access | 🔜 Deferred |

## What Is Built
- Subcontractor directory with trade filtering, tier system, single-sub form with isPreferred
- Procore CSV import — preview/conflict resolution/per-row Preferred/commit pipeline
- Bid management with tabbed detail view + editable due date
- Trade assignment from 46-trade dictionary with CSI codes
- Sub selection filtered by bid trades
- Excel export for Outlook distribution
- Scope normalization with trade assignment
- Safe AI export with redaction and approval flow
- AI gap findings import, review, and approval
- Question generation and status workflow (RFI register: numbering, priority, response, impact)
- Outreach and response logging
- Reporting dashboard with live KPIs + post-bid analytics dashboard
- Estimate intake with pricing boundary enforced
- Scope leveling — side by side, inline status and notes
- Leveling questions with AI draft + anonymized Excel export
- Spec book upload — CSI extraction via pdfjs-dist (working)
- Drawing sheet index upload — discipline parsing, trade mapping
- Three-state matching — covered / missing from bid / unknown
- Trade proposal UI — Add to Bid, manual assign, rematch trigger
- Documents tab at position 2 in tab order
- Bid submission snapshot + outcome tracking + cascading status updates
- Bid spread analysis, scope-cost correlation, estimate intelligence recommendations
- Public bid compliance checklist (PUBLIC bids only)
- Procurement timeline engine + trade tier classification + tier health panel
- Addendum delta processing — incremental, per-addendum JSON
- AI Token Config UI at /settings/ai-tokens — per-call max_tokens presets with live cost
- Light/dark theme toggle in top nav — persists to localStorage, full dark variant coverage across all pages
- RFQ Email Distribution (Module RFQ1) — Subs tab checkboxes + Send RFQ button → confirmation modal → Resend API → React Email template → OutreachLog tracking with delivery status badges
- Job Intake (Module INT1) — JobIntakePanel on Overview tab with 14 fields across 5 sections (delivery & ownership, project profile, public bid terms, site & constraints, estimator notes). Empty bids show prominent "Complete Project Intake" CTA. Intake fields feed into the brief prompt as a new "PROJECT INTAKE" section, and into a new GNG1 Project Readiness check.
- Handoff Packet (Module H1, Tier E entry point) — new Handoff tab on bid detail page (#10). Compiles project summary, project contacts, trade awards, open items (RFIs + assumptions + risk flags), document inventory from existing captured data. XLSX export with 7 sheets (Project Summary, Trade Awards, Buyout Summary, Submittals, Open Items, Contacts, Documents). "View Handoff Packet →" shortcut on SubmissionPanel when outcome=won. Works in preview mode for any bid status. Owner/architect/internal-team contacts now sourced from ProjectContact (loose end cleared 2026-04-11).
- Project Schedule (Module H4) — new Schedule tab (position 12). Seeds one CONSTRUCTION activity per BidTrade (plus "Construction Start" / "Substantial Completion" milestones), sequenced in canonical CSI division order (sitework → concrete → masonry → steel → envelope → MEP rough → finishes → MEP trim → FFE → commissioning). Duration defaults by CSI division (lib/services/schedule/durationDefaults.ts). Primavera-style activityIds (A1010, A1020, A1030…), finish-to-start predecessor chain by default. Construction start date added to Job Intake (new field in Project Profile section); changing it triggers automatic schedule recalculation. All start/finish dates walked forward as working-day math (Mon-Fri, no holidays). Recalculate button on the Schedule tab. Inline-editable duration + predecessors per row, delete button, manual add form. Export MSP CSV button outputs Microsoft Project-compatible file (ID, Task Name, Duration "Nd", Start MM/DD/YYYY, Finish MM/DD/YYYY, Predecessors, Resource Names, Notes). H1 handoff packet gets a Schedule XLSX sheet (sheet 5) and a Project Schedule rollup section on Project Summary. HandoffTab UI gets a Project Schedule summary card below Submittal Register.
- Submittal Register (Module H3) — new Submittals tab (position 11) on the bid detail page. Extracts required submittals from SpecSection.rawText via regex scanner (seedSubmittalRegister.ts): looks for "SUBMITTALS" section headers, parses list items, classifies into 9 types (PRODUCT_DATA, SHOP_DRAWING, SAMPLE, MOCKUP, WARRANTY, O_AND_M, LEED, CERT, OTHER). Idempotent — skips existing items by specSectionId + normalized title. Auto-links responsibleSub from BidInviteSelection.rfqStatus="accepted" at seed time. 8-stage lifecycle (PENDING → REQUESTED → RECEIVED → UNDER_REVIEW → APPROVED/APPROVED_AS_NOTED/REJECTED → RESUBMIT). Inline status dropdown in the table, expandable row for full detail edit (title, description, type, requiredBy, reviewer, notes). Filters by status + type. Rollup card shows total/pending/in-review/approved/overdue. Compact rollup panel also surfaces on the Handoff tab below the Buyout Tracker. "Export Procore CSV" button outputs a Procore-compatible submittal import file (Number, Title, Spec Section, Responsible Contractor, Submittal Manager, Received From, Type, Status, Required On-Site Date, Description) — first piece of Tier F. H1 handoff packet XLSX now has a Submittals sheet (sheet 4, position shifted). Project Summary sheet gains a Submittal Register rollup section.
- Buyout Tracker (Module H2) — per-trade contract tracking rendered as a section on the Handoff tab directly below Trade Awards. Auto-creates one BuyoutItem per BidTrade on first load (via GET /api/bids/[id]/buyout). Each row is inline-editable: committed amount, PO#, contract status dropdown (7-stage lifecycle: PENDING → LOI_SENT → CONTRACT_SENT → CONTRACT_SIGNED → PO_ISSUED → ACTIVE → CLOSED), paid-to-date. Expandable detail row shows change orders, total w/COs, remaining, retainage held (percent stored, dollars computed on read), notes. Rollup card at the top surfaces total committed / paid / remaining / retainage held across all trades. BuyoutItem.subcontractorId seeded from BidInviteSelection where rfqStatus="accepted" on row creation — nullable so you can track trades before award. PATCH route validates numeric non-negativity and contractStatus membership. Trade Awards table and XLSX export now source committedAmount + contractStatus from BuyoutItem instead of hardcoded "PENDING" + null. New "Buyout Summary" XLSX sheet lists all rows with full financial breakdown + totals. Project Summary XLSX sheet gains a "Buyout Rollup" section.
- Settings & Cost Observability (Module SET1) — new /settings shell at the top nav with sidebar sections: Email Integration, Estimator Profile, AI Configuration, About. AppSetting key/value table backs all credentials with hot-applied (no-restart) writes via in-process cache invalidation. Every setting falls back to its named env var if not set in the DB. Setting catalog: RESEND_API_KEY, RESEND_FROM_EMAIL, ESTIMATOR_NAME, ESTIMATOR_EMAIL, ANTHROPIC_API_KEY. Secrets masked to last-4 in display mode with Replace + Clear affordances. Email card includes "Validate Key" (auth-only check via Resend.apiKeys.list) + "Send Test Email" actions. AI card consolidates the legacy /settings/ai-tokens UI (which now redirects) plus three new sections: Anthropic API key, Actual Usage (today/7d/30d totals + per-call breakdown sourced from AiUsageLog), and the existing per-call max_tokens preset cards now annotated with model price-per-1M tokens. AiUsageLog model logs every Anthropic call (callKey, model, in/out tokens, cost computed at log time, bidId, status). All 5 Anthropic call sites wired (brief, gap-analysis, addendum-delta, intelligence, leveling-question) and updated to read ANTHROPIC_API_KEY via getSetting() instead of process.env. Cost preview chips (AiCostPreview component) mounted on Generate Brief and Run Gap Analysis buttons — show realistic cost as a colored chip (green/blue/amber by magnitude) with a click-to-expand tooltip showing input/output token breakdown, calibrated output ratio (from last 30d of AiUsageLog rows, falling back to 50% default), worst-case cost, and warnings (e.g. "input is 2x typical — consider summarizing first"). Token estimation uses chars/4 approximation; per-bid forecasts for brief/intelligence assemble the actual prompt and tokenize it for accuracy. Three new endpoints: /api/settings/app (GET+PATCH key/value), /api/settings/email/test (validate or send), /api/settings/ai-usage (rollups), /api/settings/ai-forecast (per-call cost forecast).
- Contact Handoff export (Module H7) — "Export ▾" dropdown on the ProjectContactsPanel exports the project team + awarded subs in three formats: Outlook CSV (columns: First Name, Last Name, Company, Job Title, E-mail Address, Business Phone, Categories, Notes), Google Contacts CSV (with Group Membership pre-labeled "Bid: {project}" so contacts land in their own Google group), and vCard 3.0 (.vcf with N/FN/ORG/TITLE/EMAIL/TEL/CATEGORIES/NOTE per contact; universal format for Apple Contacts, Outlook, Google, CRMs). Unified loader combines ProjectContact rows with awarded subs derived from BuyoutItem.subcontractorId (multi-trade subs collapse into a single row with a combined trade list in the notes). New service lib/services/contacts/contactExporter.ts; new endpoint GET /api/bids/[id]/contacts/export?format=outlook|google|vcard. Filename pattern: {ProjectName}_Contacts_{YYYY-MM-DD}.{csv|vcf}. RFC 4180-compliant CSV escaping, RFC 6350-compliant vCard escaping (backslash, comma, semicolon, newline). Contacts sheet in the H1 handoff XLSX packet still exists as a "view-in-Excel" option; the H7 exports are the "drag-into-Outlook" option.
- Email provider abstraction (Module SET1+) — replaces the hardcoded Resend client with an EmailProvider interface (lib/services/email/types.ts) that the RFQ send route + the settings test endpoint go through via getActiveEmailProvider(). Two implementations shipped: ResendProvider (API-based, wraps existing flow) and SmtpProvider (nodemailer-based, works with any SMTP server). Settings catalog adds EMAIL_PROVIDER (resend|smtp) plus 7 SMTP_* keys (HOST, PORT, SECURE, USER, PASSWORD, FROM_EMAIL, FROM_NAME). EmailSettingsCard rebuilt with a provider tile selector at the top — switching providers preserves both sets of settings, so the user can flip back and forth without re-entering anything. SMTP section includes a preset dropdown (Gmail / Outlook / Yahoo / iCloud / Fastmail / Custom) that bulk-saves host+port+secure on selection, plus an inline note explaining the app-password requirement for each provider. The Test Connection panel now runs against whichever provider is active: validateConnection() does an SMTP handshake (transporter.verify()) for SMTP, or hits Resend's /api-keys for Resend. RFQ React Email template renders to HTML for nodemailer via a new renderRfqHtml() helper that wraps @react-email/components' render(); plain-text fallback included for clients that don't render HTML. Legacy lib/services/email/resendClient.ts deleted — all callers go through the abstraction. AppSettings cache pinned to globalThis to survive Next.js dev-mode module duplication across route-handler bundles (otherwise PATCH from one route can't invalidate cache in another route's bundle, leading to stale provider reads). Provider switching, validate-only test, and full provider abstraction smoke-tested end-to-end against the running dev server.

## Current Known State
- pdfjs-dist installed and working — pdf-parse removed
- SpecBook, SpecSection, DrawingUpload, DrawingSheet models in schema
- Three-state matching live: tradeId (covered) / matchedTradeId (missing) / both null (unknown)
- ProjectType enum on Bid (PUBLIC / PRIVATE / NEGOTIATED)
- AiGapFinding with title, sourceRef, severity, sourceDocument, reviewNotes
- BidIntelligenceBrief with riskFlags, assumptionsToResolve, isStale, sourceContext, addendumDeltas
- AddendumUpload with deltaJson, deltaGeneratedAt, summary — delta stored per-addendum, brief untouched
- GAP_STUB_MODE, BRIEF_STUB_MODE, ADDENDUM_STUB_MODE env flags bypass Anthropic API for dev
- Go/No-Go widget on Overview tab — four gates scored from existing bid data, no AI call
- Addendum delta processing — incremental delta prompt, scope changes, new risks, actions required checklist
- Stale banner on Overview links to Documents tab (not regenerate) — delta processing clears stale flag
- BidTrade: tier (TIER1/TIER2/TIER3 string, default TIER2), leadTimeDays, rfqSentAt, quotesReceivedAt, rfqNotes
- calculateTimeline.ts — pure date logic, realistic 2-week offsets (T1=14d, T2=10d, T3=7d), leadTimeDays override
- GET /api/bids/[id]/procurement/timeline — per-trade timeline, urgency sort, summary block, daysUntilBid
- PATCH /api/bids/[id]/trades/[tradeId] — updates tier, leadTimeDays, rfqSentAt, rfqNotes
- Trades tab: tier selector, lead days input, status badge (On Track/At Risk/Overdue/Complete), RFQ date per row
- Subs tab: procurement timeline section — urgency banner, trade timeline table, Mark RFQ Sent, DBE compliance (PUBLIC)
- classifyTradeTier.ts — keyword-based rule classifier, TIER1/TIER2/TIER3 suggestion, reason, typicalLeadDays, criticalPathRisk
- Trades tab: auto-suggest hints when classifier disagrees with current tier, dismiss/apply buttons, lead time guidance below input
- Trades tab: tier health summary panel — three-column grid, color-coded by worst timeline status per tier
- Trades tab: untiered banner + bulk apply modal when suggestions exist, Critical Path badge on Tier 1 rows
- GNG1 Gate 2: Tier 1 critical path procurement check — OVERDUE → FAIL, AT_RISK → CAUTION
- Subcontractor.isPreferred — INTERNAL ONLY field (never in AI prompts, never in sub-facing exports)
- Subcontractor.procoreVendorId — unique external reference for re-import dedup
- BidSubmission model — frozen 6-field JSON snapshots + outcome fields, cascades Bid.status
- AiTokenConfig model — DB-backed per-call max_tokens overrides with in-process cache
- Legacy /bids/[id]/leveling route is a redirect to /bids/[id]?tab=leveling (do NOT recreate as a standalone page — landmine that confuses users into thinking tabs are missing)
- ThemeProvider uses React 19 useSyncExternalStore pattern (no setState-in-effect rule violations). Pre-hydration script in layout.tsx applies theme class on first paint to prevent flash.
- Tailwind v4 dark mode via @custom-variant in app/globals.css — explicit class on <html> is the only signal (no prefers-color-scheme media query)
- OutreachLog model extended with email tracking fields (Module RFQ1): emailMessageId (indexed), deliveryStatus (QUEUED/SENT/DELIVERED/OPENED/BOUNCED/FAILED), openedAt, bouncedAt, bounceReason. Existing channel/status columns reused — channel="email", status="sent" on successful queue. Custom message renders into email body but is NOT persisted (option b — discard after send).
- Resend integration is OPTIONAL — without RESEND_API_KEY + RESEND_FROM_EMAIL in .env.local, the send route returns 503 and the Subs tab "Send RFQ" button is disabled with a tooltip. Estimator name + email defaults from ESTIMATOR_NAME + ESTIMATOR_EMAIL env vars, fall back to localStorage, then to user input. Webhooks configured at /api/webhooks/resend — won't fire on localhost (need public URL).
- LIVE EMAIL SEND IS UNTESTED at commit time. Code paths verified by lint/build/typecheck. First test should be a self-send to verify Resend account, domain verification, and webhook delivery.
- INT1 schema additions on Bid (migration 20260410225347_int1_job_intake): deliveryMethod, ownerType, buildingType, approxSqft, stories, ldAmountPerDay, ldCapAmount, occupiedSpace, phasingRequired, siteConstraints, estimatorNotes, scopeBoundaryNotes, veInterest, dbeGoalPercent. String fields validated in API layer (POST /api/bids and PATCH /api/bids/[id]) rather than as Prisma enums (SQLite-friendly). Valid deliveryMethod: HARD_BID, DESIGN_BUILD, CM_AT_RISK, NEGOTIATED. Valid ownerType: PUBLIC_ENTITY, PRIVATE_OWNER, DEVELOPER, INSTITUTIONAL.
- INT1 brief prompt integration — assembleBriefPrompt.ts adds Section A2 "PROJECT INTAKE" between project identity and Division 1 sections. Only emits fields the estimator has populated (no padding "—" rows). Prompts the AI to factor intake constraints into risk flags and assumptions.
- INT1 GNG1 integration — go-no-go route adds a "Project intake captured" check to Project Readiness gate. Counts populated fields (booleans count when true). 0 fields → fail, <50% → caution, ≥50% → pass. Total field count varies by projectType (PUBLIC bids count 14, others count 11 — LD/DBE fields not counted on private/negotiated).
- H1 handoff packet assembles from existing pursuit data — never fabricates. Sources: Bid + intake fields (project/constraints), BidTrade (per-trade rows), BidInviteSelection with rfqStatus="accepted" (awarded subs), BidIntelligenceBrief.riskFlags + assumptionsToResolve (parsed JSON), GeneratedQuestion where status in ["OPEN","SENT"] (unresolved RFIs), SpecBook + DrawingUpload + AddendumUpload (documents inventory), BidSubmission.ourBidAmount (total bid — single field, not per-trade). As of H2, per-trade bidAmount and contractStatus come from BuyoutItem instead of being null/hardcoded. Boundary preserved: EstimateUpload.pricingData never touched, sub names ARE included (internal artifact only, never sent to AI).
- H1 deferred contacts cleared (2026-04-11): ProjectContact model added (migration 20260411153143_h1_project_contacts) with bidId, role (validated string: OWNER/OWNER_REP/ARCHITECT/ENGINEER/INTERNAL_PM/INTERNAL_ESTIMATOR/INTERNAL_SUPER/OTHER), name (required), company, title, email, phone, notes, isPrimary. Cascade delete on Bid. Service layer at lib/services/contacts/projectContactService.ts (load/create/update/delete with role + ownership validation, sorted by role then primary then name). API at /api/bids/[id]/contacts (GET+POST) and /api/bids/[id]/contacts/[contactId] (PATCH+DELETE). Reusable ProjectContactsPanel component mounted on BOTH the Overview tab (between JobIntakePanel and SubmissionPanel) and the Handoff tab (between Project Summary and Trade Awards) — same component, same data source. assembleHandoffPacket reads them into HandoffPacket.projectContacts; the Contacts XLSX sheet now has an "Owner & Project Team" section above "Awarded Subcontractors" instead of the deferred-note placeholder.
- H2 BuyoutItem schema (migration 20260411014717_h2_buyout_tracker): one row per BidTrade (unique bidTradeId), nullable subcontractorId (cascading from accepted RFQ selection on creation, manually adjustable thereafter), committedAmount, originalBidAmount, contractStatus (string, validated in API), loiSentAt/contractSentAt/contractSignedAt/poIssuedAt, poNumber, changeOrderAmount (default 0), paidToDate (default 0), retainagePercent (default 5), notes. Indices on bidId and subcontractorId. Cascade delete when Bid or BidTrade is removed. Valid contractStatus: PENDING, LOI_SENT, CONTRACT_SENT, CONTRACT_SIGNED, PO_ISSUED, ACTIVE, CLOSED.
- H2 service layer: loadBuyoutItemsForBid auto-creates missing rows by diffing BidTrade vs BuyoutItem; computeBuyoutRollup returns trade counts + total committed/paid/remaining/retainage + status histogram; updateBuyoutItem enforces ownership (item.bidId === bidId), numeric non-negativity, contractStatus enum, and retainagePercent 0-100. Derived fields on each row (totalCommitted = committed + COs, remainingToPay = max(0, total - paid), retainageHeld = paid * pct/100) computed at read time, never stored.
- H3 SubmittalItem schema (migration 20260411031055_h3_submittal_register): one row per required submittal, with bidId + nullable bidTradeId (for GC items) + nullable specSectionId (source) + nullable responsibleSubId. Fields: submittalNumber (auto-generated as "{csi}-{seq}" by seeder, manually editable), title (required), description, type, status (default PENDING), lifecycle timestamps (requiredBy, requestedAt, receivedAt, reviewedAt, approvedAt), reviewer, notes. Indices on bidId / specSectionId / status. Cascade delete on Bid.
- H3 service layer: seedSubmittalRegister scans SpecSection.rawText with regex (`/\b(?:\d+\.\d+\s+)?SUBMITTALS?\b\s*[:\n]/i`) to find the SUBMITTALS block, extracts lines, strips list markers (A., 1., a), •, -), classifies each line against TYPE_KEYWORDS ordered most-specific-first, requires either a keyword-matching title OR a keyword-matching description to emit a row. Auto-computes submittalNumber as "{csiNumber}-{2-digit-sequence}". loadSubmittalsForBid computes `isOverdue` server-side (requiredBy in past AND status not APPROVED/APPROVED_AS_NOTED) to avoid Date.now() in React render (React 19 purity rule). updateSubmittal auto-advances timestamps when status transitions (REQUESTED→requestedAt, RECEIVED→receivedAt, etc.) unless explicitly set.
- H3 Procore CSV export maps internal types/statuses to Procore's vocabulary: PRODUCT_DATA→"Product Data", SHOP_DRAWING→"Shop Drawings", etc; PENDING→"Draft", REQUESTED/RECEIVED/UNDER_REVIEW→"Open", APPROVED/APPROVED_AS_NOTED→"Closed", REJECTED/RESUBMIT→"Revise and Resubmit". Column order matches Procore's submittal import template: Number, Title, Spec Section, Responsible Contractor, Submittal Manager (blank), Received From (blank), Type, Status, Required On-Site Date, Description.
- H4 ScheduleActivity schema (migration 20260411154112_h4_schedule_seed): one row per BidTrade for construction activities, plus two milestones (M1000 "Construction Start", M9999 "Substantial Completion"). Fields: activityId (Primavera-style, e.g. "A1010"), name, kind (CONSTRUCTION | MILESTONE, validated in API), sequence, durationDays (default 5), startDate/finishDate (nullable, computed by recalculator), predecessorIds (comma-separated activityIds string, FS only), notes. Indices on bidId and (bidId, sequence). Cascade delete on Bid. Bid model gets two new fields: constructionStartDate (DateTime?) and projectDurationDays (Int?, informational).
- H4 service layer: seedScheduleActivities sorts BidTrades by compareByDivisionOrder (canonical CSI sequence from durationDefaults.ts), assigns durations from DIVISION_DURATION_DAYS lookup, builds an FS chain where each activity's predecessor is the previous one's activityId. Auto-creates M1000 + M9999 milestones on first run. Idempotent — skips bidTrades that already have an activity; skips milestones whose activityId already exists. After seeding, auto-calls recalculateSchedule.
- H4 recalculateSchedule: walks activities in sequence order, uses Bid.constructionStartDate as the anchor, resolves start = latest finish across predecessor IDs (defaults to anchor if no predecessors or stale chain), computes finish = addWorkingDays(start, duration - 1). All math is Mon-Fri working-day only (no holidays). Writes Bid.projectDurationDays with the total working-day span. Called automatically from: (1) seedScheduleActivities, (2) any updateScheduleActivity that changes duration/sequence/predecessor, (3) deleteScheduleActivity, (4) createScheduleActivity (manual add), (5) PATCH /api/bids/[id] when constructionStartDate changes.
- H4 MSP CSV export at POST /api/bids/[id]/schedule/export — column format matches Microsoft Project's default CSV import mapping (ID, Task Name, Duration, Start, Finish, Predecessors, Resource Names, Notes). Duration emitted as "Nd" (MSP recognizes this as working days). Dates as MM/DD/YYYY (US default). Milestones emit 0d duration with their name prefixed by ◆.
- H4 JobIntakePanel extension: constructionStartDate field added to Project Profile section (between Stories and Site & Constraints), rendered via new DateField helper. PATCH /api/bids/[id] accepts and persists the field; if it changes, the route calls recalculateSchedule (non-fatal on error) so all activity dates re-hydrate from the new anchor.

## Phase 5 — Construction Intelligence Stack

- **Python FastAPI sidecar at :8001** — PyMuPDF4LLM spec splitting, tiered Claude analysis (Sonnet for complex divisions, Haiku for others), WeasyPrint PDF generation; `npm run dev:all` starts both servers
- **SpecBook + SpecSection models** — `SpecBook.status` (uploading/splitting/analyzing/ready/error), `SpecSection.csiNumber/csiTitle/rawText/aiExtractions/canonicalTitle`; `SpecSectionPdf` stores per-section PDF blob
- **CsiMasterformat table** — ~3,995 Level 3 MasterFormat 2020 codes; seeded from XLSX via `prisma/seed/seedCsiMasterformat.ts`; used for title canonicalization
- **DrawingUpload model** — `analysisJson` (discipline breakdown), `analysisStatus` (pending/analyzing/ready/error); drawing intelligence via `sidecar/services/drawing_intelligence.py`
- **SubmittalItem.source** — `"ai_extraction"` | `"regex_seed"` | `"manual"` | `"drawing_analysis"`; drawing-sourced items come from POST `/api/bids/[id]/submittals/generate-ai` two-phase flow
- **SubmittalItem.specSectionId** — FK auto-linked during AI extraction (5G-1); `linkedActivityId` FK to ScheduleActivity for schedule-tied due dates (5G-2)
- **SubmittalPackage model** — container for grouped submittals; packageNumber, name, bidTradeId, status (DRAFT/OPEN/CLOSED), defaultReviewers, defaultDistribution; SubmittalItem.packageId FK
- **SubmittalDistributionTemplate model** — per-trade routing rules; auto-populates reviewers + distribution when CSI section picked on a submittal
- **ScheduleV2** — `ScheduleActivityV2` with 9-phase CPM template, all 4 dep types (FS/SS/FF/SF), positive/negative lag; `scheduleV2Service.ts` for seed, recalc, and AI intelligence; GET `/api/bids/[id]/schedule-v2/generate` for preflight metadata
- **Submittal generate-ai preflight** — GET `/api/bids/[id]/submittals/generate-ai` (no jobId) returns `{ analyzedSectionCount, hasSpecBook, hasDrawings }` for UI dependency hint; empty spec guard prevents misleading drawing cross-reference when no AI analysis has run
- **Warranty / Training / Inspections / Closeout registers** — near-term 5H derived views seeded from `SpecSection.aiExtractions`

## Durable Background Job System (GWX-003 / GWX-005 / GWX-005.1–005.4)

- **BackgroundJob model** — added in migration `20260421022733_add_background_job`. Fields: `id` (cuid), `jobType`, `status` (queued/running/complete/failed/cancelled), `bidId`, `relatedId`, `externalJobId`, `inputSummary`, `resultSummary`, `artifactType`, `errorMessage`, `createdAt`, `startedAt`, `completedAt`, `retryCount`, `triggerSource`. Indexed by `bidId`, `(jobType, status)`, `(status, createdAt)`, and `externalJobId`.
- **`BackgroundJob.activeSlot`** (GWX-005.1 / GWX-005.4) — nullable integer (`DEFAULT 1`). Active jobs hold `activeSlot = 1`; terminal jobs (`complete`/`failed`/`cancelled`) clear it to `NULL`. A `@@unique([bidId, jobType, activeSlot])` index enforces at-most-one active job per `(bidId, jobType)` at the DB level. SQLite treats `NULL` as distinct in unique indexes so terminal rows never conflict. Clean migration: `20260424000001_background_job_active_slot`.
- **`lib/services/jobs/backgroundJobService.ts`** — service layer: `createJob`, `startJob`, `completeJob` (clears `activeSlot`), `failJob` (clears `activeSlot`), `getJob`, `findJobByExternalId`, `findActiveJobForBid`, `listJobsForBid`.
- **`lib/services/jobs/specAnalysisAutomation.ts`** (GWX-005) — shared trigger service: `triggerSpecAnalysis(bidId, opts)`. Advisory `findActiveJobForBid` fast-path + atomic `P2002` duplicate guard. Returns typed `TriggerOutcome`. Shared by the manual UI route and the automation endpoint.
- **`GET /api/jobs/[id]`** — DB-only job status endpoint; works after sidecar restart.
- **`POST /api/automation/spec-analysis`** (GWX-005) — admin-only internal trigger. Accepts `{ bidId, tier? }`, checks `isAdminAuthorized()`, calls `triggerSpecAnalysis` with `triggerSource: "automation"`. No browser required for the job to complete — sidecar fires the existing webhook.
- **Spec analysis flow** — `POST /api/bids/[id]/specbook/analyze` delegates to `triggerSpecAnalysis` (user trigger). `POST /api/bids/[id]/specbook/analyze/complete` (sidecar callback) is the sole authoritative completion writer.
- **Sidecar unchanged** — in-memory `_jobs` dict still drives live progress polling. DB record is the authoritative durability layer; the two coexist.
- **Migration baseline (GWX-005.4)** — migration history is clean: 58 migrations, no edited applied files, no checksum drift. `prisma migrate status` → "Database schema is up to date!" Fresh-DB replay runs `20260421022733_add_background_job` (table, no `activeSlot`) then `20260424000001_background_job_active_slot` (ADD COLUMN + backfill + unique index). For new environments: run `prisma migrate deploy` — no manual `migrate resolve` needed.

### Existing-Database Repair Runbook (GWX-005.5)

GWX-005.4 deleted two migrations from the filesystem and replaced them with a single clean one. Any database that was migrated before GWX-005.4 may still have `_prisma_migrations` rows for the deleted migrations. Those databases need a one-time manual repair. This is not self-healing — `prisma migrate deploy` will not fix it automatically.

**Affected migrations (deleted from filesystem):**
- `20260421031417_background_job_active_slot`
- `20260423000001_background_job_active_slot`

**Replacement migration (must be marked applied):**
- `20260424000001_background_job_active_slot`

---

#### Step 1 — Identify whether a DB needs repair

Run the following and examine the output:

```bash
echo "SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '%active_slot%' ORDER BY started_at;" | npx prisma db execute --stdin
```

Interpret the results:

| Rows present | Meaning | Action needed |
|---|---|---|
| `20260424000001` only | Already repaired or fresh DB | None |
| `20260421031417` and/or `20260423000001`, no `20260424000001` | Needs repair | Follow steps 2–4 |
| All three | Partial repair (shouldn't happen, but possible) | Delete old rows + verify new row per steps 2–3 |

---

#### Step 2 — Remove the deleted migrations from DB history

Run both DELETEs. If a row doesn't exist, the DELETE is a no-op — that's fine.

```bash
echo "DELETE FROM _prisma_migrations WHERE migration_name = '20260421031417_background_job_active_slot';" | npx prisma db execute --stdin

echo "DELETE FROM _prisma_migrations WHERE migration_name = '20260423000001_background_job_active_slot';" | npx prisma db execute --stdin
```

Expected output for each: `Script executed successfully.`

---

#### Step 3 — Mark the replacement migration as applied

The schema changes (`activeSlot` column + unique index) are already present in the DB — this step only records the new migration name so Prisma knows the history is complete. It does **not** re-run any SQL.

```bash
npx prisma migrate resolve --applied 20260424000001_background_job_active_slot
```

Expected output: `Migration marked as applied.`

---

#### Step 4 — Verify

```bash
npx prisma migrate status
```

Expected output: all 58 migrations listed, ending with `20260424000001_background_job_active_slot`, and the final line: `Database schema is up to date!`

If any migration is listed as "failed" or "not applied," stop and investigate before proceeding.

---

#### DB state summary

| DB state | `activeSlot` column present | `_prisma_migrations` | Action |
|---|---|---|---|
| Fresh DB (never migrated) | Added by `20260424000001` | Only `20260424000001` recorded | None — `prisma migrate deploy` handles it |
| Dev DB after GWX-005.4 | Yes (was there before) | Already repaired — `migrate resolve` was run | None |
| Other existing DB, not yet repaired | Yes (was added by deleted migrations) | Has old names, missing `20260424000001` | Run steps 2–4 above |
| Other existing DB, partially repaired | Yes | Mix of old/new rows | Delete old rows, verify new row per steps 2–3 |

**Scope:** This repair is manual and environment-by-environment. There is no automated migration that performs it. It must be run once on each existing database that pre-dates GWX-005.4.

## Pricing / AI Boundary — Non-Negotiable
EstimateUpload.pricingData is never returned to client and
never included in any AI prompt. Only scopeLines go to AI.
