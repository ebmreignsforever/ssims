$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  Write-Host ''
  Write-Host 'CONFIGURATION REQUIRED' -ForegroundColor Yellow
  Write-Host "Missing: $envFile"
  Write-Host 'Copy .env.example to .env and fill in the database URLs, secrets and seed passwords.'
  Write-Host ''
  exit 1
}

$frontend = Join-Path $root 'frontend'
if (-not (Test-Path (Join-Path $frontend 'index.html'))) {
  Write-Error "Compiled frontend not found at $frontend."
  exit 1
}

# Prefer the bundled Node.exe so this folder works without a system Node install.
$node = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path $node)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Write-Host ''
    Write-Host 'NODE.JS REQUIRED' -ForegroundColor Yellow
    Write-Host 'No bundled runtime\node.exe and no node command was found on PATH.'
    Write-Host 'Install Node.js 22+ or restore runtime\node.exe.'
    Write-Host ''
    exit 1
  }
  $node = $nodeCommand.Source
}

Set-Location (Join-Path $root 'backend')
$env:SERVE_FRONTEND = 'true'
$env:FRONTEND_DIST = $frontend

Write-Host '[1/3] Running database migrations'
& $node dist/db/migrate.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host "Migration failed with exit code $LASTEXITCODE. Check PostgreSQL and .env." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host '[2/3] Running idempotent seed'
& $node dist/scripts/seed.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host "Seed failed with exit code $LASTEXITCODE." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host '[3/3] Starting SSIMS API and SPA'
$port = if ($env:API_PORT) { $env:API_PORT } else { '4000' }
Write-Host "Open http://localhost:$port"
& $node dist/server.js
