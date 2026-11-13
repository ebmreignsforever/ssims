#!/bin/sh
# =============================================================================
# Generate a local certificate authority and separate TLS certificates for:
#   - the public Nginx edge (CN=localhost)
#   - PostgreSQL (CN=db, verified with verify-full by the API)
#
# This script is idempotent. The CA private key lives only in the ca_certs volume
# and is never mounted into Nginx, PostgreSQL or the API container.
# =============================================================================
set -eu

CA_DIR=/ca
WEB_DIR=/web
DB_DIR=/db
EXPORT_DIR=/export

mkdir -p "$CA_DIR" "$WEB_DIR" "$DB_DIR" "$EXPORT_DIR"

if [ ! -f "$CA_DIR/ca.key" ]; then
  echo "[certs] Generating local certificate authority"
  openssl genrsa -out "$CA_DIR/ca.key" 4096
  openssl req -x509 -new -nodes -key "$CA_DIR/ca.key" -sha256 -days 3650 \
    -subj "/C=GH/O=SSIMS University/OU=IT Security/CN=SSIMS Local Development CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$CA_DIR/ca.crt"
fi

issue_certificate() {
  name="$1"
  dir="$2"
  cn="$3"
  san="$4"
  if [ -f "$dir/fullchain.pem" ] && [ -f "$dir/server.key" ]; then
    echo "[certs] Existing $name certificate found; keeping it"
    return 0
  fi
  echo "[certs] Issuing $name certificate for $cn"
  openssl genrsa -out "$dir/server.key" 2048
  openssl req -new -key "$dir/server.key" -subj "/C=GH/O=SSIMS University/OU=IT Security/CN=$cn" -out "$dir/server.csr"
  cat > "$dir/server.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
  openssl x509 -req -in "$dir/server.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" \
    -CAcreateserial -out "$dir/server.crt" -days 825 -sha256 -extfile "$dir/server.ext"
  cat "$dir/server.crt" "$CA_DIR/ca.crt" > "$dir/fullchain.pem"
  rm -f "$dir/server.csr" "$dir/server.ext"
}

issue_certificate "web" "$WEB_DIR" "localhost" "DNS:localhost,DNS:ssims.local,IP:127.0.0.1"
issue_certificate "database" "$DB_DIR" "db" "DNS:db,DNS:localhost,IP:127.0.0.1"

# Only the CA certificate is shared with clients and the API; never the CA key.
cp "$CA_DIR/ca.crt" "$WEB_DIR/ca.crt"
cp "$CA_DIR/ca.crt" "$DB_DIR/ca.crt"
cp "$CA_DIR/ca.crt" "$EXPORT_DIR/ssims-local-ca.crt"

# nginx-unprivileged runs as UID/GID 101.
chown -R 101:101 "$WEB_DIR"
chmod 600 "$WEB_DIR/server.key"
chmod 644 "$WEB_DIR/server.crt" "$WEB_DIR/fullchain.pem" "$WEB_DIR/ca.crt"

# postgres:16-alpine runs as UID/GID 70.
chown -R 70:70 "$DB_DIR"
chmod 600 "$DB_DIR/server.key"
chmod 644 "$DB_DIR/server.crt" "$DB_DIR/ca.crt"

chmod 644 "$EXPORT_DIR/ssims-local-ca.crt"
echo "[certs] Certificates ready. Import infra/certs/generated/ssims-local-ca.crt to trust the local CA."
