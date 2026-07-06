# Rule: Environments & Deployment Separation

Binding for any task that mentions staging, production, Docker, Compose,
images, containers, or deployment.

- **Three planes:** local (model-workable), staging (human-gated), production
  (frozen). `APP_ENV` is the tier discriminator — Zod-validated at boot,
  deploy-controlled, never request-derived (Ledger §4.8). Staging-only
  bypasses (storage smoke, fixture CLI) gate on it; never weaken those gates.
- **Models never** build/tag/pin/deploy images, recreate containers, restart
  services, edit compose files' live values, or run anything against a staging
  or production URL/DB. Drafting the command block for a human card is allowed;
  executing it is not.
- **Production is entirely frozen.** The first authorized production touch is
  GWX-Q09 (read-only inventory), human-executed, after GWX-Q08 restore proof.
  There are no exceptions, including "read-only just to check."
- **Image ordering:** migrations (Q02) strictly before the image build that
  references their columns (Q03). Every app-code card in the first chain
  (Q01/Q04a/Q06a) ships in the ONE Q03 build; later app code (e.g. Q07
  implementation) waits for a separately-approved redeploy — never smuggled in.
- **Rollback:** staging image rollback = repin previous tag
  `e41b027-storage-smoke-failclosed` (safe: pending migrations are additive/
  nullable). Data rollback = journal reversal first, DB restore last resort.
- **Operator-plane tooling (Ledger §4.11):** the inventory/backfill CLI and
  migration runner run from a host checkout at the pinned SHA with
  operator-supplied env — never from inside app images, never by a model.
  The fixture CLI is the documented exception (its own header governs).
- **Deployment stubs:** every `runtime/deployment/*.sh|.ps1` prints a plan and
  exits — do not "fix" them into live executables; that design is deliberate.
