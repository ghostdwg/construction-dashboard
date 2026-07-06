# GROUNDWORX EXECUTION LEDGER

- Written: 2026-07-06, by the Fable-5 command-center capture session (final Fable session)
- Base commit: `625301a77f73d3b56ccbee41a50c33ba34910150` (`integration/foundation-ci-divergence`, verified clean)
- Companion file: `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` (the runnable card queue this ledger orders)
- Method: five parallel read-only audit lanes (product, storage/migration, AI/security, runtime/ops, adversarial) over source, git history, tests, ADRs, runbooks, and migrations at this exact commit — plus operator-verified live facts from the 2026-07-05/06 staging validation cycle.

**PRECEDENCE:** This ledger supersedes `docs/architecture/REALITY.md` (base `971db44`, 2026-07-04), `docs/architecture/CURRENT_STATE.md`, `docs/architecture/ROADMAP.md`, and `runtime/runbooks/staging-release-bridge.md` wherever they disagree with it. Those files contain **known-stale claims listed in §9** that will mislead any agent who trusts them. Do not "correct" this ledger from those files; correct those files from this ledger (queue card GWX-Q11).

**Tagging:** `[V]` = verified in source/git at 625301a during this capture. `[OP]` = operator-verified live fact (2026-07-05/06 staging cycle), not derivable from the repo. `[INF]` = inference. `[DEC]` = decision — binding, do not reopen (see §4). `[UNK]` = unknown until a later gated action.

---

## 1. Truth table — what is actually true today

### PROVEN ON STAGING (the complete list — nothing else is staging-proven)
| Item | Evidence |
|---|---|
| Spec Book **storage** lifecycle: upload → sidecar parse → split → serve section PDF → delete → re-upload → final cleanup, with provider-bound automation suppressed (13/13 smoke steps) | `[OP]` run of `scripts/specbook-staging-smoke.mjs --storage-only` against staging app image `groundworx-app:e41b027-storage-smoke-failclosed`; suppression asserted via `automationStatus="suppressed_for_storage_smoke"` |
| One controlled **real Anthropic call**: HTTP 200, durable evidence via AiUsageLog + `GET /api/settings/ai-readiness` showing `liveProviderVerification: LAST_REAL_SUCCESS` | `[OP]`; evidence mechanism `[V]` `lib/services/ai/providerReadiness.ts`, `lib/services/ai/aiUsageLog.ts` (ok/error/stub contract) |
| Auth posture spot-check: unauthenticated section-PDF request redirects to `/login` | `[OP]` smoke step 4b; middleware `[V]` `proxy.ts` |

Notes: the two proofs were **separate operations** — the storage smoke deliberately suppresses AI; the real call was a single deliberate `POST /api/bids/{id}/intelligence/generate`. `STORAGE_SMOKE_MODE_ENABLED` is **OFF** again `[OP]`. Staging validation does **not** unblock production cutover `[DEC]`.

### LOCAL-ONLY (implemented + unit-tested at 625301a, never exercised live)
- Storage-path compatibility layer: `lib/services/specbook/storagePath.ts` (4-shape classifier, bid-scoped legacy-storage-root) + domain factory `lib/services/storage/legacyPathCompat.ts` instantiated for drawings/estimates/addendums/meetings. ~26+21 unit tests. `[V]`
- Durable relative-key writes for drawings, estimates, addendums, meetings (`89099a6`); Spec Book durable since `e5d50b0`. `[V]` — **no non-specbook lifecycle has ever run on staging.**
- Inventory + journaled reversible backfill tool (`0c3ec20`): report/apply/reverse, fail-closed journal, idempotent reversal — **deliberately not wired to any real DB** (`unimplementedAdapter()` throws; in-memory fake adapter only). `[V]` scripts/storage-inventory-backfill.ts, lib/services/storageInventory/*
- Staging-only legacy Spec Book fixture CLI (`625301a`): seeds/cleans production-shaped absolute-path rows; gated on `APP_ENV=staging`, exact fixture bid name, exact confirm phrase. **NOT staging-ready** until its two flagged defects are fixed (queue GWX-Q01; locations in §9). `[V]`
- Production stabilization ports (`d572e3e`): run-due canonical status (identical to prod), Procore webhook fail-closed (identical), `dedupeKey` schema + service plumbing, env prod-strict + prod-DB fence re-keyed to APP_ENV. `[V]` — **but the dedupeKey writer (prod `d259b58` activation) was NOT ported: column+unique index exist with no writer.** `[V]`
- Same-Bid Submittal/SpecSection integrity (`f34746a`). `[V]`
- Schedule V2 CPM engine, submittal boilerplate, Morning Strip V0, AI token config, gateway/readiness/promptScan — all with unit tests (101 test files repo-wide at 625301a). `[V]`

### STUBBED
- `BRIEF_STUB_MODE`, `GAP_STUB_MODE`, `ADDENDUM_STUB_MODE` (env-only, feature-scoped, write `status:"stub"` AiUsageLog rows). `[V]`
- Every `runtime/deployment/*.sh|.ps1` script (apply-migrations, health-check, snapshot-prod, deploy-staging, deploy-prod, rollback) — prints plan, exits. Real executables are only `scripts/apply-turso-migrations.mjs`, `scripts/validate-staging.mjs`, `scripts/divergence-report.mjs`, `scripts/cron-loop.mjs`. `[V]`
- `runtime/worker/entrypoint.sh` + worker Dockerfile — scaffold, not deployed (live prod worker is a host-level file outside the repo). `[V]`

### UNPROVEN (code exists; zero live validation)
- Every AI-content lane: spec analyze content, gap analysis, brief, addendum delta, leveling questions, submittal organize/generate, drawing analysis, meeting analysis, schedule generate. One HTTP 200 proves the credential/gateway path, **not output quality on real documents**. `[INF]`
- All non-specbook document lifecycles on staging (drawings/estimates/addendums/meetings). `[V]` code, `[OP]` never run.
- **Meetings durability-read: unprovable safely today.** The read-progression trigger is `source-mapping/route.ts` apply: it resolves audio (`audioStorageKey` via BlobStore, or legacy cwd reconstruction for historic rows) and POSTs it to the sidecar for re-transcription. There is no read-only audio-availability probe. `Meeting.audioStorageKey` populated for new hybrid uploads only. Do not claim this lifecycle is proven. `[V]` mechanism; harness decision = queue GWX-Q07.
- Procore F1–F4 (needs real Procore credentials), RFQ/award email sends, H1–H8 exports, reports, closeout/warranty/inspections/training registers (render empty until a real spec-analyze pass populates `SpecSection.aiExtractions`). `[V]` code paths.
- Observability stack (Prometheus/Loki/Grafana): activatable compose + 3 dashboards, no alerting, no evidence it has ever run on staging. `[V]`

### BLOCKED
- **Production cutover** — blocked until: backfill adapter wired (GWX-Q04), staging rehearsal green (GWX-Q05/Q06), backup+restore actually drilled (GWX-Q08), production read-only inventory reviewed (GWX-Q09), cutover decision made (GWX-Q10). Production DB rows still hold absolute `{storageRoot}/uploads/...` paths; integration reads them via compat, but normalization has never run anywhere. `[V]`+`[DEC]`
- Fixture CLI staging use — blocked on GWX-Q01 (two defects, §9).
- Real-AI validation ladder beyond the single proven call — blocked on human decision to spend real calls (GWX-Q20).

### DEFERRED (with reason — see §8)
MI-10 operator workspace (not-active-in-V1, gated on ingestion soak thresholds), versioned artifact keys, Postgres migration doc (superseded by Turso), Fly.io plane (governance-blocked, `if: false` in deploy.yml), Auth B/C RBAC (needs second user), F5 weather log, 5F drawing OCR (GPU), real tokenizer, TheBeast hardening, orange-UI branch (preserved, unmerged).

### DEPRECATED / DO NOT TRUST
- `docs/architecture/REALITY.md` at base `971db44` — **stale on exactly the points this release changed** (§9).
- `runtime/runbooks/staging-release-bridge.md` §3.5/§3.6 "liveProviderVerification is permanently NOT_VERIFIED / no durable proof possible" — superseded by `f2ab59a` (5-state evidence) and the observed `LAST_REAL_SUCCESS`. `[V]`
- `runtime/{README.md,deployment/README.md,runbooks/README.md}` "Phase R1 / empty / no scripts yet" self-descriptions — the trees are fully populated. `[V]`
- `CURRENT_STATE.md` ("Last Updated 2026-05-15") and `ROADMAP.md` Fly.io/DigitalOcean/SQLite framing. `[V]`

---

## 2. Verified facts / inference / decisions / unknowns (quick block)

**Facts `[V]`/`[OP]`:** everything tagged above; plus: two pending staging migrations `20260521020000_addendum_meeting_storage_keys` (additive, nullable, no backfill) and `20260521030000_background_job_dedupe_key` (additive + unique index safe with NULLs); `a5f490d` was a pure rename resolving a timestamp collision between independent tracks; no auto-migrate on boot; no down-migrations exist anywhere; migrations apply via `scripts/apply-turso-migrations.mjs` only (tier-fenced, atomic per-migration batch, exit 2 = partial); `main` (160f6e8) is ~100 commits behind and contains none of this work.

**Inference `[INF]`:** staging `ANTHROPIC_API_KEY` was rotated/replaced before the successful real call (repo still documents a 401); canonical-shape keys are not bid-scoped by the classifier (only legacy-storage-root is) — a corrupted DB value holding another record's valid relative key would be honored; classifier catch-paths report transient FS errors as "invalid" (operator-confusing, not data-damaging).

**Decisions `[DEC]`:** §4.

**Unknowns `[UNK]`:** production row counts per path shape; real production `STORAGE_LOCAL_PATH` mount value; whether legacy cwd-rooted blobs still exist in the prod container/volume; whether the prod worktree's uncommitted changes are baked into the running locally-built prod image; Turso backup/PITR mechanics in practice; status of the non-Anthropic secret rotations (RESEND/WHISPERX/SIDECAR_API_KEY/WORKER_TOKEN) mandated by the bridge runbook §11; live SDK exception-serialization behavior (secret-presentation audit §7 open items).

---

## 3. Dependency-ordered path from 625301a to safe production

Each step = queue card in `GROUNDWORX_AGENT_QUEUE.md`. Order is load-bearing; do not parallelize across a Human gate. (Dependency-locked 2026-07-06 integrity pass: Q04 split into local-implementation vs staging-execution; local code cards front-loaded so ONE staging image build serves the whole rehearsal chain.)

1. **GWX-Q01** Fixture CLI hardening (Sonnet, local) — unblocks all fixture-based rehearsal.
2. **GWX-Q04a** Storage-inventory Prisma adapter (Sonnet, local) — operator-plane tool code; no image dependency, but merged now so the tip is complete.
3. **GWX-Q06a** Non-specbook lifecycle route-gate audit + smoke helpers (Sonnet, local) — any missing suppression gate is APP code and must exist before the image build.
4. **GWX-Q02** Staging checkpoint + migration preflight + apply of the two pending migrations (Human). Checkpoint required first — see §7a.
5. **GWX-Q03** Staging app build/pin/deploy of the tip containing Q01+Q04a+Q06a (Human). Q02 strictly before Q03, always (columns before code).
6. **GWX-Q04b** Staging **inventory-only** run (Human, from a host checkout at the pinned SHA — see §4.11; needs Q04a merged and Q02 applied; does not need the Q03 image, but runs after it by convention).
7. **GWX-Q05** Production-shaped fixture rehearsal on staging: seed → inventory → backfill apply → reverse → re-apply → serve → delete → cleanup (Human).
8. **GWX-Q06b** Drawings/Estimates/Addendums staging lifecycle runs (Human, using Q06a helpers).
9. **GWX-Q07** Meetings durability-read harness **decision** (Opus — may run any time; its implementation, if app code, ships in a later image build, never a mid-chain surprise) → implementation (Sonnet) → staging proof (Human).
10. **GWX-Q08** Staging backup + actual **restore drill** (Human) — hard prerequisite for anything production.
11. **GWX-Q09** Production read-only inventory (Human; first authorized production touch, read-only).
12. **GWX-Q10** Production backfill/rollback rehearsal + cutover decision branch (Opus decision, Human execution).

Parallel-safe local work at any point: GWX-Q11 (doc regeneration), GWX-Q12 (dedupeKey writer), GWX-Q13 (classifier error honesty). Everything else waits (§8).

---

## 4. Architecture decisions later agents must NOT reopen `[DEC]`

1. **Relative BlobStore keys are canonical**; `plan-room/jobs/{bidId}/…` for new writes; existing `uploads/…` blob keys keep their names — backfill converts **DB values only**, never moves/renames/copies blobs. (Adjudicated 2026-07-06; full reasoning in `docs/architecture/prod-blobstore-reconciliation-dossier.md` + that session's decision: portability, key-path safety semantics, staging proof, sidecar contract, asymmetric cost.)
2. **Production migrates to the integration model.** Never revert integration to absolute paths. Never wholesale-merge the production branch; port content per-commit (pattern established by `d572e3e`).
3. **Option A credential resolution** (TS resolves via `getSetting()`, forwards per-request; sidecar never resolves its own key) — implemented across the active surface (ADR 0001/0002). Do not reintroduce env-key reads or module singletons.
4. **All provider construction stays in the two gateways** (`lib/services/ai/gateway.ts`, `sidecar/services/ai_gateway.py`); CI guardrail (`detect-ai-providers.mjs`, enforce mode) is the fence. The allowlist accepts no new entries.
5. **P2-A0 stays shadow-only** until a deliberate, separately-approved enforcement phase. It is telemetry, and is always described as such.
6. **Spec Book keeps its own classifier module** separate from the `legacyPathCompat` factory — deliberate (documented in the factory header), not an unfinished refactor. Don't "unify" it without an Opus-level decision.
7. **Migrations are forward-only**, applied manually via `apply-turso-migrations.mjs` before container recreate; recovery = forward-fix or PITR restore, never a down-migration.
8. **APP_ENV is the tier discriminator**, Zod-validated at boot, deploy-controlled, never request-derived. All staging-only bypasses (storage smoke, fixture CLI) gate on it.
9. **Suppression-style validation** (storage-only smoke, `automationStatus` assertion, four-condition gate) is the pattern for validating storage without provider exposure — reuse it, don't invent parallel mechanisms.
10. **Backfill safety contract:** journaled, idempotent, reversible, fail-closed on journal writability, confirm-phrase gated, report-only by default, AddendumUpload/Meeting inventory-only. Any adapter wiring must preserve every one of these.
11. **Tooling plane (dependency-locked 2026-07-06):** the inventory/backfill CLI and the migration runner are **operator-plane tools run from a host git checkout at the pinned SHA** with operator-supplied env (staging `DATABASE_URL` etc.) — they talk to Turso over the network and never require the app image to contain them. They are NOT baked into or executed from app images. The **fixture CLI is the exception**: it touches the storage bind mount and gates on the process env's `APP_ENV=staging`, so it runs per its own header (docker exec in the staging app container; if the runtime image proves to lack `scripts/`+tsx, the sanctioned fallback is a host checkout with the staging env file loaded — the gates still enforce identity either way). Consequence: adapter code (Q04a) needs no image rebuild to run, but is still merged before the Q03 build so the deployed SHA and the tooling SHA are identical — evidence must never come from a tool version newer than the running app.

---

## 5. Allowed vs prohibited release claims

**ALLOWED:**
- "Spec Book storage mechanics (upload/parse/split/serve/delete/re-upload/cleanup) are proven on staging, with provider automation suppressed."
- "The AI provider path is live-verified on staging: one controlled real call succeeded with durable evidence (`LAST_REAL_SUCCESS`)."
- "Provider construction is centralized in two sanctioned gateways with CI enforcement; credentials are request-scoped (Option A); credential values are never displayed or logged."
- "`pricingData`/`rawPriceText`/`isPreferred` are structurally excluded from client responses at the API layer and not placed into prompts; a detect-only shadow scanner emits telemetry as defense-in-depth."
- "AI usage evidence distinguishes real/stub/error; readiness reporting cannot overclaim."
- "Drawings, estimates, addendums, and meetings write durable relative-key storage **in code, unit-tested, not yet staging-validated**."

**PROHIBITED:**
- ❌ Any form of "P2-A0 redacts/blocks/enforces/protects confidential data" — it detects and counts, after prompt assembly, text blocks only, TS only.
- ❌ "Confidential data cannot reach the provider" — no runtime enforcement gate exists.
- ❌ "Meetings (or drawings/estimates/addendums) lifecycle proven" — only Spec Book storage is.
- ❌ "AI features work" as a product claim — one credential-path call ≠ validated analysis content on real documents.
- ❌ "Backups exist" / "restore works" — nothing has ever been backed up or restored, anywhere.
- ❌ "Production-ready" / "staging validation clears production" — cutover has its own gate chain (§3 steps 8–10).
- ❌ "The backfill tool is ready to run" — it has no real DB adapter yet.
- ❌ "All secrets rotated" — Anthropic key evidently working `[INF]`; the other mandated rotations are `[UNK]`.

---

## 6. Human/live approval gates (nothing below happens on model authority)

Every live action needs explicit operator (Josh) approval **per invocation**: staging migration apply; staging image build/pin/recreate; any run of the fixture CLI or backfill tool against a real DB (inventory included); any real provider call; staging backup/restore drill; **anything** touching production (even read-only inventory); credential handling of any kind; deleting any row/blob not created by the tool asking to delete it. Models prepare commands and acceptance criteria; humans execute. The queue marks these per-card.

---

## 7a. Staging checkpoint requirement (before ANY staging DB mutation, Q02 included)

- **Required artifact:** a same-day Turso staging-DB checkpoint the operator can point to — a `turso db backup`-style snapshot or a verified-available PITR restore point — recorded (timestamp + identifier) in the run notes. The storage tree is NOT part of this checkpoint for Q02 (both migrations are DB-only and additive); storage joins the artifact set from Q05 onward (fixture writes blobs).
- **Restore PROOF (an actually-executed restore) is NOT required before staging migrations** — requiring it would deadlock the chain, and the exposure is bounded (additive, nullable, forward-only). Restore proof IS required before any production work: GWX-Q08 must be green before GWX-Q09/Q10. Staging = checkpoint-required; production = restore-proof-required.
- **Stop condition:** if no current checkpoint can be created or verified at Q02 time (backup command fails, PITR window unavailable/unverifiable), **Q02 does not run** — and therefore nothing after it. Capture the failure, escalate to Josh; the recovery task (fixing staging backup capability) becomes the front of the queue. Never apply migrations "because they're only additive" without the checkpoint.

## 7. Production migration/cutover/rollback invariants

- **Availability:** every document classified present pre-migration remains reachable at every intermediate step (the 3-resolvable-shape reader guarantees this only if deployed before backfill).
- **No data loss:** blobs never moved/renamed/deleted by migration; DB transform journaled + reversible; shape-`legacy-cwd` rows reported, never "cleaned up."
- **Order:** migrations before app deploy; app (compat reader) deploy before backfill; backfill before any code that drops compat.
- **Backup proof precedes mutation:** a restore actually performed (staging drill first, then production snapshot verified) before the production backfill runs.
- **Rollback:** predeclared triggers (unreachable classified-present document; `assertSafeKey` throw in prod logs; any delete touching an unjournaled row) → journal reversal + image repin; DB restore only if reversal is insufficient. Decided in advance, never improvised mid-incident.
- **No provider exposure:** inventory/backfill/fixture tools never touch routes that fire automation; rehearsals use the suppression pattern.
- **Traceability:** deployed = committed SHA. The production worktree's uncommitted changes (10 files observed 2026-07-06) must be committed/stashed-and-recorded before any production inspection is treated as authoritative.
- **Scope honesty:** cutover ships the whole integration line (~100 commits beyond merge-base), not just storage. Josh accepts that scope explicitly at GWX-Q10, or a narrower promotion branch is cut (Opus decision).

---

## 8. Deferred work (reason attached)

| Item | Reason |
|---|---|
| MI-10 operator workspace activation | Gated on ingestion soak (≥100 signals/≥5 projects); marked not-active-in-V1 (`b9b65be`) |
| dedupeKey writer activation (GWX-Q12) | Safe-inert today (NULLs allowed); needed before relying on scrape dedupe, not before storage cutover |
| Versioned artifact keys | Preflight doc only; explicitly post-reconciliation |
| Real tokenizer (chars/4 fix) | Cost-display accuracy; matters at daily use, not for cutover |
| TheBeast hardening (bare IPs, no-auth Ollama, GPU SPOF) | Meetings/MI resilience; not on the storage path |
| Auth B/C (per-user isolation, RBAC) | No second user exists |
| F5 weather logs, 5F drawing OCR | Not started / GPU hardware |
| Postgres migration doc, Fly.io tomls + ROADMAP lines | Superseded (Turso) / governance-blocked; delete during GWX-Q11 doc pass |
| P2-A0 enforcement phase | Deliberate future decision; shadow-only until then |
| Non-Anthropic secret rotations + rotation runbook | Human-only; fold into GWX-Q18 |
| main-branch fast-forward/reconciliation | After cutover decision (GWX-Q10) — changing `main` earlier risks CI/deploy-path confusion |

---

## 9. DO NOT RESTART / DO NOT RE-RESEARCH

Settled questions with their answers — re-deriving these wastes a session:

1. **The 2026-07-05 staging-smoke 404**: root cause was a missing synthetic Bid (route's only 404 path is `Bid not found`); fixed by precondition + read-only preflight. Don't re-diagnose.
2. **`blobStore.ts` merges clean** between prod and integration (`git merge-tree` verified); the promotion conflict is the route/data contract, not that file.
3. **Production blobs are already key-addressable** — prod `put(key)` used relative keys; only DB columns hold absolute forms. Backfill = DB prefix-strip. No blob copying. Ever.
4. **The "5 isLegacyUploadPath copies"** = 4 code + 1 doc sample; all 4 code copies unified into `lib/services/specbook/storagePath.ts`; non-specbook domains use `legacyPathCompat` factory. Done.
5. **Fixture CLI defects (the two, exactly):** (a) `scripts/specbook-legacy-fixture.ts` `doCleanup` gates identity on SpecBook shape only — sections' blobs delete on `legacy-storage-root` **or `canonical`** (~:318) and section rows delete unconditionally (~:323); fix = section-level up-front identity gate, drop the canonical branch. (b) `runMain` catch (~:384) interpolates raw `e.message` (leaks absolute paths, unbounded) and the bootstrap `.catch` (~:402) prints the full error object+stack; fix = bounded, path-free error descriptor (code/constructor name only). Neither path is covered by the 27 existing tests.
6. **Two pending staging migrations** are exactly `20260521020000_addendum_meeting_storage_keys` + `20260521030000_background_job_dedupe_key`; both additive; apply order lexicographic; `a5f490d` already resolved the collision.
7. **Backfill tool is adapter-less by design** — `unimplementedAdapter()` throws; wiring a Prisma adapter is GWX-Q04, not a bug hunt.
8. **Meetings transcription trigger** is `source-mapping` apply (POSTs audio to sidecar; legacy rows reconstruct cwd paths). GET is passive. The harness question is GWX-Q07, already framed.
9. **Stale docs (do not trust, fix in GWX-Q11):** REALITY.md ("drawings not migrated", "spec book validation never executed", "staging 401", base 971db44); staging-release-bridge.md ("NOT_VERIFIED forever", unverified baseline tags `e5d50b0`/`5c1877c`, single `${APP_SHA}` for app+sidecar+worker); runtime README trio ("empty/scaffolding"); CURRENT_STATE.md (2026-05-15); ROADMAP.md (Fly.io).
10. **Provider surface is fully funneled** (Lane-3 verified at 625301a): no `new Anthropic(` outside gateway.ts; sidecar callers all use `build_client(api_key)`; residue = dead module constant `meeting_intelligence.py:32`, allow-listed direct `.messages.create` in drawing/meeting intelligence, health-probe boolean in `sidecar/main.py`. Not worth re-auditing.
11. **Known accepted quirks:** canonical keys aren't bid-scoped by the classifier (GWX-Q14 decides whether to change); classifier catch-paths say "invalid" for transient FS errors (GWX-Q13); observability container names (`groundworx_*`) vs app container names (`neuroglitch-*`) may make validate-staging's Loki filter miss app streams; `staging.active.yml` cannot pin app/sidecar/worker to different tags (single `${APP_SHA}`); APP_ENV vocabularies differ between `lib/env.ts` (`local`) and the migration runner (`development-parity`).
12. **Agent-worktree trap:** isolated agent worktrees in this repo may check out `main` (160f6e8), which predates all of this work. Any future subagent must `git rev-parse HEAD` first and read via `git show <sha>:<path>` if stale. This burned 3 of 5 lanes in this capture before correction.
