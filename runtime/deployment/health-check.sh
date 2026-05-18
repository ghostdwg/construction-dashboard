#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  runtime/deployment/health-check.sh
#  Host-side post-deploy health probe (STUB — Phase R4)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: STUB. NOT ACTIVE.
#
#  When active (Phase R7), this script probes the deployed services' health
#  endpoints and the worker tick file (when Phase R4 worker hardening lands).
#  Refuses to mark deploy successful until all probes return expected output.
#
#  Usage:
#    health-check.sh staging
#    health-check.sh production
#
#  This stub prints the actions it would take and exits without contacting
#  any container.
# ──────────────────────────────────────────────────────────────────────────────

set -eu

TIER="${1:-}"

echo ""
echo "============================================================"
echo "  health-check.sh  --  STUB (Phase R4 -- NOT ACTIVE)"
echo "============================================================"
echo ""

if [ -z "${TIER}" ]; then
  echo "USAGE: $0 <staging|production>"
  echo "Refusing: no tier argument provided."
  exit 2
fi

case "${TIER}" in
  staging|production) ;;
  *)
    echo "Refusing: unknown tier '${TIER}'. Must be one of: staging, production."
    exit 2
    ;;
esac

case "${TIER}" in
  production)
    PROJECT="neuroglitch"
    HOSTNAME="groundworx.neuroglitch.ai"
    ;;
  staging)
    PROJECT="neuroglitch-staging"
    HOSTNAME="staging.groundworx.neuroglitch.ai"
    ;;
esac

echo "Tier requested: ${TIER}"
echo "Compose project: ${PROJECT}"
echo "Public hostname: ${HOSTNAME}"
echo ""
echo "If this script were active, it would perform:"
echo ""
echo "  1. APP container health probe:"
echo "      docker exec ${PROJECT}-app curl -sf http://localhost:3000/api/health"
echo "      Expect: HTTP 200 + JSON {\"status\":\"ok\",...}"
echo ""
echo "  2. SIDECAR container health probe:"
echo "      docker exec ${PROJECT}-sidecar curl -sf http://localhost:8001/health"
echo "      Expect: HTTP 200 + JSON {\"status\":\"ok\",...}"
echo ""
echo "  3. WORKER tick-file probe (when Phase R4 worker hardening is deployed):"
echo "      docker exec ${PROJECT}-worker test -n \"\$(find /tmp/worker.tick -mmin -3)\""
echo "      Expect: tick file touched within the last 3 minutes"
echo ""
echo "  4. PUBLIC reachability probe:"
echo "      curl -sf https://${HOSTNAME}/api/health"
echo "      Expect: HTTP 200 (Caddy reverse proxy working)"
echo ""
echo "  5. ERROR LOG sweep (last 60 seconds):"
echo "      docker compose -p ${PROJECT} logs --since 60s | grep -i 'level=error\\|panic'"
echo "      Expect: no matches"
echo ""
echo "REFUSAL: deploy is NOT marked successful if any of the above fail."
echo ""
echo "STUB exiting without probing any container."
echo ""

exit 0
