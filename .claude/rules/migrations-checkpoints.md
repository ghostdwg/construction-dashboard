# Rule: Migrations & Checkpoints

Binding for any task that touches `prisma/`, migrations, schema, or backups.

- **Forward-only.** No down-migrations exist anywhere; never author one.
  Recovery is forward-fix or PITR/checkpoint restore (Ledger §4.7).
- **One runner.** Migrations apply ONLY via `scripts/apply-turso-migrations.mjs`
  (tier-fenced, atomic per-migration batch, exit 2 = partial = full stop, no
  retry). Never Prisma CLI against a real DB, never auto-migrate on boot,
  never any other mechanism. Models never run it against staging/production.
- **Checkpoint before any staging DB mutation** (Ledger §7a): a same-day Turso
  checkpoint/PITR point, identifier recorded, is required before Q02-class
  work. No checkpoint ⇒ the card does not run and the chain halts. Never
  proceed "because it's only additive."
- **Restore PROOF before production:** an actually-executed restore drill
  (GWX-Q08) must be green before any production work (Q09/Q10). Staging =
  checkpoint-required; production = restore-proof-required.
- **The two pending staging migrations** are exactly
  `20260521020000_addendum_meeting_storage_keys` and
  `20260521030000_background_job_dedupe_key` — both additive/nullable, apply
  order lexicographic. Do not re-derive this (Ledger §9.6).
- **New schema changes** require an explicit queue card that says so; no card's
  local scope implies schema license.
- **No manual DB edits, ever** — not to unblock a rehearsal, not to clean up a
  fixture, not "just one row." All writes go through the gated runner, gated
  fixture CLI, or gated backfill apply.
