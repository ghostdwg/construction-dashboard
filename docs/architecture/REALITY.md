# REALITY.md — Authoritative Reality Check

- Written: 2026-07-04
- Base commit this document was written against: `971db44c8be5de94cfec7dfd656d25682445976a` (short `971db44`)
- Author context: a documentation-only pass, working in an isolated worktree
  (`docs/reality-pass`, branched from the commit above). No source code was
  read-write-verified beyond what is cited below; no live/HTTP/DB/Docker
  action was taken while writing this document.

**Tagging convention used throughout:** `(source-verified)` means this task
directly read the cited file(s) or ran a read-only local command (e.g.
`git log`, `git merge-base`, `grep`) and observed the fact for itself, at the
base commit above. `(operator-reported)` means the fact is carried over from
a prior runbook, ADR, or memory note that this task did **not** independently
re-verify (in particular, anything requiring a live network call, which this
task is forbidden from making). Treat `(operator-reported)` facts as
plausible but re-check them before relying on them for anything consequential
— they may have changed since they were written down, and the person who
reported them cannot be interrogated from inside this document.

This document supersedes the "current state" framing of
`CURRENT_STATE.md` and `ROADMAP.md` wherever the two disagree. Those two
files remain valuable as a **historical build log** — do not delete or
wholesale-rewrite them — but where their narrative claims about *today's*
architecture conflict with what is verifiable in source, this document wins.

---

## 1. Source of truth — which file governs which fact

| Question | Authoritative source | NOT authoritative for this |
|---|---|---|
| What data model actually exists | `prisma/schema.prisma` | `CURRENT_STATE.md`'s module list (describes intent/history, drifts from schema over time) |
| What database is actually used, and how | `lib/prisma.ts` (PrismaLibSql adapter + `DATABASE_URL`) + `runtime/compose/TOPOLOGY.md` runtime assumptions §3–4 | `CURRENT_STATE.md` line "Prisma 7/SQLite" (stale top-line summary — see §3 below) |
| What is actually running in production, on what host, with what topology | `runtime/compose/TOPOLOGY.md` (source-verified: describes production as of the Production Runtime Assessment dated 2026-05-17) | `ROADMAP.md`'s Fly.io deploy plan (a plan that was superseded — production runs on bare-host Docker Compose, not Fly) |
| Whether `runtime/` itself is the authoritative deploy path today | `runtime/STATUS.md` (says explicitly: **not** authoritative yet; production still driven by `/opt/neuroglitch/docker-compose.yml` on host `superglitch`) | Do not assume the mere existence of `runtime/compose/*.yml` files means they are wired into a live deploy — `STATUS.md` and `TOPOLOGY.md` are both explicit that this subtree is descriptive/future-authoritative, not currently driving anything |
| AI credential resolution architecture — decided direction | `docs/architecture/adr/0001-ai-credential-resolution.md` (Status: Accepted) | Assuming "Accepted" means "implemented" — see §4 below, it is not implemented as of this commit |
| AI provider call-site governance / allow-listed exceptions | `governance/guardrails/allowlist.json` + `governance/CONFIDENTIAL_DATA_POLICY.md` | Assuming the allowlist is exhaustive — ADR 0001 §1.6/§6 itself names additional bare `os.getenv("ANTHROPIC_API_KEY")` sites in the sidecar (`schedule_intelligence.py`, `spec_intelligence.py`, `ai_extractor.py`, `submittal_intelligence.py`, `market.py`) that are **not** in the allowlist's named three and are not itemized as migration targets by this ADR |
| Durable document storage layout/backend | `lib/storage/blobStore.ts` + `docs/architecture/STORAGE.md` | Assuming all document types have been migrated onto it — only Spec Book has (commit `e5d50b0`); Drawings have not (see `docs/architecture/drawings-storage-migration-brief.md`) |
| Production/staging divergence, at any point in time | `scripts/divergence-report.mjs --prod <ref> --staging <ref>` run fresh, against explicit refs you supply | Any cached description of "the" production branch, including this document — branch tips move; re-run the tool |
| Release constraints (pricing/AI/repo-discipline rules) | `CLAUDE.md` §CONSTRAINTS (root of repo) | Nothing in this document invents new constraints — §5 below is a pointer/summary, not a new source |

---

## 2. Active integration branch (re-verify before trusting)

**As of this writing:** the active integration line is `integration/foundation-ci-divergence`, at commit `971db44c8be5de94cfec7dfd656d25682445976a` (short `971db44`), dated 2026-07-04 21:35:53 -0500 `(source-verified: git log -1 --format="%H %h %ci" integration/foundation-ci-divergence)`.

This document itself was authored on a sibling branch (`docs/reality-pass`) branched from that exact same commit, so at write-time the two are identical at the tip this document describes.

**`(source-verified)`, also important:**
- `main`'s tip is `160f6e86ec48d40581c3f67ea54b2eca8e173808` (short `160f6e8`), dated **2026-05-07** — roughly two months behind `integration/foundation-ci-divergence`. `971db44` is confirmed **not** an ancestor of `main` (`git merge-base --is-ancestor` returns false). **Do not treat `main` as reflecting current reality** — most of what this document describes (the `runtime/` subtree, the AI gateway, the guardrails, ADR 0001, the backup/restore and Spec Book staging runbooks, the Drawing migration brief) exists only on `integration/foundation-ci-divergence` and its ancestor topic branches, not on `main`.
- Numerous other local topic branches exist (`feat/provider-resolution-option-a`, `chore/prod-staging-divergence-report`, `docs/ai-credential-architecture-adr`, `docs/drawings-storage-preflight`, `docs/specbook-staging-validation`, `docs/staging-backup-restore-runbook`, `feat/ci-guardrails-gate`, `feat/gateway-shadow-prompt-scan`, `feat/sidecar-usage-evidence`, `feat/specbook-file-integrity`, `fix/specbook-pdfjs-runtime`, `integration/staging-portfolio-gateway`, and more). `feat/provider-resolution-option-a` in particular sounds like it could contain in-progress work on ADR 0001's decision — **do not assume it is merged into `integration/foundation-ci-divergence` at this commit; it was not** (verified: the three named bypass sites still read raw env vars as of `971db44`, see §4). If ADR-0001 implementation status matters to you, check that branch's own tip and diff it against this commit yourself; this document does not.

**This will go stale.** Branch tips move every session. Re-run `git branch --show-current`, `git log -1`, and `git merge-base --is-ancestor <this-doc's-base-commit> <branch>` before trusting any of the above beyond the moment this was written.

---

## 3. Live / staged / broken / blocked status

### Database
`prisma/schema.prisma`'s `datasource db { provider = "sqlite" ... }` is misleading in isolation `(source-verified)`: `lib/prisma.ts` actually constructs the Prisma client via `PrismaLibSql` (`@prisma/adapter-libsql`) against `process.env.DATABASE_URL` — the `sqlite` provider string is a Prisma-7 driver-adapter requirement, not a statement that a local `.db` file is what's connected to. `runtime/compose/TOPOLOGY.md`'s "Runtime assumptions" §3–4 name a live Turso authToken and DNS resolution to `*.turso.io` as an operational assumption of the running production stack `(source-verified: read directly)`. **Net: deployed tiers run on Turso/libSQL; only local dev falls back to a SQLite file.** `CURRENT_STATE.md`'s top-line "Stack: ... Prisma 7/SQLite ..." and `ROADMAP.md`'s "Database | SQLite via Prisma ORM ... Postgres migration planned" are both stale/misleading on this specific point — corrected in both files as part of this same change (see §7 of this repo's commit, or the diff).

### Production runtime topology
Production is a single Docker Compose project (`neuroglitch`) on host `superglitch`, described in full in `runtime/compose/TOPOLOGY.md` — seven containers (`caddy`, `app`, `sidecar`, `worker`, `landing`, `hello`, `api`), one bridge network, Caddy terminating TLS via Let's Encrypt for four vhosts including `groundworx.neuroglitch.ai` (the product). This is **not** Fly.io and **not** DigitalOcean, despite both being named as the deploy target in `ROADMAP.md`'s "A3. Production Infrastructure" stream and `CURRENT_STATE.md`'s "Production deploy to neuroglitch.ai — next milestone (DigitalOcean...)" line. Fly.io paths (`runtime/fly/*.toml`) are explicitly latent/dormant and governance-blocked: `governance/guardrails/allowlist.json` marks them `"status": "blocked-deprecated"`, and `governance/CONFIDENTIAL_DATA_POLICY.md` §7 lists Fly.io deployment as "Prohibited unless explicitly approved" `(source-verified, both files)`.

`runtime/STATUS.md` and `runtime/README.md` themselves describe the `runtime/` subtree as "Phase R1... scaffolding only... nothing authored yet" `(source-verified: read directly)` — but the actual directory listing at this commit already contains a populated `compose/` (base + observability + per-tier overrides including `staging.active.yml`), a `cron/`, a `worker/`, ~10 populated `runbooks/`, env templates, and deployment scripts. **`runtime/STATUS.md`'s own "Phase R1" framing appears stale relative to the tree's actual contents** — this is a documentation-drift instance inside `runtime/` itself, flagged here for awareness but out of this task's scope to correct (the task instructions scoped corrections to `CURRENT_STATE.md`/`ROADMAP.md` only).

### Anthropic credential on staging
`(operator-reported, NOT verified by this task)` — `runtime/runbooks/specbook-staging-validation.md` §6 and `docs/architecture/drawings-storage-migration-brief.md` both state, as background fact, that staging's `ANTHROPIC_API_KEY` currently returns a 401 from the provider. This task made no live HTTP call and cannot confirm this independently. **Do not assume it has been fixed; also do not assume it is still broken** — re-check before relying on it either way. What *is* true regardless (per the same runbook, reasoning from the route code, not from a live call): the Spec Book upload → split → serve → delete → re-upload flow does not depend on a working Anthropic call at all — only the AI-analysis *content* is unprovable while the 401 stands.

### Production promotion — BLOCKED
Per `docs/architecture/drawings-storage-migration-brief.md` §7, citing operator memory verified 2026-07-03 via `docker ps`/`docker compose ls` `(operator-reported for the divergence facts themselves; source-verified only that the branch name and SHA below resolve locally)`: production runs branch `feat/storage-auth-job-dedupe` at commit `d259b58f886e5b8a7c79e9a3643567802566d099` (confirmed to resolve locally via `git rev-parse` — `(source-verified)`), which diverged from the effective mainline at `4137ae5` and carries 7 unique stabilization commits, including an independent "BlobStore refactor" of `lib/storage/blobStore.ts` that has **not** been reconciled with this branch's own Spec-Book-driven changes to the same file (this branch's `e5d50b0` already added 25 lines to that file). This is the named reason production promotion is currently blocked — **do not attempt to resolve it**; re-run `node scripts/divergence-report.mjs --prod feat/storage-auth-job-dedupe --staging <current staging ref>` to get a fresh, read-only picture before assuming this is still the state of affairs.

### Backup/restore — DOCUMENTED ONLY
`runtime/runbooks/staging-backup-restore.md` is a complete procedural document but explicitly states, about itself: no backup, restore, snapshot, or drill has ever been executed; no `backup-staging.sh`/`restore-staging-drill.sh` script exists yet `(source-verified: read directly, and confirmed no such scripts exist under runtime/deployment/)`. **No backup of staging or production (beyond whatever the stubbed `runtime/deployment/snapshot-prod.sh` may or may not already do — not re-verified here) should be assumed to exist.**

### Spec Book staging validation — DOCUMENTED, NOT EXECUTED
`runtime/runbooks/specbook-staging-validation.md` is a complete, six-step (upload/split/list/serve/delete/re-upload) validation procedure, explicitly self-described as never having been executed against real staging. An optional dry-run-by-default helper, `scripts/specbook-staging-smoke.mjs`, exists in the repo `(source-verified: file present)`, but per the runbook's own §10, it requires explicit `--base-url`, `--cookie`/`--bearer`, and `--execute` flags together before performing any real request, and "was never invoked against staging (or anywhere else) while producing this runbook or the script itself." **Do not assume Spec Book has been validated end-to-end on staging.**

### ADR 0001 (AI credential resolution) — Accepted, NOT implemented
ADR 0001's decision (Option A: TS resolves once via `getSetting()`, forwards per-request to the sidecar) is recorded as **Accepted**, but this task directly re-read the three named legacy-bypass sites at commit `971db44` and confirmed **none of them have been migrated yet**:

| Site | Current state at this commit `(source-verified)` |
|---|---|
| `lib/services/submittal/organizeWithAi.ts:396` | Still `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` — direct env read, own client, does not go through `getSetting()` or `gateway.ts` |
| `sidecar/services/drawing_intelligence.py:193` | Still `anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))` — direct env read, own client, no `api_key` parameter threaded from a caller |
| `sidecar/services/meeting_intelligence.py` | Still implements the Option-C hybrid ADR 0001 explicitly rejects: `effective_key = api_key or ANTHROPIC_API_KEY` (line ~479) — the env fallback has **not** been removed |

So: **ADR 0001 is a decided-but-not-yet-implemented architecture as of this commit.** A branch named `feat/provider-resolution-option-a` exists locally and may contain in-progress or completed work toward this — it is not merged into `integration/foundation-ci-divergence` at `971db44` (see §2). Also per ADR 0001 §6 itself: five additional sidecar sites (`schedule_intelligence.py`, `spec_intelligence.py`, `ai_extractor.py`, `submittal_intelligence.py`, `market.py`) read `ANTHROPIC_API_KEY` directly from the environment and are **not** in the ADR's three named required migrations, "flagged here for a coordinator's awareness, not scoped into this ADR's required migrations" — meaning even a future "ADR 0001 complete" milestone would not, by itself, imply these five are migrated too.

### Confidentiality enforcement — a detection/allow-list layer, not a completeness guarantee
`governance/guardrails/allowlist.json` + `governance/CONFIDENTIAL_DATA_POLICY.md` implement a **P0 detection guardrail**: a machine-readable allow-list of pre-existing, temporary, named exceptions (13 direct-provider call sites at the allow-list's base commit `e10b799`; five entries visible in the current `allowlist.json`) plus governance prose describing the intended classification/routing policy. CI enforcement of this layer exists (commit `c95c1a7` "ci: enforce P0 guardrails in workflow" is on the integration line, `(source-verified: present in git log)`). **This is a lint-like detection layer with a documented, named list of legacy exceptions — it is not proof that every possible confidentiality violation has been found or prevented.** Do not describe it as "confidentiality enforcement complete."

---

## 4. Release constraints — pointer, not a new source

The authoritative constraints live in `CLAUDE.md` §CONSTRAINTS at repo root. Summarized here only as a quick-reference for an agent that reads this file first — **if this summary and `CLAUDE.md` ever disagree, `CLAUDE.md` wins**:

- Never return `pricingData` to the client or put it in any AI prompt.
- Never include sub name, company, or `isPreferred` in any AI prompt or sub-facing export.
- Phase 5 modules belong in `construction-dashboard`, not `bid-dashboard`.
- Never build Tier F or auth fixes in `construction-dashboard` without first syncing `bid-dashboard/main`.
- Never recreate `/bids/[id]/leveling` as a standalone page — it is a redirect.
- Never commit `.claude/settings.local.json`.
- One Claude Code session per build step; don't mix planning and build execution in one session.
- Credentials/pricing never enter any prompt (`governance/CONFIDENTIAL_DATA_POLICY.md` §3/§5 — the same rule, restated at the guardrail-policy layer).
- Fly.io deploy paths and S3/cloud object storage are both "prohibited unless explicitly approved" (`governance/CONFIDENTIAL_DATA_POLICY.md` §7) — this is a **newer** constraint than `CLAUDE.md`'s list and is worth knowing even though it isn't in `CLAUDE.md` verbatim.

---

## 5. What must never be assumed

- **Never assume `main` reflects current reality.** It is ~2 months behind the active integration line as of this writing (§2). Almost everything in this document lives only on `integration/foundation-ci-divergence` and its ancestors.
- **Never assume staging's Anthropic credential works.** It is operator-reported as a known 401. This was not re-verified live in this task and may have changed in either direction — check before relying on it.
- **Never assume `CURRENT_STATE.md`'s or `ROADMAP.md`'s "current state" framing, module counts, or deploy-platform narrative are current or complete.** Cross-check specific claims against actual source (schema, code, `runtime/` docs) the way this document did, rather than trusting the prose. In particular: the "35 modules" / "Fly.io deploy" / "SQLite" / "DigitalOcean" framing describes an earlier plan or an earlier snapshot, not today's deployed reality.
- **Never assume a backup of staging or production data exists.** The backup/restore runbook is documentation only; no backup has been executed under it.
- **Never assume the Spec Book staging validation has been run**, or that its pass criteria have ever been checked against real staging. The smoke-helper script defaults to a no-op dry run.
- **Never assume the BlobStore production-promotion blocker has been resolved** without re-running `scripts/divergence-report.mjs` yourself against current refs. Branch tips move; this document's snapshot of the blocker (§3) will go stale.
- **Never assume ADR 0001 is implemented** just because its status says "Accepted." Accepted means decided, not built — re-check the three named sites (and the five additional sidecar sites ADR 0001 itself flags as out-of-scope-but-real) directly before claiming otherwise.
- **Never assume Drawings have been migrated onto BlobStore.** Only Spec Book has. Drawings still use raw filesystem paths (`docs/architecture/drawings-storage-migration-brief.md` is a preflight plan, not an implementation).
- **Never assume the guardrail allow-list is a complete inventory of confidentiality risk.** It names known, tracked, pre-existing exceptions — it is not a proof of full scan coverage, and ADR 0001 itself names additional un-migrated sites the allow-list doesn't track.
- **Never assume production readiness in general.** Production promotion is explicitly blocked (§3); this document does not claim otherwise anywhere.
- **Never assume `runtime/`'s own `STATUS.md`/`README.md` "Phase R1" framing is current** — the directory's actual contents (populated compose/, runbooks/, observability/, cron/, worker/) appear to have progressed well past what those two files describe. This was noticed while writing this document but is not corrected here (out of this task's scope); treat it as a live question, not a settled one.

---

## 6. References

- ADR 0001 — [`docs/architecture/adr/0001-ai-credential-resolution.md`](./adr/0001-ai-credential-resolution.md)
- Staging backup/restore runbook — [`runtime/runbooks/staging-backup-restore.md`](../../runtime/runbooks/staging-backup-restore.md)
- Spec Book staging validation runbook — [`runtime/runbooks/specbook-staging-validation.md`](../../runtime/runbooks/specbook-staging-validation.md)
- Divergence report tool — [`scripts/divergence-report.mjs`](../../scripts/divergence-report.mjs) (`--help` for usage; always run fresh against explicit refs)
- Drawing storage migration preflight, including the production BlobStore promotion-blocker discussion (§7 of that doc) — [`docs/architecture/drawings-storage-migration-brief.md`](./drawings-storage-migration-brief.md)
- Production runtime topology — [`runtime/compose/TOPOLOGY.md`](../../runtime/compose/TOPOLOGY.md)
- Runtime transition status — [`runtime/STATUS.md`](../../runtime/STATUS.md)
- Confidentiality/AI-routing policy — [`governance/CONFIDENTIAL_DATA_POLICY.md`](../../governance/CONFIDENTIAL_DATA_POLICY.md)
- AI provider allow-list — [`governance/guardrails/allowlist.json`](../../governance/guardrails/allowlist.json)
- BlobStore implementation — [`lib/storage/blobStore.ts`](../../lib/storage/blobStore.ts)
- Storage layout convention — [`docs/architecture/STORAGE.md`](./STORAGE.md)
- Repo-level constraints — `CLAUDE.md` §CONSTRAINTS (repo root)
