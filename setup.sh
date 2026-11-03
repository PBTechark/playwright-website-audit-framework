#!/usr/bin/env bash
# One-time setup on a new machine: creates .env and installs every dependency.
#   ./setup.sh                    engine + dashboard (backend and frontend)
#   SKIP_DASHBOARD=1 ./setup.sh   engine only (command-line audits)
#   SKIP_SYSTEM_DEPS=1 ./setup.sh skip Chromium's system libraries (already installed, or no sudo)
set -euo pipefail
cd "$(dirname "$0")"

node -e 'const [a, b] = process.versions.node.split(".").map(Number);
  if (a < 18 || (a === 18 && b < 18)) { console.error(`Node ${process.version} found; 18.18 or newer is required.`); process.exit(1); }' \
  || { echo "Install Node.js 18.18+ (20 LTS recommended) and run ./setup.sh again."; exit 1; }

if [ -f .env ]; then
  echo "• .env already exists; leaving it unchanged."
else
  cp .env.example .env
  password=$(node -e 'console.log(require("crypto").randomBytes(12).toString("base64url"))')
  sed -i.bak -e 's/^DASHBOARD_USER_ID=$/DASHBOARD_USER_ID=admin/' -e "s/^DASHBOARD_PASSWORD=\$/DASHBOARD_PASSWORD=$password/" .env
  rm -f .env.bak
  echo "• Created .env from .env.example. Dashboard sign-in: admin / $password (change it in .env)."
fi

echo "• Installing engine packages"
npm ci

echo "• Installing Chromium"
if [ "${SKIP_SYSTEM_DEPS:-}" = "1" ]; then
  npx playwright install chromium
else
  # --with-deps also installs Chromium's system libraries; Playwright asks for sudo when not root.
  npx playwright install --with-deps chromium
fi

if [ "${SKIP_DASHBOARD:-}" != "1" ]; then
  echo "• Installing dashboard packages"
  (cd backend && npm ci)
  (cd frontend && npm ci && npm run build)
fi

cat <<'EOF'

Setup complete. Next:
  npm run audit:smoke          quick check (about 40 s)
  npm run audit                audit every enabled row in test-data/audit-targets.csv
  npm run show-report          open the report
  cd backend && npm start      dashboard at http://127.0.0.1:4300
EOF
