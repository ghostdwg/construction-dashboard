# Rule: Verification & Release Evidence

Binding whenever you state what works, write release/handoff text, or record
proof.

- **Claim discipline:** Ledger §5 is the whitelist/blacklist of release claims
  — quote it, don't paraphrase it looser. The complete staging-proven list is
  Ledger §1's table; everything else is at best "implemented and unit-tested,
  never exercised live."
- **Tag every fact** the Ledger way: `[V]` source/git-verified, `[OP]`
  operator-verified live, `[INF]` inference, `[DEC]` binding decision, `[UNK]`
  unknown. A claim you cannot tag `[V]`/`[OP]` with evidence is labeled, not
  asserted.
- **Evidence = artifact, not assertion:** exact command + exit code + summary
  line for tests; SHA + file path for source claims; timestamp + identifier
  for operator artifacts (checkpoints, journals, drill records). Journals and
  smoke outputs may contain real paths — store them as artifacts, never paste
  their contents into docs or chat.
- **A passing local suite proves local behavior only.** It never proves a live
  lifecycle, never proves human approval happened, and never upgrades an
  `[UNK]` to `[V]`.
- **Prohibited upgrades:** one HTTP 200 ≠ "AI features work"; storage-smoke
  green ≠ "lifecycle proven" for any non-specbook domain; code existing ≠
  "ready to run" (the backfill tool needed Q04a for exactly this reason);
  checkpoint taken ≠ restore proven.
- **Meetings durability-read is UNPROVEN and currently unprovable safely** —
  the read progression triggers transcription (sidecar POST). Do not design
  around this or claim it; the harness decision is GWX-Q07 (Opus).
- **Evidence SHA discipline:** evidence must never come from tooling newer than
  the running app (Ledger §4.11) — record the SHA alongside every result.
- **When a check fails:** report the failure verbatim and stop. No retry
  loops, no "fixed it and re-ran" inside a verify task.
