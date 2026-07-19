# R2 real-SQLite concurrency certification

A committed, reusable, **independent** certification target that reproduces the
strongest real-SQLite concurrency evidence used to validate the repaired
GroundWorX R2 SOL candidate — the "11/11 real-SQLite cases" originally produced
by the disposable harness
`lib/services/meetingRegister/__tests__/realSqliteConcurrency.test.ts` during
the targeted-blocker-repair and final-candidate-convergence sessions.

It runs **only** against a disposable, byte-exact reconstruction of the R2 final
convergence candidate (fingerprint `1514fd2a…`) under `/tmp`. It never needs
staging, production, Turso, the network, credentials, or real project data.

## Why this lives outside the normal test tree

The 11 cases exercise the **repaired** product code (the SQLite-contention
normalization in `retention.ts`, the reconciling `failJob`, the upload/analyze
route contracts). That repaired code does not exist in this branch's base tree —
it lives in the SOL working tree, folded into the convergence candidate. So:

- The test is committed as `realSqliteConcurrency.cert.ts` (**not** a
  `.test.ts` file) → this repo's Vitest (`vitest run`) never collects it, and
  `tests/certification/**` is excluded from base `tsc`/ESLint.
- The runner copies it INTO the reconstructed candidate as a `.cert.test.ts`
  file, adds the case-7 job-lock worker, and runs it where the repaired code and
  a migrated SQLite database exist.

This keeps the base branch green while certifying code that only exists in the
candidate.

## Invoke

```bash
npm run certify:r2-concurrency
```

Exit code is `0` only if **all 11 cases pass in every run** and the normalized
evidence is **identical across runs**. Nonzero means a failed case (`1`), a
fatal setup error (`2`), or a candidate-fingerprint mismatch / evidence gap
(`3`).

### What a run does

1. **Reconstruct** the exact candidate under `/tmp` via `assemble.sh` (base
   `9b283b9` + schema-recon `a9f51fc` + PRAGMA repair `6da1fff` + the SOL
   worktree's tracked diff + regression pack `29f141b` + refresh `59960cc` +
   SOL untracked files). All source worktrees are read-only.
2. **Verify** the candidate fingerprint equals the pinned
   `1514fd2aecf99675d252089bce10b90af8a3b990742e4e5daf6d1f5e967e7760`. Any
   mismatch is refused as an evidence gap — the gate only ever certifies the
   exact convergence target.
3. **Provision** `node_modules` by hardlink-copy from the repaired worktree
   (SOL is never mutated; the generated Prisma client dirs are deep-copied and
   regenerated for the reconciled schema).
4. **Replay migrations** into a disposable template DB (`prisma migrate deploy`,
   all 101 migrations).
5. **Run each of the 11 cases in its own Vitest process** against a fresh copy
   of the migrated template — per-case isolation, matching the prior evidence,
   so a deliberately timed-out raw client cannot poison later connections.
6. Repeat for a strict positive-integer `GWX_R2_RUNS` (default 2), require at
   least one complete run, and require byte-identical normalized evidence.
7. **Delete every database, generated client, overlay, worker, and the whole
   `/tmp` working tree** through structured failure handling.

When `GWX_R2_CANDIDATE_DIR` is supplied, the runner hashes its complete
path/content/mode manifest, verifies the pinned Git index fingerprint, and
materializes that index with `git checkout-index` into a private runner-owned
candidate. All dependency provisioning, generated clients, overlays, databases,
caches, and evidence remain outside the supplied directory. The full manifest
is compared after snapshot creation and again after execution; any change is a
configuration failure.

### Environment overrides

| Var | Default | Meaning |
|---|---|---|
| `GWX_R2_SOL` | the known SOL worktree path | repaired worktree read for assembly + node_modules |
| `GWX_R2_CANDIDATE_DIR` | *(unset)* | verify a pre-assembled candidate, then certify a private `checkout-index` snapshot |
| `GWX_R2_RUNS` | `2` | strict positive integer number of complete suite runs |
| `GWX_R2_KEEP` | *(unset)* | `1` retains the `/tmp` working tree for debugging |
| `GWX_R2_EVIDENCE_OUT` | *(unset)* | write the normalized evidence blob to this path |

## The 11 cases

The authoritative inventory — behavior, competing operations, database state,
expected winner/loser, expected rows, audit/history, retry/conflict, and prior
evidence location — is in [`cases.json`](./cases.json). Summary:

| # | Area | Certifies |
|---|---|---|
| 1 | meeting materialization vs source | history-first commits; racing source claim is `frozen`, no partial mutation |
| 2 | blob/source ownership vs 5 history writers | all five protected writers refused `source-mutation`, zero rows |
| 3 | lease ownership (concurrent CAS) | exactly one winner, one no-op loser, no torn state |
| 4 | raw engine contention control | SQLITE_BUSY/timeout **or** wait-and-commit — no partial commit either way |
| 5 | stale lease recovery | ownership lost before commit → `state-conflict`, pointer unchanged |
| 6 | concurrent BackgroundJob claim | two armed reservations share a start barrier; exactly one wins, one loses uniqueness; slot is reusable after failure |
| 7 | duplicate-processing / idempotency | child-held lock plus an observed retry timer proves real `failJob` retry entry and idempotent convergence |
| 8 | media job idempotency | provider id reconciled + slot released after ownership loss |
| 9 | attachment/blob-reference safety | real upload route → 503 before egress; prior blob survives; ordered started/failed audits and job-tracking payload persist |
| 10 | analysis transaction conflict | real analyze route → 409 before provider egress; state unchanged |
| 11 | terminal reconciliation | successful provider linkage preserves provider ids across running→failed |

## Determinism note (case 4)

The determinism gate hashes the per-case **pass/fail matrix**, which is
engine-deterministic. Case 4's raw-engine branch (whether the contender waits
and commits or hits `SQLITE_BUSY`) is genuinely engine-nondeterministic; the
test asserts the invariant that holds in **both** branches (holder wins, no
partial commit), and the volatile branch text is deliberately excluded from the
hash.

Cases 1, 3, 4, 6, and 7 execute live competing operations. Cases 2, 5, 8,
9, 10, and 11 use deterministic durable-state handoffs and do not claim live
overlap. Cases 1 and 4 resolve their in-process barrier only after lock
acquisition; their timer releases an already-established contention window.
Case 6 uses a shared start barrier after both contenders are armed. Case 7 uses
child-process IPC and an observable fake-timer event barrier, so it fails if the
product retry branch is removed.
