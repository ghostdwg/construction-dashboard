# R2 Production Observability & Recovery Audit

**Date:** 2026-07-18
**Branch:** `gwx/r2-observability-recovery-audit`
**Base commit audited:** `9b283b9` (committed tip of `gwx/sol-r2-ledger-integration`, checked out clean on this branch)
**Audit type:** documentation + read-only inspection only. No product code, schema, migration, deployment file, alert route, health endpoint, or worker code was modified. No live environment, live database, or provider was touched.

**Evidence tags** (per `.claude/rules/verification-evidence.md`): `[V]` source/git-verified at `9b283b9` · `[OP]` operator-verified live artifact · `[INF]` inference from verified facts · `[DEC]` binding decision · `[UNK]` unknown / cannot be proven from this worktree.

> **Scope caveat (load-bearing):** `9b283b9` is the committed tip of the R2 convergence candidate, whose combined review is currently **BLOCK** with remediation patches applied-but-uncommitted in a *different* worktree (`r2-convergence-control.md` §9). This audit describes the **committed tree only**. The pending media-concurrency patches (`media/0001–0005`) directly touch job/upload state-machine behavior audited here; findings marked with ⚠ may change after that remediation lands. Nothing in this audit certifies the candidate for release. `[V]`
>
> **Deployed-reality caveat:** everything tagged `[V]` is proven about *source at this SHA*, not about any running container. Production runs a different branch entirely and staging is pinned to an earlier image (`[OP]`, 2026-07-03 topology inspection); no claim in this document upgrades to "live-proven." Live behavior is `[UNK]` unless an operator artifact is cited. `[DEC]` per Ledger claim discipline.

---

## 1. Current evidence-source inventory

Every source an operator can consult today, with what it actually proves.

| # | Source | Location | What it provides | State |
|---|--------|----------|------------------|-------|
| E1 | Structured audit stdout | `lib/observability/audit.ts:147` — single-line JSON prefixed `[audit]` via `console.info` | Canonical structured log. Envelope (`lib/observability/taxonomy.ts:83-140`): category, action, severity, correlationId, actor, subject, decision, reasonLog, payload (≤4KB by convention). Scraped by Promtail → Loki | `[V]` implemented; live scrape `[UNK]` |
| E2 | `AuditEvent` table | `prisma/schema.prisma:3877-3918`; writers `lib/observability/audit.ts:110-187` | Durable audit rows for 12 persisted categories (`taxonomy.ts:165-179`). Two write policies: **fail-closed in-transaction** (`persistAuditEnvelope(tx,…)` — e.g. `lib/services/operationsAudit.ts:14-42`, `lib/services/tradeResponse/txAudit.ts:9-37`) and **fail-open best-effort** (`emitAuditEvent`, swallows DB failure at `audit.ts:164-176`) | `[V]` |
| E3 | Prometheus `/metrics` | `app/metrics/route.ts:14-24`; registry `lib/observability/metrics.ts` | 28 metric families (counters/gauges/histograms): audit emissions + persistence failures, runner cycles/durations, ingestion, forecast, alert-eval pipeline, unread-alert gauges, P2-A0 shadow prompt-scan outcomes. **No process metrics, no HTTP request metrics, no job-queue metrics** | `[V]` |
| E4 | Loki + Promtail | `runtime/observability/promtail/promtail.yaml:40-79`; `loki-config.yaml:45-58` | Container stdout via docker socket discovery; parses `[audit]` prefixes into 5 bounded labels; 90-day retention | `[V]` config; live `[UNK]` |
| E5 | Grafana | `runtime/observability/grafana/dashboards/` | 3 dashboards: `platform-health`, `audit-stream`, `intelligence-throughput`. No alert rules provisioned | `[V]` |
| E6 | Prometheus server | `runtime/observability/prometheus/prometheus.yml:13-19`; `runtime/compose/observability.yml:58` | Scrapes `app:3000/metrics` @15s; 15-day TSDB retention; **no Alertmanager, no alerting rules** | `[V]` |
| E7 | `/api/health` | `app/api/health/route.ts:1-7`; public (`lib/routing/publicPaths.ts:11`) | Static liveness only: `{status:'ok', version: npm_package_version, timestamp}`. **No DB / migration / storage / worker check; `version` is package version, not git SHA** | `[V]` |
| E8 | Deeper health routes | `app/api/ollama/health/route.ts:6-19`; `app/api/settings/gpu-worker/health/route.ts:46-65`; `app/api/settings/ai-readiness/route.ts:14-27` | Sidecar reachability (authed); WhisperX GPU worker + sidecar probe (admin); provider-config readiness (admin, never live-calls) | `[V]` |
| E9 | Worker health | `runtime/worker/Dockerfile:42-43` (tick-file freshness ≤3 min); `runtime/worker/entrypoint.sh` (readiness gate, backoff, always-log) | Detects a wedged worker loop at the Docker level. `GET /api/jobs/run-due` returns `{enabled, queued}` | `[V]` scaffold; **deployed prod worker is a different host-path artifact** `[OP]`/`[UNK]` |
| E10 | Docker healthchecks / restart | `runtime/compose/base.yml:68-103` (app+sidecar `curl /api/health\|/health`, 30s); `Dockerfile:95-96`; cron tick `runtime/cron/Dockerfile:65-66`; all services `restart: unless-stopped` | Container-level liveness; restart-on-crash. **Nothing restarts or alerts on `unhealthy`;** caddy/worker(compose)/landing have no compose healthcheck | `[V]` |
| E11 | `BackgroundJob` table | `prisma/schema.prisma:1365-1421` | Durable job rows: `status` FSM (queued→running→complete\|failed\|cancelled), `activeSlot` uniqueness (`:1403-1414`), `externalJobId`, `errorMessage`, timestamps, `runAfter`, `dedupeKey`. `retryCount` exists but is **never read or written** by any code | `[V]` |
| E12 | `Meeting.status` FSM | `prisma/schema.prisma:1131-1203` | PENDING→UPLOADING→TRANSCRIBING→(AWAITING_NAMES)→ANALYZING→READY\|FAILED; `transcriptionJobId`, `transcriptionSource`, `audioStorageKey` | `[V]` |
| E13 | Provider job identifiers | `startJob(id, externalJobId)` `lib/services/jobs/backgroundJobService.ts:52-61`; spec-analyze callback `app/api/bids/[id]/specbook/analyze/complete/route.ts:48-181`; transcription poll `.../meetings/[meetingId]/status/route.ts:257-261` | Sidecar job ids stored and matchable (`externalJobId` indexed). Spec analysis completes via token-authed webhook; transcription completes only via **client-initiated polling** | `[V]` |
| E14 | `RunnerLease` table + dispatcher | `lib/runners/lease.ts`, `lib/runners/dispatcher.ts:157-190`; `prisma/schema.prisma:3947-3980` | Atomic windowKey claims, heartbeat, lease expiry, last-run status/duration/error. `findStaleLeases`/`markLeaseStale` exist (`lease.ts:160-185`) but **nothing invokes them** | `[V]` |
| E15 | Cron scheduler | `scripts/cron-loop.mjs`; `runtime/cron/schedule.json` | health-check */15 (a trivial framework ping — heartbeats + audits, checks nothing else: `lib/runners/registry.ts:41-51`), municipal-agenda-ingestion hourly, forecast-daily 08:00, alert-eval :30 hourly; `/tmp/cron.tick` heartbeat | `[V]` |
| E16 | Alert evaluation | `lib/runners/alertEval.ts`; detectors `lib/services/operatorWorkspace/runnerAlerts.ts:53-62,735-743`; review route `app/api/market-intelligence/workspace/alerts/[id]` | Hourly; 9 deterministic detectors — **all market-intelligence domain** (emergence, trajectory, source degradation, governance burst…). Persists `AlertEvent` with fingerprint cooldown. **Zero detectors cover jobs, storage, DB, auth, or infrastructure** | `[V]` |
| E17 | Domain history tables | `ConsultantReportRevision`/`ConsultantDispositionRecord`, `TradeResponseRevision`/`ReviewDecision`, `MeetingRegisterEntry(+Revision)`, `MeetingExtractionRun`, `MeetingMinutesRevision`, `MeetingTranscriptCorrection`, `ProjectTimelineEvent`, `ProjectStateTransition`, `ProcorePush`, `ProcoreWebhookEvent` (schema §3 of the inventory; e.g. `schema.prisma:4198-4812`) | Append-only/immutable domain evidence with Restrict FKs (post-migration-100) | `[V]` |
| E18 | `AiUsageLog` | `prisma/schema.prisma:1114-1129`; writer `lib/services/ai/aiUsageLog.ts:103-121` | Per-call provider usage: tokens, cost, status ok\|error\|stub, bounded errorMessage. Writer is **fail-open** (swallows) and non-transactional | `[V]` |
| E19 | Credential-access log | `lib/services/credentials/auditLog.ts:20-40` | NDJSON flat file `/storage/audit/credentials-access.jsonl` (service/field/caller only — never values); survives DB outage | `[V]` |
| E20 | Error responses | `lib/auth-helpers.ts:54,93,138-165`; ~940 literal status sites in `app/api` | Uniform `{error: string}` envelope; 401/403/404/409/500 conventions; cross-bid access deliberately collapses to 404 (`auth-helpers.ts:132-156`) | `[V]` |
| E21 | Ad-hoc route logging | 177 `console.*` call sites across `app/`+`lib/` | `console.error("[route] error:", err)` in catch blocks; no correlationId, no envelope, inconsistent | `[V]` |
| E22 | Sidecar logging | `sidecar/` — 3 non-test `print()` calls (`routers/meetings.py:89`, `routers/parse.py:545`, `services/credentials.py:66`) | Effectively no sidecar observability: no logger, no levels, no correlation ids; auth denials (`sidecar_auth.py:20`) unlogged | `[V]` |
| E23 | Migration state | `scripts/apply-turso-migrations.mjs:161-197` (`_prisma_migrations` + sha256 checksums, partial-state WARNING, exit 2 = partial); `scripts/migration-lint.mjs`; `scripts/replay-validation.mjs` (`prisma migrate diff`, exit 2 = drift) | Applied-state recording + additive-only lint + local drift proof. **No continuous/live drift check** | `[V]` |
| E24 | Staging validator | `scripts/validate-staging.mjs` | 8 on-demand checks: app health, sidecar health, `/metrics` format, Turso migration state vs local set, Prometheus target, Loki ingestion, AuditEvent write/read, RunnerLease cycle. Manual, not scheduled | `[V]` |
| E25 | Other operator scripts | `scripts/divergence-report.mjs`, `scripts/activation-report.ts`, `scripts/manage-queue.mjs`, `scripts/storage-inventory-backfill.ts`, `scripts/specbook-staging-smoke.mjs` | Git divergence report; MI activation audit (incl. last-cycle ages); raw-libsql market_scrape queue CLI; storage-path column inventory/backfill (report-only default, double-gated apply, journaled, reversible); staging storage smoke driver | `[V]` |
| E26 | Storage smoke mode | 4-condition gate (admin + marker header + `STORAGE_SMOKE_MODE_ENABLED` + `APP_ENV=staging`), e.g. `app/api/bids/[id]/drawings/upload/route.ts:23-138` | Proves storage round-trip mechanics with automation suppressed; fail-closed | `[V]`; one staging run proven `[OP]` |
| E27 | Backup/restore | `runtime/runbooks/staging-backup-restore.md` | **Documentation only.** `backup-staging.sh` / `restore-staging-drill.sh` do not exist; no backup cron; no drill ever executed | `[V]` docs; capability **absent** |
| E28 | Deployment stubs | `runtime/deployment/*.sh` (e.g. `health-check.sh`, `snapshot-prod.sh`) | Print-plan-and-exit stubs by design (`.claude/rules/environments-deployment.md`) — not executable recovery | `[V]` `[DEC]` |
| E29 | BlobStore + integrity fields | `lib/storage/blobStore.ts` (local FS only; `put` returns `{size, sha256}`); checksums stored only for consultant reports/stream exports (`schema.prisma:4207,4290`) | Storage layer computes hashes; most callers discard them; no read-time verification anywhere | `[V]` |
| E30 | External-token rate limiter | `lib/services/tradeResponse/rateLimit.ts` (60 req/60s, DB bucket, digest-keyed); enforced `app/api/external/response/[token]/route.ts:7` | Abuse containment exists; **rejections emit no log/metric/audit** | `[V]` |
| E31 | Docker/compose logging config | grep of `runtime/compose/**` | **No `logging:` driver options anywhere** → unbounded default json-file; no logrotate; no disk monitoring | `[V]` (absence verified) |
| E32 | Durable mission reports | `/home/neuroglitch/gwx-ops/reports/*.md` (25+ R2/SOL reports incl. `r2-convergence-control.md`, `r2-auth-regression-pack.md`, `r2-local-certification-harness.md`) | Program-level evidence: review verdicts, test counts, known fail-open findings, worktree/branch truth | `[OP]`/`[V]` |

**Current signals inventoried: 32.**

### 1a. Known audit-integrity defects already on record (inherited, not re-derived)

From `r2-auth-regression-pack.md` (Builder-2, 2026-07-18), pinned by passing tests at base `c1312a7` and still relevant to `9b283b9` `[V]`:
- `acceptObservationAsNewItem` and `linkObservationToItem` (`lib/services/consultantReports/observations.ts`) commit mutations even when the AuditEvent write fails (legacy `audit()` helper swallows).
- `setFormalResponse` (`lib/services/consultantReports/formalResponse.ts`) has the same fail-open shape.
- Meeting Register rerun can supersede human-edited-but-still-PENDING entries.

These are **product defects with observability consequences** (a mutation without durable history — FM-12). They are inputs to this audit, owned by the SOL remediation/rereview chain, not re-opened here.

---

## 2. Failure-mode matrix

Severity: **SEV-1** = operator must act now (data loss / integrity / total outage risk). **SEV-2** = act within the day (degradation, stuck work, silent divergence). **SEV-3** = track and fix (hygiene, latency). Priorities: **P0** before staging promotion of the R2 line, **P1** before production, **P2** operational hardening, **P3** future.

Diagnostic commands are **operator-executed, read-only**. All recovery writes go through gated tooling only (`.claude/rules/migrations-checkpoints.md`: no manual DB edits, ever). Where no gated write path exists today the entry says **RECOVERY GAP** — the gap itself is a backlog item.

---

### FM-01 — BackgroundJob stuck with `activeSlot=1`
- **Failure:** a `running` (or `queued`) job whose process died holds `activeSlot=1` forever; the `@@unique([bidId, jobType, activeSlot])` slot (`schema.prisma:1413`) blocks all future jobs of that type for that bid.
- **Current detectability:** NONE automated. No sweep, no metric, no alert. `[V]`
- **Current evidence:** the DB row itself (`status`, `startedAt`, `activeSlot`); per-bid UI job status where surfaced.
- **Missing signal:** running/queued age metric; stuck-slot detector.
- **Metric/log required:** gauge `gwx_jobs_oldest_active_age_seconds{jobType,status}`; counter `gwx_jobs_terminal_total{jobType,status}`; detector audit event `system_health/job_stuck`.
- **Alert threshold:** running age > 2× per-jobType expected duration (default 30 min; transcription 2 h); queued age > 30 min while worker healthy.
- **Severity:** SEV-2 (SEV-1 if it blocks a deadline-bound bid workflow).
- **Impact:** silent permanent loss of that job lane for the bid; users see a spinner or nothing.
- **Immediate action:** confirm process/worker state before touching the row — a *live* long job must not be killed.
- **Safe diagnostics:** read-only `SELECT id,jobType,status,bidId,startedAt,externalJobId FROM BackgroundJob WHERE activeSlot=1 AND status='running' ORDER BY startedAt;` `docker ps` / container health; sidecar job status via `GET .../status` route.
- **Recovery:** for market_scrape queued jobs: authenticated cancel route (`app/api/jobs/[id]/route.ts:56` clears `activeSlot`) `[V]`. For running jobs of other types: **RECOVERY GAP** — no gated tool marks a dead running job failed. `scripts/manage-queue.mjs` cancel writes `status='cancelled'` **without clearing `activeSlot`** (`manage-queue.mjs:48-65`) — using it leaves the slot occupied (defect, backlog B-08). Proposed: gated job-repair CLI (report-only default, confirm phrase, journal).
- **Automatic recovery safe?** NO today (cannot distinguish dead from slow without a heartbeat). After a job-lease/heartbeat exists: auto-fail past-deadline jobs is safe (forward-only status write + audit).
- **Verify recovery:** row terminal with `activeSlot IS NULL`; new job of same type/bid can be created; audit event recorded.
- **Escalation:** if the slot row won't clear via gated tooling → stop, escalate to Josh; never hand-edit.
- **Data-loss risk:** none directly (job payloads are re-derivable); workflow-progress loss.
- **Priority:** **P0** (detection + repair tool). ⚠ media patches touch this state machine.

### FM-02 — Queued job never starts
- **Failure:** `queued` row never transitions: worker down, `runAfter` in the future, wrong jobType (the `run-due` worker pulls **only** `market_scrape`: `app/api/jobs/run-due/route.ts` — other jobTypes are started inline by their trigger and never re-picked-up), or `WORKER_TOKEN` unset (route returns 503).
- **Current detectability:** PARTIAL-manual: `GET /api/jobs/run-due` returns `{enabled, queued}` `[V]`; worker tick healthcheck detects a wedged loop `[V]`. No alert, no age visibility.
- **Current evidence:** BackgroundJob rows; worker container logs (every response logged, incl. `processed:0`).
- **Missing signal:** queued-depth + oldest-queued-age gauges; worker last-success timestamp as a metric.
- **Metric/log required:** `gwx_jobs_queued_depth{jobType}`, `gwx_jobs_oldest_queued_age_seconds{jobType}`, `gwx_worker_last_run_due_success_timestamp`.
- **Alert threshold:** oldest queued age > 30 min (market_scrape, respecting `runAfter`); any queued row of a jobType that has no consumer > 10 min (that's a bug, not a backlog).
- **Severity:** SEV-2.
- **Impact:** scrapes/analyses silently never happen; MI freshness decays.
- **Immediate action:** check worker container health + `GET /api/jobs/run-due`; check `runAfter` values.
- **Safe diagnostics:** `SELECT jobType,status,COUNT(*),MIN(createdAt) FROM BackgroundJob WHERE status='queued' GROUP BY 1,2;` `docker inspect --format '{{.State.Health.Status}}' <worker>`.
- **Recovery:** restart worker container (human, per environments rule); token misconfig → env fix + redeploy (human). Queued-forever rows of consumer-less types: cancel via gated path, re-trigger from the app.
- **Automatic recovery safe?** Worker restart-on-crash already exists (`restart: unless-stopped`). Auto-cancel of stale queued rows: NO — operator decision.
- **Verify:** queue depth drains; worker log shows `processed>0`.
- **Escalation:** worker healthy + token OK but jobs still stuck → code path issue, escalate.
- **Data-loss risk:** none.
- **Priority:** **P0**.

### FM-03 — Running job exceeds expected duration
- **Failure:** job runs but far beyond norm (hung sidecar call, huge input).
- **Current detectability:** NONE (no duration expectation exists anywhere). `[V]`
- **Current evidence:** `startedAt` on the row; sidecar logs (minimal).
- **Missing signal:** same age gauge as FM-01 + per-jobType duration histogram `gwx_job_duration_seconds{jobType,status}` on terminal transition.
- **Alert threshold:** p99/2× baseline per jobType once baselines exist; bootstrap with fixed budgets (scrape 15 min, spec analysis 30 min, transcription 2 h).
- **Severity:** SEV-3 → SEV-2 if recurring.
- **Impact:** slot held (blocks successor jobs), user-visible latency.
- **Immediate action / diagnostics / recovery:** as FM-01; prefer waiting over killing.
- **Automatic recovery safe?** NO (cannot distinguish slow from dead today).
- **Verify:** terminal transition recorded with duration.
- **Escalation:** repeated overrun of one jobType → open defect.
- **Data-loss risk:** none.
- **Priority:** **P1**.

### FM-04 — Provider job exists but local reservation is missing
- **Failure:** sidecar/WhisperX holds a job the app has no BackgroundJob row for (row deleted, crash between provider submit and `startJob`, or `startJob` write failed).
- **Current detectability:** NONE. There is no provider-side job enumeration or reconciliation anywhere. `[UNK]` whether the sidecar can even list jobs. `[V]` (absence in app code)
- **Current evidence:** sidecar process state only.
- **Missing signal:** periodic reconciliation: provider job list ↔ `BackgroundJob.externalJobId`.
- **Metric/log required:** reconciliation runner emitting `gwx_job_reconcile_orphans_total{side="provider"}` + audit event per orphan.
- **Alert threshold:** any occurrence (should be ~0).
- **Severity:** SEV-3 (wasted compute; a completed result nobody consumes).
- **Impact:** GPU/CPU burn; possible surprise callback hitting a 404 job match (spec-analyze completion is dropped with a log if `findJobByExternalId` misses `[INF]`).
- **Immediate action:** none urgent; record.
- **Safe diagnostics:** `SELECT externalJobId FROM BackgroundJob WHERE externalJobId IS NOT NULL AND status='running';` vs sidecar state (requires new sidecar list endpoint — backlog).
- **Recovery:** let provider job finish and discard; cancel provider-side if supported (human).
- **Automatic recovery safe?** Discarding unmatched callbacks is already the behavior; YES for that. Cancelling provider jobs automatically: NO.
- **Verify:** reconciliation clean on next cycle.
- **Escalation:** recurring → find the crash window.
- **Data-loss risk:** none.
- **Priority:** **P2**.

### FM-05 — Local job exists but provider job is missing
- **Failure:** `running` BackgroundJob whose `externalJobId` the sidecar no longer knows (sidecar restarted — job state is in-process/ephemeral `[INF]`).
- **Current detectability:** PARTIAL for transcription only, and only if a client polls: the status route proxies the sidecar and surfaces failure to that client (`status/route.ts:257-261`); nothing server-side notices. Spec analysis: NONE (waits forever for a webhook that will never come).
- **Missing signal:** server-side janitor that re-polls `running` jobs' provider status past a deadline and fails them through the service path.
- **Metric/log:** `gwx_job_provider_lost_total{jobType}` + audit event.
- **Alert:** any occurrence.
- **Severity:** SEV-2.
- **Impact:** permanently stuck job + slot (= FM-01 by another road); meeting stuck in TRANSCRIBING.
- **Immediate action:** confirm sidecar restart happened (container uptime).
- **Safe diagnostics:** `docker ps` (sidecar start time) vs `BackgroundJob.startedAt`; poll the status route read-only.
- **Recovery:** fail the job via gated path (**RECOVERY GAP**, same tool as FM-01), user re-triggers upload/analysis. Meeting rows: status must be reset through the app's audited mutation paths, never SQL.
- **Automatic recovery safe?** YES once the janitor exists: sidecar-restart + unknown-job is a deterministic dead state; auto-fail with audit is safe and is the *proposed* design (subject to the FM-06/GWX-Q07-class harness decision for transcription `[DEC]`-pending).
- **Verify:** job failed + slot cleared + meeting FSM shows FAILED with retriable UI.
- **Escalation:** if sidecar loses jobs *without* restarting → sidecar defect.
- **Data-loss risk:** uploaded audio is durable (`audioStorageKey`) — re-transcription possible; no source loss.
- **Priority:** **P1**.

### FM-06 — Provider callback never arrives
- **Failure:** spec-analyze webhook (`analyze/complete`) never fires (sidecar crash mid-run, network, token mismatch → 401 at the receiving route).
- **Current detectability:** NONE server-side; job stays `running` forever. Callback POST failures are printed sidecar-side only (`parse.py:545`). `[V]`
- **Missing signal:** running-age detector (FM-01) + callback-deadline janitor (FM-05) + counter for rejected callbacks `gwx_callback_rejected_total{reason}` at the receiving route.
- **Alert:** rejected-callback counter > 0 (token misconfig is a deploy defect); running-age breach.
- **Severity:** SEV-2.
- **Impact:** spec analysis never completes; slot held.
- **Immediate action:** check sidecar logs for the `[callback]` failure line; verify `SIDECAR_CALLBACK_TOKEN` consistency (names only, never values).
- **Safe diagnostics:** Loki query for `[callback]`; read-only job row check.
- **Recovery:** fail via gated path + re-trigger analysis.
- **Automatic recovery safe?** Deadline-based auto-fail YES (post-janitor); auto-*retriggering* analysis NO (provider cost — human/queue-card gate `[DEC]`).
- **Verify:** re-run completes; `AiUsageLog` row present.
- **Escalation:** systematic callback failures → transport/config defect.
- **Data-loss risk:** none (inputs durable).
- **Priority:** **P1** (detection is P0 via FM-01's age alert).

### FM-07 — `failJob` or reconciliation itself fails
- **Failure:** the terminal-transition write throws; every caller swallows it (`.catch(()=>{})` — `status/route.ts:75-77`, `analyze/complete/route.ts:71,171`, automation triggers) leaving the row `running`+slot held with **zero trace**. `[V]`
- **Current detectability:** NONE. This is the worst silent path in the job system.
- **Missing signal:** never-swallow: on terminal-transition failure emit CRITICAL `[audit]` stdout (`system_health/job_terminal_write_failed`, forceDbPersist=false — DB may be the thing failing) + counter `gwx_job_terminal_write_failures_total`.
- **Alert:** any occurrence → SEV-1 signal (it usually means DB trouble).
- **Severity:** SEV-1.
- **Impact:** stuck slot + lost failure evidence; if the cause is DB-wide, everything else is failing too.
- **Immediate action:** treat as DB incident first (see FM-08/10).
- **Safe diagnostics:** Loki CRITICAL stream; DB reachability probe.
- **Recovery:** fix DB condition; then repair rows via gated tool (FM-01).
- **Automatic recovery safe?** Retry-once with backoff on the terminal write: YES (idempotent status write). Beyond that, no.
- **Verify:** counter stops; rows reconciled.
- **Escalation:** immediately, if paired with other DB errors.
- **Data-loss risk:** evidence loss (the error message), not domain data.
- **Priority:** **P0**.

### FM-08 — Repeated SQLite lock contention
- **Failure:** libsql `SQLITE_BUSY`-class stalls under concurrent writers.
- **Current detectability:** NONE structured. No `busy_timeout` PRAGMA, no retry wrapper, no error classifier — grep for `SQLITE_BUSY`/`P1008`/`busy_timeout` = zero hits (`lib/prisma.ts` reviewed). Errors surface as generic 500s + ad-hoc `console.error`. `[V]`
- **Missing signal:** DB-error classifier at a single choke point tagging busy/locked codes; counter `gwx_db_errors_total{class="busy"|"locked"|"other"}`; Loki pattern alert as interim.
- **Alert:** busy count > 5 in 10 min = SEV-2; sustained = SEV-1.
- **Severity:** SEV-2→SEV-1.
- **Impact:** user-facing 500s, failed jobs, partial workflows (mitigated by fail-closed transactions).
- **Immediate action:** identify the hot writer (recent deploy? runner cycle overlap? backup tar running against the DB file? `[INF]`).
- **Safe diagnostics:** Loki error-rate by route; runner cycle timings (`neuroglitch_runner_cycle_duration_seconds`); host I/O (`iostat`, `df`).
- **Recovery:** reduce concurrency (pause cron runners via human-gated container stop) until clear; then product fix (busy_timeout/retry — backlog B-18).
- **Automatic recovery safe?** Bounded retry-with-backoff on classified-busy writes: YES (that is the fix, not a recovery hack). Auto-pausing runners: NO.
- **Verify:** busy counter → 0; error rate normal.
- **Escalation:** contention without load growth → schema/query defect; escalate with evidence.
- **Data-loss risk:** low (failed transactions roll back); integrity preserved by design.
- **Priority:** **P1** instrumentation; P2 remediation.

### FM-09 — High retryable-409 rate
- **Failure:** clients hammer app-level 409 conflict gates (frozen transcript, duplicate submit, append-only guards — 23 literal 409 sites `[V]`).
- **Current detectability:** NONE aggregated (individual responses only; denials unlogged).
- **Missing signal:** HTTP status-class counter `gwx_http_responses_total{status_class,route_group}` (bounded route groups, not raw paths).
- **Alert:** 409 rate > 10× baseline for 15 min — usually a stuck client/UI retry-loop bug.
- **Severity:** SEV-3.
- **Impact:** noise, load; can mask a real conflict bug.
- **Diagnostics:** Loki by route group once labeled; identify actor.
- **Recovery:** none server-side; fix client.
- **Automatic recovery safe?** N/A.
- **Verify:** rate returns to baseline.
- **Escalation:** 409s on paths that should never conflict → logic defect.
- **Data-loss risk:** none (409 = correctly refused write).
- **Priority:** **P2**.

### FM-10 — Unexpected P1008 / SQLITE_BUSY
- Same substrate as FM-08; listed separately because a **single** unexpected busy/timeout on a normally-quiet path is a leading indicator (disk pressure, runaway query, checkpoint stall).
- **Alert:** ANY P1008/SQLITE_BUSY classified error → notify (not page).
- **Severity:** SEV-2 as a singleton signal.
- **Everything else:** as FM-08. **Priority: P1** (comes free with the FM-08 classifier).

### FM-11 — Audit/history write failure
- **Failure:** AuditEvent or domain-history write fails.
- **Current detectability:** GOOD for the two designed paths `[V]`: fail-closed tx paths abort the mutation (user sees 500 — correct); fail-open telemetry path increments `neuroglitch_audit_persistence_failures_total` + CRITICAL `console.error` (`audit.ts:164-176`). **But no alert consumes the counter**, and the §1a legacy fail-open holes bypass both.
- **Missing signal:** alert rule on the existing counter; closure of §1a holes (SOL-owned).
- **Alert:** `neuroglitch_audit_persistence_failures_total` increase > 0 in 5 min → SEV-1.
- **Severity:** SEV-1 (accountability layer).
- **Impact:** fail-closed: feature outage (correct behavior). Fail-open: silent evidence loss.
- **Immediate action:** treat as DB incident; identify failing category from counter label.
- **Safe diagnostics:** Loki `CRITICAL` + `[audit]` stream gap analysis; `SELECT category,COUNT(*) FROM AuditEvent WHERE emittedAt > datetime('now','-1 hour') GROUP BY 1;`
- **Recovery:** fix DB; stdout stream in Loki is the interim record — reconcile after (stdout fan-out happens even when DB persist fails `[V]`).
- **Automatic recovery safe?** NO writes; the design already does the right thing.
- **Verify:** counter flat; spot-check category counts resume.
- **Escalation:** immediate if fail-closed 500s are user-visible.
- **Data-loss risk:** audit-trail gaps on fail-open paths (Loki 90-day retention is the backstop).
- **Priority:** **P0** (the alert rule); §1a closure tracked in SOL rereview.

### FM-12 — Mutation committed without durable history
- **Failure:** the invariant behind FM-11 actually broken — a state change with no history row.
- **Current detectability:** structurally prevented on R2 core paths (in-tx `persistAuditEnvelope`, Restrict FKs since migration 100, client-extension append-only guards) `[V]`; **known holes** §1a; ⚠ HIGH-3 (media/history race) is exactly this class and its fix is uncommitted.
- **Missing signal:** periodic invariant reconciliation (read-only): mutations-vs-history coverage sample (e.g. TrackedItems created in window ↔ audit rows), emitted as a report + `gwx_history_coverage_gaps_total`.
- **Alert:** any gap → SEV-1 investigation.
- **Severity:** SEV-1.
- **Impact:** accountability loss; review-gate premise broken.
- **Immediate action:** stop relying on affected history lane; snapshot evidence.
- **Safe diagnostics:** targeted read-only joins per domain (runbook §D).
- **Recovery:** forward-fix code; history backfill only via an explicit reviewed card — never fabricate history rows.
- **Automatic recovery safe?** NO. Never auto-write history.
- **Verify:** reconciliation clean over next window.
- **Escalation:** always — this is a release-gate breach.
- **Data-loss risk:** evidence loss (the thing the R2 program exists to prevent).
- **Priority:** **P1** (reconciliation job); holes themselves are SOL-owned P0-equivalents already tracked.

### FM-13 — Authorization-denied spikes
- **Failure:** burst of 401/403 (probing, broken client, auth misconfig after deploy).
- **Current detectability:** NONE — denial paths return without any log/metric/audit (`lib/auth-helpers.ts` has zero logging `[V]`; no authz category in taxonomy `[V]`).
- **Missing signal:** counter `gwx_authz_denials_total{kind=unauthenticated|forbidden|cross_bid_404, route_group}` + audit event (bounded: no path params, no body) for `forbidden`/`cross_bid_404`.
- **Alert:** denial rate > 5× baseline 15 min → SEV-2; sustained unauthenticated spike on external routes → SEV-2 security review.
- **Severity:** SEV-2.
- **Impact:** can't distinguish attack / broken deploy / expired sessions — today all invisible.
- **Immediate action:** correlate with deploy time; check caddy access pattern.
- **Safe diagnostics:** Loki (once emitted); caddy logs.
- **Recovery:** config/deploy rollback (human) if deploy-correlated; else monitor.
- **Automatic recovery safe?** N/A (no write).
- **Verify:** rate normalizes.
- **Escalation:** credential-stuffing pattern → security escalation to Josh.
- **Data-loss risk:** none.
- **Priority:** **P0**.

### FM-14 — Cross-bid access attempts
- **Failure:** authenticated user probing other bids' resources.
- **Current detectability:** NONE — deliberately collapsed to 404 externally (correct `[DEC]`), but also not recorded internally (`auth-helpers.ts:147-156` `[V]`). 68 cross-bid tests prove *rejection*, not *visibility* `[V]`.
- **Missing signal:** the `cross_bid_404` counter/audit of FM-13 (internal only; external response stays 404).
- **Alert:** > 3 distinct cross-bid 404s from one actor in 1 h → SEV-2 review.
- **Severity:** SEV-2.
- **Impact:** insider probing invisible today.
- **Action/diagnostics/recovery:** review actor's audit trail; account action is human-owned.
- **Automatic recovery safe?** NO (account lockout is a human decision).
- **Verify:** monitoring continues; incident note recorded.
- **Escalation:** any confirmed deliberate probing → Josh.
- **Data-loss risk:** none (tenancy held); confidentiality risk if a gap ever pairs with it.
- **Priority:** **P0** (same packet as FM-13).

### FM-15 — Token / external-response abuse
- **Failure:** leaked/rotated-away external response token replayed; scripted abuse of the contractor portal.
- **Current detectability:** PARTIAL-invisible: limiter enforces (60/60s `[V]`), expiry/revocation enforced, external *mutations* are audited (`register_action`, actor `anonymous` `[V]`) — but **denials, rate-limit hits, and expired/revoked-token attempts emit nothing** (`app/api/external/**` has zero log/audit calls `[V]`).
- **Missing signal:** `gwx_external_denied_total{reason=not_found|expired|revoked|rate_limited}` + audit event on revoked-token *use* (that's a leak indicator).
- **Alert:** rate_limited > 0 sustained 10 min → SEV-3; revoked-token use > 0 → SEV-2.
- **Severity:** SEV-2.
- **Impact:** abuse invisible; sub-confidentiality perimeter unobserved.
- **Immediate action:** rotate token for the affected package (`rotate-token` route — existing, audited `[V]`).
- **Safe diagnostics:** Loki once emitted; `SELECT` on rate-limit buckets (read-only).
- **Recovery:** rotate/revoke token (existing gated app routes); notify GC.
- **Automatic recovery safe?** NO auto-revocation (business decision).
- **Verify:** old token 404s (existing behavior); denial counters show the block.
- **Escalation:** evidence of token sharing beyond intended sub → Josh.
- **Data-loss risk:** none; confidentiality exposure bounded by token scope + 404 design.
- **Priority:** **P0** (counters), given the external surface ships with R2.

### FM-16 — Upload failure after blob write
- **Failure:** blob persisted, DB row fails.
- **Current detectability:** SPLIT `[V]`: trade-response attachments + meeting audio have compensating deletes (meeting logs "Failed to compensate…" if even that fails: `upload/route.ts:236-263`); consultant reports orphan-by-design (content-addressed, next identical upload reuses); **drawings and addendums silently orphan** (`drawings/upload/route.ts:179→193`, `addendums/upload/route.ts:61→64`, no cleanup).
- **Missing signal:** `gwx_upload_compensation_total{domain,outcome=deleted|failed}`; orphan sweeper (FM-17) as the backstop.
- **Alert:** compensation-failed > 0 → SEV-3 ticket.
- **Severity:** SEV-3.
- **Impact:** disk growth; user got an error and can retry (no user-facing corruption).
- **Action:** none urgent; sweeper reconciles.
- **Diagnostics:** sweeper report (once built).
- **Recovery:** delete orphans via the sweeper's journaled apply mode (gated, report-only default — mirrors `storage-inventory-backfill` pattern `[DEC]`). Never `rm` ad-hoc: `.claude` rules forbid deleting blobs the tool didn't create without gating.
- **Automatic recovery safe?** Report-only always safe; auto-delete NO (require journaled human-approved apply).
- **Verify:** sweeper re-run shows zero.
- **Escalation:** orphan rate growing → upload-path defect.
- **Data-loss risk:** none (orphans are unreferenced by definition — verify before delete).
- **Priority:** **P2** (compensation parity); sweeper P1.

### FM-17 — Unreferenced / orphan blob
- **Failure:** blobs on disk without any DB reference (FM-16 accumulation, crash windows, historical).
- **Current detectability:** NONE — `storage-inventory-backfill.ts` inventories **DB column values only**, explicitly never touches the filesystem (`storageInventory/index.ts:10-35` `[V]`). No disk↔DB reconciler exists.
- **Missing signal:** storage integrity sweeper: walk storage root, join against all storage-key columns (E29 field list), emit `gwx_blob_orphans{count,bytes}` + report artifact.
- **Alert:** orphan bytes > 5 GB or > 10% of store → SEV-3.
- **Severity:** SEV-3.
- **Impact:** disk growth (compounds FM-27).
- **Recovery:** journaled gated delete (as FM-16).
- **Automatic recovery safe?** NO auto-delete.
- **Verify:** re-sweep clean; disk reclaimed.
- **Escalation:** none unless growth rate anomalous.
- **Data-loss risk:** the *sweep* is the risk if wrong — hence report-only default + journal + human apply `[DEC]`-style gate.
- **Priority:** **P1** (build sweeper), report-only.

### FM-18 — Missing referenced blob
- **Failure:** DB row points at a key `get()` can't read (deleted, wrong root, restore mismatch).
- **Current detectability:** PARTIAL: per-request 404 "File is missing from storage" on every download route + `console.error` for consultant reports `[V]`; Spec Book proactive `fileAvailability` check surfaces missing/invalid pre-click `[V]`. **No aggregate signal** — one user's 404 tells no one.
- **Missing signal:** counter `gwx_blob_missing_total{domain}` at the shared miss points; sweeper (FM-17) reverse direction: referenced-but-absent list.
- **Alert:** ANY missing-referenced-blob → SEV-1 (either data loss or a mis-mounted storage root — both urgent).
- **Severity:** SEV-1.
- **Impact:** user-facing data loss of evidence files (field reports, consultant PDFs, meeting audio).
- **Immediate action:** FIRST check mount/config: `STORAGE_LOCAL_PATH`, volume mounts, recent deploy/restore — a wrong root looks identical to loss and is fully recoverable.
- **Safe diagnostics:** `docker inspect` mounts; `ls` the expected key path (read-only); sweeper report; compare against last backup manifest (once backups exist).
- **Recovery:** config error → human redeploy with correct mount. True loss → restore from backup (**currently impossible — no backup exists, FM-22**); else re-upload by the user; record an incident note in the affected record via normal app flows.
- **Automatic recovery safe?** NO.
- **Verify:** download succeeds; sweeper clean.
- **Escalation:** always (data loss class), to Josh.
- **Data-loss risk:** **HIGH — this is the realized data-loss failure.** The only mitigations today are ad-hoc; backup (FM-22) is the real answer.
- **Priority:** **P1** detection; backup dependency P1-hard.

### FM-19 — Attachment checksum or size mismatch
- **Failure:** stored bytes ≠ recorded checksum/size (corruption, truncated write, tamper).
- **Current detectability:** NONE at read time anywhere `[V]`. Checksums exist only for consultant reports/stream exports and are used solely for upload dedupe (`consultantReports/index.ts:131-148`).
- **Missing signal:** sweeper verify pass (hash sampled/all blobs vs stored checksum where present) + `gwx_blob_checksum_mismatch_total`; store `PutResult.sha256` for the domains that currently discard it (schema change → explicit queue card required `[DEC]`).
- **Alert:** any mismatch → SEV-1.
- **Severity:** SEV-1 (integrity).
- **Impact:** silently corrupted evidence files.
- **Action/diagnostics:** re-hash read-only; compare backup copy.
- **Recovery:** restore from backup (FM-22 dependency); re-upload.
- **Automatic recovery safe?** NO.
- **Verify:** re-hash matches.
- **Escalation:** any mismatch → Josh (possible disk fault).
- **Data-loss risk:** HIGH if backups absent.
- **Priority:** **P2** (verify pass), after P1 sweeper skeleton.

### FM-20 — Migration mismatch
- **Failure:** DB applied-set ≠ image's expected set (missed apply before deploy, partial apply).
- **Current detectability:** PARTIAL-manual: runner records + surfaces partial state (exit 2, WARNING `[V]`); `validate-staging.mjs` check #4 compares live state to local set `[V]` — **but only when a human runs it**. Runtime: the app never checks; Prisma queries just fail at first missing-column touch (generic 500s).
- **Missing signal:** migration-state check in a deep-health surface: applied-count + latest-name vs build-time expected manifest → `gwx_migration_state{status=ok|behind|partial|unknown}`.
- **Alert:** anything ≠ ok → SEV-1 block-deploy signal.
- **Severity:** SEV-1.
- **Impact:** hard runtime errors on new-column paths; the exact failure the Q02→Q03 ordering rule exists to prevent `[DEC]`.
- **Immediate action:** STOP further deploys; run `validate-staging.mjs` check; read `_prisma_migrations` read-only.
- **Safe diagnostics:** `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 10;` runner `--dry-run`.
- **Recovery:** apply pending via `scripts/apply-turso-migrations.mjs` — **human-executed, per-invocation approval, same-day checkpoint first** (`.claude/rules/migrations-checkpoints.md` `[DEC]`). Partial (exit 2) = full stop → operator + forward-fix, never retry-loop.
- **Automatic recovery safe?** ABSOLUTELY NOT. Migrations are never auto-run `[DEC]`.
- **Verify:** runner reports none pending; deep-health ok; re-run validate.
- **Escalation:** partial state → immediately Josh, before anything else touches the DB.
- **Data-loss risk:** low (additive-only discipline) but partial-state ambiguity is why the checkpoint gate exists.
- **Priority:** **P0** (the check); the process gates already exist.

### FM-21 — Schema drift
- **Failure:** live schema differs from migrations-derived schema (a manual edit — prohibited — or restore of a stale snapshot).
- **Current detectability:** LOCAL-ONLY: `replay-validation.mjs` proves migrations⇒schema on an ephemeral DB (exit 2 on drift `[V]`); nothing compares a **live** DB's actual DDL. Runner checksums detect edited migration *files* `[V]`.
- **Missing signal:** operator drift probe: dump live DDL (read-only) and diff against replay-derived DDL; part of pre-deploy checklist rather than continuous.
- **Alert:** any drift → SEV-1 freeze.
- **Severity:** SEV-1.
- **Impact:** undefined behavior under ORM assumptions.
- **Recovery:** forward-only migration to reconcile, via full gate chain; never edit live DDL `[DEC]`.
- **Automatic recovery safe?** NO.
- **Verify:** drift probe clean.
- **Escalation:** drift found → full stop, Josh, provenance investigation (drift implies a prohibited action happened).
- **Data-loss risk:** medium (depends on drift nature).
- **Priority:** **P2** (probe script); prevention already structural.

### FM-22 — Database backup failure
- **Failure:** scheduled backup doesn't run / produces bad artifact.
- **Current detectability:** N/A in the worst way: **there is no backup to fail.** `runtime/runbooks/staging-backup-restore.md` is a spec; scripts don't exist; no cron entry `[V]`. Turso-side PITR state: `[UNK]` from this worktree.
- **Missing signal:** after implementation: `gwx_backup_last_success_timestamp{kind=db|storage}` + manifest artifact per run.
- **Alert:** backup age > 26 h → SEV-1.
- **Severity:** SEV-1 (as a standing condition, it's the program's largest unmitigated risk paired with FM-18/19).
- **Impact:** any data-loss event is currently unrecoverable except via Turso PITR (`[UNK]` unverified) — blob storage has no PITR at all.
- **Immediate action (today):** treat every integrity alert as potentially unrecoverable; escalate early.
- **Recovery:** implement per runbook §1-§6 (human-gated); off-host copy required.
- **Automatic recovery safe?** Backups themselves should be automated (that's the point); restore never auto.
- **Verify:** manifest + checksum + age metric.
- **Escalation:** backup failing 2 consecutive runs → Josh.
- **Data-loss risk:** defines it.
- **Priority:** **P1-hard** (production gate); staging can proceed with checkpoint discipline `[DEC]`.

### FM-23 — Restore verification failure
- **Failure:** backups exist but don't restore (bad tar, schema/version skew, wrong root layout).
- **Current detectability:** NONE — **no restore drill has ever been executed** (`staging-backup-restore.md:7-14` `[V]`; parallel to Ledger Q08 discipline `[DEC]`).
- **Missing signal:** drill evidence artifact (runbook §8 table) + `gwx_restore_drill_last_success_timestamp`.
- **Alert:** drill age > 90 days → SEV-2 (once drills exist).
- **Severity:** SEV-1 at the gate (untested backup = no backup).
- **Recovery path:** execute drill per runbook §7 into isolated targets; never over live `[DEC]`.
- **Automatic recovery safe?** NO — drills are human, scheduled, evidenced.
- **Verify:** drill checklist green, evidence recorded in gwx-ops.
- **Escalation:** drill failure → block production, fix, re-drill.
- **Data-loss risk:** hidden until it matters.
- **Priority:** **P1-hard: production promotion gate — restore-proof-required** (mirrors migrations-checkpoints rule).

### FM-24 — Worker offline
- **Failure:** worker container down/wedged; queue accumulates.
- **Current detectability:** PARTIAL: Docker healthcheck flags `unhealthy` on stale tick `[V]`, `restart: unless-stopped` revives crashes — but **an `unhealthy`-but-running container is never restarted or alerted** (no autoheal, no docker-events consumer, no alert rule `[V]`), and nothing watches queue depth (FM-02).
- **Missing signal:** queue-depth/age alerts (FM-02) — these catch worker-offline *by effect*, which is the signal that matters; optionally container-health scrape.
- **Alert:** FM-02 thresholds; container unhealthy > 5 min → SEV-2.
- **Severity:** SEV-2.
- **Immediate action:** `docker ps`/`inspect` health + worker logs (last response line).
- **Recovery:** human container restart; config fix if 401/503 from run-due (token).
- **Automatic recovery safe?** restart-on-crash already on; adding on-unhealthy auto-restart (autoheal-class) is LOW risk and recommended — decision recorded as backlog, human-approved deploy change `[DEC]`-pending.
- **Verify:** tick fresh; queue drains.
- **Escalation:** repeated wedging → defect.
- **Data-loss risk:** none (queue is durable).
- **Priority:** **P0** (via FM-02 alerts).

### FM-25 — Unhealthy Docker container (any service)
- **Failure:** app/sidecar healthcheck failing while process lives.
- **Current detectability:** PARTIAL: state visible in `docker ps` only; nothing consumes health transitions; caddy keeps routing (no health-gated upstream config found `[UNK]`).
- **Missing signal:** Prometheus-visible container health (`docker events`-driven or exporter) OR — simpler, self-hosted-minimum — Grafana alert on `up{job="groundworx_app"}==0` + sidecar-reachability via existing `/api/ollama/health`-style probe result exported as a gauge.
- **Alert:** app scrape down > 2 min → SEV-1; sidecar unreachable > 5 min → SEV-2.
- **Severity:** SEV-1/2.
- **Recovery:** human restart; inspect `docker inspect --format '{{json .State.Health}}'` last probes first (evidence before restart — restarts destroy it).
- **Automatic recovery safe?** as FM-24.
- **Verify:** health `healthy`; scrape up.
- **Data-loss risk:** none directly.
- **Priority:** **P0** (the `up` alert costs nothing and exists in Prometheus already — just needs a rule + notifier).

### FM-26 — Public health endpoint failure
- **Failure:** `/api/health` non-200 or unreachable from outside.
- **Current detectability:** inside-only (Docker healthcheck + Prometheus scrape imply it); **no external synthetic probe** — TLS/caddy/DNS failures invisible until a user reports `[V]`.
- **Missing signal:** external check (self-hosted minimum: a cron curl from any second host/TheBeast writing a Loki line or ntfy ping; optional blackbox_exporter).
- **Alert:** external probe fail ×3 → SEV-1.
- **Severity:** SEV-1.
- **Recovery:** standard outage triage (caddy logs, cert expiry, container states) — runbook §A.
- **Automatic recovery safe?** NO (cause unknown by definition).
- **Verify:** probe green from outside.
- **Data-loss risk:** none.
- **Priority:** **P1**.

### FM-27 — Disk usage growth
- **Failure:** `/storage`, DB file, or docker logs fill the disk. Full disk on SQLite = every write fails (cascades to FM-07/08/11 simultaneously).
- **Current detectability:** NONE automated — manual `df -h` runbook steps only `[V]`.
- **Missing signal:** disk gauges. Self-hosted minimum without new exporters: app-emitted `gwx_disk_free_bytes{mount="/storage"}` gauge (statvfs at metrics render); better: node_exporter (one container, P1).
- **Alert:** < 20% free SEV-3; < 10% SEV-2; < 5% SEV-1.
- **Severity:** escalating as above.
- **Immediate action:** `df -h`, `du -sh` per subtree, identify grower (blobs? docker logs? Loki chunks?).
- **Recovery:** log rotation fix (FM-28), orphan sweep (FM-17), Loki/Prom retention already bounded `[V]`; expansion is human.
- **Automatic recovery safe?** NO auto-deletion of anything.
- **Verify:** free-space trend recovers.
- **Escalation:** < 5% → Josh immediately.
- **Data-loss risk:** HIGH at 100% (failed writes, potential DB corruption).
- **Priority:** **P0** (a gauge + threshold is cheap; the blast radius is total).

### FM-28 — Log volume growth
- **Failure:** unbounded container json-file logs (no `logging:` options in any compose file, no logrotate `[V]`) — every stdout line kept forever twice (docker file + Loki).
- **Current detectability:** only via FM-27.
- **Missing signal:** none needed beyond FM-27 once rotation is configured.
- **Fix:** compose `logging: {driver: json-file, options: {max-size: "50m", max-file: "5"}}` on all services — **deployment-file change, human-gated card** `[DEC]`; Loki remains the long-horizon store (90 d `[V]`).
- **Alert:** docker-logs subtree > 5 GB → SEV-3 until rotation lands.
- **Severity:** SEV-3 (SEV-1 by proxy via FM-27).
- **Recovery:** rotation config + restart (human). Interim manual truncation is a human call — never `rm` an active log file; use `truncate -s 0` if forced `[INF]`.
- **Automatic recovery safe?** rotation IS the automation; yes.
- **Verify:** per-container log file sizes bounded.
- **Priority:** **P0** (trivially cheap, prevents a SEV-1 class).

### FM-29 — Repeated application restart
- **Failure:** crash-loop hidden by `restart: unless-stopped` — users see intermittent failures, container shows "Up 2 minutes" forever.
- **Current detectability:** NONE aggregated: custom metrics registry resets on restart (in-process maps `[V]`) which is *itself* a detectable artifact (counter resets), but nothing watches; no boot event emitted; `RestartCount` only via manual `docker inspect`.
- **Missing signal:** boot audit event `system_health/app_boot {version, bootId}` at startup → restart counting in Loki; plus Grafana alert on Prometheus counter-reset heuristic (`resets(neuroglitch_audit_emissions_total[1h]) > 3`).
- **Alert:** > 3 boots in 30 min → SEV-1.
- **Severity:** SEV-1.
- **Immediate action:** `docker inspect` RestartCount + last OOMKilled flag; container logs at crash timestamps.
- **Recovery:** rollback to previous pinned image tag (human; staging rollback = repin, safe with additive migrations `[DEC]`); memory-limit tuning if OOM.
- **Automatic recovery safe?** restart already automated; the *loop* must page a human.
- **Verify:** uptime grows; boot events stop.
- **Escalation:** OOMKilled or crash without deploy → escalate with logs.
- **Data-loss risk:** in-flight requests only; jobs are durable (though restart mid-job ⇒ FM-01).
- **Priority:** **P1**.

### FM-30 — Stale session or authentication failure
- **Failure:** NextAuth misconfig after deploy (secret/URL mismatch) mass-logs-out users; or session expiry storm.
- **Current detectability:** NONE (401s unlogged — FM-13 substrate).
- **Missing signal:** FM-13's `unauthenticated` counter; deploy-time canary: authenticated smoke request in post-deploy checklist.
- **Alert:** 401 rate spike ×10 baseline right after deploy → SEV-1 rollback signal.
- **Severity:** SEV-1 when deploy-correlated, else SEV-3.
- **Recovery:** env fix / rollback (human); sessions re-establish on next login.
- **Automatic recovery safe?** NO.
- **Verify:** login smoke passes; 401 rate normal.
- **Data-loss risk:** none.
- **Priority:** **P0** (same counter as FM-13).

### FM-31 — Notification / email / webhook failure
- **Failure:** Resend email or Procore webhook path fails.
- **Current detectability:** PARTIAL-durable, zero-alerting: `OutreachLog` rows record outreach/email history `[V]`; `ProcoreWebhookEvent.error` + `processed` fields record inbound failures `[V]`; `ProcorePush` records per-push error counts `[V]`. Nothing aggregates or alerts. RESEND key rotation status `[UNK]` `[DEC]` (don't claim rotated).
- **Missing signal:** `gwx_outbound_notify_failures_total{channel}` + scheduled read of error-bearing rows into the alert runner.
- **Alert:** failures > 3/h per channel → SEV-3; webhook backlog unprocessed > 1 h → SEV-2.
- **Severity:** SEV-3→2.
- **Recovery:** provider status check; re-trigger through app flows (Procore re-push exists as an app action `[INF]`); never hand-mutate log rows.
- **Automatic recovery safe?** retry-with-backoff for transient sends YES (bounded); auto-re-push to Procore NO.
- **Verify:** subsequent sends succeed; error rows stop.
- **Escalation:** provider outage confirmed → note + wait; credentials suspected → human-only lane.
- **Data-loss risk:** none (records durable; deliveries re-sendable).
- **Priority:** **P2**.

### FM-32 — Confidential-data egress attempt
- **Failure:** confidential content (sub pricing, names, `isPreferred`) headed toward a provider prompt or external surface.
- **Current detectability:** PARTIAL, **detection-only by design**: P2-A0 shadow prompt-scan emits `neuroglitch_ai_prompt_scan_outcomes_total{outcome=flagged}` + an audit event per gateway call, content-free labels `[V]` (`metrics.ts:328-362`). **P2-A0 is shadow telemetry — it does not redact, block, or enforce, and this document makes no protection claim** `[DEC]` (Ledger §5). Coverage: TS gateway call sites (`brief`, `submittal-organize` + `other`-bucketed) — sidecar-side prompt paths `[UNK]`/not covered by this counter. Structural exclusions (pricingData stripped from responses/prompts; verified zero logging of `pricingData`/`rawPriceText` `[V]`) are the primary control.
- **Missing signal:** alert rule on `outcome="flagged"`; sidecar-path scan coverage decision (Opus-lane question, do not design here `[DEC]`).
- **Alert:** flagged > 0 → SEV-2 review (shadow = investigate, not auto-block).
- **Severity:** SEV-2.
- **Immediate action:** identify feature label + correlationId in the audit stream; review the calling workflow (never paste scanned content anywhere).
- **Recovery:** N/A retroactively; fix the offending path via a reviewed card.
- **Automatic recovery safe?** NO auto-blocking — that would be an enforcement claim P2-A0 explicitly must not make `[DEC]`.
- **Verify:** flagged count returns to 0 after fix.
- **Escalation:** any flagged event involving sub-confidential fields → Josh, immediately.
- **Data-loss risk:** confidentiality, not loss.
- **Priority:** **P1** (alert rule on existing counter).

### FM-33 — Deployment version mismatch
- **Failure:** running image ≠ intended SHA (stale image, wrong tag repin). **This has already happened**: the R1 staging nav incident's surviving explanation is a stale, unlabeled deployed image `[OP]` (`r1-nav-recovery` record; operator inspection was still pending 2026-07-17).
- **Current detectability:** WEAK: `/api/health` returns `npm_package_version` — static across commits, useless for SHA identity `[V]`. Immutable-tag + OCI-label discipline exists as runbook (`runtime/runbooks/image-traceability.md` `[V]`) but nothing at runtime self-reports.
- **Missing signal:** build-arg `GIT_SHA` baked at image build, exposed in `/api/health` + as `gwx_build_info{sha,card}` gauge; deploy checklist asserts running SHA == pinned SHA.
- **Alert:** running SHA ∉ expected set → SEV-1 (dashboard red, block further deploys).
- **Severity:** SEV-1.
- **Immediate action:** `docker inspect` image labels/digest vs compose pin; compare with `divergence-report.mjs` output.
- **Recovery:** repin correct tag + recreate (human).
- **Automatic recovery safe?** NO.
- **Verify:** health SHA matches pin; smoke passes.
- **Escalation:** unlabeled image in use → rebuild via traceability runbook before anything else.
- **Data-loss risk:** indirect (running code that predates migrations expectations → FM-20).
- **Priority:** **P0** (evidence: it already bit once).

### FM-34 — Partial staging deployment
- **Failure:** some services updated, others stale (compose config drift — staging's recorded config list already references a deleted file `[OP]`, making partial re-up a live hazard).
- **Current detectability:** MANUAL-only: `validate-staging.mjs` (8 checks) catches most effects if run; nothing enforces running it.
- **Missing signal:** per-service build-info (FM-33) → cross-service SHA consistency panel; deploy checklist gate "validate-staging must pass" as the staging-promotion rule.
- **Alert:** SHA skew across services → SEV-2.
- **Severity:** SEV-2.
- **Recovery:** re-run compose up with reconciled config (human; fix the config-list fragility first `[OP]`); rollback = repin previous tags.
- **Automatic recovery safe?** NO.
- **Verify:** validate-staging all-pass; SHA panel consistent.
- **Escalation:** compose config list broken → operator infrastructure task before any redeploy.
- **Data-loss risk:** low.
- **Priority:** **P1**.

### FM-35 — Rollback failure
- **Failure:** repin-previous-image fails (tag missing/unpinned base), or data-level rollback needed and journals/backups can't support it.
- **Current detectability:** discovered only during the rollback attempt (worst time).
- **Current evidence:** image rollback path documented (repin `e41b027-storage-smoke-failclosed` on the GWX staging line `[DEC]`; the R2 line's staging baseline is `e10b799`-pinned GHCR `[OP]`); data rollback doctrine = journal reversal first, restore last resort `[DEC]`. Restore unproven (FM-23). Backfill journals exist and are reversible (`storage-inventory-backfill.ts:155-166` `[V]`).
- **Missing signal:** rollback preflight in the runbook: verify target tag exists in registry + previous-tag retention policy; migration-compatibility note per release (additive-only makes image rollback safe `[V]` for current pending set).
- **Alert:** N/A (procedural).
- **Severity:** SEV-1 when it occurs.
- **Immediate action:** stop; do not improvise forward — a failed rollback plus improvisation is how data loss happens.
- **Recovery:** registry-retention fix; if data-level: journal reversal via the owning gated tool; restore only with Josh, per runbook §9-10.
- **Automatic recovery safe?** NEVER.
- **Verify:** post-rollback smoke + validate-staging.
- **Escalation:** immediate, always.
- **Data-loss risk:** HIGH if attempted without drill-proven restore.
- **Priority:** **P1** (preflight doc + registry retention check); restore-proof is the gate (FM-23).

---

## 3. Current-gap matrix (summary)

| Domain | Detect today | Diagnose today | Recover today (gated) | Verdict |
|---|---|---|---|---|
| Jobs (FM-01..07) | ✗ (no age/depth/stuck signals; terminal-write failures swallowed) | ◐ (rows + logs, manual SQL) | ◐ (cancel route for market_scrape only; **no repair tool for stuck running jobs**; manage-queue cancel leaves slot held) | **Worst gap cluster — P0** |
| DB contention (FM-08..10) | ✗ (no classifier, no busy_timeout) | ◐ (Loki grep) | ◐ (pause writers, human) | P1 |
| Audit/history (FM-11..12) | ◐ (counter exists, **no alert**; legacy fail-open holes) | ✓ (Loki + AuditEvent) | ✓ (design is fail-closed on core paths) | P0 alert rule |
| AuthZ/tokens (FM-13..15) | ✗ (zero signal on any denial) | ✗ | ✓ (rotate/revoke routes exist) | **P0** |
| Storage (FM-16..19) | ✗ aggregate (per-request 404 only; no sweeper; no verify) | ◐ | ✗ (**no backup**; no gated blob delete) | P1, backup-hard |
| Migration/schema (FM-20..21) | ◐ (manual runner/validator, nothing runtime) | ✓ (read-only `_prisma_migrations`) | ✓ (gated runner; forward-only) | P0 check |
| Backup/restore (FM-22..23) | — (nothing exists) | — | ✗ | **P1-hard production gate** |
| Infra (FM-24..29) | ◐ (docker health exists; nothing consumes it; no disk/log/restart signals) | ✓ (docker CLI) | ◐ (restart-on-crash only) | P0 cheap wins |
| Sessions/notify/egress (FM-30..32) | ◐ (durable rows / shadow counter; no alerts) | ◐ | ✓ (rotate, re-send paths) | P0/P1/P2 mixed |
| Deploy (FM-33..35) | ✗ runtime identity; ◐ manual validator | ◐ | ◐ (repin documented; restore unproven) | P0 identity, P1 gates |

---

## 4. Proposed signal inventory

Conventions (inherit `lib/observability` house rules `[V]`): metric names snake_case prefixed `gwx_`; labels bounded enums only — never ids, paths, emails, filenames, or free text; high-cardinality detail goes to the `[audit]` Loki stream via the existing envelope (correlationId lives there, not in labels); payloads ≤ 4 KB; audit categories reuse `system_health` where possible to avoid taxonomy growth. Retention: Prometheus 15 d (existing), Loki 90 d (existing), AuditEvent = indefinite DB (existing policy). Every signal below is **content-free by construction**: no secret values, no project/document content, no sub-identifying fields.

| # | Signal | Type | Exact location | Bounded fields (labels) | Prohibited | Retention | Cardinality risk | Dashboard use | Alert use |
|---|---|---|---|---|---|---|---|---|---|
| S1 | `gwx_jobs_queued_depth` | gauge | new `lib/observability/jobMetrics.ts`, refreshed by detector runner + on `run-due` | `jobType` (≤10 known values) | bidId, relatedId | 15 d | low | Queue panel | FM-02 |
| S2 | `gwx_jobs_oldest_queued_age_seconds` | gauge | same | `jobType` | ids | 15 d | low | Queue panel | FM-02 |
| S3 | `gwx_jobs_oldest_active_age_seconds` | gauge | same | `jobType`,`status` | ids | 15 d | low | Stuck panel | FM-01/03/06 |
| S4 | `gwx_jobs_terminal_total` | counter | `completeJob`/`failJob` in `backgroundJobService.ts` | `jobType`,`status` | errorMessage | 15 d | low | Throughput | failure-rate |
| S5 | `gwx_job_duration_seconds` | histogram | same, on terminal transition | `jobType` | ids | 15 d | low | Duration p95 | FM-03 baseline |
| S6 | `gwx_job_terminal_write_failures_total` + CRITICAL `[audit]` line | counter+log | replace every `failJob(...).catch(()=>{})` with a logging catch (call sites list in FM-07) | `jobType` | error detail in metric (goes to log) | 15 d / 90 d | low | — | **FM-07 SEV-1** |
| S7 | `system_health/job_stuck` audit event | audit | new detector in alert-eval-style runner | subjectId=jobId in envelope (not label) | payload beyond ids/ages | 90 d + DB | low | Stuck list (Loki) | FM-01 |
| S8 | `gwx_db_errors_total` | counter | single classifier wrapping Prisma error normalization (extend `uniqueConstraintError.ts` module) | `class` ∈ busy,locked,timeout,unique,other | SQL text, params | 15 d | low | DB panel | FM-08/10 |
| S9 | `gwx_authz_denials_total` | counter | `lib/auth-helpers.ts` denial paths (`requireUser`, `assertBidAccess`, `requireBidAccess` 404-collapse) | `kind` ∈ unauthenticated,forbidden,cross_bid_404; `route_group` (bounded map, ≤20) | userId/email/path in labels (userId goes in audit envelope only) | 15 d | low-med (route_group bounded) | Auth panel | FM-13/14/30 |
| S10 | `authz_denied` audit event (forbidden + cross_bid_404 only) | audit | same | envelope actor + subject kind/id | request body, query strings | 90 d | low | Actor drill-down | FM-14 review |
| S11 | `gwx_external_denied_total` | counter | `lib/services/tradeResponse/externalHttp.ts` 404-collapse point + `rateLimit.ts` reject | `reason` ∈ not_found,expired,revoked,rate_limited | token digest, IP | 15 d | low | External panel | FM-15 |
| S12 | revoked-token-use audit event | audit | token resolution miss-with-revoked-match in `packages.ts` | packageId subject | raw token, digest | 90 d + DB | low | Security review | FM-15 SEV-2 |
| S13 | `gwx_upload_compensation_total` | counter | meeting upload compensation branch; trade attachment compensation; (drawings/addendums when parity lands) | `domain`,`outcome` ∈ deleted,failed | keys, filenames | 15 d | low | Storage panel | FM-16 |
| S14 | `gwx_blob_missing_total` | counter | shared download-miss points (the five "File is missing from storage" sites + `legacyPathCompat` miss) | `domain` | storage keys (audit envelope carries key) | 15 d | low | Storage panel | **FM-18 SEV-1** |
| S15 | Storage-integrity sweep report + `gwx_blob_orphans_bytes`, `gwx_blob_checksum_mismatch_total` | gauge/counter + artifact | new operator CLI `scripts/storage-integrity-sweep.ts` (report-only default, journaled gated apply for deletes — mirrors `storage-inventory-backfill` gates) | `domain` | file contents; report artifact stays operator-side, never pasted | artifact: gwx-ops; metrics 15 d | low | Integrity panel | FM-17/19 |
| S16 | `gwx_migration_state` | gauge (0/1/2/3 = ok/behind/partial/unknown) | deep-health module comparing `_prisma_migrations` count+latest vs build-time manifest generated from `prisma/migrations/` | none | migration SQL | 15 d | none | Deploy panel | **FM-20 SEV-1** |
| S17 | `gwx_build_info` | gauge=1 | `/api/health` + metrics; `GIT_SHA`+card build-args per `image-traceability.md` | `sha` (one active), `card` | — | 15 d | low (single series per deploy) | Version panel | FM-33/34 |
| S18 | `system_health/app_boot` audit event | audit | app startup (instrumentation hook / layout init) | version, sha in payload | env dump | 90 d | low | Restart panel (Loki count) | FM-29 |
| S19 | `gwx_disk_free_bytes` | gauge | metrics render path, statvfs on `/storage` + DB dir (until node_exporter decision) | `mount` (≤3) | paths beyond mount label | 15 d | none | Disk panel | **FM-27** |
| S20 | `gwx_backup_last_success_timestamp`, `gwx_restore_drill_last_success_timestamp` | gauge | backup script writes a marker file/row the app or textfile-collector exposes | `kind` ∈ db,storage | backup paths, hostnames | 15 d | none | Backup panel | FM-22/23 |
| S21 | `gwx_callback_rejected_total` | counter | `analyze/complete` route auth-reject + job-match-miss branches | `reason` ∈ bad_token,unknown_job | token, payload | 15 d | low | Jobs panel | FM-06 |
| S22 | `gwx_outbound_notify_failures_total` | counter | Resend/Procore send wrappers | `channel` ∈ email,procore_push,procore_webhook | recipients, payloads | 15 d | low | Notify panel | FM-31 |
| S23 | Alert rule on existing `neuroglitch_audit_persistence_failures_total` | rule only | Grafana provisioning | — | — | — | — | — | **FM-11 SEV-1** |
| S24 | Alert rule on existing `neuroglitch_ai_prompt_scan_outcomes_total{outcome="flagged"}` | rule only | Grafana provisioning | — | — | — | — | — | FM-32 (shadow-detect review, never described as blocking `[DEC]`) |
| S25 | Sidecar structured logs | log format | `sidecar/` logging adoption: single-line JSON, `[sidecar]` prefix, level + correlation id propagated via header from TS side | level, component | document/audio content, prompt text, key values | 90 d (Loki) | low | Sidecar panel | sidecar error rate |
| S26 | External synthetic probe result | log line/ntfy | cron curl from a second host against `https://…/api/health` | status only | — | 90 d | none | Uptime panel | **FM-26 SEV-1** |

---

## 5. Prioritized implementation backlog

Every item is a *future card* — nothing here was implemented in this mission. Live-touching items are human-gated per standing rules.

### P0 — required before staging promotion of the R2 line (8 items)
- **B-01** Job lifecycle metrics S1–S5 + detector runner emitting S7 (stuck/queued-age) wired like `alert-eval`. *(local code+tests)*
- **B-02** Terminal-transition failure signal S6 — eliminate every silent `failJob(...).catch(()=>{})`. *(local; ⚠ coordinate with pending media patches — same files)*
- **B-03** AuthZ/session/token denial telemetry S9–S12 (FM-13/14/15/30). *(local)*
- **B-04** Migration-state + build-identity surface S16–S17 (deep-health module + GIT_SHA build-arg; endpoint exposure is a deploy-gated change). *(local code + human deploy card)*
- **B-05** Grafana alert-rule pack #1 + one notification contact point: S23 (audit persistence), `up==0` (FM-25), S1–S3 thresholds (FM-01/02), disk S19 (FM-27), counter-reset restart heuristic (FM-29 interim). *(observability config; human-applied)*
- **B-06** Compose log rotation on all services (FM-28) + `gwx_disk_free_bytes` S19 (FM-27). *(deployment-file card, human)*
- **B-07** Gated job-repair CLI: list stuck jobs (report-only default), journaled `--apply` fail/clear with confirm phrase, per `storage-inventory-backfill` gate pattern (FM-01/05 recovery gap). *(local tool + operator runbook)*
- **B-08** Fix `scripts/manage-queue.mjs` cancel to clear `activeSlot` (defect, `manage-queue.mjs:48-65`). *(local)*

### P1 — required before production promotion (9 items)
- **B-09** Backup implementation per `staging-backup-restore.md` §1–§6 (scripts + cron + off-host copy) + S20 age alerting (FM-22). *(human-gated)*
- **B-10** Executed restore drill with recorded evidence (runbook §7–§8) — **production gate: restore-proof-required** (FM-23). *(human)*
- **B-11** Storage-integrity sweeper S15: disk↔DB orphans both directions, report-only; journaled gated delete mode (FM-17/18). *(local tool)*
- **B-12** Provider-job janitor: deadline re-poll/auto-fail through service paths with audit (FM-05/06); includes wiring the existing-but-never-invoked `findStaleLeases`/`markLeaseStale` (RunnerLease janitor). *(local; transcription-poll interaction respects the meetings-durability constraint — harness decision is Opus-lane `[DEC]`)*
- **B-13** DB-error classifier + S8 counters + Loki alert (FM-08/10). *(local)*
- **B-14** Sidecar structured logging + correlation propagation + auth-denial logging S25 (FM-06/22-adjacent). *(local)*
- **B-15** External synthetic probe S26 (FM-26). *(operator infra, trivial)*
- **B-16** Boot event S18 + restart-loop alert (FM-29); autoheal-on-unhealthy decision recorded (FM-24/25). *(local + human deploy decision)*
- **B-17** Alert rule S24 (prompt-scan flagged review — detection-only wording) (FM-32); deploy checklist gate: `validate-staging.mjs` must pass post-deploy (FM-34); rollback preflight additions to runbook (FM-35).

### P2 — operational hardening (7 items)
- **B-18** SQLITE_BUSY remediation: busy_timeout/bounded-retry at the classifier choke point (after B-13 data).
- **B-19** Unified route error helper (envelope + correlationId + `console.error` replacement across the 177 ad-hoc sites) + `gwx_http_responses_total` (FM-09).
- **B-20** Upload compensation parity for drawings/addendums + S13 counters (FM-16).
- **B-21** Checksum verify pass in the sweeper; store `PutResult.sha256` for currently-discarding domains (**schema change ⇒ explicit queue card** `[DEC]`) (FM-19).
- **B-22** History-coverage reconciliation sampler (FM-12).
- **B-23** Live-DDL drift probe script (read-only dump + diff vs replay-derived DDL) in pre-deploy checklist (FM-21).
- **B-24** Notification-failure counters + alerts S22 (FM-31).

### P3 — future enhancement (4 items)
- **B-25** Managed-service option (see §8): Grafana Cloud / hosted Loki+Prom remote-write; optional Sentry for exception grouping.
- **B-26** OpenTelemetry traces app↔sidecar (supersedes correlation-header approach).
- **B-27** SLOs + error budgets; paging integration (ntfy/Pushover self-hosted → PagerDuty if managed).
- **B-28** Baseline/anomaly detection on job + authz rates (extends the deterministic detector pattern).

**Counts: P0 = 8 · P1 = 9 · P2 = 7 · P3 = 4 (28 items).**

---

## 6. Minimum production dashboard

One Grafana dashboard — **"R2 Ops Minimum"** — 12 panels, all from existing datasources (Prometheus + Loki), consumable at a glance by a non-developer operator:

1. **App up** — `up{job="groundworx_app"}` (existing scrape).
2. **Build identity** — S17 `gwx_build_info` (sha, card) + deploy annotation.
3. **Job queue depth** — S1 by jobType.
4. **Oldest active job age** — S3 (threshold lines at per-type budgets).
5. **Job failures / terminal-write failures** — S4 (`status="failed"`) + S6 (red when > 0).
6. **Audit persistence failures** — existing `neuroglitch_audit_persistence_failures_total` (red when > 0).
7. **AuthZ denials** — S9 by kind.
8. **External token denials / rate limits** — S11 by reason.
9. **DB error classes** — S8 (busy/locked highlighted).
10. **Disk free** — S19 per mount (thresholds 20/10/5%).
11. **Restarts** — Loki count of S18 boot events (24 h window).
12. **Runner heartbeat** — existing `neuroglitch_runner_cycles_total` rate by runner + last alert-eval age.

Panels 1, 6, 12 work **today**; the rest depend on P0/P1 signals. The three existing dashboards (`platform-health`, `audit-stream`, `intelligence-throughput`) remain as drill-downs.

## 7. Minimum alert specification

Ten rules (Grafana-provisioned; delivery via one contact point — see §8):

| # | Rule | Threshold | Severity | FM |
|---|---|---|---|---|
| A1 | App scrape down | `up==0` for 2 min | SEV-1 | 25/26 |
| A2 | Audit persistence failure | counter increase > 0 / 5 min | SEV-1 | 11 |
| A3 | Job terminal-write failure | S6 > 0 | SEV-1 | 07 |
| A4 | Stuck active job | S3 > per-type budget | SEV-2 | 01/03/06 |
| A5 | Queue stalled | S2 > 30 min | SEV-2 | 02/24 |
| A6 | Disk low | S19 < 10% (warn 20%, page 5%) | SEV-2→1 | 27/28 |
| A7 | Restart loop | > 3 boots / 30 min (S18 Loki or counter-reset heuristic) | SEV-1 | 29 |
| A8 | AuthZ anomaly | S9 rate > 5× 7-day baseline / 15 min; any revoked-token use (S12) | SEV-2 | 13/14/15/30 |
| A9 | DB busy/locked | S8 busy+locked > 5 / 10 min (notify on any) | SEV-2 | 08/10 |
| A10 | Migration/backup state | S16 ≠ ok; backup age > 26 h (S20) | SEV-1 | 20/22 |

Plus review-queue (non-paging): prompt-scan flagged (S24, FM-32), external rate-limit sustained (FM-15), missing-blob any (S14 — pages once backups exist, until then it *always* escalates to Josh).

---

## 8. Self-hosted baseline vs. managed option

**Self-hosted minimum (no paid platform — the default posture):**
- Already present `[V]`: Prometheus (15 d) + Loki (90 d) + Promtail + Grafana, compose-deployed, app scrape wired, 3 dashboards.
- To add (P0/P1): Grafana alert rules + ONE notification channel that works without a vendor — options in order of preference: (a) self-hosted `ntfy` container (push to phone), (b) SMTP via existing Resend account (already a dependency; rotation status `[UNK]` — verify before relying), (c) Grafana's built-in webhook to any operator endpoint. No Alertmanager needed at this scale — Grafana unified alerting suffices.
- Synthetic probe: cron curl from any second host (TheBeast is available on the tailnet `[OP]`).
- Host metrics: either the S19 statvfs gauge (zero new containers) or one `node_exporter` container (better; still free).

**Optional managed-service enhancement (P3, additive not replacing):**
- Grafana Cloud free/paid tier via `remote_write` (Prometheus) + Loki push — off-host retention + alerting redundancy (alerts still fire if the host itself dies — the self-hosted stack's blind spot).
- Optional Sentry (or GlitchTip self-hosted first) for exception grouping.
- Uptime service (UptimeRobot-class) replacing the cron probe.
- Decision gate: any managed option ships telemetry off-host ⇒ must pass the §9 content policy review and secrets-handling review (human-owned) before adoption.

## 9. Telemetry data policy (binding for all packets)

**No-secret-in-logs:** no env values, credential values, tokens (raw or digest), cookies, or connection strings in any metric label, log line, audit payload, or report artifact. Key *names* allowed. Existing precedents: credential log stores names/callers only `[V]`; `AiUsageLog.errorMessage` is bounded-class only `[V]`. Any signal added by these packets inherits this as an acceptance criterion with a test.

**No-project-content-in-telemetry:** no document text, transcript text, prompt text, meeting content, file names supplied by users, sub names/companies/`isPreferred`, `pricingData`/`rawPriceText` (never logged today — verified `[V]` — and this stays true), or free-text user input in any metric/log/alert. Ids are allowed in audit envelopes (DB/Loki), never in metric labels. P2-A0 outcomes stay content-free enums `[V]`.

**Cardinality:** labels are closed enums; route identity via a bounded `route_group` map; anything unbounded goes to the audit envelope. New label values require touching the enum in code review — that is the enforcement point.

**Retention:** Prometheus 15 d, Loki 90 d, AuditEvent indefinite, operator report artifacts in `gwx-ops` (never pasted into chat/docs — reference by path `[DEC]`).

---

## 10. Implementation packets

Independently assignable; each = one builder card with Allowed/Forbidden lists. Dependencies noted. ⚠ = must rebase on / coordinate with the SOL remediation commit when it lands (same files).

| Packet | Contents (backlog) | Owner class | Depends on | Live-gated? |
|---|---|---|---|---|
| **OBS-PKT-01** Job lifecycle signals | B-01 | builder (local) | — | no |
| **OBS-PKT-02** Terminal-transition + DB-error hardening signals | B-02, B-13 | builder ⚠ | — | no |
| **OBS-PKT-03** AuthZ/token/session telemetry | B-03 | builder | — | no |
| **OBS-PKT-04** Deep health + build identity | B-04 | builder + human deploy | — | endpoint exposure: yes |
| **OBS-PKT-05** Alert rules + contact point | B-05, B-17(S24), B-24 | observability config | PKT-01..04 for full set; A1/A2/A6-interim possible now | apply: yes |
| **OBS-PKT-06** Log rotation + disk | B-06 | human deploy card | — | yes |
| **OBS-PKT-07** Operator repair tooling | B-07, B-08 | builder + runbook | PKT-01 (detection first) | apply-mode runs: yes |
| **OBS-PKT-08** Backup/restore | B-09, B-10 | human | — | yes |
| **OBS-PKT-09** Storage integrity | B-11, B-20, B-21, B-22 | builder (report-only) + human apply | — | apply: yes; B-21 schema: queue card |
| **OBS-PKT-10** Janitor + sidecar observability | B-12, B-14, B-16 | builder ⚠ | PKT-01 | janitor enable: yes |
| **OBS-PKT-11** Error-envelope unification | B-19, B-23 | builder | — | no |
| **OBS-PKT-12** Probe + managed path | B-15, B-25..28 | operator / future | §8 policy review | yes |

**Suggested order:** PKT-01 → 02 → 03 (parallel-safe with each other after 01) → 04 → 05 → 06/07 → staging gate → 08 → 09/10 → production gate → 11/12.

## 11. Staging gate and production gate

**Staging promotion gate (R2 line) — all of:**
1. SOL combined rereview BLOCK→APPROVE on the repaired candidate (external precondition — none of this document's packets substitute for it `[DEC]`).
2. P0 packets complete: PKT-01,02,03,04(code) landed with tests; PKT-05 rules + contact point applied; PKT-06 rotation applied; PKT-07 tooling available.
3. Same-day checkpoint before any staging DB mutation (standing rule `[DEC]`).
4. Post-deploy: `validate-staging.mjs` all-pass + "R2 Ops Minimum" dashboard panels 1/6/12 + P0 panels live and non-red for 24 h.

**Production promotion gate — all of:**
1. Staging gate held for an agreed soak (recommend ≥ 2 weeks) with zero unexplained SEV-1 signals.
2. **Restore-proof-required:** B-09 backups running ≥ 1 week with green age metric AND B-10 restore drill executed with recorded evidence (mirrors migrations-checkpoints rule `[DEC]`).
3. P1 packets complete (PKT-08,09,10 + B-13..17).
4. Version-identity proven: running SHA self-reported and matching pins across services (FM-33/34).
5. Prod/staging branch divergence reconciled (the 7-vs-40 commit split `[OP]` — outside this audit's scope but a hard precondition it must record).
6. On-call runbook (companion doc) reviewed by the operator; escalation contact confirmed.

## 12. Verification of this audit

- Method: 5 parallel read-only code inventories (schema; job/worker lifecycle; logging/errors; health/alerts/ops tooling; storage lifecycle), each returning file:line evidence; key claims independently re-read in the main session (`app/api/health/route.ts`, `prisma/schema.prisma:1389-1421`, `lib/observability/metrics.ts`, `runtime/cron/schedule.json`, `lib/runners/registry.ts`, absence-greps for denial logging).
- Durable-report cross-check: `r2-convergence-control.md`, `r2-auth-regression-pack.md`, `r2-local-certification-harness.md`, `r2-build3-contract-freeze.md` read in full; §1a defects inherited, not re-derived.
- Honest limits: anything about running containers, Turso PITR state, deployed images, or live scrape health is `[OP]` (dated) or `[UNK]`. This document makes **no** live-proven claims and does not upgrade any `[UNK]`.

**Companion:** `docs/r2/R2-FAILURE-DETECTION-AND-RESPONSE-RUNBOOK.md` (operator procedures for every FM above).
