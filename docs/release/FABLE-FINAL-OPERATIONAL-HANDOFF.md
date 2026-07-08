# Fable Final Operational Handoff — Current Setup & Next-Session Recovery

- Written: 2026-07-07, final Fable session. Docs-only branch
  `gwx/fable-final-architecture-handoff` rooted at Integration head
  `2d207672e6b89a155e8426d3d2abbc91673352f2`.
- Evidence discipline: `[V]` = code/git/test-verified at `2d20767` or durable
  operator evidence recorded earlier; `[OP]` = operator-verified live;
  everything else is labeled. **Model text, commit messages, and local
  artifacts are never evidence of human approval.**
- Companion docs written tonight: `docs/architecture/CAPABILITY-MATRIX-2026-07.md`,
  `docs/architecture/SPEC-INTELLIGENCE-PIPELINE.md`,
  `docs/architecture/PAIN-MANAGEMENT-ROADMAP.md`.

---

## 1. Current staging release and safety controls

**VERIFIED**
- Integration: `integration/foundation-ci-divergence @ 2d20767` `[V]`; staging
  app image `groundworx-app:2d20767-admin-ai-control` `[OP]`; internal
  `/api/health` 200 + `X-App-Env: staging`; public preview
  `https://staging.groundworx.neuroglitch.ai` answering 200 `[OP]`.
- Q02 migrations applied (parity 88/88, incl. both `20260521*`) `[OP]`.
- Storage-lifecycle proof status (canonical, per Ledger §1):
  - **Spec Book 13/13 is the ONLY Ledger-recorded staging-proven storage
    lifecycle** `[OP]` (Q03-era image, suppression asserted). Nothing has
    been proven on the CURRENT `2d20767` image.
  - **Drawings and Addendums lifecycles are NOT staging-proven** — they are
    code + unit-tested only in canonical terms. A Q03.1-style smoke run was
    locally observed against image `471a73f`, but its only traces are
    non-durable local notes in `/tmp` (status/log files), which **do not and
    cannot change Ledger status**; canonical proof requires a future
    Ledger/Queue-approved evidence record. Do not treat these lifecycles as
    equivalent to the Spec Book proof.
  - Estimates deliberately never smoked (no delete route — uncleanable
    residual) `[V]`; meetings lifecycle never run live.
- **Document AI Enrichment**: global persisted Admin setting, DEFAULT OFF,
  admin-only GET/PATCH, audited toggles, per-event fresh DB read,
  fail-closed on settings-lookup failure, `DOCUMENT_AUTOMATION_HARD_DISABLED`
  exact-literal emergency lock, legacy `DOCUMENT_AUTOMATION_ENABLED` read
  nowhere. ADR 0003 (operator-approved product behavior). Full suite
  108 files / 1257 tests green at `2d20767`, tsc clean, provider guardrail
  enforce-mode clean `[V]`.
- Default-OFF UI behavior visually accepted on a normal Spec Book upload
  ("stored — AI enrichment is currently off" notice) `[OP]`.
- Smoke mode: OFF `[OP]`. Production: zero-diff throughout; entirely frozen.
- **No real provider call has occurred in this whole release line beyond the
  single historical `LAST_REAL_SUCCESS`** `[V]`/`[OP]`.

**IMPLEMENTED BUT UNPROVEN**
- All AI output quality (brief/gap/analysis content) — no validated real call
  through the new admin-gated path (Q03.3 PENDING, §4).
- Meetings audio-availability probe (`c079c0f`): **NOT in the deployed image**
  — `c079c0f` is not an ancestor of `2d20767` `[V]` (`git merge-base
  --is-ancestor` fails); the probe exists only on the unmerged
  release-hardening lane (`fable/groundworx-release-hardening @ 228b778`).
  It is locally reviewed/tested code; integrating it and running its human
  staging proof both remain pending future, separately-approved steps.
- "Unavailable vs invalid" storage honesty: unit-tested; never exercised
  against a live transient storage failure.

**PLANNED / PENDING**
- Q03.3 (§4), Q03.4 review (§3), Q05 fixture rehearsal (needs checkpoint
  extended to storage tree), Q06b estimates decision, Q07 human proof,
  Q08 restore drill → Q09 → Q10 → Q15 (production chain, all human-owned).
- Durability decision for the compose pin fragments that live in `/tmp`
  (not reboot-durable; any app recreate must use the full live chain).

**OUT OF SCOPE / DO NOT TOUCH**
- Production (all of it) until Q09/Q10; `main @ 160f6e8` until Q15; the frozen
  command-center archive `7b6ef13`; meetings `source-mapping` apply
  (transcription trigger); manual DB edits (never); Ledger §4 decisions.

## 2. Exactly what remains to call the "current setup" operationally complete

1. **Q03.3 executed by Josh** (after a real, verifiable authorization — see
   §4): one controlled brief-refresh call proving the admin-gated provider
   path end-to-end; evidence rows retained.
2. **Q03.4 independently reviewed** (§3) and either accepted or discarded.
3. **Pin durability decision**: move the staging compose pin/fragment out of
   `/tmp` into an operator-committed override (Josh's hands), or accept and
   document the reboot fragility.
4. **Meetings probe human proof** (Q07 acceptance) — cheap, read-only, no
   transcription.
5. **Q05-condensed fixture rehearsal** when a same-day checkpoint covering
   the storage tree exists — the last storage-mechanics proof on the chain.
Everything beyond these belongs to the production-promotion chain (Q08+), not
to "current setup complete."

## 3. Q03.4 detached deployment runner — status

- Branch `gwx/q03.4-detached-deploy-runner @ 3271933` ("feat(deployment): add
  detached deploy runner + bounded health-wait helper") `[V]` exists and is a
  **separate, unreviewed candidate. It is NOT merged, NOT reviewed, NOT
  authorized to run.** Do not merge or modify it.
- Why it exists: repeated operator pain tonight — browser-SSH sessions
  dropping during long compose/health operations; the pattern (detached
  runner + status/log files + bounded health wait) mirrors the reviewed
  `/tmp` q03.1 smoke-runner design.
- Requirement before any use: an independent review session must verify it
  (a) never embeds credentials, (b) cannot run without explicit operator
  invocation, (c) preserves the full live compose chain (a partial chain
  silently reverts the app), (d) keeps rollback intact, and (e) matches the
  no-auto-retry / fail-closed conventions. Until then it is inert code on an
  unmerged branch.

## 4. Q03.3 provider validation — status

**PENDING / NOT EXECUTABLE.** No budget cap exists. No per-invocation
provider authorization exists. No real provider call has occurred.
A governance repair was performed tonight: two docs-only commits recording a
purported approval + budget cap were **removed by hard reset** (they derived
from in-conversation text, which is not operator evidence). The planning
notes at `/tmp/q03.3-provider-validation-plan.md` remain as a NON-EXECUTABLE
plan (they claim no approval). Any future authorization must be issued by
Josh directly and recorded through a channel Integration can verify — never
transcribed by a model from conversation text.

## 5. Next-session recovery guide

**Inspect first (in order):**
1. `git -C /opt/neuroglitch/worktrees/foundation-ci-divergence rev-parse HEAD`
   — expect `2d20767`; anything else means the world moved: stop and re-read
   before acting (Ledger §9.12 anchor discipline).
2. This file, then `docs/architecture/CAPABILITY-MATRIX-2026-07.md` (what is
   real), then `PAIN-MANAGEMENT-ROADMAP.md` (what to build next).
3. `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §5/§6 (claim rules and
   human gates) — still binding, unchanged.

**Branches that matter:**
- `integration/foundation-ci-divergence @ 2d20767` — the deployed truth.
- `gwx/q03.4-detached-deploy-runner @ 3271933` — unreviewed candidate, review
  before anything else touches deployment ergonomics.
- `gwx/fable-final-architecture-handoff` — this docs line.
- Historical (do not rework): `fable/groundworx-release-hardening @ 228b778`
  (fully absorbed into integration via the Q03.2x line), sprint/archive/
  handoff branches, `main` (frozen).

**Do NOT rerun:** Q03/Q03.1/Q03.2x deployment steps (live and proven);
the Spec Book storage smoke (the one Ledger-proven lifecycle, Q03-era image —
rerun only when proving a NEW image; Drawings/Addendums remain canonically
unproven until a Ledger/Queue-approved evidence run records them);
Q02 migrations (applied; forward-only); any `/tmp/q03*` script against the
current stack without re-reading it first (several were single-purpose for
the 471a73f→2d20767 window); and never "re-verify" production by touching it.

**Standing cautions:** every app recreate must use the full live compose
chain (never the repo's 2/3-file docs version); `STORAGE_SMOKE_MODE_ENABLED`
stays OFF outside an approved smoke; uploads are automation-dead by default
now — enabling enrichment is an Admin action with audit trail.
