#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  runtime/deployment/apply-migrations.sh
#  Host-side migration runner (STUB — Phase R4)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: STUB. NOT ACTIVE.
#
#  When active (Phase R7), this script invokes scripts/apply-turso-migrations.mjs
#  against the tier's Turso DB. Refuses to proceed unless DATABASE_URL pattern
#  matches the target tier.
#
#  Usage:
#    apply-migrations.sh staging
#    apply-migrations.sh production
#
#  This stub prints the actions it would take and exits without running
#  migrations.
# ──────────────────────────────────────────────────────────────────────────────

set -eu

TIER="${1:-}"

echo ""
echo "============================================================"
echo "  apply-migrations.sh  --  STUB (Phase R4 -- NOT ACTIVE)"
echo "============================================================"
echo ""

if [ -z "${TIER}" ]; then
  echo "USAGE: $0 <staging|production>"
  echo ""
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

echo "Tier requested: ${TIER}"
echo ""
echo "If this script were active, it would perform:"
echo ""
echo "  1. VERIFY DATABASE_URL pattern matches tier:"
case "${TIER}" in
  staging)
    echo "      DATABASE_URL must contain 'groundworx-staging-ghostdwg'"
    ;;
  production)
    echo "      DATABASE_URL must contain 'groundworx-prod-ghostdwg'"
    ;;
esac
echo "      REFUSE if pattern does not match."
echo "      REFUSE if DATABASE_URL is unset or empty."
echo ""
echo "  2. INVOKE the bespoke libsql migrator:"
echo "      node scripts/apply-turso-migrations.mjs"
echo "      (NEVER prisma migrate deploy against libsql:// -- returns P1013)"
echo ""
echo "  3. VERIFY migration completed:"
echo "      query _prisma_migrations row count via @libsql/client"
echo "      compare against prisma/migrations/ directory count"
echo "      REFUSE next step if counts diverge"
echo ""
echo "STUB exiting without running migrations."
echo ""

exit 0
