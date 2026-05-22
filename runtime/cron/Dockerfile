# ──────────────────────────────────────────────────────────────────────────────
#  runtime/cron/Dockerfile
#  Phase O2.2 PR4 — Autonomous cadence runtime image.
#
#  Hosts the cron-loop that fires recurring MI runners (forecast, calibration,
#  briefing, alert-eval, outcome-detect — PR5+; municipal-agenda-ingestion +
#  health-check today).
#
#  DESIGN:
#    * Same code as the app container (the cron-loop spawns
#      `npx tsx scripts/run-cycle.ts` which depends on the same lib/ tree).
#      We achieve this by deriving from the same base; in production the
#      compose overlay uses the SAME image as `app:` with an overridden CMD.
#      This file is provided for operators who want a standalone cron image.
#    * tini as PID 1 for proper signal forwarding (SIGTERM → graceful drain).
#    * Non-root user — the loop only needs to fork tsx + write /tmp/cron.tick.
#    * HEALTHCHECK based on /tmp/cron.tick freshness (touched every minute).
#    * Reads runtime/cron/schedule.json at startup. Restart container to
#      reload schedule changes.
#
#  BUILD CONTEXT:
#    docker build -f runtime/cron/Dockerfile -t groundworx-cron:dev .
#    (build context = repo root so the COPY can grab the app source tree)
#
#  ENV (set in compose overlay, not here):
#    DATABASE_URL          — same DB as the app container
#    DATABASE_AUTH_TOKEN   — Turso auth token
#    SIDECAR_URL           — http://sidecar:8001 (in compose)
#    CRON_SCHEDULE_PATH    — /app/runtime/cron/schedule.json (default)
#    CRON_TICK_FILE        — /tmp/cron.tick (default)
# ──────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

# tini for signal handling + ca-certs for HTTPS DB / sidecar calls.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps with full devDependencies — tsx (used by run-cycle.ts) lives
# in devDependencies. Prisma client also generated here. A separate prod-only
# build is an optimization for a later PR.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the app source. The cron-loop only needs scripts/ + lib/ + prisma/ +
# runtime/cron/schedule.json, but it's simpler + safer to ship the full tree
# (the spawned tsx process imports liberally from @/lib).
COPY . .

# Generate Prisma client.
RUN npx prisma generate

# Non-root user — defense-in-depth.
RUN groupadd --system cron && useradd --system --gid cron --create-home cron \
 && chown -R cron:cron /app

USER cron

# Healthcheck: tick file must have been touched within the last 2 minutes
# (cron-loop touches it every minute). Without this, `docker ps` would show
# "healthy" even when the loop wedged.
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s --retries=3 \
  CMD test -n "$(find /tmp/cron.tick -mmin -2 2>/dev/null)" || exit 1

# tini reaps zombies + forwards signals. cron-loop traps SIGTERM/SIGINT and
# drains in-flight runs before exiting.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/cron-loop.mjs"]
