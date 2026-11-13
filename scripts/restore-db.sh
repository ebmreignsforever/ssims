#!/usr/bin/env bash
# =============================================================================
# Restore a pg_dump custom-format archive into the Docker Compose database.
# The API is stopped during restore to prevent writes and inconsistent reads.
#
# Usage: ./scripts/restore-db.sh backups/ssims-20260101T000000Z.dump[.gpg]
# =============================================================================
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup.dump[.gpg]>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "Backup not found: $INPUT" >&2
  exit 1
fi

WORK="$INPUT"
if [[ "$INPUT" == *.gpg ]]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "gpg is required to decrypt $INPUT" >&2
    exit 1
  fi
  WORK="${INPUT%.gpg}.restore.dump"
  gpg --batch --yes --decrypt --output "$WORK" "$INPUT"
fi

echo "[restore] Stopping API, edge and frontend to prevent writes"
docker compose stop nginx backend frontend || true

REMOTE="/tmp/ssims-restore-$$.dump"
docker compose cp "$WORK" "db:$REMOTE"

echo "[restore] Restoring (clean + if-exists). Review output for ownership warnings."
docker compose exec -T db pg_restore -U ssims_owner -d ssims --clean --if-exists --no-owner --role=ssims_owner "$REMOTE" || {
  echo "[restore] pg_restore reported errors. Inspect them before restarting the API." >&2
  exit 1
}
docker compose exec -T db rm -f "$REMOTE"
if [[ "$WORK" != "$INPUT" ]]; then rm -f "$WORK"; fi

echo "[restore] Restarting services"
docker compose up -d backend frontend nginx
echo "[restore] Complete. Verify /health and sign in with a known account."
