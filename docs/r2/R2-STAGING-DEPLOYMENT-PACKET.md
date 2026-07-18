# R2 Staging Deployment Packet

**Status:** Release-planning document. Read-only inspection product. **Nothing
in this packet has been executed.** No deploy, build, migration, backup,
restore, or staging/production access was performed while authoring it.

**Purpose:** define the exact, human-gated procedure to move an *approved*
GroundWorX R2 integration candidate into the **staging** tier, so the procedure
exists before the candidate is ready rather than being invented under pressure.

**Companion documents:**
- `docs/r2/R2-STAGING-ACCEPTANCE-CHECKLIST.md` — post-deploy validation gates.
- `docs/r2/R2-STAGING-ROLLBACK-RUNBOOK.md` — recovery if any gate fails.

**Authority model (non-negotiable, per repo governance):** every live action
below (build, tag, migrate, recreate, checkpoint, restore, health-probe against
a real URL) is **operator-executed with explicit per-invocation approval**.
Models prepare command blocks and acceptance criteria; humans execute. A
passing local test or a local hook never substitutes for operator approval.
The `runtime/deployment/*` scripts referenced here are **Phase R4 stubs that
print a plan and exit** — this packet does not change that, and the deploy is
performed today by an operator following these steps by hand over SSH.

---

## 0. Candidate identity — REQUIRED INPUTS (parameters, not values)

This packet is **candidate-SHA parameterized**. It does **not** assume the
current SOL worktree tip (`9b283b9`), the dirty SOL working tree, or any other
in-flight commit is the approved candidate. The SOL integration candidate
remains under repair and is **not approved**. The following placeholders MUST
be filled by the operator from the *approved* candidate at execution time; an
unfilled placeholder is a hard stop.

| Placeholder | Meaning | Source of truth |
|---|---|---|
| `${CANDIDATE_SHA}` | Full 40-char Git SHA of the approved R2 integration candidate | Release approval record |
| `${CANDIDATE_SHORT_SHA}` | `git rev-parse --short ${CANDIDATE_SHA}` | Derived |
| `${CANDIDATE_CARD}` | Release-card slug for the immutable image tag (e.g. `r2-release`) | Release approval record |
| `${REVIEWED_BASE_SHA}` | Base of the independently reviewed range | Review record |
| `${REVIEWED_RANGE}` | `${REVIEWED_BASE_SHA}..${CANDIDATE_SHA}` — the exact range a human reviewed | Review record |
| `${APP_IMAGE_DIGEST}` | `sha256:…` digest of the built app image | Captured at build (§2) |
| `${SIDECAR_IMAGE_DIGEST}` | `sha256:…` digest of the built sidecar image | Captured at build (§2) |
| `${WORKER_IMAGE_DIGEST}` | `sha256:…` digest of the built worker image | Captured at build (§2) |
| `${CHECKPOINT_ID}` | Turso backup/PITR identifier taken before migrate | Captured at checkpoint (§3) |
| `${PREV_STAGING_SHA}` | SHA currently deployed to staging, for rollback | `runtime/runbooks/image-traceability.md` inspect |
| `${PREV_STAGING_DIGEST}` | `sha256:…` digest of the currently-deployed staging app image | `docker inspect` before deploy |

> Discipline: record every filled value in the ops log entry (§5.6). Never
> paste secret values (auth tokens, keys) into the log — record identifiers,
> SHAs, digests, timestamps, and names only.

---

## 1. Pre-release gates

Every gate below must read **PASS** before staging deploy begins. Any FAIL or
UNKNOWN halts the release; there is no "deploy and fix in staging."

| # | Gate | PASS criterion | How verified (read-only) |
|---|---|---|---|
| G1 | **Exact candidate SHA** | `${CANDIDATE_SHA}` is fixed and recorded; it is a real commit reachable in the repo | `git cat-file -t ${CANDIDATE_SHA}` = `commit` |
| G2 | **Independently reviewed range** | `${REVIEWED_RANGE}` was reviewed by a human other than the author; range endpoints recorded | Review record cites `${REVIEWED_BASE_SHA}..${CANDIDATE_SHA}` |
| G3 | **Clean Git status** | Working tree at `${CANDIDATE_SHA}` is clean; no dirty SOL worktree is being shipped | `git status --porcelain` empty; `git diff --check` clean |
| G4 | **Required final verdict** | A recorded "APPROVED for staging" verdict exists for `${CANDIDATE_SHA}` (not for a predecessor) | Approval record |
| G5 | **Full test status** | `npm run typecheck`, `npm run lint`, `npm run test` all green at `${CANDIDATE_SHA}` | CI run tied to `${CANDIDATE_SHA}` |
| G6 | **Regression-pack status** | The R2 regression suite (Meeting Register, trade-response, rerun preservation, migration replay) green at `${CANDIDATE_SHA}` | CI / `npm run validate:replay` result |
| G7 | **Lifecycle-certification status** | Any lifecycle claim is tagged `[V]`/`[OP]` with evidence; unproven lifecycles labeled `[UNK]`, not asserted | Verification-evidence discipline; see acceptance checklist |
| G8 | **Migration-recovery rehearsal** | A restore drill (`runtime/runbooks/staging-backup-restore.md`) has been executed green **if** any candidate migration is non-additive (see §3 — migrations 100/101 are table rebuilds) | Drill report with checksum-manifest match |
| G9 | **Security re-review status** | `/security-review` (or equivalent) run over `${REVIEWED_RANGE}`; findings resolved or accepted | Security review record |
| G10 | **Secrets / configuration readiness** | Every staging env var *name* in `runtime/env/staging.env.example` is present in `/opt/neuroglitch/.env.staging`; values sourced from `GroundWorX-staging` 1Password vault; none printed | Config fingerprint (§2) — names only |
| G11 | **Database checkpoint readiness** | Turso staging checkpoint procedure (§3) is ready; a same-day checkpoint will be taken **before** migrate | §3 |
| G12 | **Rollback image availability** | `${PREV_STAGING_SHA}` / `${PREV_STAGING_DIGEST}` recorded and the previous image is still pullable | `docker inspect` / GHCR tag list before deploy |

**Load-bearing ordering:** migrations (§3) apply strictly **before** the image
recreate that references their columns (§4). This mirrors the Q02-before-Q03
rule in `.claude/rules/environments-deployment.md` and the "migrate before
recreate" invariant in `runtime/deployment/compose-governance.md` §4.

---

## 2. Build and artifact provenance

The candidate ships as **three immutable, self-identifying images** built from a
clean host checkout at `${CANDIDATE_SHA}`. Canon: `runtime/runbooks/image-traceability.md`.

### 2.1 Image naming (immutable tags)

```
ghcr.io/ghostdwg/groundworx-app:${CANDIDATE_SHORT_SHA}-${CANDIDATE_CARD}
ghcr.io/ghostdwg/groundworx-sidecar:${CANDIDATE_SHORT_SHA}-${CANDIDATE_CARD}
ghcr.io/ghostdwg/groundworx-worker:${CANDIDATE_SHORT_SHA}-${CANDIDATE_CARD}
```

- Tag is **immutable**: never re-push a tag to point at a different image.
  Rollback = repin a previous tag, never rebuild under the same name.
- Never build from a dirty worktree (`git status --porcelain` must be empty).

### 2.2 Commit-SHA labeling + build timestamp (OCI provenance)

The `runner` stage of `Dockerfile` accepts three build args and stamps standard
OCI labels (`Dockerfile:55-60`). Canonical build command (operator, from a clean
checkout — **not executed here**):

```bash
git status --porcelain                       # MUST print nothing
SHA=$(git rev-parse HEAD)                     # MUST equal ${CANDIDATE_SHA}
SHORT=$(git rev-parse --short HEAD)
docker build \
  --build-arg IMAGE_REVISION="$SHA" \
  --build-arg IMAGE_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg IMAGE_SOURCE="https://github.com/ghostdwg/construction-dashboard" \
  -t "ghcr.io/ghostdwg/groundworx-app:${SHORT}-${CANDIDATE_CARD}" \
  .
```

| Build arg | OCI label | Value |
|---|---|---|
| `IMAGE_REVISION` | `org.opencontainers.image.revision` | full `${CANDIDATE_SHA}` |
| `IMAGE_CREATED` | `org.opencontainers.image.created` | ISO-8601 UTC build timestamp |
| `IMAGE_SOURCE` | `org.opencontainers.image.source` | repo URL |

### 2.3 Dependency-lock verification

- Node: `package-lock.json` present and unchanged; the Dockerfile installs from
  the lockfile (`npm ci` semantics) so the build is reproducible.
- Python sidecar: the pinned requirements file the sidecar image installs from.
- **Verify (read-only):** `git status --porcelain package-lock.json` empty at
  `${CANDIDATE_SHA}`; lockfile hash recorded in the release manifest (§2.7).

### 2.4 Image digest capture

Immediately after build/push, capture the immutable digests (these become the
deploy identity that survives tag reuse):

```bash
docker images --digests ghcr.io/ghostdwg/groundworx-app
docker inspect --format '{{index .RepoDigests 0}}' \
  ghcr.io/ghostdwg/groundworx-app:${CANDIDATE_SHORT_SHA}-${CANDIDATE_CARD}
```

Record as `${APP_IMAGE_DIGEST}`, `${SIDECAR_IMAGE_DIGEST}`, `${WORKER_IMAGE_DIGEST}`.

### 2.5 SBOM / dependency inventory (where available)

- If BuildKit SBOM attestation is enabled: capture with the build and store the
  attestation reference next to the digest.
- Otherwise the dependency inventory = pinned `package-lock.json` + sidecar
  requirements lock, hashed into the release manifest (§2.7). Record which of
  the two applies; do not claim an SBOM that was not produced.

### 2.6 Migration inventory

The candidate's migration set is the full `prisma/migrations/` tree at
`${CANDIDATE_SHA}`. The **staging-pending** subset (what this deploy applies) is
the tail not yet recorded in the staging DB. For the R2 candidate that tail is
the last three, applied lexicographically (see §3.5):

| Order | Migration | Shape |
|---|---|---|
| 99 | `20260718010000_r2b2_trade_response_packages` | **Additive** — `ADD COLUMN`, new tables, new indexes |
| 100 | `20260718024444_r2_release_blocker_retention` | **Table rebuild** — SQLite `new_*` copy pattern, forward-only, data-preserving, tightens FKs to `RESTRICT` |
| 101 | `20260718030000_r2b2_trade_response_reviewer_repairs` | **Table rebuild** — forward-only, data-preserving |

> Confirm the exact pending tail at execution time with the migration runner's
> dry-run (§3.5). Do not hard-code the count; the candidate under approval may
> differ from `9b283b9`.

### 2.7 Configuration fingerprint (no secrets)

Produce a fingerprint of the staging configuration **without exposing values**:

- List of env var **names** expected (from `runtime/env/staging.env.example`).
- For each: source (1Password vault `GroundWorX-staging`, or `/settings` UI),
  ownership (operator), and validation method (Zod boot fence / presence check).
- Never print values. Example (names only): `APP_ENV`, `NODE_ENV`,
  `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUTH_SECRET`, `NEXTAUTH_URL`,
  `APP_URL`, `SETTINGS_ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY`, `SIDECAR_URL`,
  `SIDECAR_API_KEY`, `SIDECAR_CALLBACK_TOKEN`, `WORKER_TOKEN`,
  `ANTHROPIC_API_KEY`, `WHISPERX_URL`, `WHISPERX_API_KEY`, `OLLAMA_URL`,
  `OLLAMA_MODEL`, `ASSEMBLYAI_API_KEY`, `*_STUB_MODE`.
- **Validation, not disclosure:** the app's Zod boot fence (`lib/env.ts`)
  refuses to start on a missing/invalid required var — presence is proven by a
  clean boot, not by reading the file.

### 2.8 Immutable release manifest

One manifest per release, stored as an artifact (not pasted into chat/docs),
recording — all non-secret:

```
candidate_sha:        ${CANDIDATE_SHA}
candidate_short_sha:  ${CANDIDATE_SHORT_SHA}
release_card:         ${CANDIDATE_CARD}
reviewed_range:       ${REVIEWED_RANGE}
built_at_utc:         <ISO-8601>
app_image_digest:     ${APP_IMAGE_DIGEST}
sidecar_image_digest: ${SIDECAR_IMAGE_DIGEST}
worker_image_digest:  ${WORKER_IMAGE_DIGEST}
lockfile_sha256:      <sha256 of package-lock.json>
sidecar_lock_sha256:  <sha256 of sidecar requirements lock>
sbom_ref:             <attestation ref | "n/a — dependency-inventory only">
pending_migrations:   [99, 100, 101]  # confirm via dry-run
checkpoint_id:        ${CHECKPOINT_ID}
prev_staging_sha:     ${PREV_STAGING_SHA}
prev_staging_digest:  ${PREV_STAGING_DIGEST}
operator:             <name/handle>
```

---

## 3. Database checkpoint (staging-only) — DEFINITION, not execution

**Do not execute the checkpoint.** This section defines the exact process the
operator follows. Canon: `runtime/runbooks/staging-backup-restore.md`,
`.claude/rules/migrations-checkpoints.md`, `runtime/deployment/snapshot-prod.sh`
(the production analogue, itself a stub).

**Rule (Ledger §7a):** a same-day Turso checkpoint, identifier recorded, is
**required before any staging DB mutation**. No checkpoint ⇒ migrations do not
run and the release halts. Never proceed "because the change is only additive"
— migrations 100/101 are table rebuilds, not additive.

### 3.1 Current database identification

- Staging DB: `groundworx-staging-ghostdwg` (Turso/libSQL).
- Confirm the target before anything else: `DATABASE_URL` for the run **must**
  contain `groundworx-staging` (the runner's tier fence, `apply-turso-migrations.mjs:98-104`,
  refuses otherwise). Never a URL containing `groundworx-prod`.

### 3.2 Backup command

```bash
turso db backup create groundworx-staging-ghostdwg \
  --description "pre-R2-migrate checkpoint <ISO-8601-UTC>"
```

### 3.3 Backup destination

- Turso-managed PITR/backup (platform-native), **plus** the durable storage
  archive of `/opt/neuroglitch/storage-staging` per the backup runbook §2.
- Destination MUST live **off** the staging serving path — not inside
  `/opt/neuroglitch/storage-staging`, not writable by the running staging
  containers (backup runbook §3).

### 3.4 Checksum + integrity evidence

- Record `${CHECKPOINT_ID}` (Turso backup ID) and the UTC request timestamp.
- Storage archive: `sha256sum` of the full archive + file count, into the
  checksum manifest (backup runbook §4).
- **Row-count and integrity evidence:** capture `SELECT count(*)` per table
  (including `_prisma_migrations` and `AuditEvent`) at checkpoint time, into the
  manifest — this is the baseline the restore drill and any restore compares
  against.
- **Verify existence post-creation:** `turso db backup list
  groundworx-staging-ghostdwg | head -1` must show the new entry; an unverified
  create is not a checkpoint (backup runbook §1).

### 3.5 Migration state capture + apply order (99 → 100 → 101)

**State capture (read-only, before applying):**

```bash
APP_ENV=staging DATABASE_URL=libsql://groundworx-staging-…?authToken=… \
  node scripts/apply-turso-migrations.mjs --dry-run     # == npm run migrate:turso:status
```

The dry-run lists exactly which migrations are pending and applies nothing
(exit 0). It also surfaces any `started-but-not-finished` partial rows — a
partial state is a **stop**, investigate before proceeding.

**Apply (only after checkpoint verified, G11):**

```bash
APP_ENV=staging DATABASE_URL=libsql://groundworx-staging-…?authToken=… \
  node scripts/apply-turso-migrations.mjs               # == npm run migrate:turso
```

- Applies pending migrations in **lexicographic filename order**:
  `20260718010000_…packages` (99) → `20260718024444_…retention` (100) →
  `20260718030000_…reviewer_repairs` (101).
- Each migration is applied as one atomic write batch; a failure mid-run exits
  **2** and leaves the DB in a partial state — **full stop, no retry**, inspect
  Turso and go to the rollback runbook.
- The runner is the **only** sanctioned path. Never `prisma migrate deploy`
  against `libsql://` (returns P1013). Never auto-migrate on boot.

### 3.6 Rollback compatibility (READ THIS BEFORE APPLYING)

- Migration 99 is additive/nullable → an **image-only** rollback to the prior
  SHA is schema-compatible (old code ignores new columns/tables).
- Migrations **100 and 101 rebuild tables** (SQLite `new_*` copy pattern) and
  tighten foreign keys to `RESTRICT`. There is **no down-migration** (forward-
  only is repo law). Once 100/101 are applied, rolling the *application* back to
  `${PREV_STAGING_SHA}` does **not** revert the schema. If the prior app code is
  incompatible with the rebuilt tables, a clean rollback requires **restoring
  the §3 checkpoint**, not just repinning the image. This is the decisive input
  to the rollback runbook's "application-only vs application+DB" branch.

### 3.7 Conditions that PROHIBIT migration

Do not apply migrations if **any** hold:
- No same-day verified checkpoint (`${CHECKPOINT_ID}` absent/unverified).
- `DATABASE_URL` does not contain `groundworx-staging`, or `APP_ENV` ≠ `staging`
  (runner refuses; do not "fix" by editing the fence).
- Dry-run shows a partial (`started-but-not-finished`) row.
- The candidate is not approved (G4 FAIL), or the working tree is dirty (G3 FAIL).
- Any pre-release gate G1–G12 reads FAIL/UNKNOWN.

---

## 4. Deployment sequence (staging)

Ordered, human-executed. The `runtime/deployment/*` scripts are the **future**
entry points (Phase R4 stubs today); until they are real, the operator runs
these steps by hand over SSH to host `superglitch`. Sequence is non-negotiable:
**checkpoint → migrate → recreate → health → record**, and **migrate before
recreate**.

Where the final `${CANDIDATE_SHA}` / `${APP_IMAGE_DIGEST}` is unknown at
planning time, the placeholders stand in; they are filled at execution.

**Step 1 — Build the candidate** (see §2): build the three images from a clean
checkout at `${CANDIDATE_SHA}` with OCI provenance args.

**Step 2 — Tag the image** (see §2.1): immutable tags
`…:${CANDIDATE_SHORT_SHA}-${CANDIDATE_CARD}`; push to GHCR.

**Step 3 — Capture digest** (see §2.4): record `${APP_IMAGE_DIGEST}` etc. into
the release manifest.

**Step 4 — Checkpoint** (see §3): take + verify the staging Turso checkpoint and
storage archive; record `${CHECKPOINT_ID}`, row counts, checksums. **Gate: do
not proceed without a verified checkpoint.**

**Step 5 — Apply staging migrations** (see §3.5), in order 99 → 100 → 101:

```bash
# host: superglitch, staging env sourced, APP_ENV=staging
runtime/deployment/apply-migrations.sh staging   # future runner; wraps apply-turso-migrations.mjs
# (today, operator invokes apply-turso-migrations.mjs directly with staging env)
```

Refuses unless `DATABASE_URL` matches the staging tier. Exit 2 = partial = stop.

**Step 6 — Stop/replace staging safely (recreate)** — Compose recreate against
the **staging** project only, using the activatable overlay
`overrides/staging.active.yml` (the `${APP_SHA}` overlay; **not** the R3
placeholder `staging.yml`):

```bash
APP_SHA=${CANDIDATE_SHA} docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

- Only `app sidecar worker` are listed — `caddy/landing/hello/api` belong to the
  production project and are **not** started in staging.
- Containers reattach to the existing named volume `neuroglitch-staging_storage`
  (bind `/opt/neuroglitch/storage-staging`). **Isolation invariant:** the bind
  device MUST remain `/opt/neuroglitch/storage-staging`; changing it to
  `/opt/neuroglitch/storage` collapses staging↔production storage isolation.
- Production Compose project `neuroglitch` is untouched.

**Step 7 — Health verification** (see acceptance checklist §Automated):

```bash
runtime/deployment/health-check.sh staging     # future; probes /api/health, /health, worker tick
```

Expected: app `/api/health` → HTTP 200 `{"status":"ok",…}`; sidecar `/health` →
200; worker tick file fresh; public `https://staging.groundworx.neuroglitch.ai/api/health`
→ 200 once the shared Caddy edge (Phase 6.b) is wired.

**Step 8 — Log inspection:** last-60s error sweep across the staging project:

```bash
docker compose -p neuroglitch-staging logs --since 60s | grep -i 'level=error\|panic'
```

Expected: no matches. Any new `level=error` line is a rollback-trigger candidate
(see acceptance checklist + rollback runbook).

**Step 9 — Version verification:** confirm the running image is the intended
candidate, by **image provenance**, not the app's self-reported version:

```bash
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  <running-staging-app-image>          # MUST equal ${CANDIDATE_SHA}
docker inspect --format '{{index .RepoDigests 0}}' <running-staging-app-image>   # MUST equal ${APP_IMAGE_DIGEST}
```

> Note: `/api/health` returns `version: process.env.npm_package_version`
> (`app/api/health/route.ts`), which is `0.1.0`/`unknown` in a `next start`
> container and is **not** a reliable build identity. The OCI `image.revision`
> label + digest are the authoritative version check. An image with an empty
> `revision` label is **untraceable** and must not be deployed.

---

## 5. Post-deploy record

**§5.6 Ops log entry** (`planning/ops-log-<year>.md`) — non-secret fields only:
`${CANDIDATE_SHA}`, tier=`staging`, operator, start/end UTC, `${CHECKPOINT_ID}`,
`${APP_IMAGE_DIGEST}`, migrations applied `[99,100,101]`, health result, smoke
result, and a pointer to the acceptance-checklist evidence artifact.

---

## 6. What this packet deliberately does NOT do

- Does not deploy, build, push, migrate, checkpoint, restore, or touch staging
  or production.
- Does not modify `runtime/deployment/*` scripts (they are intentional Phase R4
  stubs) or any product code, compose file, env file, or the SOL worktree.
- Does not assume `9b283b9` or any dirty worktree is the approved candidate.
- Does not define a production deployment procedure — see the rollback runbook's
  "Production promotion boundary" for the evidence gate that must precede any
  such procedure, which is separately approved.

---

## 7. Canonical references

- `runtime/deployment/compose-governance.md` — layering, deploy sequencing (§4),
  rollback expectations (§5), isolation (§6).
- `runtime/runbooks/environment-promotion.md` — local→staging→production flow.
- `runtime/runbooks/image-traceability.md` — immutable tags + OCI provenance.
- `runtime/runbooks/staging-backup-restore.md` — checkpoint/restore foundation.
- `runtime/runbooks/turso-migrations.md` + `scripts/apply-turso-migrations.mjs`
  — the only sanctioned migration path and its tier fence.
- `runtime/compose/base.yml` + `overrides/staging.active.yml` — the deploy
  topology and the `${APP_SHA}` staging overlay.
- `runtime/env/staging.env.example` — staging env var **names** (no values).
- `.claude/rules/migrations-checkpoints.md`, `environments-deployment.md`,
  `verification-evidence.md`, `secrets-providers.md` — binding constraints.
