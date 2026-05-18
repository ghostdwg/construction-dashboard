# ──────────────────────────────────────────────────────────────────────────────
#  runtime/worker/Dockerfile
#  Hardened background-job worker image (SCAFFOLD — Phase R4)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: SCAFFOLD. NOT YET BUILT BY ANY DEPLOY.
#
#  The currently-deployed neuroglitch-worker container is built from a host
#  Dockerfile under /opt/neuroglitch/infrastructure/worker/. This Dockerfile
#  is the future replacement, landed when the operator cuts the worker over
#  to runtime/worker/ (planned Phase R4 deploy or later).
#
#  Differences from the current production worker:
#    - Drops to a non-root user (current container runs as root for no reason).
#    - Adds a HEALTHCHECK based on the /tmp/worker.tick file written by
#      entrypoint.sh — makes `docker ps` truthful about loop liveness.
#    - Uses tini as PID 1 for proper signal handling.
#    - Installs only curl + ca-certificates + tini (minimal attack surface).
#
# ──────────────────────────────────────────────────────────────────────────────

FROM alpine:3.20

# Install runtime dependencies: tini for signal handling, curl for the loop,
# ca-certificates for HTTPS validation (future readiness gate may probe HTTPS).
RUN apk add --no-cache tini curl ca-certificates \
 && addgroup -S worker \
 && adduser -S -G worker -s /bin/sh worker \
 && mkdir -p /home/worker \
 && chown worker:worker /home/worker

# Entrypoint script. Executable.
COPY --chown=worker:worker entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/worker-entrypoint.sh

# Drop privileges. The worker only needs to fork curl and write to /tmp/worker.tick.
USER worker
WORKDIR /home/worker

# Healthcheck: tick file must have been touched within the last 3 minutes.
# Without this, `docker ps` would show "Up" even when the loop is wedged.
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s --retries=3 \
  CMD test -n "$(find /tmp/worker.tick -mmin -3 2>/dev/null)" || exit 1

# tini reaps zombies and forwards signals (SIGTERM → graceful shutdown).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/worker-entrypoint.sh"]
