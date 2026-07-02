#!/usr/bin/env bash
# governance/guardrails/run-p0-checks.sh
#
# The single documented command that runs all P0 confidential-data guardrails.
# Network-free and secret-free: it only reads source files and prints findings.
#
#   ./governance/guardrails/run-p0-checks.sh            # warn mode (default, exit 0)
#   GUARDRAILS_MODE=enforce ./governance/guardrails/run-p0-checks.sh   # CI enforce mode
#
# A later CI job can invoke this script directly (no secrets, no network).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${GUARDRAILS_MODE:-warn}"

echo "=================================================================="
echo " P0 Confidential-Data Guardrails  (mode=${MODE})"
echo " Reads source only. No network. No secrets. No runtime changes."
echo "=================================================================="

rc=0

echo; echo "----- self-test -----"
node "$DIR/selftest.mjs" || rc=$?

echo; echo "----- check 1: AI providers -----"
node "$DIR/detect-ai-providers.mjs" || rc=$?

echo; echo "----- check 2: deploy/storage -----"
node "$DIR/detect-deploy-storage.mjs" || rc=$?

echo
if [ "$MODE" = "enforce" ]; then
  echo "P0 guardrails finished (enforce): exit ${rc}"
else
  echo "P0 guardrails finished (warn): exit 0 (findings are advisory only)"
  rc=0
fi
exit "$rc"
