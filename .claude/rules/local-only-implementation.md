# Rule: Local-Only Implementation

Binding for every model (Sonnet/Haiku builder or verifier) session doing code
work.

- **Scope = one queue card.** Work exactly the card's Allowed list; its
  Forbidden list and Stop condition are full stops — report, don't improvise
  or "helpfully" widen scope. New sessions per card.
- **Anchor first (Ledger §9.12):** `git rev-parse HEAD` before reading
  anything. Fresh worktrees may sit at `main` (`160f6e8`), which predates all
  GroundWorX work. If stale, re-anchor to the card's stated tip or read via
  `git show <sha>:<path>`. Record the anchored SHA in your report.
- **Local means local:** editing code, running unit tests (`npx vitest run
  <target>`), running static analysis, and committing to your own branch. It
  does NOT include: Docker/Compose, HTTP requests, staging/production URLs,
  Turso or any real DB, migrations, env-value inspection, provider calls,
  installing global tooling, or `git push` without explicit instruction.
- **Tests use fakes:** the in-memory adapters and mocked-Prisma patterns
  already in the repo are the template. Never point a test at a real DATABASE_URL;
  never weaken a gate (confirm phrase, journal requirement, report-only
  default, APP_ENV fence, suppression pattern) to make a test pass.
- **Branch + commit hygiene:** branch off the card's stated tip; conventional
  commit message; trailer `Co-Authored-By: NeuroGlitch AI Engine
  <ai@neuroglitch.dev>`; never commit `.claude/settings.local.json`, env
  files, journals, or anything containing real paths/data.
- **Deliverable = diff + evidence:** the commit, the exact test commands with
  their summary lines, and an explicit list of anything the card expected that
  you could not verify locally (labeled UNKNOWN, not glossed).
- **If your card seems to require a live resource, the card is telling you to
  stop** — that work belongs to a Human card. Report the boundary you hit.
