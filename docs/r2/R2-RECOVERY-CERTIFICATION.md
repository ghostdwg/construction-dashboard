# GroundWorX R2 — Migration, Backup, Restore & Recovery Certification

## What this is

A local-only, disposable-database certification package that proves the
current `prisma/migrations/` chain can:

- initialize a fresh database and migrate it through the full chain;
- upgrade an existing database through its final three migrations
  (today: migrations 99→100→101 of a 101-migration chain);
- create a verified backup and restore it into a disposable environment;
- preserve relational and immutable-history integrity across that
  round-trip;
- detect unsafe or incomplete recovery states (corrupted backup, wrong
  schema version, interrupted migration, partial restore, missing
  migration, unknown future migration).

**This is not proof that backup/restore works on staging or production.**
Per `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §5, "backups exist" /
"restore works" remains a prohibited claim until an actual staging/production
drill runs (GWX-Q08). What this package proves is narrower and load-bearing
in its own right: **the migration chain and a from-scratch local
backup/restore/detection harness behave correctly against disposable local
SQLite**, which is a prerequisite nothing else in the repo previously
checked mechanically.

## Prerequisites

- Local checkout at the SHA you want to certify (see "Rerunning against a
  final candidate SHA" below).
- `npm install` (this harness uses `@libsql/client`, `tsx`, and `vitest`,
  already project dependencies — no new dependency was added).
- No network, no credentials, no `DATABASE_URL`, no Turso account, no
  staging/production access of any kind. The harness never reads
  `process.env.DATABASE_URL` and never opens a `libsql://` URL.

## Running it

```bash
npm run certify:r2-recovery
```

Runs the full 22-scenario pipeline **twice** (to prove deterministic
evidence — scenario 22), writes:

- `docs/r2/certification-result.json` — machine-readable, one row per
  scenario (`id`, `name`, `status`, `detail`, `evidence`);
- `docs/r2/certification-summary.md` — normalized human-readable summary
  table.

Exit code is `0` if every scenario is `PASS`, `1` otherwise. Pass `--keep`
to retain the disposable run directories for inspection after a failure:

```bash
npm run certify:r2-recovery -- --keep
# ... prints the two run directories under os.tmpdir(), e.g.
#   /tmp/gwx-r2-cert-run1-XXXXXX
#   /tmp/gwx-r2-cert-run2-XXXXXX
```

Focused automated tests (exercise the library modules directly, faster,
CI-friendly):

```bash
npx vitest run tests/certification
```

## Database locations

Everything lives under `os.tmpdir()/gwx-r2-cert-<label>-<random>/`, entirely
outside the repository working tree:

```
<run>/db/       disposable SQLite files (fresh.db, upgrade.db, restored.db, ...)
<run>/backup/   backup files + `<name>.db.bak.manifest.json` manifests
<run>/result/   reserved, currently unused by the orchestrator directly
```

Without `--keep`, the harness deletes its own run directory (`fs.rmSync`)
when it exits — never any other path. It never writes inside the repo
except the two committed evidence files above.

## What each phase does

### 1. Creation

`scripts/certification/lib/migrator.ts` re-implements (does **not** import)
the statement-splitting and `_prisma_migrations` bookkeeping logic in
`scripts/apply-turso-migrations.mjs`, pointed at a local `file:` SQLite path
via `@libsql/client` instead of a tier-fenced `libsql://` URL. It is a
from-scratch local twin, not a wrapper — see the header comment in
`lib/db.ts` for why the real Turso runner is never imported as a library
(it has top-level `APP_ENV`-gated side effects designed for a CLI, not a
module).

### 2. Seeding

`scripts/certification/lib/fixtures.ts` inserts a synthetic entity graph via
raw parameterized SQL (`Trade`, `Subcontractor`, `Bid`, `Meeting`,
`MeetingRegisterEntry` + revision, `MeetingCommitment`, `TrackedItem` +
attachment, `BackgroundJob`, `AuditEvent`), then — once migration 99 has
applied — a full response-package chain (`ResponsePackage` →
`ResponsePackageItem` → `TradeResponseRevision` → `TradeResponseAttachment`
/ `ResponseAccessToken`), with the revision's `gcReview` set to `'APPROVED'`
specifically to exercise migration 101's data backfill into
`TradeResponseReviewDecision`. All literal values come from
`tests/fixtures/r2-recovery-seed.json` and are prefixed `[CERT]` — no real
project, customer, or sub data. Timestamps are fixed literals, not
wall-clock, so seeded content hashes identically across runs.

### 3. Migration

`npm run certify:r2-recovery` exercises two paths:

- **Fresh:** an empty database migrated straight through all migrations
  on disk (scenario 1).
- **Upgrade:** a database migrated through migration *N-3* (today, #98 —
  `20260717120000_r2b1_register_rerun_supersession`), seeded with baseline
  fixtures, backed up (captures the pre-tail schema version for later use),
  then migrated one step (migration 99), seeded with response-package
  fixtures, then migrated through the remaining two (100, 101) — scenario 2.
  The "last 3" tail is computed from the current migration count, not
  hardcoded names, so this stays meaningful as new migrations land (see
  "Rerunning" below).

Order verification (scenario 3), idempotent repeat-apply (scenario 4), and
three anomaly-detection scenarios (18, 20, 21 — interrupted / missing /
unknown migration) round out this phase using `auditMigrationState()` and a
`simulate` namespace that injects each anomaly directly into a throwaway
copy's `_prisma_migrations` bookkeeping table (never product data).

### 4. Backup

`scripts/certification/lib/backup.ts` checkpoints the WAL
(`PRAGMA wal_checkpoint(TRUNCATE)`), copies the SQLite file's bytes, and
writes a `<backup>.manifest.json` recording a sha256 checksum, byte size,
and the last applied migration name (the "schema version").

### 5. Checksum

Scenario 6 independently recomputes the backup file's sha256 and asserts it
matches the manifest.

### 6. Restore

`restoreBackup()` verifies the manifest checksum against the backup file
(refuses on mismatch — scenario 16), optionally verifies an
`expectedSchemaVersion` argument against the manifest's recorded schema
(refuses on mismatch — scenario 17), copies to a `.restoring` temp path,
re-verifies the copy's checksum, and only then atomically renames it into
place. `verifyRestoredIntegrity()` re-checks a restored file's checksum and
byte size against the manifest at any later point — used both right after a
real restore and to simulate detecting a restore that was interrupted or
corrupted after the fact (scenario 19).

### 7. Integrity validation

`scripts/certification/lib/integrity.ts` provides:

- `tableRowCounts` — used for the full-database row-count comparison
  (scenario 8, all tables via `listTables()`, not a hardcoded subset);
- `foreignKeyCheck` — wraps `PRAGMA foreign_key_check` (scenario 9);
- `contentDigest` — deterministic sha256 over specific columns of a table,
  ordered by `id`, used to prove byte-identical survival of: immutable
  `AuditEvent` history (10), `MeetingRegisterEntryRevision` +
  `TradeResponseReviewDecision` audit trails (11), Meeting/Register/
  TrackedItem provenance fields (12), the full response-package relationship
  chain via a join-count comparison (13), `TrackedItemAttachment` /
  `TradeResponseAttachment` storage keys (14), and `BackgroundJob` state
  (15) — each compared between the source database and its restored copy.

### 8. Cleanup

`cleanupCertRun()` (`fs.rmSync(run.root, { recursive: true, force: true })`)
removes only the one `os.tmpdir()` directory tree the harness itself
created for that pipeline run. It never touches any other path. Skipped
when `--keep` is passed.

## Interpreting failures

- `docs/r2/certification-summary.md`'s table gives PASS/FAIL/SKIP per
  scenario with a one-line detail. `docs/r2/certification-result.json` has
  the full `evidence` object per scenario (row counts, applied-migration
  lists, refusal reasons) for anything the summary line doesn't say enough
  about.
- Scenarios 8–15 report `SKIP` (not `FAIL`) if scenario 7 (restore) itself
  failed — there is nothing to compare.
- A `FAIL` on scenarios 1–4 means the migration chain itself does not apply
  cleanly locally; rerun with `--keep` and inspect
  `<run>/db/fresh.db`/`upgrade.db` directly with any SQLite browser.
- A `FAIL` on 16/17 means a refusal that should have happened did not (or
  happened for the wrong reason) — treat this as a release blocker, not a
  harness bug, until proven otherwise.
- A `FAIL` on 22 means the two full pipeline runs produced different
  normalized evidence — see "Determinism & normalization" below before
  assuming it's transient.

### A defect this harness found (already fixed here, still open in the real runner)

Certifying the harness against real migration content surfaced a genuine
defect: **`PRAGMA foreign_keys = ON|OFF` is a no-op when issued inside an
already-open transaction** (documented SQLite behavior). Both this
harness's original statement splitter and `scripts/apply-turso-migrations.mjs`
batch an entire migration — including its leading/trailing
`PRAGMA foreign_keys` toggle — into one `client.batch(stmts, "write")` call,
which is one implicit transaction. That means the toggle never actually
takes effect, and migration
`20260718030000_r2b2_trade_response_reviewer_repairs` (which rebuilds
`ResponsePackage`/`TradeResponseRevision`/etc. via SQLite's
create-copy-drop-rename pattern while `PRAGMA foreign_keys=OFF` is meant to
be active) fails with `SQLITE_CONSTRAINT` foreign-key errors **once those
tables already hold rows** — reproduced here by seeding a response-package
chain before applying migration 101 (scenario 2).

- **Fixed in this package:** `scripts/certification/lib/migrator.ts` now
  splits each migration's statements on `PRAGMA foreign_keys`/
  `defer_foreign_keys` boundaries and executes those PRAGMAs outside any
  transaction, batching only the DDL/DML between them. See the
  `applyStatementGroups` comment in that file for detail.
- **Not fixed in `scripts/apply-turso-migrations.mjs`** — that script is
  human-gated (GWX-Q02-class) and out of this task's permitted-file scope
  (`.claude/rules/migrations-checkpoints.md`: "One runner… models never run
  it against staging/production"). It carries the same latent defect.
- **Why staging is very likely unaffected today:** migrations 99, 100, and
  101 are all still pending as of this writing (Ledger §9.6 lists only two
  *different*, already-applied-adjacent migrations as the pending pair — R2
  build-2 tables don't exist on staging yet). Applying 99→101 back-to-back
  against an empty `ResponsePackage`/`TradeResponseRevision` table set (as
  scenario 1's fresh-database path here also proves) does not trigger the
  bug — there's no row data for the FK check to violate. The exposure is
  narrow but real: **any future migration that both toggles
  `PRAGMA foreign_keys` and table-redefines an already-populated table
  should be scenario-tested against a seeded local database — via this
  harness or equivalent — before being applied to staging**, and
  `apply-turso-migrations.mjs`'s batching should get the same
  `applyStatementGroups`-style fix under a reviewed Q-series card before
  that becomes a real risk.

## Limitations

- **SQLite, not Turso/libSQL-over-network.** `@libsql/client` against a
  local `file:` path uses libsql's embedded engine; this validates the
  same `migration.sql` files and the same SQL dialect Turso uses, but does
  not exercise network latency, libSQL server-side replication, Turso's
  PITR/checkpoint mechanics, or any staging/production credential or
  connection-string behavior. Those remain `[UNK]` per the Ledger until a
  real staging/production drill (GWX-Q08) runs.
- **A migration that toggles `PRAGMA foreign_keys` mid-file is not fully
  atomic under this harness's statement grouping** — see the defect note
  above. A failure in a later statement group of such a migration can leave
  that migration's DDL partially applied at the SQL level even though
  `_prisma_migrations` correctly does not record it as finished (bookkeeping
  is only inserted after every group for that migration succeeds). This is
  an inherent SQLite property (no nested-transaction-safe way to combine a
  `PRAGMA foreign_keys` toggle with a single atomic transaction), not
  specific to this package's code.
- **Row-count and content-digest checks cover every table currently in the
  schema** (`listTables()` queries `sqlite_master` directly — nothing is
  hardcoded or silently excluded), but only the specific fixture rows
  seeded by `fixtures.ts` are covered by content-digest assertions. Tables
  with no certification fixture data pass row-count comparison trivially
  (0 == 0) but have no content-level assertion.
- **Backup mechanism is a checkpointed file copy**, not
  `VACUUM INTO`/Turso's native backup API — appropriate for local
  disposable SQLite, not a statement about what mechanism staging/
  production backup should use.
- Synthetic data only; no coverage of real-world data shapes, encoding
  edge cases, or scale.

## Rerunning against a final candidate SHA

```bash
git checkout <candidate-sha>   # or a branch pointing at it
npm install
npm run certify:r2-recovery
git diff --stat docs/r2/certification-result.json docs/r2/certification-summary.md
```

The "last 3 migrations" tail scenario is computed from
`listMigrations().length` at run time, not hardcoded — as new migrations
land after this writing, scenario 2 will exercise whatever the new tail is,
and `docs/r2/certification-result.json`'s `evidence.tailMigrations` field on
scenario 2 records exactly which migrations were exercised for that run.
