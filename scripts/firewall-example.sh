#!/usr/bin/env bash
# =============================================================================
# Example host firewall for a single-node SSIMS deployment (Ubuntu + UFW).
# Adapt the administrative CIDR before running. The database must have NO
# published port, so no 5432 rule is required or permitted.
#
# WARNING: review and apply through your cloud provider's security group as well.
# =============================================================================
set -euo pipefail

ADMIN_CIDR="${ADMIN_CIDR:-203.0.113.0/24}"
SSH_PORT="${SSH_PORT:-22}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_CIDR" to any port "$SSH_PORT" proto tcp comment 'SSH from administrative network'
ufw allow 80/tcp comment 'HTTP redirect to HTTPS'
ufw allow 443/tcp comment 'SSIMS HTTPS'
ufw deny 5432/tcp comment 'PostgreSQL must never be exposed'
ufw deny 4000/tcp comment 'API is internal to Docker'
ufw deny 8080/tcp comment 'Frontend/Adminer are internal'
ufw --force enable
ufw status verbose
