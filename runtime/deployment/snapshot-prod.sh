#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  runtime/deployment/snapshot-prod.sh
#  Host-side production snapshot before any destructive operation (STUB — Phase R4)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: STUB. NOT ACTIVE.
#
#  When active (Phase R7), this script captures a Turso PITR (point-in-time
#  recovery) marker before any migration or destructive deploy step. Required
#  step gate for deploy-prod.ps1 and rollback.ps1.
#
#  Usage:
#    snapshot-prod.sh
#
#  This stub prints the actions it would take and exits without contacting
#  Turso.
# ──────────────────────────────────────────────────────────────────────────────

set -eu

echo ""
echo "============================================================"
echo "  snapshot-prod.sh  --  STUB (Phase R4 -- NOT ACTIVE)"
echo "============================================================"
echo ""
echo "If this script were active, it would perform:"
echo ""
echo "  1. VERIFY environment:"
echo "      DATABASE_URL must contain 'groundworx-prod-ghostdwg'"
echo "      turso CLI must be installed and authenticated"
echo "      operator must have prod-vault Turso token in env"
echo ""
echo "  2. CAPTURE PITR marker:"
echo "      turso db backup create groundworx-prod-ghostdwg \\"
echo "        --description \"pre-deploy snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)\""
echo ""
echo "  3. VERIFY snapshot exists:"
echo "      turso db backup list groundworx-prod-ghostdwg | head -1"
echo "      REFUSE next step if creation failed or last snapshot is > 5 min old"
echo ""
echo "  4. RECORD snapshot ID:"
echo "      echo \"<snapshot-id>\" > /tmp/snapshot-prod.last"
echo "      (deploy-prod.ps1 consumes this for the ops log entry)"
echo ""
echo "REFUSAL CONDITIONS:"
echo "  - DATABASE_URL pattern wrong"
echo "  - turso CLI absent"
echo "  - snapshot creation returns non-zero"
echo "  - cannot verify snapshot exists post-creation"
echo ""
echo "STUB exiting without contacting Turso."
echo ""

exit 0
