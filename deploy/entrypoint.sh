#!/bin/sh
# =============================================================================
# Single-container startup for Render/Koyeb-style platforms.
# Runs migrations and the idempotent seed before starting the API/SPA server.
# =============================================================================
set -eu

# Render injects RENDER_EXTERNAL_URL; use it as the trusted browser origin when
# the deployment has not explicitly supplied FRONTEND_ORIGIN.
if [ -z "${FRONTEND_ORIGIN:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export FRONTEND_ORIGIN="$RENDER_EXTERNAL_URL"
fi

if [ -z "${API_PORT:-}" ] && [ -n "${PORT:-}" ]; then
  export API_PORT="$PORT"
fi

echo "[startup] Running database migrations"
node dist/db/migrate.js

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[startup] Running idempotent seed"
  node dist/scripts/seed.js
fi

echo "[startup] Starting SSIMS API and SPA on port ${API_PORT:-4000}"
exec node dist/server.js
