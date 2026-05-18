# runtime/compose/TOPOLOGY.md

Canonical documentation of the **current production Docker Compose topology** running on host `superglitch`. Phase R3 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`.

**This document is descriptive, not prescriptive.** It records reality as of the Production Runtime Assessment dated 2026-05-17. No service in this topology is being changed by Phase R3. The topology described here is what the eventual `runtime/compose/base.yml + overrides/production.yml` combination must produce.

---

## Status

Source of truth for the descriptions below: `Migration/Production Runtime Assessment.txt`. The actual authoritative file on the host is `/opt/neuroglitch/docker-compose.yml`. Operator validates parity between this document and the live file at the start of Phase R7 (cutover) and reconciles any drift before promoting `runtime/compose/` to authoritative.

---

## Executive summary

```text
                 superglitch (Linux, Tailscale 100.87.4.85, LAN 192.168.1.55)
                 Docker Compose project: neuroglitch
                 Single compose file: /opt/neuroglitch/docker-compose.yml
                 Single network: neuroglitch_neuroglitch (bridge, 172.21.0.0/16)
                 Storage bind: /opt/neuroglitch/storage → /storage (in containers)
                 Edge: Caddy on host ports 80, 443/tcp, 443/udp
                 Containers: caddy, app, sidecar, worker, landing, hello, api
```

Seven Compose-managed containers. One external GPU node (`thebeast`) reached over Tailscale; not part of the Compose stack.

---

## Service inventory

| # | Container | Image source | Restart | Healthcheck | Role |
|---|---|---|---|---|---|
| 1 | `neuroglitch-caddy` | `caddy:2` (Docker Hub) | unless-stopped | none configured | TLS termination, reverse proxy for 4 vhosts |
| 2 | `neuroglitch-app` | locally built (`construction-dashboard/Dockerfile` at repo root) | unless-stopped | `curl /api/health` | Next.js 16.2.4 app, port 3000 internal |
| 3 | `neuroglitch-sidecar` | locally built (`construction-dashboard/sidecar/Dockerfile`) | unless-stopped | `curl /health` | FastAPI Python sidecar, port 8001 internal |
| 4 | `neuroglitch-worker` | locally built (`/opt/neuroglitch/infrastructure/worker/`) | unless-stopped | none configured (entrypoint suppresses idle ticks; see DEPLOYMENT_DNS_ANALYSIS-Corrected) | Alpine + tini + curl loop polling `/api/jobs/run-due` every 60s |
| 5 | `neuroglitch-landing` | locally built static nginx | unless-stopped | none | `neuroglitch.ai` marketing site |
| 6 | `neuroglitch-hello` | locally built static | unless-stopped | none | Vestigial; depended upon by Caddy `depends_on` |
| 7 | `neuroglitch-api` | locally built JS stub | unless-stopped | none | Vestigial; 12-line server.js returning `{"service":"api","status":"running"}` |

The `landing`, `hello`, and `api` containers are vestigial fixtures from earlier brand exploration. They are not product-critical and are decommission candidates (deferred to Phase Z).

---

## Network topology

Single bridge network:

```text
Name (Docker)      neuroglitch_neuroglitch
Driver             bridge
Subnet             172.21.0.0/16
Created            2026-05-08 (matches Caddy container creation)
Network type       Compose default for project `neuroglitch` with explicit
                   network declaration `neuroglitch:` inside the compose file.
```

All seven containers attach to this single network. Docker's embedded DNS at `127.0.0.11` resolves service names: `caddy`, `app`, `sidecar`, `worker`, `landing`, `hello`, `api` — each resolves to the corresponding container's bridge IP.

The worker reaches the app via `http://app:3000/...`. The app reaches the sidecar via `http://sidecar:8001`. Caddy reaches each vhost upstream by container name. No service exposes itself to the host except Caddy.

---

## Volume topology

Three named volumes plus bind-mount references:

| Volume name (Docker) | Driver | Backing | Mounted in | Mount point |
|---|---|---|---|---|
| `neuroglitch_storage` | local (bind) | `/opt/neuroglitch/storage` (host path) | app, sidecar, worker | `/storage` |
| `neuroglitch_caddy_data` | local (managed) | docker-managed | caddy | `/data` (ACME state) |
| `neuroglitch_caddy_config` | local (managed) | docker-managed | caddy | `/config` |

Plus the bind mount for Caddyfile:

```text
Source: /opt/neuroglitch/infrastructure/caddy/Caddyfile (host)
Target: /etc/caddy/Caddyfile (caddy container)
Mode:   read-only
```

### Storage path conventions (inside the shared `/storage` mount)

Established by `lib/storage/blobStore.ts` in the app and mirrored in the sidecar:

```text
/storage/
├── market/docs/{sourceId}/{YYYY}/{MM}/{docId}.{ext}
├── plan-room/jobs/{jobId}/{kind}/{file}
├── meetings/{meetingId}/{file}
└── audit/
    └── credentials-access.jsonl
```

### Storage drift (operational debt, not in this topology)

The host also contains `/opt/neuroglitch/uploads/groundworx/meetings/{4,5,7,8}/` populated by older upload code. **Not bind-mounted** into any current container. Orphaned data; consolidation deferred (Production Runtime Assessment §17 Low severity item).

Also: `/opt/neuroglitch/storage-staging/` exists on the host (empty) for the future staging stack. Not consumed by any running container today.

---

## Ingress path

```text
Public Internet
    │
    │ HTTPS (80, 443/tcp, 443/udp on host)
    ▼
caddy (caddy:2)
    │
    ├── neuroglitch.ai              → landing:80
    ├── hello.neuroglitch.ai        → hello:80
    ├── api.neuroglitch.ai          → api:3000
    └── groundworx.neuroglitch.ai   → app:3000      [the product]
```

Caddy serves four virtual hosts. ACME certs are issued automatically by Let's Encrypt and persisted in `neuroglitch_caddy_data` (`/data`). Losing this volume requires reissuing all certificates, which is subject to LE rate limits.

The Caddy `admin` API on port `:2019` is internal-only and is not exposed past the Compose network.

The Next.js app trusts proxy headers (`trustHost: true` in `lib/auth.ts`, commit `ed6c876`). Auth.js sessions are stamped against `NEXTAUTH_URL=https://groundworx.neuroglitch.ai`.

---

## Sidecar relationships

```text
app  ──HTTP, X-API-Key: SIDECAR_API_KEY──►  sidecar
        │
        │ (callbacks the other direction use SIDECAR_CALLBACK_TOKEN)
        ▼
sidecar ──HTTP, X-API-Key: WHISPERX_API_KEY──►  WhisperX (thebeast:8002, Tailscale)
sidecar ──HTTP, NO AUTH──►                      Ollama   (thebeast:11434, Tailscale)
sidecar ──HTTPS, ANTHROPIC_API_KEY──►           Anthropic API (cloud)
sidecar ──HTTPS, ASSEMBLYAI_API_KEY──►          AssemblyAI    (cloud, optional fallback)
```

The sidecar also reads `IntegrationCredential` rows directly from Turso via `@libsql/client` and decrypts in-process using `CREDENTIAL_MASTER_KEY`. The app does not mediate this read path today. Reducing this coupling is Phase F' work in `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`.

---

## depends_on relationships

```text
worker  depends_on  app
app     depends_on  sidecar
caddy   depends_on  hello       (vestigial)
```

Compose `depends_on` is **start-order only** — it does not gate on health. The worker's historical 11-minute "Could not resolve host: app" window on 2026-05-16 (documented in `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md`) is a direct consequence of `depends_on` not enforcing health-readiness.

The Phase R4 worker entrypoint hardening adds a readiness gate that compensates by polling `/api/health` before entering the work loop.

---

## Health probes

Currently configured:

```text
app:
  test: curl -f http://localhost:3000/api/health
  interval: 30s; timeout: 10s; retries: 3; start_period: 30s

sidecar:
  test: curl -f http://localhost:8001/health
  interval: 30s; timeout: 10s; retries: 3; start_period: 20s
```

Other containers have no Docker healthcheck. `docker ps` shows `Up` even if the underlying process is wedged. The worker entrypoint hardening (Phase R4) adds a tick-file healthcheck.

---

## Restart policy

`unless-stopped` on every container. Docker restarts containers that exit non-zero unless the operator explicitly stopped them. Survives host reboots.

---

## Runtime assumptions (operationally important)

Documented in detail in `Migration/Production Runtime Assessment.txt` §16. Summary here for completeness:

1. **`neuroglitch_neuroglitch` bridge network always exists.** If containers are started in a different order than expected (e.g., worker before app), DNS resolution can transiently fail for up to one `sleep 60` cycle.
2. **Tailscale tailnet up; `thebeast` reachable at `100.126.166.110`.** No MagicDNS hostname is used — bare IPs are in code and env.
3. **The host resolves `api.anthropic.com` and `*.turso.io`.**
4. **Turso authToken is valid; no automatic refresh.** Manual rotation only.
5. **Container clock == host clock.** No NTP container in the stack.
6. **`/storage` is permanent and writable** from all three containers (app, sidecar, worker) as the in-container `nextjs` user (uid 1001). Host directory ownership is `neuroglitch:65533`; group write permission is what makes this work.
7. **Worker assumes app is reachable at start time.** If not, it spam-logs DNS errors until app comes up. After recovery the loop falls silent (Phase R4 fixes the silence).
8. **Next.js standalone build pulls runtime env from `env_file`.** Anything `NEXT_PUBLIC_*` baked at build time would be frozen. None are observed today.
9. **Prisma migrations are applied manually** via `scripts/apply-turso-migrations.mjs` **before** recreating the app container. The app entrypoint deliberately does not run them.
10. **Host user `neuroglitch` owns the codebase**; container `nextjs` user (uid 1001) writes to host directories owned `neuroglitch:65533`. This works only because file mode permits group write.

---

## Compose project naming

```text
Production: docker compose -p neuroglitch up -d
            → containers named neuroglitch-{app,sidecar,worker,caddy,landing,hello,api}
            → network neuroglitch_neuroglitch
            → volumes neuroglitch_storage, neuroglitch_caddy_data, neuroglitch_caddy_config

Staging   : docker compose -p neuroglitch-staging up -d    (NOT ACTIVE TODAY)
            → would produce containers neuroglitch-staging-{...}
            → separate volumes neuroglitch-staging_storage, etc.
            → separate network neuroglitch-staging_neuroglitch
```

The staging project shares the host with production but is otherwise fully isolated: separate Docker network, separate Docker volumes, separate env file. The shared Caddy serving both routes is documented in `runtime/runbooks/staging-bootstrap.md`.

---

## What this topology document does NOT cover

- `runtime/compose/base.yml` literal YAML structure → see that file's header.
- Per-tier override semantics → see `overrides/staging.yml`, `overrides/production.yml`, `runtime/deployment/compose-governance.md`.
- Caddy routing rules per vhost → see `runtime/caddy/` (Phase R3+ when Caddyfile templates are authored).
- Worker entrypoint shape → see `runtime/worker/` (Phase R4).
- Deploy script invocation → see `runtime/deployment/` (Phase R4 stubs, R7 real).

---

## Canonical references

- `Migration/Production Runtime Assessment.txt` — authoritative description of current production runtime (the source for this document).
- `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` — worker DNS behavior analysis.
- `Migration/ARCHITECTURE_V1` §3, §5, §6, §7 — service inventory, topology diagrams, AI boundaries, storage boundaries.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 — staging strategy.
- `runtime/STATUS.md` — overall runtime/ transition state.
