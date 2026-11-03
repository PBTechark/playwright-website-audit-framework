#!/usr/bin/env bash
# Shares the dashboard with people outside this machine through an ngrok HTTPS URL.
#   npm run share     (Ctrl+C stops the tunnel, and the dashboard if this script started it)
# Needs once: ngrok installed and `ngrok config add-authtoken <token>`.
# Optional in .env: NGROK_DOMAIN=<your free static domain>.ngrok-free.app keeps the URL the same.
set -euo pipefail
cd "$(dirname "$0")"

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
port=$(env_value BACKEND_PORT)
port=${port:-4300}
domain=$(env_value NGROK_DOMAIN)
password=$(env_value DASHBOARD_PASSWORD)

command -v ngrok >/dev/null || { echo "ngrok is not installed: https://ngrok.com/download"; exit 1; }
[ -f frontend/dist/index.html ] || { echo "Build the dashboard first: cd frontend && npm run build"; exit 1; }
# Anyone with the link reaches the sign-in page, so a guessable password is not acceptable.
if [ ${#password} -lt 12 ]; then
  echo "DASHBOARD_PASSWORD in .env must be at least 12 characters before the dashboard goes public."
  echo "Generate one: node -e \"console.log(require('crypto').randomBytes(12).toString('base64url'))\""
  exit 1
fi

if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
  echo "Starting the dashboard on port $port"
  (cd backend && exec node_modules/.bin/tsx src/index.ts) &
  backend=$!
  trap 'kill "$backend" 2>/dev/null' EXIT
  for _ in $(seq 30); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/" && break; sleep 1; done
fi

echo "Share the https:// Forwarding URL below. Visitors sign in with the DASHBOARD_USER_ID / DASHBOARD_PASSWORD from .env."
ngrok http "$port" ${domain:+--url="$domain"}
