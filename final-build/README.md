# SSIMS — Final Build

Production build of the Secure Student Information Management System, packaged so the API and SPA can run directly with Node.js. It does **not** contain Docker images, Docker Compose files, or a database.

The working folder contains a **local-only `.env`** for this machine. The distributable ZIP deliberately excludes it. Do not share the working folder as-is.

## Contents

```text
final-build/
├── frontend/              Compiled React SPA (index.html + assets)
├── backend/
│   ├── dist/              Compiled Express API (JavaScript)
│   ├── node_modules/      Production dependencies, including native argon2
│   ├── package.json
│   └── pnpm-lock.yaml
├── database/
│   ├── init/              Role bootstrap (ssims_owner, ssims_app, readonly)
│   └── migrations/        PostgreSQL schema and least-privilege grants
├── runtime/node.exe       Bundled Node.js runtime for Windows
├── .env                   Local-only configuration (excluded from ZIP)
├── .env.example           Environment template (no secrets)
├── BUILD-INFO.json        Build metadata
├── CHECKSUMS.sha256       Integrity hashes for build files
├── start.cmd              Windows double-click launcher
├── start.ps1              Windows PowerShell launcher
├── start.sh               Linux/macOS launcher
└── README.md
```

## Requirements

- Windows: none for Node.js — `runtime/node.exe` is bundled
- Linux/macOS: Node.js 22 or newer
- PostgreSQL 16 or newer, running and reachable from this machine
- A filled-in `.env` file with secrets and database credentials

## Quick start — Windows

Double-click `start.cmd`, or run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

If `.env` is missing (for example after extracting the ZIP), create it first:

```powershell
Copy-Item .env.example .env
notepad .env
```

`start.cmd` applies the execution-policy bypass and pauses on failure so the actual error remains visible.

Open:

```text
http://localhost:4000
```

`start.ps1` sets `SERVE_FRONTEND=true`, points Express at `frontend/`, runs the idempotent database migrations and seed, then starts the API and SPA from one Node process.

## Quick start — Linux/macOS

```bash
cp .env.example .env
nano .env
chmod +x start.sh
./start.sh
```

## Required environment values

At minimum, fill these in `.env`:

```ini
DATABASE_ADMIN_URL=postgresql://ssims_owner:PASSWORD@127.0.0.1:5432/ssims
DATABASE_URL=postgresql://ssims_app:PASSWORD@127.0.0.1:5432/ssims
FRONTEND_ORIGIN=http://localhost:4000
COOKIE_SECURE=false

JWT_ACCESS_SECRET=<at least 32 random characters>
COOKIE_SECRET=<at least 32 random characters>
MFA_ENCRYPTION_KEY=<64 hex characters>
CHALLENGE_SECRET=<at least 32 random characters>
WEBHOOK_SECRET=<at least 32 random characters>

SEED_SUPER_ADMIN_PASSWORD=<long random password>
SEED_ADMIN_PASSWORD=<long random password>
SEED_LECTURER_PASSWORD=<long random password>
SEED_STUDENT_PASSWORD=<long random password>
SEED_LAB_PASSWORD=<long random password>
```

For a local PostgreSQL instance without TLS, keep:

```ini
NODE_ENV=development
DB_SSL_MODE=disable
COOKIE_SECURE=false
FRONTEND_ORIGIN=http://localhost:4000
```

For an internet-facing deployment behind HTTPS, use:

```ini
NODE_ENV=production
DB_SSL_MODE=verify-full
DB_SSL_CA=/absolute/path/to/database-ca.crt
COOKIE_SECURE=true
FRONTEND_ORIGIN=https://your-domain.example
TRUST_PROXY=1
```

Production mode refuses to start with `COOKIE_SECURE=false`, `DB_SSL_MODE=disable`, or `EXPOSE_RESET_TOKEN=true`.

## Database

The database must already exist. The `ssims_owner`, `ssims_app`, and read-only roles must exist before migrations run; `database/init/00-roles.sh` documents the role bootstrap used by the full project. The final build includes the migration SQL under `database/migrations/`.

Run migrations manually if needed:

```powershell
cd backend
node dist/db/migrate.js
node dist/scripts/seed.js
```

## Manual start

```powershell
cd backend
$env:SERVE_FRONTEND = "true"
$env:FRONTEND_DIST = (Resolve-Path ..\frontend).Path
node dist/server.js
```

Health check:

```text
GET http://localhost:4000/health
```

The frontend calls the API at relative `/api/...`, so serving both from the same origin is recommended. If you serve `frontend/` with Nginx or another static server, proxy `/api` to the Node process.

## Security notes

- The ZIP excludes `.env`, database dumps, bootstrap passwords, JWT secrets, MFA keys, and private keys.
- The working folder's local `.env` contains machine-local credentials. Do not share the folder as-is.
- Generate fresh secrets for every deployment; never reuse the values from another environment.
- Use a non-owner PostgreSQL role for `DATABASE_URL` and keep `DATABASE_ADMIN_URL` only for migrations/seed.
- Terminate HTTPS at a trusted reverse proxy and enable HSTS there when exposing the app publicly.
- `COOKIE_SECURE=true` is mandatory in production.
