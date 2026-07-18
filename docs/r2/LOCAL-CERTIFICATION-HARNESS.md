# R2 Local Certification Harness — Operator Runbook

**Branch:** `gwx/r2-local-certification-harness` · **Base:** `9158b4b`

## Purpose

A reusable, deterministic, **local-only** certification package that proves
the GroundWorX R2 Meeting-to-Response Control Loop's lifecycle compatibility
across currently IMPLEMENTED capabilities, FIXTURE_SIMULATED capabilities,
and the frozen future Build 3 contract — without staging, production,
provider credentials, live project data, customer information, manual
screenshots, external AI services, a live WhisperX worker, AssemblyAI, or a
live Turso database.

It exists because active GroundWorX R2 capabilities are spread across
several independent branches and the Codex SOL integration lane is
temporarily paused (usage-limit issue). This harness gives a repeatable local
certification package that can be rerun against the approved integrated
branch later, without waiting on that lane.

**This harness does not implement Build 3 production behavior.** Everything
from "response package" onward in the lifecycle below is a labeled,
in-memory simulation of the frozen contract — never a production
reimplementation, never imported by application code.

## Supported lifecycle

```
Meeting → transcript/minutes → Meeting Register → Tracked Item →
Consultant/Field Observation → trade grouping → response package →
contractor response → GC review → compiled response → transmittal →
originator disposition → revise-and-resubmit/accepted → closure eligibility →
closure record → reopening
```

See `docs/r2/R2-LIFECYCLE-CAPABILITY-MATRIX.md` for the full per-stage
capability matrix (status, implementation source, fixture source, scenario
coverage, provenance/authorization/audit expectations, known blockers).

## Prerequisites

- Node.js + npm (already required by the repo).
- `npm ci` (or equivalent) to install dependencies.
- `npx prisma generate` once, so `@prisma/client` types resolve for
  `tsc`/`vitest` module imports — this generates TypeScript types from
  `prisma/schema.prisma` only; it does **not** connect to any database.
- No environment variables, no `.env` file, no credentials, no running
  services (no dev server, no sidecar, no Docker).

## Exact run command

```bash
npm run certify:r2-lifecycle
```

Equivalent direct form: `node scripts/certification/run-r2-certification.mjs`.

To run only the underlying test files directly (bypassing the summary
script):

```bash
npx vitest run tests/certification/r2-lifecycle/
```

## Expected runtime

Under 5 seconds on a typical developer machine (30 in-memory assertions
across 26 required scenarios plus 2 infrastructure checks — no I/O, no
network, no process spawned other than `vitest` itself).

## Expected output

A banner, a scenario-by-scenario `[PASS]`/`[FAIL]`/`[MISSING]` table for all
26 required scenarios with their capability label (`IMPLEMENTED`,
`FIXTURE_SIMULATED`, `HARNESS DETERMINISM`), an infrastructure-checks section
(network isolation, forbidden-import static scan), a total count, and a
final `CERTIFICATION RESULT: PASS` or `CERTIFICATION RESULT: FAIL` line. Exit
code is `0` on full pass, nonzero otherwise (the underlying `vitest` exit
code is propagated when it produced no usable output; otherwise `1`).

## Local database behavior

- **Database type:** none. This harness uses an **in-memory substitute**
  (plain TypeScript objects/arrays inside
  `tests/fixtures/r2-lifecycle/responsePackageSimulator.ts` and the existing
  `tests/field-response-certification/unit-integration-builders.ts`), not a
  real Prisma client, not a SQLite file, not `@prisma/adapter-libsql`.
- **Why not a real local SQLite file**, even though the repo's Prisma
  datasource is SQLite-backed and `vitest.setup.ts` already defaults
  `DATABASE_URL=file:./test.db`: two independent reasons make a real DB the
  wrong choice here, not merely an inconvenient one.
  1. The Build 3 models this harness must exercise
     (`ResponsePackage`/`CompiledResponse`/`Transmittal`/
     `OriginatorDisposition`/`ResponsePackageClosureRecord`) **do not exist
     in `prisma/schema.prisma` on this branch** — they live only on the
     untouched `gwx-sol-r2-ledger-integration` worktree and the Build 3
     contract freeze. A real local DB literally cannot represent the full
     lifecycle regardless of effort spent wiring one up.
  2. `.claude/rules/local-only-implementation.md` is explicit: *"Tests use
     fakes: the in-memory adapters and mocked-Prisma patterns already in the
     repo are the template. Never point a test at a real DATABASE_URL."*
     Every existing test in this repo that touches `TrackedItem`,
     `ConsultantObservation`, etc. mocks `@/lib/prisma` (see
     `app/api/bids/[id]/tracked-items/__tests__/routes.test.ts` for the
     idiom this harness's real-service tests — scenarios 8 and 9 — follow).
- **Location:** nowhere on disk. Nothing is created, nothing is deleted.
- **Creation command:** N/A.
- **Seed mechanism:** each scenario builder in
  `tests/fixtures/r2-lifecycle/scenarioBuilders.ts` calls its own reset
  (`resetIds`, `resetMeetingIds`) before constructing fixtures, and uses a
  fixed injected clock — this is the harness's deterministic-setup
  equivalent of a seed script.
- **Teardown mechanism:** none needed (nothing persists past process exit).
  The one artifact the *runner script* itself creates —
  `.r2-certification-result.json`, `vitest`'s JSON report — is deleted both
  before it runs (never trust a stale prior file) and after it parses the
  report. That double-delete is this harness's deterministic-cleanup step.
- **Transaction behavior:** simulated only. `responsePackageSimulator.ts`
  models "audit write inside the mutation's transaction, rollback on
  failure" (contract §11) by calling the injectable audit sink *before*
  committing any state change within a single synchronous method body — see
  scenario 14.
- **Foreign-key enforcement:** N/A (no real DB). Cross-object integrity
  (tenancy, uniqueness, membership) is enforced by explicit guard code in the
  simulator and in the real service functions it reuses, not by a database
  constraint layer.
- **Migrations:** not required, not simulated, not applied. No schema on
  this branch changes for this harness (constraint: "do not modify Prisma
  schema").

## Network isolation

`tests/certification/r2-lifecycle/network-isolation.test.ts` proves this two
ways:
1. Replaces `globalThis.fetch` with a throwing stub, runs every
   FIXTURE_SIMULATED scenario builder, and asserts the stub was never
   called.
2. Statically scans every file in `tests/fixtures/r2-lifecycle/` (the code
   that actually executes on a certification run) for import specifiers
   matching the two sanctioned AI gateways, AssemblyAI, WhisperX,
   `@libsql/client`, `@prisma/adapter-libsql`, Resend, or Nodemailer, and for
   literal `new PrismaClient(` construction. Zero matches allowed.

No real API keys are used anywhere in this harness. `vitest.setup.ts`'s
test-only placeholder env values (`sk-ant-test-only`, etc.) satisfy
`lib/env.ts`'s Zod parse at import time for unrelated modules the test
runner transitively loads — this harness never reads or forwards them.

## Scenario descriptions and capability labels

See `docs/r2/R2-LIFECYCLE-CAPABILITY-MATRIX.md` for the authoritative table.
Quick index (file : scenarios):

| Test file | Scenarios | Labels present |
|---|---|---|
| `disposition-outcomes.test.ts` | 1-6 | FIXTURE_SIMULATED, one IMPLEMENTED-underlying (3) |
| `provenance-and-rejection.test.ts` | 7, 8, 9, 10, 23 | FIXTURE_SIMULATED (7, 10, 23) + IMPLEMENTED (8, 9) |
| `rerun-and-determinism.test.ts` | 11, 12, 13, 20, 21, 22 | HARNESS DETERMINISM (11, 12, 20) + FIXTURE_SIMULATED (13) + IMPLEMENTED (21, 22) |
| `closure-and-reopening.test.ts` | 15, 16, 17, 18, 19 | FIXTURE_SIMULATED |
| `audit-and-safety.test.ts` | 14, 24, 25, 26 | FIXTURE_SIMULATED |
| `network-isolation.test.ts` | (infrastructure, not numbered) | proves section-G requirements |

**IMPLEMENTED** means the assertion exercises real, unit-tested production
code (via the repo's mocked-Prisma idiom) — a genuine (if narrow) proof.
**FIXTURE_SIMULATED** means the assertion exercises
`responsePackageSimulator.ts`, an in-memory model of the *frozen* Build 3
contract — it proves the contract's own rules are internally consistent and
exercisable, and gives a byte-identical target for a future real
implementation to be checked against. It proves **nothing** about production
Build 3 code, because no such code exists yet on this branch.
**HARNESS DETERMINISM** means the assertion proves a property of this
certification harness itself (repeatable ids/order/output across runs), not
of any application capability.

## Interpreting failures

- A **FIXTURE_SIMULATED** scenario failing means either the simulator has a
  bug relative to the frozen contract, or a scenario builder mis-drives the
  simulator's state machine — fix the harness, not application code (there
  is no application code to fix at this layer).
- An **IMPLEMENTED** scenario failing (8, 9, 21, 22, or scenario 3's
  underlying-fixture assertion) means a real regression in
  `lib/services/trackedItems/` or `unit-integration-builders.ts` — treat it
  as a genuine product-code finding and follow
  `.claude/rules/verification-evidence.md`'s evidence discipline (do not
  silently "fix and re-run"; report it).
- A **MISSING** row in the runner's summary means a scenario's describe
  block title doesn't start with the expected `"Scenario N — "` prefix —
  check for an accidental rename before assuming a real failure.
- The `network-isolation.test.ts` failing on the "no forbidden imports"
  check means a harness source file under `tests/fixtures/r2-lifecycle/`
  started importing something it shouldn't — this must be fixed before any
  other result is trusted, because it invalidates the "no network access"
  and "no credentials" guarantees this harness exists to prove.

## Rerunning after an integrated-branch change

This harness was built to be re-pointed at the approved integrated branch
(once the SOL lane resumes and Build 3 packets B3-P1 onward land) with
minimal changes:

1. Re-verify `docs/r2/R2-LIFECYCLE-CAPABILITY-MATRIX.md` rows currently
   marked FUTURE_CONTRACT/FIXTURE_SIMULATED against the integrated branch's
   actual schema — promote any row that now has real Prisma models to
   IMPLEMENTED.
2. For each promoted row, replace the corresponding
   `responsePackageSimulator.ts` calls in the affected scenario builder with
   calls to the real service (mocked-Prisma pattern, as scenarios 8/9
   already demonstrate) — do not delete the simulator until every scenario
   that used it has a real-service replacement, so scenario coverage never
   silently drops.
3. Resolve the two B3-P0 conflicts (`DEFER`, `VOID` — see the capability
   matrix) with an explicit human/Fable decision before wiring real
   disposition-recording routes.
4. Re-run `npm run certify:r2-lifecycle` twice and diff the scenario-summary
   output — it must still be identical run-to-run (this harness's own
   determinism guarantee, scenarios 11/12/20, must survive the swap).

## Extending the harness

- New scenarios: add a builder function to
  `tests/fixtures/r2-lifecycle/scenarioBuilders.ts`, a test in the
  thematically-closest `tests/certification/r2-lifecycle/*.test.ts` file (or
  a new file, following the `describe("Scenario N — ...")` naming
  convention so the runner script's summary picks it up), and a row in the
  capability matrix.
- New Build 3 contract sections: extend
  `tests/fixtures/r2-lifecycle/responsePackageSimulator.ts` — every method
  must cite the contract section it simulates in a comment, exactly as the
  existing methods do, so a future reader can audit simulator-vs-contract
  drift without re-reading the whole 900-line contract.
- Reused fixtures: always check
  `tests/field-response-certification/unit-integration-builders.ts` first.
  Do not duplicate a builder merely to rename it — import and compose.

## Known limitations

- The entire "response package" through "reopening" leg of the lifecycle is
  simulation, not production proof, because no Build 3 (or even Build 2
  trade-response) schema exists on this branch. See the capability matrix.
- Scenario 8 (cross-meeting provenance) and scenario 9 (duplicate Register
  promotion) are real production-code proofs, but narrow: they exercise
  `promoteMeetingActionItem` only, not the full route/HTTP layer (no
  `requireBidAccess` middleware, no session auth) — those are covered by the
  repo's existing route-level tests, not duplicated here.
- The `DEFER` and `VOID` legacy disposition values have no resolved Build 3
  mapping (B3-P0 conflict, human decision required) — any future scenario
  that needs them must wait on that decision, not invent one.
- This harness cannot and does not certify anything about staging,
  production, live Turso, real provider calls, or the SOL integration
  branch's actual state — those remain entirely out of scope by design.

## Prohibition on treating fixture-simulated behavior as production certification

**No result from this harness may be cited as proof that Build 3 (response
package → reopening) is implemented, staging-validated, or
production-ready.** Every FIXTURE_SIMULATED result proves only that the
*frozen contract itself* is internally consistent and that a future
implementation has a concrete, executable reference to be checked against.
Cite results using the exact labels in this document and the capability
matrix (`IMPLEMENTED` / `FIXTURE_SIMULATED` / `HARNESS DETERMINISM`) — never
paraphrase a FIXTURE_SIMULATED pass as "Build 3 works" or "the response loop
is certified."
