#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  runtime/deployment/consultant-reports-auth-preflight.sh
#  AUTH_DISABLED preflight for Consultant Reports (STUB — Phase 1A)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: STUB. Prints the exact operator preflight plan and exits without
#  contacting any container. Deployment stubs are deliberate — do not "fix"
#  this into a live executable (runtime/deployment convention).
#
#  CONTRACT (Phase 1A card §5): before the inline/download consultant-report
#  routes ever serve a REAL document in a deployed tier, the operator MUST
#  confirm the auth wall is on. lib/env.ts rejects AUTH_DISABLED=true in
#  production, but the staging posture cannot be verified by any model —
#  only this human-run check proves it per deploy.
#
#  Operator steps (grep-count method — never a full env dump):
#
#    docker inspect <app-container> \
#      --format '{{range .Config.Env}}{{println .}}{{end}}' \
#      | grep -c 'AUTH_DISABLED=true'
#
#    Required output: 0
#    Record in the deploy-packet acceptance log as: AUTH_PREFLIGHT_OK=true
#    (with timestamp, container id, and image tag).
#
#  A nonzero count means the session wall is BYPASSED for every route —
#  do NOT expose consultant documents; stop and remediate before deploy.
# ──────────────────────────────────────────────────────────────────────────────

set -eu

echo ""
echo "============================================================"
echo "  consultant-reports-auth-preflight.sh  --  STUB (Phase 1A)"
echo "============================================================"
echo ""
echo "This stub prints the operator preflight plan only. It does not"
echo "inspect any container and cannot record AUTH_PREFLIGHT_OK itself."
echo ""
echo "PLAN:"
echo "  1. docker inspect <app-container> \\"
echo "       --format '{{range .Config.Env}}{{println .}}{{end}}' \\"
echo "       | grep -c 'AUTH_DISABLED=true'"
echo "  2. Require output: 0   (any other value: STOP — auth wall bypassed)"
echo "  3. Record AUTH_PREFLIGHT_OK=true in the deploy-packet acceptance"
echo "     log with timestamp + container id + image tag."
echo ""
echo "Never print a full env dump. Key names only, never values."
echo ""
exit 0
