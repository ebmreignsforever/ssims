/**
 * Single-service launcher for platforms that detect this pnpm workspace at the
 * repository root (Sevalla, Render, Railway, etc.).
 *
 * The root `pnpm build` builds both workspaces. This launcher then:
 *   1. runs database migrations,
 *   2. runs the idempotent seed,
 *   3. starts the Express API with `SERVE_FRONTEND=true` so the compiled React
 *      SPA and `/api` are served from the same origin.
 *
 * Required platform environment:
 *   DATABASE_URL, DATABASE_ADMIN_URL, JWT_ACCESS_SECRET, COOKIE_SECRET,
 *   MFA_ENCRYPTION_KEY, CHALLENGE_SECRET, WEBHOOK_SECRET, SEED_* passwords,
 *   FRONTEND_ORIGIN, NODE_ENV=production, COOKIE_SECURE=true,
 *   DB_SSL_MODE=require or verify-full.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const backend = path.join(root, 'backend');
const server = path.join(backend, 'dist', 'server.js');
const frontend = path.join(root, 'frontend', 'dist');

if (!existsSync(server)) {
  console.error(`[start] Missing ${server}. Run "pnpm build" before starting.`);
  process.exit(1);
}
if (!existsSync(path.join(frontend, 'index.html'))) {
  console.error(`[start] Missing ${frontend}/index.html. Run "pnpm build" before starting.`);
  process.exit(1);
}

// Serve the SPA from Express. A platform-provided value still wins.
process.env.NODE_ENV ??= 'production';
process.env.SERVE_FRONTEND ??= 'true';
process.env.FRONTEND_DIST ??= frontend;

function runBackendScript(name) {
  const script = path.join(backend, 'dist', name);
  console.log(`[start] Running ${name}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: backend,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[start] Could not run ${name}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[start] ${name} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (process.env.RUN_MIGRATIONS !== 'false') runBackendScript('db/migrate.js');
if (process.env.RUN_SEED !== 'false') runBackendScript('scripts/seed.js');

console.log('[start] Starting SSIMS API and SPA');
await import(pathToFileURL(server).href);
