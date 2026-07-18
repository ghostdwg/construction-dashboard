# R2 Failure Detection & Response Runbook

**Date:** 2026-07-18 · **Companion to:** `docs/r2/R2-PRODUCTION-OBSERVABILITY-RECOVERY-AUDIT.md` (the audit — failure-mode numbers FM-01…FM-35 and signal numbers S1…S26 reference it)
**Audience:** the on-call operator (human). Models never execute anything in this document against a live system.

> **Standing rules that override everything below**
> 1. **No manual DB edits, ever.** All writes go through the gated migration runner, gated fixture CLI, gated backfill/repair apply modes, or the application's own audited routes. If a recovery step below has no gated path, the runbook says **RECOVERY GAP** and the answer is *stop and escalate*, not improvise.
> 2. **Migrations** apply only via `scripts/apply-turso-migrations.mjs`, human-executed, checkpoint-first, forward-only. Exit 2 (partial) = full stop.
> 3. **Production is frozen** until its gate opens. Staging mutations need a same-day checkpoint.
> 4. **Never print or paste secret values** — key names only. Journals/smoke outputs are artifacts; reference them by path, don't paste contents.
> 5. Evidence before action: capture `docker inspect` / log excerpts **before** restarting anything — restarts destroy the evidence.
> 6. When a check fails, record it verbatim. No retry-loops inside a diagnosis session.

---

## A. Minimum on-call runbook (first 10 minutes of any incident)

1. **Is the app up?**
   `curl -sS -m 5 https://<host>/api/health` → expect `{"status":"ok",...}`. Also from *inside* the host: `curl -sf http://localhost:3000/api/health`. Outside-fails/inside-works ⇒ caddy/TLS/DNS lane (§B3).
2. **Container states:**
   `docker ps --format 'table {{.Names}}\t{{.Status}}'` — look for `(unhealthy)`, recent `Up X seconds` (restart-loop), or missing services.
   For any suspect: `docker inspect --format '{{json .State.Health}}' <name> | head -c 2000` and `docker inspect --format 'RestartCount={{.RestartCount}} OOM={{.State.OOMKilled}}' <name>`.
3. **Disk:**
   `df -h /opt/neuroglitch /var/lib/docker` and `du -sh <storage-root>` — below 10% free is an incident of its own (§B4) and can be the *cause* of everything else.
4. **Dashboards:** Grafana → `platform-health`, `audit-stream`; then "R2 Ops Minimum" once it exists. Red panels: audit persistence failures, job stuck/queue age, `up`.
5. **Recent change?** Was anything deployed/repinned/migrated today? If yes, the incident is that change until proven otherwise — check version identity (§B5) before deep-diving symptoms.
6. **Logs quick pass:**
   `docker logs --since 30m <app> 2>&1 | grep -v '\[audit\]' | tail -100` (errors stand out once audit lines are filtered)
   Loki (Grafana Explore): `{container=~".*app.*"} |= "CRITICAL"` over 1 h.
7. **Classify** using §B, act via the matching procedure, and record: timestamp, symptom, evidence paths, actions taken, in an incident note under `~/gwx-ops/reports/` (durable, referenced not pasted).

**Escalation boundary (global):** anything involving data loss, audit-integrity breach, migrations in partial state, restore decisions, credential suspicion, or production — stop and involve Josh before acting. SEV-1 = act/escalate now; SEV-2 = same day; SEV-3 = ticket it.

---

## B. Procedures by domain

### B1. Jobs stuck / queue stalled (FM-01…FM-07)

**Detect (today, manual):**
```sql
-- read-only; run via your Turso/sqlite shell
SELECT id, jobType, status, bidId, startedAt, createdAt, externalJobId
FROM BackgroundJob
WHERE activeSlot = 1
ORDER BY COALESCE(startedAt, createdAt);
```
Anything `running` for hours, or `queued` far past `runAfter`, is a candidate. Worker view: `curl -sS -H "X-Worker-Token: <from env, do not echo>" ... ` — do **not** curl run-due manually with the token in shell history; read the worker container logs instead (`docker logs --since 1h <worker> | tail -50`), which include every response.

**Decide dead-vs-slow before any recovery:**
- Worker/cron container healthy? (`docker ps`, tick files `/tmp/worker.tick`, `/tmp/cron.tick` inside containers).
- Sidecar restarted after the job started? `docker ps` start time vs `startedAt` ⇒ if sidecar is younger than a `running` transcription/analysis job, the provider side is gone → job is dead (FM-05).
- Transcription: the meeting `GET .../meetings/<id>/status` route (authenticated, read-only) re-polls the sidecar — a 404/error there for the stored `transcriptionJobId` confirms dead.
- Spec analysis: check sidecar logs for the `[callback]` failure line (Loki: `{container=~".*sidecar.*"} |= "[callback]"`).

**Recover (gated paths only):**
- Queued `market_scrape`: cancel via the app's job DELETE route (clears `activeSlot`) or requeue by fixing `runAfter` cause. Note: `scripts/manage-queue.mjs cancel` currently **leaves `activeSlot` occupied** (known defect, backlog B-08) — prefer the app route until fixed.
- Running-but-dead jobs of any other type: **RECOVERY GAP** — no gated tool exists yet (backlog B-07, gated job-repair CLI). Until it ships: record the job ids, escalate to Josh, decide together; do not hand-edit rows.
- Worker offline: restart the worker container (operator action). If run-due returns 503/401 in worker logs: `WORKER_TOKEN` env mismatch — fix env + recreate (deploy-gated).
- `failJob` swallowed-failure suspicion (job running, but its trigger's logs show an error at the right time and DB shows nothing): treat as FM-07 — check DB health first (§B2); the row repair itself is the same RECOVERY GAP.

**Verify:** the slot is free (`SELECT` again: terminal status + `activeSlot IS NULL`), a fresh job of that type/bid can be created from the UI, and an audit line exists for whatever action was taken.

**Escalate when:** the same jobType wedges twice in a week (defect, not ops); any repair would require a raw UPDATE.

**Data-loss note:** job inputs are durable (uploaded audio/PDFs in blob storage) — a dead job is re-runnable; never delete source rows/blobs as part of "cleanup."

### B2. Database errors: busy / locked / audit-write failures (FM-08…FM-12)

**Detect:** user-facing 500s clustering; Loki `{...app...} |= "SQLITE_BUSY" or |= "P1008"` (no structured counter yet — backlog B-13); red `neuroglitch_audit_persistence_failures_total` panel; fail-closed paths surfacing as 500s on mutations (that's the design working).

**Diagnose (read-only):**
- Disk first (§A3) — a full disk mimics lock contention.
- Who's writing? Runner cycle overlap: Grafana `neuroglitch_runner_cycle_duration_seconds` — a cycle running long across the :00/:30 boundaries can collide with interactive writes.
- Any operator tooling (backfill apply, migration runner) running right now? Those serialize with app writes by design — coordinate, don't overlap.
- Audit persistence failures: the counter's `category` label says which lane; Loki `|= "CRITICAL"` has the stack.

**Recover:**
- Contention: stop the optional load (pause cron container — operator action; it resumes cleanly, leases are windowed) until writes clear; then file B-18 remediation evidence.
- Audit persistence failing while app otherwise healthy: DB path is degrading — treat as pre-outage; checkpoint (staging) and escalate. The stdout `[audit]` stream in Loki remains the interim record; after recovery, note the gap window in an incident report. Do not attempt to backfill AuditEvent rows — **never fabricate history**.
- Fail-closed 500s on mutations: correct behavior under audit failure; fix the DB condition, the feature recovers by itself.

**Verify:** error rate returns to baseline; a test mutation in a scratch-safe surface succeeds; audit counter flat.

**Escalate when:** partial migration state is discovered mid-incident (immediate full stop, Josh); busy errors persist with no load explanation.

### B3. App/sidecar/edge down, restart loops (FM-24…FM-26, FM-29)

**Detect:** §A steps 1–2; Grafana `up` panel; boot-event count (once S18 exists).

**Diagnose:**
- Outside-fails / inside-works: `docker logs <caddy> --since 30m`; cert expiry (`echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -dates`); DNS.
- Crash loop: `docker inspect` RestartCount + OOMKilled; `docker logs --tail 200 <app>` at the crash boundary. Correlate with deploy time.
- Unhealthy-but-running: read the health probe output in `docker inspect` — it contains the actual failing response.

**Recover:**
- Crash loop after deploy: **rollback = repin previous image tag + recreate** (operator; staging-safe while migrations remain additive). Capture logs first.
- OOM: raise memory limit only as a bridge; file the leak as a defect.
- Sidecar down: restart; jobs that were in flight are now FM-05 — sweep §B1 afterwards. This ordering matters: restart sidecar, *then* audit the job table.
- Edge/cert: fix caddy config/cert (operator); app itself usually needs nothing.

**Verify:** external probe green; `up==1` for 15 min; RestartCount stable; then B1 sweep if sidecar or app restarted.

**Escalate when:** crash without a correlated change; any rollback that doesn't take (FM-35: stop, Josh, no improvisation).

### B4. Disk / log growth (FM-27, FM-28)

**Detect:** §A3; thresholds 20/10/5% free.

**Diagnose:** `du -sh` the candidates in order: docker container logs (`/var/lib/docker/containers/*/*-json.log` — `ls -lhS` the top few), blob storage root, Loki chunks dir, Prometheus data, the SQLite/libsql file + WAL.

**Recover:**
- Container logs huge: rotation is not configured yet (backlog B-06). Bridge: `truncate -s 0 <the -json.log file>` (never `rm` — the fd stays open); then prioritize B-06.
- Blob growth: run the storage inventory (`npx tsx scripts/storage-inventory-backfill.ts` report mode — read-only) for the DB-side view; true orphan reclamation waits for the sweeper (B-11) — **no ad-hoc deletion of blobs**.
- Loki/Prom growth beyond configured retention: check retention actually enforcing (compactor logs) before touching data dirs.
- DB file growth: normal with usage; investigate only if step-change without workload change.

**Verify:** free% recovering and the *grower identified* — space freed without knowing the source is a repeat incident scheduled.

**Escalate when:** < 5% free (Josh, now — writes are about to start failing everywhere); any temptation to delete data files.

### B5. Deploy identity / migration state / partial deploy / rollback (FM-20, FM-21, FM-33…FM-35)

**Detect/diagnose:**
- What is actually running? `docker inspect --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' <svc>` for every service; compare against the compose pins. Unlabeled image ⇒ rebuild via `runtime/runbooks/image-traceability.md` before trusting anything (the R1 nav incident is the precedent).
- Migration state (read-only):
  ```sql
  SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 10;
  ```
  plus `node scripts/apply-turso-migrations.mjs --dry-run` (operator env) which classifies OK/PENDING/partial without writing.
- Post-deploy: `node scripts/validate-staging.mjs` (8 checks) is the acceptance bar; run it after **every** staging deploy.

**Recover:**
- Pending migrations found: apply via the runner — human, checkpoint first, correct order is automatic (lexicographic). Never any other mechanism.
- **Partial state (exit 2 / started-not-finished row): FULL STOP.** No retry, no second apply, nothing else touches the DB → Josh + forward-fix decision.
- Version mismatch/partial deploy: repin the intended tags and recreate the lagging services; re-run validate-staging.
- Rollback: repin the previous known-good tag (keep the tag list in the deploy log); if the registry no longer has it — stop (FM-35), do not build "something close" under pressure.
- Suspected live schema drift (a column that shouldn't exist / DDL surprise): freeze deploys, capture read-only `.schema` dump, escalate — drift implies a prohibited action happened; provenance matters more than the quick fix.

**Verify:** SHA labels match pins on every service; validate-staging all-pass; migration dry-run reports none pending.

### B6. Storage integrity: missing / orphan / mismatch (FM-16…FM-19)

**Detect:** user report or Loki `|= "File is missing from storage"` / `|= "blob missing"`; (aggregate counters are backlog S14/S15).

**Diagnose a missing-blob report — in this order (config before loss):**
1. `docker inspect` the app's mounts — is the storage volume mounted, and at the expected root (`STORAGE_LOCAL_PATH`, default `/storage`)? Name only; never echo env values wholesale.
2. Does the key exist on disk? `ls -l <storage-root>/<key-path>` (read-only). Wrong-root symptoms: *everything* recent is "missing," old files fine (or vice versa).
3. Recent deploy/restore/compose change? A re-up with a broken override list can silently drop the volume.
4. Only if config is proven correct: treat as real loss.

**Recover:**
- Config: remount/redeploy correctly (operator); files reappear; nothing was lost.
- Real loss: **there is currently no backup to restore from** (FM-22 — until B-09 lands). Options: user re-upload (the app paths tolerate re-upload; field-report/consultant lanes keep history), and an incident note. Escalate to Josh always — data loss is never a solo call.
- Orphans (disk file, no DB row): leave them until the sweeper (B-11) provides journaled, report-first deletion. Disk pressure alone doesn't justify ad-hoc deletion.
- Checksum mismatch (once verification exists): quarantine-by-record (note in the affected record via app flows), restore-from-backup when that exists, escalate — possible disk fault.

**Verify:** the affected download route serves bytes; sweeper (when available) clean on re-run.

### B7. AuthZ / tokens / sessions / abuse (FM-13…FM-15, FM-30)

**Detect (today):** almost nothing is emitted (the P0 gap) — reports arrive via users ("logged out", "can't access") or caddy access-log anomalies. After B-03: Grafana authz panel + Loki `authz_denied` events.

**Diagnose:**
- Mass 401s right after a deploy = auth misconfig (secret/URL): check the deploy diff of env *names* touched; login smoke with a test account.
- Cross-bid 404 pattern from one account (post-B-03 signal): review that actor's audit trail (`SELECT category, action, subjectKind, subjectId, emittedAt FROM AuditEvent WHERE actorUserId = ? ORDER BY emittedAt DESC LIMIT 100;` read-only).
- External token trouble: token state lives on the package (issue/rotate/revoke are audited app actions) — check package audit trail rather than tokens directly.

**Recover:**
- Deploy-caused auth break: env fix / rollback (operator). Sessions self-heal on login.
- Suspected leaked external token: rotate via the package's `rotate-token` route (existing, audited); notify the intended recipient GC-side. Revocation is same-route class.
- Abuse/probing: rate limiter already contains external surfaces (60/60s); account-level action on internal users is a human/Josh decision — the runbook's job is evidence, not punishment.

**Verify:** 401/denial rates back to baseline; rotated token's predecessor rejected (404) on a test fetch *of a non-sensitive route* — do not fetch real content as a "test."

**Escalate when:** any deliberate-probing pattern, any token misuse with evidence of content access, anything credential-shaped (credential handling is human-owned, always).

### B8. Audit/history integrity (FM-11, FM-12) — special handling

This is the R2 program's core invariant. If evidence suggests a mutation happened without its history row (beyond the three known legacy fail-open paths listed in audit §1a):
1. Stop using the affected lane (organizationally, not by disabling code).
2. Capture: the mutation's row, the absent-history query, timestamps, Loki `[audit]` stream for the window.
3. Escalate to Josh + the SOL review lane — this class is a release-gate breach, and the fix is a reviewed product change, never a hand-written history row.

### B9. Notifications / webhooks (FM-31)

Read-only checks: `SELECT * FROM ProcoreWebhookEvent WHERE processed = 0 OR error IS NOT NULL ORDER BY id DESC LIMIT 20;` and recent `OutreachLog` rows with failure states; provider status pages. Re-delivery goes through app flows (Procore re-push action). Credential-shaped failures (provider 401s): human lane, rotation status for RESEND et al. is UNKNOWN — verify before assuming.

### B10. Confidential-egress flag (FM-32)

P2-A0 is **shadow detection only** — a flag means *review*, not *blocked*. On `outcome="flagged"`: pull the audit event by correlationId (Loki), identify the feature lane and workflow, review the calling code path with the SOL/security lane. Never paste the scanned content anywhere. Any flag touching sub-confidential fields (pricing, sub identity) goes to Josh immediately.

---

## C. Safe diagnostic command palette (read-only, operator)

```bash
# Platform
curl -sS -m 5 http://localhost:3000/api/health
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker inspect --format '{{json .State.Health}}' <name>
docker inspect --format 'RestartCount={{.RestartCount}} OOM={{.State.OOMKilled}}' <name>
docker logs --since 30m <name> | tail -200
df -h /opt/neuroglitch /var/lib/docker

# Observability stack
curl -sS http://localhost:3000/metrics | grep -E 'audit_persistence|runner_cycles' | head
# Grafana Explore (Loki): {container=~".*app.*"} |= "CRITICAL"
#                          {container=~".*app.*"} |= "[audit]" | json

# Jobs (Turso/sqlite shell, SELECT only)
SELECT id, jobType, status, bidId, startedAt, externalJobId FROM BackgroundJob WHERE activeSlot = 1;
SELECT jobType, status, COUNT(*) FROM BackgroundJob GROUP BY 1,2;
SELECT * FROM RunnerLease ORDER BY claimedAt DESC LIMIT 10;

# Migrations (SELECT only + dry-run)
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 10;
node scripts/apply-turso-migrations.mjs --dry-run

# Post-deploy acceptance
node scripts/validate-staging.mjs
```

Prohibited in a diagnosis session: any `UPDATE/DELETE/INSERT`, `prisma migrate` anything, `docker compose up` variants, editing env files, printing env values, `rm` under storage or docker dirs.

## D. Automatic-recovery policy (summary)

| Allowed automatically (existing or approved-by-backlog) | Never automatic |
|---|---|
| Container restart-on-crash (`unless-stopped`) | Migrations, any DB write repair |
| Worker loop backoff + readiness gate | Deleting blobs/rows/logs data |
| Bounded retry of a failed *terminal-status* write (B-02) | Failing/cancelling a job without a heartbeat-based deadline (until B-12 lands) |
| Deadline-based auto-fail of provider-dead jobs **after** B-12's janitor + audit trail | Token revocation, account action |
| Log rotation (B-06) | Restore of any backup |
| Restart-on-unhealthy (pending recorded decision, FM-24) | Anything in production before its gate |

## E. Escalation matrix

| Condition | Escalate to | Latency |
|---|---|---|
| Data loss confirmed or suspected (FM-18/19/22/23) | Josh | immediately |
| Migration partial state (runner exit 2) | Josh | immediately, full stop |
| Audit-integrity breach beyond known §1a paths | Josh + SOL review lane | immediately |
| Credential suspicion / any secret exposure | Josh | immediately; no self-service rotation of shared secrets |
| Restart loop with no correlated change | Josh | same day |
| Deliberate probing / token abuse with access evidence | Josh | same day |
| Recurring stuck jobs (same type, 2+/week) | defect ticket + builder card | next session |
| Anything requiring a write with no gated path | stop; Josh decides | before acting |
