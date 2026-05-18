# infra/ — DEPRECATED

**Status:** deprecated by Phase R1 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`. Authoritative replacement: `construction-dashboard/runtime/`.

## Why deprecated

The single-repo runtime governance decision (see `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` and `Migration/ARCHITECTURE_V1`) consolidates all infrastructure-as-code and operator procedures into `runtime/`. This folder previously held an ad-hoc deploy runbook and is being subsumed:

| File | Status | Replacement |
|---|---|---|
| `deploy-runbook.sh` | Inline shell script with deploy steps. Useful as historical reference; not maintained. | `runtime/runbooks/deploy-prod.md` and `runtime/runbooks/deploy-staging.md` (Phase R2 skeleton, Phase R7 real); `runtime/deployment/deploy-prod.ps1` for the laptop-side orchestration (Phase R4 stub, R7 real) |

## Not authoritative

- This folder is **not** the source of truth for any production behavior.
- The file `deploy-runbook.sh` here is preserved as a historical reference for the manual deploy steps that operators have used. It is not invoked by any current deploy tooling.

## Do not use

- Do not add new files to this folder.
- Do not edit `deploy-runbook.sh` — write the new procedure as a runbook in `runtime/runbooks/` and a script in `runtime/deployment/`.
- Do not source `deploy-runbook.sh` in any new automation.

## Removal

Removal is deferred to **Phase Z** of the workspace normalization plan, executed after `runtime/` has been authoritative across at least three successful deployments. Until then, this folder remains in place as an inert sentinel.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 (Phase R1, Phase Z) and §8 (migration mapping).
- `Migration/ARCHITECTURE_V1` revised — single-repo runtime decision.
