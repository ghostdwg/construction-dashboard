# R2 Staging Rollback Runbook

**Status:** Release-planning document. **No rollback, restore, or recreate has
been executed.** This runbook defines the recovery procedure if any release or
acceptance gate fails during or after the R2 staging deploy
(`docs/r2/R2-STAGING-DEPLOYMENT-PACKET.md`,
`docs/r2/R2-STAGING-ACCEPTANCE-CHECKLIST.md`).

**Scope: staging only.** Production is frozen and out of scope. Rollback is
**image-tag based**, not `git revert` based (compose-governance §5,
environment-promotion §Rollback). Migrations are **forward-only** — no
down-migration exists or may be authored.

**Candidate identity:** the deploy under recovery is the *approved*
`${CANDIDATE_SHA}`. The rollback target is `${PREV_STAGING_SHA}` /
`${PREV_STAGING_DIGEST}` — the image running on staging **before** this deploy.

---

## 1. Rollback decision authority

- **Authority:** the operator (default: Josh / repo owner). No model, no CI job,
  and no automated hook may initiate a rollback of a live tier. Every action
  below is human-executed with explicit per-invocation approval.
- The operator decides between the three responses (§3): **application-only
  rollback**, **application + database restore**, or **forward-fix**. The
  migration shape (§5) is the decisive input.
- The decision, its trigger, and the chosen path are recorded in the incident
  report (§9) and the ops log.

---

## 2. Hard rollback triggers

Any of these, observed during/after deploy, is a **hard** trigger — begin
rollback assessment immediately:

1. App/sidecar/worker health fails and does not recover (acceptance A1–A4).
2. Wrong image running — OCI `image.revision` ≠ `${CANDIDATE_SHA}` or digest ≠
   `${APP_IMAGE_DIGEST}` (A5).
3. Migration left in a **partial** state — runner exited **2**, or dry-run shows
   a `started-but-not-finished` row (A6 / A10).
4. **Tenant isolation breach** or **external-response authorization escape**
   (acceptance 2.3 / 2.14) — unconditional, blocks promotion.
5. **Confidential data leak** — `pricingData`/`rawPriceText`, sub names,
   companies, or `isPreferred` reaching a client/sub-facing surface (2.13).
6. **Data-integrity loss** — rerun preservation destroys prior-run data, audit
   trail missing, or background jobs double-process (2.9 / 2.15 / 2.17).
7. New persistent `level=error`/`panic` class attributable to the candidate (A8).
8. Auth broadly broken (2.1) — no one can log in.

Soft failures (isolated, candidate-independent, or cosmetic) are **not** hard
triggers — record them and let the operator weigh fix-forward vs rollback.

---

## 3. The three recovery paths

### 3.1 Application-only rollback (image repin)

**When:** the failure is in application behavior and **the schema is unchanged
or backward-compatible** with `${PREV_STAGING_SHA}`. For the R2 candidate this
is only safe if migrations 100/101 have **not yet been applied** (i.e. failure
during build/health *before* migrate, or only additive migration 99 landed).

**Action:** recreate the staging services at the previous image, no rebuild:

```bash
APP_SHA=${PREV_STAGING_SHA} docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

Then re-run health (§7). Compose pulls the previous immutable tag / digest;
named volumes reattach unchanged.

### 3.2 Application + database restore

**When:** a candidate migration has been applied **and** the schema is **not**
backward-compatible with the app being rolled back to — i.e. migrations **100 or
101 (table rebuilds with tightened RESTRICT FKs)** are applied and
`${PREV_STAGING_SHA}` code cannot run against the rebuilt tables; or data was
lost/corrupted.

**Action (operator, gated):**
1. Confirm the restore target is the **live staging DB recovery** path — note
   this is a *higher-severity* procedure than the isolated restore **drill** in
   `runtime/runbooks/staging-backup-restore.md` §9 (which must NEVER point at
   live staging). Live-staging DB recovery from a checkpoint requires its own
   explicit operator approval and is distinct from the drill.
2. Verify the checkpoint before using it: recompute the storage-archive
   `sha256sum` == manifest; confirm `${CHECKPOINT_ID}` still resolves via
   `turso db backup list groundworx-staging-ghostdwg` (§6, backup runbook §4).
3. Restore the Turso checkpoint `${CHECKPOINT_ID}` (Turso-native PITR/restore,
   not a raw file copy) to bring the schema+data back to the pre-migrate point.
4. Repin the application to `${PREV_STAGING_SHA}` (as §3.1).
5. Re-run health (§7) and the migration-state check (acceptance A6) — the
   restored DB must show the pre-R2 migration set with no partial rows.

> Because migrations are forward-only, restore is the **only** way to revert the
> schema changes from 100/101. There is no reverse migration and none may be
> written.

### 3.3 Forward-fix (no rollback)

**When forward repair is safer than restore:**
- The migrations applied cleanly and the defect is in application code only,
  fixable by a small follow-up commit — repinning would lose good schema state.
- A restore would discard legitimate data written since the checkpoint that is
  more costly to lose than the defect is to tolerate briefly.
- The defect is a soft failure (§2) with a known, low-risk patch.

**Action:** author a forward-fix commit, take it through the normal gates
(review, tests, security re-review as applicable), and deploy it as a new
candidate `${FIX_SHA}` via the deployment packet. Never hand-edit the live DB or
the live compose file to "just fix it."

---

## 4. Choosing the path (decision table)

| Situation | Path |
|---|---|
| Health/build fails **before** migrate ran | §3.1 application-only |
| Only additive migration 99 applied, app misbehaves | §3.1 application-only (99 is backward-compatible) |
| Migration 100 or 101 applied, app incompatible or data harmed | §3.2 application + DB restore |
| Migration partial (exit 2 / partial row) | **Stop.** Inspect Turso; §3.2 restore from `${CHECKPOINT_ID}` is the safe reset |
| Migrations clean, app-only defect, small safe patch | §3.3 forward-fix |
| Tenant/authz/confidentiality breach | Roll back now (§3.1 or §3.2 per migration state); do not fix-forward on a live breach |

---

## 5. Migration compatibility checks (run before choosing §3.1 vs §3.2)

1. **What applied?** `APP_ENV=staging … node scripts/apply-turso-migrations.mjs
   --dry-run` — read `_prisma_migrations` state: which of 99/100/101 are
   `finished`, which (if any) are partial.
2. **Additive-only?** If only 99 (`…trade_response_packages`) landed → schema is
   backward-compatible → **§3.1 is safe**.
3. **Rebuild landed?** If 100 (`…release_blocker_retention`) or 101
   (`…trade_response_reviewer_repairs`) landed → tables were rebuilt with
   RESTRICT FKs; `${PREV_STAGING_SHA}` code may be incompatible → **§3.2 (DB
   restore) is required for a clean rollback**.
4. **No down-migration.** Do not author or run any reverse migration. Recovery of
   schema state is restore-only.

---

## 6. Previous image digest & backup verification (preconditions)

Before any rollback action:

- **Previous image available:** `${PREV_STAGING_SHA}` and `${PREV_STAGING_DIGEST}`
  are recorded (deployment packet §0) and the image is still pullable
  (`docker inspect` / GHCR). The stub `rollback.ps1` refuses if no previous tag
  exists and warns if it is >30 days old — honor that.
- **Backup verified (only for §3.2):** the checkpoint `${CHECKPOINT_ID}` passes
  its checksum-manifest verification (archive `sha256sum` matches, file count
  matches, backup ID resolves). A manifest-mismatched backup is **not** usable —
  abort restore and escalate (backup runbook §4).

---

## 7. Rollback commands (staging) & post-rollback health

Application repin (both §3.1 and step 4 of §3.2):

```bash
APP_SHA=${PREV_STAGING_SHA} docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

Post-rollback health checks (must all PASS before declaring recovered):

- App `/api/health` 200 `{"status":"ok"}`; sidecar `/health` 200; worker tick fresh.
- `docker inspect … image.revision` == `${PREV_STAGING_SHA}`; digest ==
  `${PREV_STAGING_DIGEST}` — the **previous** image is confirmed running.
- `apply-turso-migrations.mjs --dry-run` reflects the expected migration set for
  the rolled-back state (pre-R2 set if §3.2 restore ran; includes 99 only if
  §3.1 after additive-only).
- Error-log sweep (last 60s) clean.
- Auth: log in / reload as a test user — sessions functional.

---

## 8. Audit & evidence capture

Capture as artifacts (non-secret; no transcript bodies, no `pricingData`):

- The trigger (which acceptance/gate id failed, with its evidence).
- Migration state at time of decision (dry-run output).
- Rollback path chosen and why (§4 row).
- Commands run, with timestamps and exit codes.
- Post-rollback health evidence (§7).
- `${CHECKPOINT_ID}` used (if §3.2) and its verification result.
- Any `AuditEvent` rows written by the recovery actions.

---

## 9. Incident report requirements

Every rollback produces a dated incident report (stored durably, referenced from
the ops log) containing:

- **Summary:** what failed, when (UTC), who decided.
- **Candidate:** `${CANDIDATE_SHA}`, `${REVIEWED_RANGE}`, image digests.
- **Trigger:** the exact gate/acceptance id and its evidence.
- **Path taken:** §3.1 / §3.2 / §3.3, with the §5 migration-compatibility finding
  that drove it.
- **Restore detail (if §3.2):** `${CHECKPOINT_ID}`, verification result,
  row-count comparison against the checkpoint baseline.
- **Outcome:** post-rollback health (§7), migration state, current running
  `${PREV_STAGING_SHA}`.
- **Follow-ups:** the forward-fix plan (`${FIX_SHA}` if any), root cause, and any
  gate that should have caught this earlier.
- **Confidentiality attestation:** no secret values, transcript bodies, or
  `pricingData` recorded.

---

## 10. Production promotion boundary

**Staging-green is not production-authorization.** A production deploy of R2 is a
**separate, separately-approved procedure** and this runbook does not create one.
Before staging could *ever* be considered for production promotion, ALL of the
following must be recorded and true (evidence-tagged `[V]`/`[OP]`):

1. **Staging fully validated** — every Hard-trigger acceptance surface PASS, no
   unresolved `[UNK]` that matters to production, over the agreed soak window
   (default ≥2h green health, environment-promotion §5).
2. **Executed restore proof** — a *green, actually-run* isolated restore drill
   (`runtime/runbooks/staging-backup-restore.md`, GWX-Q08 class), not merely a
   checkpoint taken. Production is **restore-proof-required**; a checkpoint alone
   is insufficient (`.claude/rules/migrations-checkpoints.md`,
   `verification-evidence.md`).
3. **Migration reversibility understood** — because 100/101 are forward-only
   table rebuilds, the production plan must include a verified prod PITR snapshot
   (`snapshot-prod.sh` when real) taken **before** migrate, since forward-only
   means restore is the only revert.
4. **Prod/staging line reconciled** — the divergence between the production
   branch and the staging line is reconciled (a known open item; production is
   frozen until that reconciliation, per repo governance).
5. **Explicit, separate operator approval** — a distinct "APPROVED for
   production" verdict for `${CANDIDATE_SHA}`, with the `-ConfirmProd`-style
   gesture the prod deploy path requires. Staging approval never implies
   production approval.

No production deployment procedure is defined here, and none may bypass this
separate operator-approval boundary.

---

## 11. Canonical references

- `runtime/deployment/compose-governance.md` §5 — rollback expectations.
- `runtime/runbooks/environment-promotion.md` §Rollback — image-tag rollback.
- `runtime/deployment/rollback.ps1` — the (Phase R4 stub) rollback entry point.
- `runtime/runbooks/staging-backup-restore.md` — checkpoint verification, restore
  drill isolation, and the live-restore prohibition on the drill path.
- `scripts/apply-turso-migrations.mjs` — migration state inspection; exit codes.
- `docs/r2/R2-STAGING-DEPLOYMENT-PACKET.md` §3.6 — rollback-compatibility of the
  R2 migration set (99 additive, 100/101 rebuilds).
