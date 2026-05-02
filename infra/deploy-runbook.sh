#!/bin/bash
# NeuroGlitch — Production deployment runbook
# Run from repo root. Read every section before executing.
set -e

echo "=== NeuroGlitch Production Deploy Runbook ==="

echo "--- Checking prerequisites ---"
command -v flyctl >/dev/null 2>&1 || { echo "ERROR: flyctl not installed. Run: brew install flyctl"; exit 1; }
command -v turso  >/dev/null 2>&1 || { echo "ERROR: turso not installed. Run: npm install -g @turso/cli"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not installed."; exit 1; }
echo "OK: All tools present"

echo ""
echo "--- Checking uploads/ is not tracked in git ---"
if git ls-files --error-unmatch uploads/ > /dev/null 2>&1; then
  echo "BLOCKING: uploads/ is still tracked in git. Run:"
  echo "  pip install git-filter-repo"
  echo "  git filter-repo --path uploads/ --invert-paths --force"
  echo "  echo 'uploads/' >> .gitignore"
  echo "  git add .gitignore && git commit -m 'chore: remove uploads from git'"
  echo "  git push origin main --force"
  exit 1
else
  echo "OK: uploads/ not tracked"
fi

echo ""
echo "--- STEP 1: Turso database setup ---"
echo "Run these manually, then re-run this script:"
echo "  turso db create neuroglitch-prod --region ord"
echo "  turso db show neuroglitch-prod"
echo "  turso db tokens create neuroglitch-prod --expiration none"
echo ""
echo "Then add to .env.local:"
echo '  DATABASE_URL="libsql://neuroglitch-prod-[org].turso.io"'
echo '  DATABASE_AUTH_TOKEN="your-token"'
echo ""
echo "Then run:"
echo "  npx prisma db push"
echo "  sqlite3 dev.db .dump > export.sql"
echo "  turso db shell neuroglitch-prod < export.sql"

echo ""
echo "--- STEP 2: Fly app creation (run once) ---"
echo "  flyctl launch --name neuroglitch-app --region ord --no-deploy"
echo "  flyctl launch --name neuroglitch-sidecar --region ord --no-deploy --config fly.sidecar.toml"

echo ""
echo "--- STEP 3: Set Fly secrets ---"
cat << 'EOF'
flyctl secrets set --app neuroglitch-app \
  DATABASE_URL="libsql://neuroglitch-prod-[org].turso.io" \
  DATABASE_AUTH_TOKEN="your-turso-token" \
  AUTH_SECRET="$(openssl rand -hex 32)" \
  NEXTAUTH_URL="https://neuroglitch.ai" \
  ANTHROPIC_API_KEY="sk-ant-your-key" \
  SIDECAR_URL="https://neuroglitch-sidecar.fly.dev"

flyctl secrets set --app neuroglitch-sidecar \
  ANTHROPIC_API_KEY="sk-ant-your-key"
EOF

echo ""
echo "--- STEP 4: Deploy ---"
flyctl deploy --config fly.toml --remote-only
flyctl deploy --config fly.sidecar.toml --remote-only

echo ""
echo "--- STEP 5: Verify ---"
sleep 15
curl -sf https://neuroglitch-app.fly.dev/api/health && echo "Main app: OK" || echo "Main app: FAILED"
curl -sf https://neuroglitch-sidecar.fly.dev/health  && echo "Sidecar:  OK" || echo "Sidecar:  FAILED"

echo ""
echo "--- STEP 6: DNS (manual) ---"
echo "  flyctl ips list --app neuroglitch-app"
echo "  Then in your registrar:"
echo "    A     neuroglitch.ai       → [IPv4]"
echo "    AAAA  neuroglitch.ai       → [IPv6]"
echo "    CNAME www.neuroglitch.ai   → neuroglitch.ai"
echo "    CNAME api.neuroglitch.ai   → neuroglitch-sidecar.fly.dev"
echo "  flyctl certs create neuroglitch.ai --app neuroglitch-app"
echo "  flyctl certs create www.neuroglitch.ai --app neuroglitch-app"

echo ""
echo "--- STEP 7: GitHub Actions secret ---"
echo "  flyctl tokens create deploy -x 999999h"
echo "  → GitHub repo → Settings → Secrets → FLY_API_TOKEN"

echo ""
echo "=== Runbook complete ==="
