# Turso Migration Runbook

How database schema changes reach a Turso (libSQL) database in the GroundWorX platform. Authoritative source for the `scripts/apply-turso-migrations.mjs` runner introduced in Phase R6.6.

## Why a bespoke runner

`prisma migrate deploy` does not speak `libsql://`. The Prisma schema engine dispatches by URL scheme and returns `P1013 ("scheme is not recognized")` when handed a Turso URL. Working around it by shipping the full Prisma engine inside the runtime container does not help — the engine itself cannot connect to libSQL endpoints.

The governed path is:

| Tier | Migration tool | Datasource |
|---|---|---|
| `local` (`APP_ENV=development`) | `npx prisma migrate dev` | `file:./dev.db` |
| `development-parity` / `staging` / `production` | `npm run migrate:turso` (this runner) | `libsql://...turso.io` |

Phase R6.5 fences Prisma CLI away from `libsql://` URLs at `prisma.config.ts` — invoking `prisma migrate deploy` against a Turso URL now refuses with a diagnostic pointing at this runbook. There is exactly one governed migration path per tier.

## No auto-migrate-on-boot policy

The runtime container's command is `node server.js`. There is no entrypoint script and no boot-time migration step. This is intentional:

- Auto-migrate-on-boot couples deploy success to migration success. A schema change that fails to apply would leave the previous app version running indefinitely and pointing at a half-migrated DB, with no operator visibility.
- Multiple replicas booting simultaneously would race the same migration set.
- Rollback would require either reverse migrations (which Prisma does not generate) or accepting that the DB is now ahead of the app version.

Instead: an operator applies migrations explicitly before recreating containers. If the migration fails, the operator sees it; the existing containers keep serving against the old schema.

## APP_ENV requirements

The runner refuses to start without an explicit tier declaration. `APP_ENV` must be set and one of:

| `APP_ENV` | Required `DATABASE_URL` substring | Intended DB |
|---|---|---|
| `development-parity` | `groundworx-dev-` | Per-developer parity Turso DB |
| `staging` | `groundworx-staging` | `groundworx-staging-ghostdwg.turso.io` |
| `production` | `groundworx-prod` | `groundworx-prod-ghostdwg.turso.io` |

`APP_ENV=development` is rejected — local SQLite dev uses `prisma migrate dev`, not this runner.

The fence runs before any DB connection. A wrong-tier URL refuses with exit code 1 and a diagnostic naming the expected substring.

## Staging usage

Run from inside the staging worktree on `superglitch`, sourcing the staging env file:

```bash
cd /opt/neuroglitch/apps/construction-dashboard-staging

# Pass APP_ENV and DATABASE_URL inline; do NOT export them in the shell.
APP_ENV=staging \
  DATABASE_URL=$(grep '^DATABASE_URL=' /opt/neuroglitch/.env.staging | sed 's/^DATABASE_URL=//') \
  npm run migrate:turso
```

Expected first-activation output (against a freshly-provisioned staging Turso DB):

```
[apply-turso-migrations] APP_ENV=staging — connecting...
Found 66 migrations on disk. 0 recorded in Turso. 66 pending.

Pending:
  - 20260404...
  - 20260405...
  ...

Applying 20260404... (N statements)...
  OK (checksum abcd1234...)
...
Done. Applied 66 migration(s).
```

The runner creates `_prisma_migrations` if absent (R6.6 addition; the original `2030909` script crashed against fresh DBs).

## Production usage

Production migrations are operator-driven and gated by a deploy window. The procedure:

1. Snapshot the production Turso DB via the Turso CLI (see `runtime/runbooks/rotate-turso-token.md` for token handling; snapshot procedure tracked in the deferred `snapshot-prod.sh` work item).
2. Apply migrations:
   ```bash
   APP_ENV=production \
     DATABASE_URL=$(grep '^DATABASE_URL=' /opt/neuroglitch/.env.local | sed 's/^DATABASE_URL=//') \
     npm run migrate:turso
   ```
3. If the runner exits 0, recreate the runtime containers at the new image tag.
4. If the runner exits 1 (tier mismatch / bad inputs): abort, the DB is untouched.
5. If the runner exits 2 (mid-run failure): see the failure recovery section below; do not recreate containers.

The production runner is never invoked from CI. Production schema changes require an operator at the host with an authenticated Turso CLI session and access to the live env file.

## Dry-run usage

The `migrate:turso:status` script invokes the runner in `--dry-run` mode. It connects, reads `_prisma_migrations`, lists pending migrations, and exits 0 without applying anything.

```bash
APP_ENV=staging \
  DATABASE_URL=... \
  npm run migrate:turso:status
```

Use cases:
- Confirming that a staging DB is in sync with the working tree before activation.
- Inspecting which migrations would be applied during a deploy window without committing.
- CI smoke (future) — verifying that `_prisma_migrations` state matches the migrations checked into the branch being deployed.

Dry-run still enforces the APP_ENV tier fence. There is no read-only-without-tier mode by design; declaring the tier is the point of the fence.

## Migration state model

The runner uses the same `_prisma_migrations` table Prisma's CLI uses. Schema:

```sql
CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id                      TEXT PRIMARY KEY NOT NULL,
  checksum                TEXT NOT NULL,
  finished_at             DATETIME,
  migration_name          TEXT NOT NULL,
  logs                    TEXT,
  rolled_back_at          DATETIME,
  started_at              DATETIME NOT NULL DEFAULT current_timestamp,
  applied_steps_count     INTEGER UNSIGNED NOT NULL DEFAULT 0
);
```

Rules:
- `pending = (migrations on disk) ∖ (rows present in _prisma_migrations)`
- A row with `finished_at IS NOT NULL` means applied successfully.
- A row with `finished_at IS NULL` means started-but-not-finished — surfaced as a warning, not auto-retried.
- Checksum is `sha256(migration.sql)`. Stored at apply time; future Prisma CLI commands targeting a SQLite-shaped replica will validate against it.

Pending migrations are applied in lexicographic order of directory name (Prisma's `YYYYMMDDHHMMSS_*` convention sorts correctly).

Each migration's SQL is split on `;` at end-of-line and applied as a single libSQL atomic `batch`. If any statement fails, the entire batch rolls back and the runner exits with code 2 — no `_prisma_migrations` row is recorded for that migration.

## Failure recovery

| Exit code | Meaning | First action |
|---|---|---|
| `0` | Applied (or nothing to do, or dry-run) | Proceed to container recreate (if applying). |
| `1` | Bad inputs — refused before connecting | Read the diagnostic; fix env, retry. DB is untouched. |
| `2` | Mid-run failure — partial DB state | **Do not retry blindly.** See below. |

### Exit code 2 recovery (partial state)

1. Read the runner's last log line — it names the failing migration and the libSQL error.
2. Inspect `_prisma_migrations`:
   ```bash
   APP_ENV=staging \
     DATABASE_URL=... \
     npm run migrate:turso:status
   ```
   The dry-run output shows any rows with `finished_at IS NULL` under the WARNING block.
3. Open `prisma/migrations/<failed-migration-name>/migration.sql` and inspect the statement that failed.
4. Three recovery paths, in increasing severity:
   - **The migration is non-destructive and re-runnable** (e.g., a new column with a default): manually apply the remaining statements via `turso db shell`, then `INSERT` the `_prisma_migrations` row by hand using Prisma's column shape. Verify with another `migrate:turso:status`.
   - **The migration is partially destructive** (drops + creates): restore from the pre-migration Turso snapshot (see step 1 of production usage), then re-run `migrate:turso` against the restored DB.
   - **Schema is irrecoverable**: tear down the staging DB (`turso db destroy groundworx-staging-ghostdwg`) and re-provision per `runtime/runbooks/staging-first-activation.md`. **Never destroy production.**

### Refusal conditions

The runner refuses to start (exit 1) when:
- `APP_ENV` is unset.
- `APP_ENV` is not one of `development-parity` | `staging` | `production`.
- `DATABASE_URL` is unset.
- `DATABASE_URL` does not contain the expected substring for the declared `APP_ENV`.

The fence runs before any network call. A wrong-tier invocation cannot reach the wrong DB.

## Env vars touched

| Var | Read by runner | Modified by runner |
|---|---|---|
| `APP_ENV` | yes (tier fence) | no |
| `DATABASE_URL` | yes (connection) | no |

No other env vars are consulted. `DATABASE_AUTH_TOKEN` is read inside `DATABASE_URL` (Turso convention is `libsql://...?authToken=...`).

## Lineage note

The runner was originally authored on `feat/market-intelligence` at commit `2030909` ("fix(deploy): drop auto-migrate at boot, add libsql-aware migrator script") on 2026-05-16 but was never merged into `main`. Phase R6.6 lifts it into the active R-series lineage with three additions:

1. APP_ENV tier fence (refuses wrong-tier `DATABASE_URL` before connecting).
2. Fresh-DB bootstrap of `_prisma_migrations` (the original crashed on freshly-provisioned DBs).
3. Surfacing of started-but-not-finished rows as warnings.

The 2030909 commit also dropped auto-migrate-on-boot from `docker-entrypoint.sh`, which is now codified as policy (this runbook §No auto-migrate-on-boot policy). The current `Dockerfile` uses `CMD ["node", "server.js"]` with no entrypoint script — the policy holds by construction.

## Canonical references

- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §3 — original migration discipline design.
- `Migration/PHASE_R6_6_MIGRATION_RUNNER_LINEAGE_AUDIT.md` — pre-implementation audit.
- `prisma.config.ts` — Prisma CLI fence (Phase R6.5).
- `runtime/runbooks/staging-first-activation.md` — staging activation procedure; step 5 invokes this runner.
- `runtime/runbooks/environment-promotion.md` — tier promotion sequencing.
