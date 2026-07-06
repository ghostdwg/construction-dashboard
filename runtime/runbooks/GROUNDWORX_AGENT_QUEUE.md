# GROUNDWORX AGENT QUEUE

Ordered, runnable work cards from `integration/foundation-ci-divergence @ 625301a` to safe production and daily use. Companion to `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` — **read the Ledger first**; it holds the truth table, decisions (do not reopen), claim rules, and the "do not re-research" list. This queue assumes them.

**Owner semantics** — `Sonnet`: bounded local implementation/testing; no live systems, no schema changes unless the card says so. `Opus`: cross-cutting/adversarial decisions; read-only unless the card says otherwise. `Human` (Josh): every live staging/production/credential/backup/migration/provider/destructive action, per invocation.

**Universal rules for every card:** work on a branch off current integration tip; never touch production; never place secret values, raw document content, or user project data in code/docs/commits; commits end with `Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>`; if your isolated worktree's HEAD is not the integration tip, STOP and re-anchor (Ledger §9.12); a card's "Stop condition" is a full stop — report, don't improvise.

**EXECUTION ORDER (dependency-locked 2026-07-06 — differs from card numbering; local code cards front-load so ONE staging image build serves the whole rehearsal chain):**
`Q01 → Q04a → Q06a` (Sonnet, local, parallel-safe) `→ Q02 → Q03 → Q04b → Q05 → Q06b → Q07 → Q08 → Q09 → Q10` (Q07's Opus decision may run any time; only its implementation waits). Cards below appear in numeric order for stable IDs — follow THIS line for sequencing.

---

## GWX-Q01 — Fixture CLI safety hardening ✦ FIRST

- **Owner:** Sonnet. **Prereqs:** none.
- **Objective:** fix the two adjudicated defects in `scripts/specbook-legacy-fixture.ts`: (a) section-level cleanup identity validation; (b) bounded/sanitized unexpected-error output.
- **Allowed:** that script + its test file only. **Forbidden:** any other file; any live run; changing gates/confirm phrases/fixture name; touching the classifiers.
- **Files:** `scripts/specbook-legacy-fixture.ts` (~:314-325, ~:383-385, ~:402), `scripts/__tests__/specbook-legacy-fixture.test.ts`.
- **Tests/acceptance:** new tests proving — cleanup refuses the WHOLE run if any non-null `section.pdfPath` is not `legacy-storage-root` for that bid (including a `canonical`-key section: must refuse, never delete that blob); section rows never deleted when refusal fires; unexpected fs/BlobStore throw produces a bounded, path-free message (assert no `/` -rooted path substring, no stack) on both the `runMain` catch and the bootstrap catch, exit 2. All 27 existing tests still pass; `npx vitest run scripts/__tests__/specbook-legacy-fixture.test.ts` green.
- **Gates:** none (local). **Stop:** if the fix requires touching `lib/services/specbook/storagePath.ts`, stop — that's out of scope, report why.
- **Handoff prompt:** see §"First Sonnet prompt" at bottom (verbatim).

## GWX-Q02 — Staging checkpoint + migration preflight + apply

- **Owner:** Human (Sonnet may draft the command block only).
- **Prereqs:** a **same-day staging-DB checkpoint** per Ledger §7a (Turso snapshot or verified-available PITR point, identifier recorded). Storage tree not required for this card (DB-only additive migrations). **Must precede Q03.**
- **Objective:** apply the two pending migrations to the staging Turso DB: `20260521020000_addendum_meeting_storage_keys`, `20260521030000_background_job_dedupe_key`.
- **Allowed:** `node scripts/apply-turso-migrations.mjs` dry-run, then real apply, against the **staging** DB URL only, run from a host checkout at the current pinned/target SHA (operator-plane tooling, Ledger §4.11). **Forbidden:** production DB; any other migration source; Prisma CLI; proceeding without the checkpoint.
- **Acceptance:** checkpoint identifier recorded; dry-run lists exactly the two; apply exits 0; `_prisma_migrations` shows both; `scripts/validate-staging.mjs` migration-parity check passes (or is run post-Q03).
- **Gates:** migration gate (this IS it); checkpoint gate per Ledger §7a. **Stop/rollback:** no checkpoint obtainable → card does not run, chain halts (Ledger §7a stop condition). Exit 2 (partial) → stop, capture output, do NOT retry; both migrations are additive so forward-fix is the recovery path; no down-migration exists; the checkpoint is the last resort.

## GWX-Q03 — Staging app build/pin/deploy to integration tip

- **Owner:** Human.
- **Prereqs:** Q02 applied (columns exist before code referencing them deploys); Q01, Q04a, AND Q06a merged into the tip being built — every card that changes app code ships in THIS one build, so the whole rehearsal chain (Q04b–Q06b) runs on a single image. (Q04a's adapter is operator-plane and doesn't strictly need the image — it's merged now so tooling SHA == deployed SHA, Ledger §4.11.)
- **Objective:** build/tag app+sidecar+worker images from that tip, pin via `staging.active.yml` `${APP_SHA}`, recreate staging.
- **Known constraints (Ledger §9.11):** single `${APP_SHA}` pins all three services — worker re-tag required even if unchanged; fix the compose config-list before recreate if still pointing at the deleted `/tmp` file.
- **Acceptance:** `/api/health` 200; `X-App-Env: staging`; `validate-staging.mjs` green (SKIPs allowed for observability); `GET /api/settings/ai-readiness` still shows `LAST_REAL_SUCCESS` (durable evidence survived).
- **Gates:** image gate (this IS it). **Stop/rollback:** repin previous tag `e41b027-storage-smoke-failclosed` (image-only rollback is safe: the two migrations are additive/nullable and old code ignores the columns).

## GWX-Q04a — Storage-inventory Prisma adapter (LOCAL implementation)

- **Owner:** Sonnet. **Prereqs:** none. **Must merge before Q03's image build** (tooling SHA == deployed SHA, Ledger §4.11 — the adapter itself is operator-plane and needs no image).
- **Objective:** implement the real Prisma `StorageInventoryDbAdapter` (`findRows`/`updateField`) so the inventory/backfill tool can run against a real DB.
- **Allowed:** new adapter module + wiring in `scripts/storage-inventory-backfill.ts` (replace `unimplementedAdapter()` injection point only), tests with the existing in-memory fakes + a mocked-Prisma unit test. **Forbidden:** weakening any gate (confirm phrase, journal requirement, report-only default, AddendumUpload/Meeting inventory-only); any live DB in tests; BlobStore/network imports into `lib/services/storageInventory/*`.
- **Files:** `scripts/storage-inventory-backfill.ts` (~:117-130), new `lib/services/storageInventory/prismaAdapter.ts`, `lib/services/storageInventory/types.ts` (read-only reference), tests.
- **Acceptance:** all existing 30+ tool tests pass unchanged; new tests prove the adapter maps the 6 model/field pairs correctly and `updateField` is unreachable in inventory mode.
- **Gates:** none (local). **Stop:** if honoring the safety contract requires changing `lib/services/storageInventory/{apply,journal,reversal}.ts` semantics, stop and report.

## GWX-Q04b — Staging inventory-only run (LIVE execution)

- **Owner:** Human.
- **Prereqs:** Q04a merged; Q02 applied (the classifiers/tool reference the new columns' models). By convention runs after Q03 so app and tooling are at the same SHA; **the run itself does NOT execute inside the app container** — it runs from a host git checkout at the pinned SHA with operator-supplied staging `DATABASE_URL` (operator-plane, Ledger §4.11).
- **Objective:** one inventory-only run against the staging DB.
- **Acceptance:** counts-only report (no raw paths) printed; exits 0; writes nothing (verify by repeat-run identity or before/after row checksum).
- **Gates:** staging gate; per-invocation approval (Ledger §6); the staging `DATABASE_URL` is handled only by the Human — never given to a model. **Stop:** any write observed in inventory mode = full stop + incident note.

## GWX-Q05 — Production-shaped Spec Book fixture rehearsal on staging

- **Owner:** Human (docker exec in staging app container per the CLI's own header; if the runtime image lacks `scripts/`+tsx, the sanctioned fallback is a host checkout with the staging env file loaded — Ledger §4.11), with the Q01-hardened CLI.
- **Prereqs:** Q01, Q02, Q03, Q04a, Q04b. Extend the §7a checkpoint to include the storage tree from this card onward (fixture writes blobs).
- **Objective:** end-to-end rehearsal of the production migration mechanics on staging: `--seed` fixture (absolute-path rows) → inventory (rows classify `legacy-storage-root`) → backfill `--apply` with journal → verify rows now canonical → **serve the section PDF through the app** (compat read) → `--reverse` (rows back to absolute) → serve again (legacy read) → re-apply → delete via app route → fixture `--cleanup` → inventory shows zero.
- **Acceptance:** every step's expected classification/status observed; journal file captured as evidence artifact (it contains paths — store it, don't paste it); staging left with zero fixture rows/blobs.
- **Gates:** staging gate; per-invocation approval. **Stop/rollback:** any refusal/unexpected classification → stop, run `--reverse` with the journal, cleanup, report. Never hand-edit rows to force progress.

## GWX-Q06a — Non-specbook lifecycle route-gate audit + smoke helpers (LOCAL)

- **Owner:** Sonnet. **Prereqs:** none. **Must merge before Q03's image build** — any suppression gate added here is APP code that must be IN the deployed image, unlike the external smoke scripts.
- **Objective:** (1) audit the drawings/estimates/addendums upload routes for provider-bound fire-and-forget automation; where one exists without a gate, add a suppression gate byte-for-byte following the Spec Book four-condition pattern (admin + marker header + env flag + `APP_ENV=staging`). (2) Build the external smoke helpers modeled on `scripts/specbook-staging-smoke.mjs` (dry-run default, cookie-prompt, staging-URL check, automationStatus-style assertions where a gate exists).
- **Forbidden:** any other route change; weakening the Spec Book pattern; live execution.
- **Acceptance:** unit tests green for gates and helpers; PR explicitly lists which routes fire automation and which gates were added.
- **Gates:** none (local). **Stop:** if a route's automation can't be gated without restructuring it, stop and report — that becomes an Opus card.

## GWX-Q06b — Drawings / Estimates / Addendums staging lifecycle runs (LIVE)

- **Owner:** Human. **Prereqs:** Q03 (image contains Q06a), Q06a helpers.
- **Objective:** prove upload → serve/read → delete for drawings, estimates, addendums on staging with synthetic fixtures, suppression engaged wherever Q06a added a gate.
- **Source-proven route facts from the Q06a audit (Sprint 1, binding for this run):** only the drawings upload fires provider-bound automation (two call sites, both gated; assert `automationStatus` on the upload response). Addendums and estimates uploads are clean — BUT the addendums **DELETE** route fires `triggerBriefRefresh`, so it carries its own gate (`x-addendums-storage-smoke` marker; assert response header `X-Automation-Status: suppressed_for_storage_smoke` on cleanup; note the delete success shape is 200 `{deleted:true}`, not 204). **Estimates have NO delete route anywhere in the app** — the smoke run cannot self-clean an EstimateUpload; the helper skips cleanup with a loud warning, and the leftover synthetic estimate is removed by the operator afterward (or accepted as a labeled fixture). Helper: `scripts/artifacts-staging-smoke.mjs --domain drawings|addendums|estimates` (dry-run default, `--execute --storage-only --cookie-prompt`).
- **Acceptance:** each lifecycle 100% pass; no provider call fired (readiness real-call count unchanged unless deliberate); addendums cleanup header assertion passes.
- **Gates:** staging gate per run. **Stop:** any step's failure — capture and stop; no retry loops.

## GWX-Q07 — Meetings safe durability-read harness (decision → build → prove)

- **Owner:** Opus (decision), Sonnet (build), Human (staging proof).
- **Prereqs:** decision none; build after decision; proof after Q03.
- **Objective:** decide and build a way to prove meeting-audio durability WITHOUT invoking transcription. Candidate shapes (Opus adjudicates): a read-only audio-availability probe reusing the `fileAvailability` pattern via `lib/services/meetings/storagePath.ts`; vs a HEAD/stat-style admin endpoint; vs extending the storage smoke. Must handle both `audioStorageKey` rows and legacy cwd-reconstruction rows honestly (legacy rows may be gone — report, don't fabricate).
- **Forbidden:** anything that POSTs audio to the sidecar; claiming the meetings lifecycle proven from availability alone (it proves storage presence only).
- **Acceptance:** Opus decision recorded in the PR/ADR-lite note; Sonnet tests green; Human staging run shows correct classification for a fresh hybrid upload (durable-present) without any transcription job created.
- **Image note:** if the chosen mechanism is app code (probe/endpoint), it ships in a LATER, separately-approved staging image build ("staging redeploy #2") — it must never be smuggled into the Q03 build mid-chain, and Q08–Q10 do not depend on it.
- **Handoff prompt (Opus):** see §"First Opus prompt" at bottom (verbatim).

## GWX-Q08 — Staging backup + actual restore drill

- **Owner:** Human. **Prereqs:** Q03 (representative data helps but isn't required).
- **Objective:** first-ever executed backup and isolated restore: Turso staging DB snapshot + `/opt/neuroglitch/storage-staging` tar (paired timestamps, checksum manifest per `runtime/runbooks/staging-backup-restore.md`), then restore into an ISOLATED target (never over live staging) and verify a served document + row counts.
- **Acceptance:** a written drill record (timestamps, checksums, verification outcome) committed as a runbook appendix — the drill record, not the runbook, is the proof.
- **Gates:** backup gate (this IS it); hard prerequisite for Q09/Q10. **Stop:** restore-verification failure = production stays frozen until root-caused.

## GWX-Q09 — Production read-only inventory

- **Owner:** Human (command prepared by Sonnet as part of Q04a deliverable docs).
- **Prereqs:** Q04a (adapter) + Q04b (staging run proved write-free), Q05 (rehearsal green), Q08 (restore proven — Ledger §7a: production requires restore PROOF, not just a checkpoint). Also: commit/stash-and-record the production worktree's uncommitted changes first (Ledger §7 traceability). Run from a host checkout at the pinned SHA with operator-supplied production `DATABASE_URL` (Ledger §4.11) — never from inside any container, never by a model.
- **Objective:** first authorized production touch — inventory-only run against the production DB. Output: counts per model per shape (canonical / legacy-cwd / legacy-storage-root / invalid). Resolves Ledger §2 unknowns (row counts, mount value).
- **Gates:** production gate — explicit unfreeze for THIS read-only action only; nothing else unfreezes. **Stop:** any nonzero `invalid` count → Opus adjudication before proceeding to Q10.

## GWX-Q10 — Production backfill/rollback rehearsal + cutover decision branch

- **Owner:** Opus (decision dossier), Human (execution).
- **Prereqs:** Q01–Q09 all green.
- **Objective:** Opus writes the cutover decision brief from Q09's real counts: full-line promotion vs narrower promotion branch; backfill window; rollback triggers (Ledger §7). Human then, in order and each separately approved: production backup (snapshot verified) → deploy compat-reader app → backfill `--apply` with journal → verify sample documents → decide cutover complete or `--reverse` + repin.
- **Acceptance:** every Ledger §7 invariant demonstrably held; journal retained; post-backfill inventory: zero `legacy-storage-root` rows, zero unexplained `invalid`.
- **Stop/rollback:** predeclared triggers only (Ledger §7); reversal + repin is the default response, DB restore the last resort.

---

## Follow-on cards (order flexible after the first ten)

**GWX-Q11 — Documentation truth pass** · Sonnet · Prereq none · Regenerate/correct: REALITY.md (against current tip; keep its tagging convention), bridge-runbook §3.5/§3.6 NOT_VERIFIED text, runtime README trio, CURRENT_STATE.md header, ROADMAP.md Fly.io lines; delete `fly.toml`/`fly.sidecar.toml`/`runtime/fly/*` (governance-blocked). Acceptance: no doc contradicts the Ledger; Ledger §9.9 list emptied.

**GWX-Q12 — dedupeKey writer activation** · Sonnet · Prereq Q02 on staging (column exists) · Port production `d259b58`'s queue-scrape dedupe activation (source-keyed `dedupeKey`, structured outcome logs) onto integration's `app/api/market-intelligence/sources/[id]/queue-scrape/route.ts`; tests for at-most-one-active-per-key via the unique index. Forbidden: schema changes (already shipped).

**GWX-Q13 — Classifier error honesty** · Sonnet · Prereq none · `storagePath.ts`/`legacyPathCompat.ts` catch-paths currently report transient FS/BlobStore errors as `invalid`; introduce a distinct `unavailable`-style result (or rethrow taxonomy) so operators aren't told a present file is malformed. Keep both modules in sync (Ledger §4.6: they stay separate). Tests for the error branch in both.

**GWX-Q14 — Canonical-key scoping decision** · Opus · Prereq none · Decide whether canonical relative keys should be structurally scope-checked (e.g., require `plan-room/jobs/{expectedBidId}/…` when a scope is known) or accept the current trust-the-DB posture. Cross-cutting: touches every domain wrapper + fixture/cleanup semantics. Record as ADR; implementation is a follow-on Sonnet card if adopted.

**GWX-Q15 — main-branch reconciliation** · Opus decision, Human merge · Prereq Q10 decided · Fast-forward or merge `main` to the promoted line so CI/deploy paths and future worktrees stop anchoring 100 commits behind (Ledger §9.12 trap). Frozen until then.

**GWX-Q16 — Real-AI validation ladder** · Human + Sonnet · Prereq Q03 · One controlled real call per feature lane on synthetic fixtures (spec analyze → gap analysis → brief → addendum delta → leveling question → submittal organize), each asserting an `ok` AiUsageLog row and sane output; budget-capped; readiness stays `LAST_REAL_SUCCESS`. This is what upgrades "AI path verified" toward "AI features validated" — content quality on real project documents remains a daily-use judgment, not a claim.

**GWX-Q17 — Secret rotation closeout** · Human · Rotate remaining `secret:true` settings mandated by bridge-runbook §11 (RESEND/WHISPERX/SIDECAR_API_KEY/WORKER_TOKEN) if not already done (`[UNK]` in Ledger); author the missing credential-rotation runbook while doing it.

**GWX-Q18 — Token estimator honesty** · Sonnet · Replace chars/4 with a real tokenizer or label estimates as approximate in the UI; deferred until daily use (Ledger §8).

**GWX-Q19 — TheBeast resilience** · Sonnet + Human · MagicDNS/hostname instead of bare IPs, auth in front of Ollama, graceful GPU-down UX for meetings/MI. Deferred: not on the storage path.

**GWX-Q20 — Daily-use pilot on staging** · Human · After Q05/Q06b/Q16: run one real bid end-to-end (real spec book, real workflows) on staging as the acceptance test for "daily-use ready." Only after this may that claim be made — and still not "production-ready" (that's Q10).

**Explicitly deferred, no card:** MI-10 workspace activation (soak-gated), versioned artifact keys, Postgres migration, Auth B/C, F5, 5F OCR, P2-A0 enforcement, orange-UI branch. Reasons in Ledger §8.

---

## First Sonnet prompt (GWX-Q01) — paste verbatim

> Read `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §4, §9.5, and `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` card GWX-Q01 first; they are binding. Verify `git rev-parse HEAD` is the current `integration/foundation-ci-divergence` tip (descended from 625301a); if your worktree is at `main`/160f6e8, re-anchor before reading anything. Task: in `scripts/specbook-legacy-fixture.ts` only, fix two defects. (1) `doCleanup` validates identity only at SpecBook level — add an up-front gate refusing the ENTIRE cleanup unless every non-null `section.pdfPath` classifies as `legacy-storage-root` for the target bid via `classifyStoragePath`; then delete section blobs strictly through that classification's `canonicalKey`, removing the `|| classified.kind === "canonical"` branch (~line 318) and the unconditional row-delete divergence (~line 323). A `canonical`-key section blob must NEVER be deleted by this tool. (2) The `runMain` catch (~line 384) and the bootstrap `.catch` (~line 402) print raw error content — replace with a bounded, path-free descriptor (errno code or error constructor name only; fixed max length; never `e.message`, never a stack), keeping exit code 2. Do not alter any gate, confirm phrase, fixture name, or any other file except the test file. Add tests in `scripts/__tests__/specbook-legacy-fixture.test.ts` covering: refusal on a canonical-key section (blob untouched, no rows deleted), refusal on an invalid/mismatched-bid section, sanitized output on an injected fs throw during seed and during cleanup (assert output contains no absolute path and no stack). All existing tests must pass unchanged: `npx vitest run scripts/__tests__/specbook-legacy-fixture.test.ts`. No live execution of the CLI anywhere. Commit on a branch as `fix(storage): harden legacy fixture cleanup identity and error output`, trailer `Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>`.

## First Opus prompt (GWX-Q07) — paste verbatim

> Read `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` (all of it — §1 "meetings", §4, §9.8 minimum) and `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` card GWX-Q07; they are binding. Verify you are reading the current `integration/foundation-ci-divergence` tip (descended from 625301a), via `git show` if your worktree is stale. Decision required, read-only, no code: how do we PROVE meeting-audio durability on staging without ever invoking transcription? Constraints: the only current read-progression path (`app/api/bids/[id]/meetings/[meetingId]/source-mapping/route.ts` apply) resolves audio via `Meeting.audioStorageKey` (BlobStore) or legacy `cwd`-reconstruction and POSTs it to the sidecar — off limits. Candidates to adjudicate (add your own if better): (a) a read-only availability probe modeled on `lib/services/specbook/fileAvailability.ts`, backed by `lib/services/meetings/storagePath.ts`, surfaced on the meeting GET or a small admin endpoint; (b) extending the storage-smoke script family with a meetings step; (c) declaring availability provable only via new-upload rehearsal and documenting legacy rows as unknowable. Decide: exact mechanism, what it proves vs doesn't (storage presence ≠ lifecycle proof — the Ledger's claim rules apply), how legacy null-key rows are reported honestly, auth posture (admin-only?), and the acceptance evidence a Human staging run must capture. Deliver: a one-page decision note (ADR-lite) naming the chosen shape, the Sonnet implementation scope (files, tests), and the staging proof procedure — then stop. Do not implement. Do not touch live systems. Do not reopen Ledger §4 decisions.

---

## Adversarial self-review of this queue (authoring pass + 2026-07-06 dependency-lock pass)

Authoring pass: (1) the chain executes with no rediscovery — every needed fact is in a card or Ledger §9. (2) No card lets a model touch a live system. (3) Q02 strictly precedes Q03 (columns before code). (4) Fixture CLI never runs pre-Q01. (5) Meetings cards cannot trigger transcription. (6) Rollback exists at every live step (repin / journal-reverse / restore). (7) No card contradicts the Ledger's prohibited claims.

Dependency-lock pass (resolved ambiguities, binding):
- **Q04 split:** Q04a (Sonnet, local adapter — operator-plane code, no image needed, merged before Q03 anyway so tooling SHA == deployed SHA) and Q04b (Human staging run from a host checkout, NOT docker exec). Ledger §4.11 records the tooling-plane decision.
- **Q06 split:** Q06a (Sonnet, local — route suppression gates are APP code and MUST precede the Q03 build; smoke helpers ride along) and Q06b (Human runs). This was the one true image-ordering bug in v1: v1 allowed Q06's route-gate work to land after the build it had to be inside.
- **Q02 checkpoint:** same-day Turso staging checkpoint required (artifact + identifier recorded); restore PROOF required only before production (Q08 before Q09/Q10); no checkpoint ⇒ Q02 does not run and the chain halts (Ledger §7a).
- **Code-before-image sweep:** every code-changing card in the first chain (Q01, Q04a, Q06a) now precedes the Q03 build; Q07's implementation is explicitly a later, separately-approved redeploy; Q12/Q13 and any post-Q07 code target that same later build. Migrations (Q02) precede the only image that references their columns (Q03); the pinned old image tolerates the additive columns, so there is no window where code outruns schema.
- **Hidden-dependency audit of the first chain (Q01→Q09):** no production access before Q09 (which is itself the explicit unfreeze); all credentials (staging DATABASE_URL, admin session cookie, env files) are handled exclusively inside Human-owned cards — no model card requires any credential; no provider calls anywhere in the chain (suppression asserted where uploads could fire automation; readiness checks are read-only); no manual DB edits anywhere (all writes via the gated migration runner, gated fixture CLI, or gated backfill apply).

Residual accepted risks: Q05's in-container ergonomics (image may lack `scripts/`+tsx — sanctioned host-checkout fallback documented); Q09's real counts may invalidate Q10's assumptions (why Q10 is a decision branch, not a plan).
