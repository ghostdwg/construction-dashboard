# Staging Backup / Restore Runbook

Operator procedure for backing up the staging tier (Turso DB + durable
`/storage` archive) and for proving, via an isolated restore drill, that a
backup is actually restorable. This is the **foundation** document only:

- **This runbook is documentation.** No backup, restore, snapshot, or
  drill has been executed as part of authoring it.
- **No script exists yet.** `runtime/deployment/` does not (yet) contain a
  `backup-staging.sh` / `restore-staging-drill.sh` pair. This runbook
  describes the requirements those future scripts must satisfy, in the same
  spirit as `runtime/deployment/snapshot-prod.sh` (currently a STUB per
  Phase R4) — plausible future locations are named below, but writing them
  is out of scope here and requires its own separately-approved phase.
- **Never point restore at live staging.** See §9. This is the single most
  important rule in this document.

---

## Scope

Covers the **staging** tier only (`APP_ENV=staging`, Turso DB
`groundworx-staging-ghostdwg`, storage bind `/opt/neuroglitch/storage-staging`
→ container mount `/storage`, per `runtime/runbooks/staging-bootstrap.md`).
Production backup (`runtime/deployment/snapshot-prod.sh`) is a separate,
already-stubbed concern and is not modified by this document.

---

## 1. DB snapshot requirements

The staging database is Turso (libSQL), per `docs/architecture/STORAGE.md`
and `runtime/runbooks/turso-migrations.md`. A valid staging DB snapshot MUST:

- Be taken via the Turso platform's own backup/PITR mechanism (`turso db
  backup create <db-name> --description "..."`), not an ad hoc file copy —
  libSQL does not guarantee a consistent on-disk snapshot from a raw file
  read while the DB is live. This mirrors the approach already described for
  production in `snapshot-prod.sh` (§2 "CAPTURE PITR marker").
- Capture a single, well-defined point in time. Record the exact UTC
  timestamp the snapshot was requested and the snapshot/backup ID Turso
  returns — both go in the checksum manifest (§4).
- Cover the **entire** `groundworx-staging-ghostdwg` database — every table
  reachable from `prisma/schema.prisma`, including `_prisma_migrations`
  (needed to know which migrations the restored DB is at) and the
  `AuditEvent` table (per `runtime/observability/README.md`). No table is
  excluded from scope.
- Be verified to exist post-creation before the operation is considered
  successful (`turso db backup list <db-name> | head -1` showing the new
  entry) — an unverified "create" call that silently no-ops is not a valid
  snapshot. This is the same refusal condition already codified in
  `snapshot-prod.sh` §3, applied here to staging.
- Never be taken by connecting with a production Turso auth token. Staging
  snapshots use the staging-scoped token only (see `staging.env.example`
  `DATABASE_AUTH_TOKEN`, sourced from the `GroundWorX-staging` 1Password
  vault).

## 2. Durable `/storage` archive requirements

Per `docs/architecture/STORAGE.md`, staging's durable blob storage is the
`LocalBlobStore` filesystem tree bind-mounted at
`/opt/neuroglitch/storage-staging` on the host (container path `/storage`,
env `STORAGE_BACKEND=local`, `STORAGE_LOCAL_PATH=/storage`). A valid storage
archive MUST:

- Capture the **entire** tree under the staging storage root: `market/`,
  `plan-room/`, `meetings/`, and `_trash/` (per the layout documented in
  `docs/architecture/STORAGE.md`). Do not exclude `_trash/` — it holds
  30-day soft-deletes that may still be needed for a restore drill.
- Be taken as close in time as possible to the DB snapshot in §1, and the
  **archive window MUST be recorded against the same timestamp/snapshot ID**
  used for the DB snapshot, so DB rows and blob files never drift apart
  relative to each other (e.g. a `Submittal` row referencing a
  `plan-room/jobs/{jobId}/spec/original.pdf` key that doesn't exist in the
  paired archive would be a drift bug). Concretely: take the DB snapshot
  first, then immediately archive storage, and record both the DB snapshot
  ID and the storage archive's start/end wall-clock time in the same
  manifest entry (§4).
- Preserve the exact relative key structure (`sha256`-addressable content
  addressed by `LocalBlobStore` key, per `lib/storage/blobStore.ts`) so a
  restored archive can be extracted straight back onto a
  `STORAGE_LOCAL_PATH` mount without any key remapping.
- Be a full archive, not incremental, for this foundation phase — the same
  posture STORAGE.md already documents for the production weekly cron
  (`tar czf storage-$(date +%F).tar.gz ...`). Incremental/differential
  backup is an optimization for a later phase, not this one.

## 3. Destination and permissions requirements

- Backups (DB snapshot metadata + storage archive) MUST land **off the
  staging host's live serving path** — i.e. not inside
  `/opt/neuroglitch/storage-staging` itself, and not readable/writable by
  the running `neuroglitch-staging-app` / `-sidecar` / `-worker` containers.
  A backup that lives next to the thing it backs up is not a backup.
- The exact destination host/path/bucket is an infrastructure decision for
  the execution phase (separately approved) — this runbook does not
  prescribe one. Whatever is chosen MUST satisfy:
  - Access restricted to the operator(s) who run backup/restore
    procedures — not the same broad access as the app runtime.
  - No credentials shared between the backup destination and the staging
    app's own secrets (`AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`,
    `CREDENTIAL_MASTER_KEY`, etc. per `staging.env.example`) — a compromise
    of one must not imply compromise of the other.
  - If the destination is ever cloud object storage, that is subject to
    the same approval gate as any other external storage decision per
    `governance/CONFIDENTIAL_DATA_POLICY.md` §7 ("S3 / cloud object
    storage ... only `LocalBlobStore` is permitted today" — that clause
    governs the app's live serving backend, but the same approval
    discipline should be applied here before choosing a cloud backup
    destination; this is a **judgment call**, flagged for human review in
    the summary below).
- Whoever/whatever holds write access to the backup destination should NOT
  also be the default credential set used for day-to-day staging
  deploys — minimize the blast radius of a leaked deploy credential.

## 4. Checksum manifest

Every backup run MUST produce a manifest (plain text or JSON, checked
alongside the archive, never inside a location that gets rotated away
before the archive itself) recording:

| Field | Content |
|---|---|
| `backup_id` | Operator-chosen or timestamp-derived unique ID for this run |
| `taken_at_utc` | ISO-8601 UTC timestamp the run started |
| `db_snapshot_id` | The Turso backup/PITR ID from §1 |
| `db_snapshot_sha256` | Hash of the DB snapshot's exported representation, if Turso's export format permits a stable hash; otherwise the Turso-provided snapshot ID stands in as the integrity reference and this field is recorded as `n/a (Turso-managed)` |
| `storage_archive_path` | Relative/logical name of the archive file (not the destination's absolute path/credentials) |
| `storage_archive_sha256` | `sha256sum` of the full `tar`/archive file — one hash for the whole archive |
| `storage_file_count` | Count of files captured, as a cheap sanity check independent of the hash |
| `app_env` | Must read `staging` — a manifest for any other tier does not belong in this flow |
| `operator` | Who ran the backup (name/handle, not a credential) |

Integrity verification before ANY restore (drill or otherwise):

1. Recompute `sha256sum` on the archive file at the destination; it MUST
   match `storage_archive_sha256` in the manifest exactly.
2. Confirm `storage_file_count` matches the archive's actual entry count.
3. Confirm the manifest's `db_snapshot_id` still resolves via
   `turso db backup list groundworx-staging-ghostdwg`.
4. If any check fails: **abort**. Do not attempt a "best effort" restore
   from a manifest-mismatched backup. Escalate to the operator named in
   the manual approval gates (§10).

## 5. Retention policy

- Keep the **last N successful, manifest-verified backups** (N to be fixed
  as a config value when the execution-phase script is written; a
  reasonable starting default consistent with the production storage cron's
  weekly cadence in `docs/architecture/STORAGE.md` is **4 weekly backups
  (~1 month) plus the most recent daily, if daily cadence is adopted** —
  this default is a judgment call for human confirmation, not a fixed
  requirement of this runbook).
- Rotation removes the **oldest** backup only after the **newest** backup
  has passed its own checksum-manifest verification (§4) — never rotate an
  old backup out before confirming the new one that replaces it is good.
- Retention/rotation of backup artifacts is itself a **manual-approval
  action** (§10c) in this foundation phase — no automatic cron-driven
  deletion until a script exists and has been separately approved.
- Backups belonging to a completed, torn-down restore drill (§7) are
  **drill artifacts**, not staging backups, and follow the drill cleanup
  gate (§10c), not this retention policy.

## 6. No-secret logging rules

Aligned with `governance/CONFIDENTIAL_DATA_POLICY.md` (Project Confidential /
Contractually Restricted default-to-LOCAL posture, and its instruction that
"pricing/credentials never enter any prompt" — the same discipline applies
to logs and manifests, not only AI prompts). Backup/restore logs, manifests,
and any drill output MUST NEVER contain:

- `DATABASE_AUTH_TOKEN`, or any `DATABASE_URL` value with its `authToken=`
  query parameter unredacted (log the host/db-name portion only, if the URL
  must appear at all).
- `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY`,
  `SIDECAR_API_KEY`, `SIDECAR_CALLBACK_TOKEN`, `WORKER_TOKEN`, or any other
  value sourced from the `GroundWorX-staging` 1Password vault (per the full
  list in `runtime/env/staging.env.example`).
- Raw contents of confidential project documents captured in the `/storage`
  archive (spec PDFs, drawings, meeting audio/transcripts) — logs may name
  **counts and paths/keys**, never body text or transcript content.
  `pricingData` in particular must never appear in any log line, per the
  project-wide "never return pricingData" constraint.
- Any operator's personal credentials (SSH keys, 1Password session tokens,
  Turso CLI auth state).

Logs and manifests MAY contain: timestamps, snapshot/backup IDs, file
counts, checksums, `APP_ENV`/tier names, and non-secret hostnames. When in
doubt, treat a value as a secret and omit it — this is the same
fail-closed posture `CONFIDENTIAL_DATA_POLICY.md` §2 applies to unclassified
project data.

## 7. Isolated restore-drill procedure

A restore drill proves a backup is restorable **without ever touching live
staging**. "Isolated" here means ALL of the following simultaneously:

- **Separate Turso DB/namespace.** Restore into a newly-created,
  drill-only Turso database (e.g. a name distinct from both
  `groundworx-staging-ghostdwg` and `groundworx-prod-ghostdwg`, following
  the naming-fence pattern in `turso-migrations.md` — a plausible future
  name is something like `groundworx-staging-restoredrill-<date>`, chosen
  so the `APP_ENV` tier fence and the "must contain `staging`"/"must
  contain `prod`" substring checks in `lib/env.ts` cannot accidentally
  resolve it as either real tier). Never restore into
  `groundworx-staging-ghostdwg` itself, even "temporarily."
- **Separate storage prefix/root.** Extract the storage archive into a
  drill-only filesystem root (e.g. `/opt/neuroglitch/storage-restoredrill/`),
  never into `/opt/neuroglitch/storage-staging` or `/opt/neuroglitch/storage`.
- **No shared credentials with live staging.** The drill DB gets its own
  freshly-generated Turso auth token; the drill environment does not read
  `/opt/neuroglitch/.env.staging` or any live staging secret. If application
  containers are stood up at all for smoke testing, they run under a
  separate Compose project name (following the `neuroglitch-staging` /
  `neuroglitch` project-naming precedent in `staging-bootstrap.md` — a
  drill project would be named distinctly, e.g. `neuroglitch-restoredrill`)
  with its own env file populated from drill-only generated secrets, never
  copied from the `GroundWorX-staging` vault.
- **No network path back to live staging or production.** The drill
  environment must not be able to write to, or be reachable by, the live
  staging Compose project, its DB, or its storage mount.

High-level drill sequence (no commands executed as part of authoring this
runbook; commands below are the procedure a human operator follows once the
manual approval gate in §10b is granted):

1. Select the backup to drill (its manifest, per §4) and verify its
   checksum manifest **before** provisioning anything (§4 integrity check).
2. Provision the isolated drill DB and drill storage root, per the
   isolation requirements above.
3. Restore the DB snapshot into the drill DB (Turso-native restore, not a
   raw file copy — mirrors the snapshot mechanism in §1).
4. Extract the storage archive into the drill storage root.
5. Run application-level verification against the drill environment only
   (§8) — never against live staging.
6. Record results (§8) and hand them to the operator named in §10b.
7. Tear down the drill environment per the cleanup gate (§10c).

## 8. Exact verification evidence

A restore drill is only considered a **pass** when ALL of the following are
captured and recorded (not just eyeballed):

| Evidence | How captured |
|---|---|
| Manifest checksum match | Recomputed `sha256sum` of the archive equals the manifest's `storage_archive_sha256` (§4), recorded pass/fail |
| DB row counts | `SELECT count(*)` per table in the drill DB, compared against the row counts recorded from the source staging DB at backup time (the backup step must capture these counts into the manifest for exactly this comparison) |
| `_prisma_migrations` state | Drill DB's applied migration count/names match what `migrate:turso:status` (per `turso-migrations.md`) reports for staging as of the snapshot time |
| Storage file count | Extracted file count in the drill storage root equals `storage_file_count` from the manifest |
| Spot-check file integrity | `sha256sum` of at least one sampled file per top-level storage directory (`market/`, `plan-room/`, `meetings/`) matches the `.meta.json`/expected hash where one exists |
| Application smoke test | If containers are stood up for the drill: auth flow, one read of a restored record (e.g. a bid or submittal), and one storage read via the drill `LocalBlobStore` root, each recorded pass/fail with timestamp |
| Drill environment isolation confirmation | Explicit statement that the drill DB name, storage root, and (if applicable) Compose project name are distinct from every live-staging and live-production identifier, checked against §7's isolation list |

All of the above go into a drill report (dated, naming the backup drilled
and the operator who ran it) before the drill is declared successful and
before cleanup (§10c) proceeds.

## 9. Explicit prohibition on restoring over live staging

> **THIS RESTORE PROCEDURE MUST NEVER BE POINTED AT LIVE STAGING.**
>
> The restore target is **always** the isolated drill DB and isolated drill
> storage root defined in §7 — **never**
> `groundworx-staging-ghostdwg`, **never**
> `/opt/neuroglitch/storage-staging`, and **never** the running
> `neuroglitch-staging-*` containers. There is no variant of this procedure,
> no emergency, and no operator convenience that justifies restoring
> directly onto live staging. If live staging itself needs to be recovered
> from a backup, that is a **different, higher-severity procedure** that
> does not exist yet, requires its own explicit design and its own
> separately-named approval gate, and is explicitly **out of scope** for
> this document.
>
> Before running any restore step, the operator MUST re-read this section
> and confirm out loud / in the approval record (§10b) that the restore
> target is the drill environment, not live staging.

## 10. Manual approval gates

No automated trigger performs any of the actions below. Each requires an
explicit, named human checkpoint before proceeding — consistent with this
repo's existing pattern of operator-gated staging/production actions (see
`turso-migrations.md` "production migrations are operator-driven and gated
by a deploy window," and `staging-first-activation.md` "if any step in this
runbook fails, abort and document. Do not improvise on production.").

### (a) Before any backup is actually run

**Approver: the operator (default: Josh / repo owner — confirm the actual
on-call name at execution-phase time; this runbook does not hard-code a
name as policy, see judgment-call note below).**

Before the backup script (once written and separately approved) is invoked
against real staging infrastructure, the approver must explicitly confirm:

- Which backup (`backup_id`) is about to be taken and why (routine cadence
  vs. pre-change safety snapshot).
- That the destination (§3) is reachable and has sufficient free space.
- That no prior backup run is still in flight (no overlapping snapshot
  windows against the same DB).

### (b) Before any restore drill is actually run

**Approver: the operator (default: Josh / repo owner).**

Before ANY restore step touches even the isolated drill environment, the
approver must explicitly confirm:

- The exact backup (`backup_id` + manifest) being drilled, and that its
  checksum manifest has already passed verification (§4).
- The drill DB name, drill storage root, and (if used) drill Compose
  project name, and that each is confirmed distinct from every live
  staging/production identifier per §7 and the prohibition in §9.
- That they have re-read §9 and are not, in fact, about to restore over
  live staging.

### (c) Before any cleanup of drill artifacts is performed

**Approver: the operator (default: Josh / repo owner).**

Before the drill DB is destroyed and the drill storage root is deleted, the
approver must explicitly confirm:

- The drill report (§8) has been fully captured and saved somewhere durable
  (i.e., cleanup does not also destroy the evidence that the drill
  happened).
- The drill environment is definitively the one being torn down (name
  double-checked against §7's isolation list one more time) — deleting the
  wrong Turso DB or the wrong storage root is irreversible.
- No further verification is pending against this drill.

---

## What this runbook does NOT do

- Does not contain executable backup, restore, snapshot, or drill commands
  run against real infrastructure. No such command was run while authoring
  this document.
- Does not create `backup-staging.sh`, `restore-staging-drill.sh`, or any
  other script. Those are a future, separately-approved phase.
- Does not modify `runtime/fly/`, any Docker/Compose file, or any
  provider/credential source.
- Does not define a live-staging disaster-recovery procedure (see §9) —
  that is explicitly out of scope and would need its own runbook.
- Does not fix the S3-vs-`LocalBlobStore` tension noted in §3 — flagged for
  human review, not resolved here.

---

## Canonical references

- `docs/architecture/STORAGE.md` — BlobStore layout, current backend, and
  the existing production weekly-cron backup description this runbook
  extends to staging.
- `runtime/runbooks/turso-migrations.md` — Turso/libSQL migration model,
  `_prisma_migrations` schema, APP_ENV tier fence, PITR reference.
- `runtime/runbooks/staging-bootstrap.md` — staging tier naming (Compose
  project, storage bind, Turso DB, `APP_ENV` values) that this runbook's
  isolation requirements (§7) are built on top of.
- `runtime/runbooks/staging-first-activation.md` — "production remains
  authoritative" / isolation-first precedent this runbook follows for the
  drill environment.
- `runtime/deployment/snapshot-prod.sh` — existing (stubbed) production
  snapshot precedent; §1 and §10 mirror its verify/capture/verify shape.
- `runtime/deployment/compose-governance.md` /
  `runtime/runbooks/environment-promotion.md` — existing PITR-restore
  rollback language this runbook's §1 and §9 are consistent with.
- `runtime/env/staging.env.example` — authoritative staging env var names
  referenced throughout (§1, §3, §6).
- `governance/CONFIDENTIAL_DATA_POLICY.md` — no-secret-logging basis for
  §6 and the cloud-storage caution in §3.
