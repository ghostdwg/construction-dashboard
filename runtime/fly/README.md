# runtime/fly/

**Dormant alternate deploy plane.** Fly.io app and sidecar configs are preserved here for optionality. They are **not** the production deploy path.

## Status (Phase R1)

**Empty.** `fly.toml` and `fly.sidecar.toml` currently live at the repo root, not yet in this folder.

## Planned contents (Phase R4)

```text
fly/
├── README.md                                 # this file
├── fly.toml                                  # moved from repo root in Phase R4
├── fly.sidecar.toml                          # moved from repo root in Phase R4
└── .github-workflows-deploy.yml.example      # the Fly deploy workflow, parked
```

The `.github/workflows/deploy.yml` file currently lives at `.github/workflows/deploy.yml` in the repo and references Fly. Phase R4 either parks it in this folder as an example artifact (preferred) or removes it (only if production is committed exclusively to the self-hosted plane).

## Why preserved

The currently-running production runtime is **self-hosted Docker Compose on `superglitch`**, not Fly (see `Migration/Production Runtime Assessment.txt` §1, §3 and `Migration/ARCHITECTURE_V1` §3). Fly remains available as an alternate plane in case:

- The self-hosted host degrades and a temporary public deploy is needed.
- Cost or operational pressure favors a managed plane.
- A specific subsystem (sidecar, worker) is decoupled and deployed independently.

Preservation is cheap. Activation is a separate, explicit operator decision.

## Why NOT removed

Deleting Fly configs would be destructive of optionality. The cost of keeping them — a few kilobytes of TOML and a parked workflow file — is negligible. The cost of resurrecting them from Git history later would be operationally annoying. Defer the deletion decision to whenever the self-hosted plane has been canonical for ≥ 6 months without incident.

## Do not use

- Do not deploy from Fly today. The production app names `neuroglitch-app` and `neuroglitch-sidecar` exist as registered Fly entities, but they are NOT the live deploy target.
- Do not run `flyctl deploy` without explicit operator approval.
- Do not modify these configs without a corresponding decision recorded in `planning/`.

## Canonical references

- `Migration/ARCHITECTURE_V1` §17, §9a — deployment boundaries; Fly's dormant status.
- `Migration/Production Runtime Assessment.txt` §1 — actual production substrate.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 R4 — Fly relocation step.
