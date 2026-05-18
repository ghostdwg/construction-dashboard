# runtime/caddy/

Caddy reverse-proxy / TLS-termination templates for the GroundWorX edge.

## Status (Phase R1)

**Empty.** No Caddy files yet.

## Planned contents (Phase R3)

```text
caddy/
├── Caddyfile.template          # Committed — placeholder hostnames + routes
├── Caddyfile.staging.example   # Staging routes (staging.groundworx.neuroglitch.ai)
└── Caddyfile.prod.example      # Prod routes (groundworx.neuroglitch.ai +
                                  the vestigials landing/hello/api during decommission)
```

## Current state of production Caddy

Production runs a single Caddy 2 container (`neuroglitch-caddy`) on host `superglitch` with:

- Caddyfile bind-mounted from `/opt/neuroglitch/infrastructure/caddy/Caddyfile`.
- ACME state in named Docker volumes `neuroglitch_caddy_data` and `neuroglitch_caddy_config`. **Losing these volumes = reissue all LE certs = rate-limit risk.**
- Four virtual hosts today: `neuroglitch.ai` (landing), `hello.neuroglitch.ai` (vestigial), `api.neuroglitch.ai` (vestigial), `groundworx.neuroglitch.ai` (the product).
- Admin API on `:2019` internal only.

Phase R3 snapshots the live Caddyfile into `Caddyfile.prod.example`. Phase R6 adds `staging.groundworx.neuroglitch.ai` to the live Caddyfile (Caddy reload, no app downtime).

## What goes in Caddy templates

- Hostname → upstream container mappings (e.g., `groundworx.neuroglitch.ai → neuroglitch-app:3000`).
- ACME / TLS configuration (defaults; no static cert paths).
- Compression, headers, rate limiting (none configured today).

## What does NOT go in Caddy templates

- Real API keys, JWT secrets, or other product credentials.
- Operator-specific paths.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 — staging routes.
- `Migration/Production Runtime Assessment.txt` §1, §13 — current edge topology.
- `runtime/STATUS.md` — overall transition state.
