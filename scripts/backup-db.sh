#!/usr/bin/env bash
# =============================================================================
# Logical PostgreSQL backup for the Docker Compose deployment.
# Uses pg_dump's custom format, then copies the archive out of the container so
# PowerShell/Windows terminals never need to pipe binary data.
#
# Usage: ./scripts/backup-db.sh
# Optional: BACKUP_GPG_RECIPIENT=security@example.com for asymmetric encryption
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p backups

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE="/tmp/ssims-backup-$STAMP.dump"
LOCAL="$ROOT/backups/ssims-$STAMP.dump"

echo "[backup] Dumping database through the trusted local socket"
docker compose exec -T db pg_dump -U ssims_owner -Fc -f "$REMOTE" ssims

docker compose cp "db:$REMOTE" "$LOCAL"
docker compose exec -T db rm -f "$REMOTE"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "[backup] gpg is not installed; refusing to leave an unencrypted archive while encryption was requested" >&2
    exit 1
  fi
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$LOCAL"
  shred -u "$LOCAL" 2>/dev/null || rm -f "$LOCAL"
  LOCAL="$LOCAL.gpg"
fi

chmod 600 "$LOCAL"
echo "[backup] Complete: $LOCAL"
echo "[backup] Store the archive off-host and test restores regularly."
