# runtime/fly/

**Dormant alternate deploy plane.** Fly.io app and sidecar configurations preserved here for historical and optional-future-use reference only. **Not the active production deploy path.**

## Status (Phase R4)

`fly.toml` and `fly.sidecar.toml` have been moved into this folder from the repo root (`git mv`, history-preserving). The files exist; the deploy plane they describe is dormant.

```text
runtime/fly/
├── README.md           this file
├── fly.toml            App config (Fly app: neuroglitch-app, region: ord, port 3000)
└── fly.sidecar.toml    Sidecar config (Fly app: neuroglitch-sidecar, port 8001)
```

The `.github/workflows/deploy.yml` workflow still references these files (paths updated in Phase R4 to `runtime/fly/fly.toml` and `runtime/fly/fly.sidecar.toml`). The workflow is dormant in practice — it would deploy to the `neuroglitch-app` and `neuroglitch-sidecar` Fly entities, which are registered but unused.

## Why this lives in the active app repo (not deleted)

1. **Optionality.** If the self-hosted production host (`superglitch`) ever degrades and a temporary public deploy is needed, Fly remains a one-`flyctl deploy`-away fallback.
2. **History preservation.** `git mv` retains file history. Deleting and recreating later would lose lineage.
3. **Small footprint.** The two TOML files are a few kilobytes. Storage and indexing cost is negligible.
4. **Documentation of past architectural intent.** The Fly configs encode a deploy plane that was once seriously considered. Future operators understand the repo better by seeing what's been kept.

## Why this is NOT the active runtime

Per `Migration/Production Runtime Assessment.txt` and `Migration/ARCHITECTURE_V1`:

- The active production runtime is **self-hosted Docker Compose on host `superglitch`** (Linux, Tailscale `100.87.4.85`).
- Compose project: `neuroglitch`. Single file at `/opt/neuroglitch/docker-compose.yml`.
- Edge: a single Caddy 2 container terminates TLS for four `*.neuroglitch.ai` hostnames.
- The Fly apps `neuroglitch-app` and `neuroglitch-sidecar` are registered but the live production traffic does NOT flow through them.

## Activating Fly would require

(For documentation only — do not do this without architectural review.)

1. Verify Fly secrets are populated: `flyctl secrets list -a neuroglitch-app`, same for sidecar.
2. Ensure `runtime/fly/fly.toml` and `fly.sidecar.toml` reflect any post-original-authoring changes (e.g., the `groundworx.neuroglitch.ai` hostname is currently NOT in fly.toml's domain list).
3. Issue a DNS cutover (point `groundworx.neuroglitch.ai` at Fly IPs).
4. Run `flyctl deploy` for both apps.
5. Verify health endpoints respond on Fly.

This is a Phase G' or operator-emergency event. Not for routine ops.

## Do not modify

- Do not edit `fly.toml` or `fly.sidecar.toml` without an architectural decision recorded in `planning/`.
- Do not delete this folder — see "Why this lives here."
- Do not invoke `flyctl deploy` without explicit operator approval.

## Path references that point here

Phase R4 updated:

| File | Reference |
|---|---|
| `.github/workflows/deploy.yml:64` | `flyctl deploy --remote-only --config runtime/fly/fly.toml` |
| `.github/workflows/deploy.yml:77` | `flyctl deploy --remote-only --config runtime/fly/fly.sidecar.toml` |
| `.dockerignore:59-61` | `runtime/fly/` (excludes the whole folder from image build context) |

Phase R4 did NOT update (documentation references; not behaviorally significant):

| File | Reference | Disposition |
|---|---|---|
| `infra/deploy-runbook.sh` | `flyctl deploy --config fly.toml ...` | Inside the DEPRECATED `infra/` folder (Phase R1). Deferred to Phase Z deletion. |
| `docs/architecture/ROADMAP.md`, `CURRENT_STATE.md` | Narrative references to "Fly" | Documentation-grade; cleanup deferred to a future doc-pass phase. |
| `runtime/README.md`, `runtime/STATUS.md` | Mentions of `fly.toml` in repo root path | Now stale; minor cleanup in a future runtime/ refresh. |

## Canonical references

- `Migration/Production Runtime Assessment.txt` §1, §3 — actual production substrate.
- `Migration/ARCHITECTURE_V1` §17 — deployment boundaries; Fly's dormant status.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 R4 — the relocation step.
