# R2 Staging Acceptance Checklist

**Status:** Release-planning document. **No check below has been executed.** This
checklist defines what the operator verifies on staging **after** the R2
candidate is deployed per `docs/r2/R2-STAGING-DEPLOYMENT-PACKET.md`, before the
candidate is considered validated on staging.

**Candidate identity:** all checks run against the *approved* `${CANDIDATE_SHA}`
running on the `neuroglitch-staging` Compose project. `9b283b9` and the dirty
SOL worktree are **not** the candidate.

**How to read this document:**
- **[A] Automated** — a script/command returns a machine-checkable result.
- **[M] Manual** — a human drives a UI/API flow and observes the outcome.
- **Evidence** — the artifact that proves the result (command + exit code +
  summary line, screenshot, DB row, log excerpt). Store as an artifact; never
  paste secrets, transcript bodies, or `pricingData` into it.
- **Pass/Fail** — the exact bar. Anything not clearly PASS is FAIL.
- **Rollback trigger** — whether a FAIL here is a hard rollback trigger (see
  `docs/r2/R2-STAGING-ROLLBACK-RUNBOOK.md`). "Hard" = roll back now; "Soft" =
  fix-forward candidate, operator judgment, does not by itself force rollback.

**Claim discipline:** a green check here proves *staging behavior at this
moment*. It never proves production behavior, never proves a live lifecycle not
actually exercised, and never upgrades an `[UNK]` claim to `[V]`. Tag lifecycle
claims honestly (`[V]`/`[OP]`/`[INF]`/`[UNK]`).

---

## Section 0 — Gate order

Run automated infra checks (§1) first; if any FAIL, stop — do not spend manual
effort on a stack that is not healthy. Then work the functional surfaces (§2)
roughly in dependency order (auth → access → operations → meetings → responses →
audit → resilience).

---

## Section 1 — Automated infrastructure gates [A]

| # | Check | Command / method | Pass criterion | Evidence | Rollback trigger |
|---|---|---|---|---|---|
| A1 | **Public health endpoint** | `curl -sf https://staging.groundworx.neuroglitch.ai/api/health` | HTTP 200, JSON `{"status":"ok",…}` | response body + status | **Hard** |
| A2 | **App container health** | `docker exec neuroglitch-staging-app curl -sf localhost:3000/api/health` | HTTP 200 `{"status":"ok"}` | exec output | **Hard** |
| A3 | **Sidecar health** | `docker exec neuroglitch-staging-sidecar curl -sf localhost:8001/health` | HTTP 200 `{"status":"ok"}` | exec output | **Hard** |
| A4 | **Worker liveness** | worker tick file fresh (`find /tmp/worker.tick -mmin -3`) | tick within 3 min | exec output | **Hard** |
| A5 | **Version identity** | `docker inspect … Labels "org.opencontainers.image.revision"` on running app image | equals `${CANDIDATE_SHA}`; digest equals `${APP_IMAGE_DIGEST}` | inspect output | **Hard** (wrong image running) |
| A6 | **Migration state parity** | `APP_ENV=staging … node scripts/apply-turso-migrations.mjs --dry-run` (`npm run migrate:turso:status`) | "Nothing to do" — 0 pending, 0 partial; disk count == recorded count | dry-run output | **Hard** |
| A7 | **Staging validator** | `APP_ENV=staging … node scripts/validate-staging.mjs` | every required check PASS, exit 0 (health, `/metrics`, migration parity, AuditEvent write/read, RunnerLease claim/heartbeat/release) | validator summary | **Hard** |
| A8 | **Error-log sweep** | `docker compose -p neuroglitch-staging logs --since 60s \| grep -i 'level=error\|panic'` | no matches since recreate | log excerpt (counts/paths, no bodies) | **Hard** if new error class tied to candidate |
| A9 | **Full test suite @ candidate** | `npm run typecheck && npm run lint && npm run test` at `${CANDIDATE_SHA}` (CI, pre-deploy) | all green | CI run id tied to SHA | **Hard** (should have blocked deploy) |
| A10 | **Migration replay** | `npm run validate:replay` at `${CANDIDATE_SHA}` (local/CI, throwaway DB) | replay green — migrations 99→100→101 apply cleanly on a fresh DB | replay summary | **Hard** |

> A6/A7 write only tagged test rows (`validate-staging-NNN`) to `AuditEvent`/
> `RunnerLease` and never mutate domain tables. They are safe against live
> staging; they are **not** a substitute for the manual functional checks below.

---

## Section 2 — Functional acceptance surfaces

Each surface lists the automated portion (if any) and the manual flow. Unless
noted, functional FAILs are **Hard** rollback triggers when they represent a
regression from the currently-deployed staging behavior; a pre-existing,
candidate-independent defect is **Soft** (record it, do not roll back for it).

### 2.1 Authentication [M] (+A2/A7 for reachability)
- **Flow:** log in as a real staging test user; log out; log back in.
- **Pass:** login succeeds; session cookie issued; logout clears session;
  re-login works. `AUTH_DISABLED=false` on staging (env fence).
- **Evidence:** screenshots of authenticated + logged-out states; no credential
  values recorded.
- **Rollback:** **Hard** — broken auth blocks everything.

### 2.2 Project / bid access [M]
- **Flow:** open a project; open a bid within it; read its detail surfaces.
- **Pass:** authorized user sees their project/bid data; lists and detail render;
  no 500s.
- **Evidence:** screenshot + A8 clean for the request window.
- **Rollback:** **Hard** on regression.

### 2.3 Tenant isolation [M] — **security-critical**
- **Flow:** as user of tenant/org A, attempt to access a project/bid/meeting
  belonging to tenant/org B by direct URL/ID.
- **Pass:** access is **denied** (403/404/redirect); no cross-tenant data leaks
  in the response body. `pricingData`/`rawPriceText`/sub names never appear in a
  response the requesting user should not see.
- **Evidence:** the denied response (status + that no B-data is present).
- **Rollback:** **Hard** — a leak here blocks promotion unconditionally.

### 2.4 Operations navigation [M]
- **Flow:** exercise the Operations nav tree (the R1 nav-recovery surface):
  every Operations entry routes to a rendering page.
- **Pass:** no dead links, no blank/500 routes; nav matches the R1-recovered
  structure.
- **Evidence:** click-through screenshots per nav node.
- **Rollback:** **Hard** if Operations nav is broken (R1 regression).

### 2.5 Meeting creation [M]
- **Flow:** create a new Meeting under a bid.
- **Pass:** meeting persists; appears in listings; owning bid/tenant correct.
- **Evidence:** created meeting id + screenshot.
- **Rollback:** **Hard** on regression.

### 2.6 Transcript upload [M]
- **Flow:** upload a transcript/audio artifact to a meeting.
- **Pass:** artifact stored via `LocalBlobStore` under the staging storage root
  (`/opt/neuroglitch/storage-staging`, `meetings/…`); reference row created.
- **Evidence:** blob key (path, not body) + DB reference row.
- **Rollback:** **Hard** on regression.
- **Note:** the meetings **durability-read** progression triggers transcription
  (sidecar POST) and is **UNPROVEN / not safely provable** here (GWX-Q07). Do
  not design the acceptance around exercising it; if a live transcription call
  would fire, **stop** and record `[UNK]` — do not force it to prove a lifecycle.

### 2.7 Transcription status [M/A]
- **Flow:** observe transcription status transitions for an uploaded artifact
  **only if** a sanctioned, non-billing path exists on staging; otherwise mark
  `[UNK] — not exercised (Q07 gate)`.
- **Pass:** status field reflects the honest processing state; **stub mode**
  writes `status:"stub"` rows, never a fake `ok`.
- **Evidence:** status row (no transcript body).
- **Rollback:** **Soft** unless a status regression corrupts meeting state.

### 2.8 Meeting Register [M] — R2 core
- **Flow:** open the Meeting Register for a meeting with extraction runs; view
  register entries and their source/history.
- **Pass:** register renders entries; source and history tables populated;
  RESTRICT-protected durable rows present (migration 100 retention behavior).
- **Evidence:** register screenshot + entry ids.
- **Rollback:** **Hard** on regression.

### 2.9 Rerun preservation [M] — R2 core
- **Flow:** trigger a register re-run / re-extraction; confirm prior run data is
  preserved (superseded, not destroyed).
- **Pass:** prior run rows retained and marked superseded; no destructive
  overwrite; supersession chain correct (`r2b1_register_rerun_supersession` +
  retention migration).
- **Evidence:** before/after run rows showing preservation.
- **Rollback:** **Hard** — silent loss of prior-run data is a data-integrity failure.

### 2.10 Tracked Item promotion [M] — R2 core
- **Flow:** promote an observation/register item to a Tracked Item; set lead
  trade / responsible contractor / GC-internal / consultant discipline
  (columns from migration 99).
- **Pass:** Tracked Item created with the assigned responsibility fields; indexes
  back the bid-scoped queries; promotion is auditable.
- **Evidence:** Tracked Item row + audit entry.
- **Rollback:** **Hard** on regression.

### 2.11 Consultant / field observations [M]
- **Flow:** create a field report and a consultant report observation; confirm
  `ReportObservation` rows with disposition fields.
- **Pass:** observations persist with `disposition` defaulting `OPEN`; source
  kind and locator captured; bid-scoped.
- **Evidence:** observation rows (metadata only).
- **Rollback:** **Hard** on regression.

### 2.12 Attachments [M]
- **Flow:** attach a file to an observation / tracked item / trade response.
- **Pass:** stored under staging storage root; retrievable by authorized user;
  content-addressed key intact.
- **Evidence:** blob key + successful authorized read.
- **Rollback:** **Soft** unless attachments are unreadable for existing records.

### 2.13 Trade-response packages [M] — R2 core
- **Flow:** assemble a trade-response package for a trade/subcontractor.
- **Pass:** package builds from the correct scoped items; sub confidentiality
  respected — `pricingData`/`rawPriceText`, sub names, companies, `isPreferred`
  never leak into any sub-facing export or prompt.
- **Evidence:** package contents review confirming no confidential leakage.
- **Rollback:** **Hard** on confidentiality leak or wrong-scope assembly.

### 2.14 External response authorization [M] — security-critical
- **Flow:** exercise the external (sub-facing) response authorization path — a
  token/link grants exactly the intended, scoped access and nothing more.
- **Pass:** external actor can act only on their authorized package; cannot
  enumerate or reach other subs' data; token privacy preserved (per the R2
  token-privacy fixes, commits `3ae33e2`/`ce488f4`).
- **Evidence:** authorized action succeeds; an out-of-scope attempt is denied.
- **Rollback:** **Hard** — authorization escape blocks promotion.

### 2.15 Audit / history [M/A]
- **Flow:** perform an auditable action (promotion, disposition, response
  review); confirm an `AuditEvent`/history row is written.
- **Pass:** audit row created with actor, action, target, timestamp; history is
  append-only / non-destructive; RESTRICT deletes hold.
- **Evidence:** audit row (metadata).
- **Rollback:** **Hard** if audit trail is missing for auditable actions.

### 2.16 Failure paths [M]
- **Flow:** drive intentional failures — invalid input, unauthorized action,
  missing resource, oversized upload.
- **Pass:** app fails **closed** with a clean handled error (4xx), not a 500 /
  stack leak / partial write; no secret or confidential data in error output.
- **Evidence:** the handled error responses.
- **Rollback:** **Soft** unless a failure path corrupts data or leaks.

### 2.17 Background job recovery [M/A] — R2 core
- **Flow:** enqueue a background job; while it is in flight (or after a worker
  restart) confirm the dedupe key prevents duplicate processing and the job
  resumes/completes exactly once.
- **Pass:** no duplicate side effects; `RunnerLease` claim/heartbeat/release
  healthy (A7); dedupe-key uniqueness holds; worker tick stays fresh.
- **Evidence:** job rows showing single completion; lease log.
- **Rollback:** **Hard** if jobs double-process or stall permanently.

### 2.18 Migration verification [A] — see A6/A10
- **Pass:** staging DB `_prisma_migrations` includes 99, 100, 101 as **finished**
  (no partial rows); disk-vs-DB counts agree; replay green on a fresh DB.
- **Evidence:** dry-run "Nothing to do" + replay summary.
- **Rollback:** **Hard** on partial/mismatched migration state (go to rollback
  runbook §migration-compatibility).

### 2.19 Browser refresh & session behavior [M]
- **Flow:** on an authenticated deep page, hard-refresh; reopen in a new tab;
  return after idle within session TTL.
- **Pass:** session survives refresh and the recreate; no unexpected logout;
  deep-linked state re-renders. (Auth.js session surviving deploy is the real
  signal — environment-promotion runbook §5.4.)
- **Evidence:** refreshed authenticated page.
- **Rollback:** **Soft** unless sessions are globally invalidated by the deploy.

---

## Section 3 — Summary gate

The R2 candidate is **staging-validated** only when:

1. All **[A]** infra gates A1–A10 PASS.
2. All **Hard**-trigger functional surfaces PASS with no regression.
3. Every remaining item is either PASS or an explicitly recorded `[UNK]` with a
   named reason (e.g. Q07 transcription gate) — never a silently skipped check.
4. No new `level=error` class attributable to the candidate persists.
5. Evidence for each is captured as an artifact and referenced from the ops-log
   entry.

Any unmet condition → do **not** declare staging-validated; consult the rollback
runbook for whether to roll back now or fix-forward.

---

## Section 4 — What this checklist does NOT claim

- It does not prove production behavior. Staging-green ≠ production-ready; see
  the rollback runbook's production-promotion boundary.
- It does not prove the meetings durability-read / live transcription lifecycle
  (Q07 `[UNK]`).
- A green run does not authorize a production deploy — that requires the separate
  restore-proof and operator approval gate.
