#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$ROOT/.env" ]; then
  echo "Missing $ROOT/.env. Copy .env.example to .env and fill in the required values." >&2
  exit 1
fi
if [ ! -f "$ROOT/frontend/index.html" ]; then
  echo "Compiled frontend not found at $ROOT/frontend." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required on PATH. The bundled runtime is Windows-only." >&2
  exit 1
fi

cd "$ROOT/backend"
export SERVE_FRONTEND=true
export FRONTEND_DIST="$ROOT/frontend"

echo "[1/3] Running database migrations"
node dist/db/migrate.js

echo "[2/3] Running idempotent seed"
node dist/scripts/seed.js

echo "[3/3] Starting SSIMS API and SPA"
echo "Open http://localhost:${API_PORT:-4000}"
exec node dist/server.js
