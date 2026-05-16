#!/bin/sh
set -e

# Note: `prisma migrate deploy` is NOT run here. The Prisma migrate CLI does not
# speak the libsql:// scheme (it dispatches by URL to the schema-engine and
# returns P1013). Apply migrations against Turso via the @libsql/client-based
# script at scripts/apply-turso-migrations.mjs, or via the Turso CLI directly,
# BEFORE recreating this container.
echo "[entrypoint] Starting app: $*"
exec "$@"
