# Firewall, Network Segmentation and DDoS Protection

## 1. Security perimeter

Only the Nginx edge is published to the host. Every other service communicates over internal Docker networks.

```
Internet / campus network
        │
        │ TCP 80, 443
        ▼
┌──────────────────────────┐
│ Nginx edge (edge_net)    │  TLS, HSTS, CSP, rate limits
└───────┬──────────┬───────┘
        │          │
  static│          │/api
        ▼          ▼
┌────────────┐  ┌──────────────┐
│ React SPA  │  │ Express API  │  app_net (internal)
│ frontend   │  │ backend      │
└────────────┘  └──────┬───────┘
                       │ TLS verify-full, db_net (internal)
                       ▼
                ┌──────────────┐
                │ PostgreSQL   │
                └──────┬───────┘
                       │ admin_net (internal, optional only)
                       ▼
                ┌──────────────┐
                │ Adminer      │  127.0.0.1:8080
                └──────────────┘
```

The database is never published to the host. The API and frontend are never published. Adminer is optional and bound to loopback.

---

## 2. Docker networks

| Network | `internal` | Services | Purpose |
|---|---:|---|---|
| `edge_net` | No | Nginx | Public ingress |
| `app_net` | Yes | Nginx, frontend, API | Application traffic |
| `db_net` | Yes | API, migration, PostgreSQL | Database traffic |
| `admin_net` | Yes | PostgreSQL, Adminer | Administrative access |

Because `app_net`, `db_net` and `admin_net` are `internal: true`, containers on those networks do not receive a default route to the Internet. Build/download steps occur at image build time, not at runtime.

---

## 3. Published ports

| Host | Container | Service | Notes |
|---:|---:|---|---|
| 80 | 8080 | Nginx | 301 redirect to HTTPS |
| 443 | 8443 | Nginx | TLS endpoint |
| 127.0.0.1:8080 | 8080 | Adminer (profile only) | loopback-only admin UI |
| — | 4000 | API | not published |
| — | 5432 | PostgreSQL | not published |
| — | 8080 | Frontend static | not published |

---

## 4. Host firewall

`scripts/firewall-example.sh` provides a UFW baseline. Review it before use.

Principles:

1. Default deny inbound, allow outbound.
2. SSH only from the administrative network.
3. Allow 80 and 443 to the edge.
4. Explicitly deny 5432, 4000 and 8080.
5. Apply equivalent rules in the cloud security group; host firewalls do not replace network ACLs.
6. Keep Docker's published ports aligned with the firewall. A published port that bypasses the firewall is a common misconfiguration.

Example commands:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 203.0.113.0/24 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 5432/tcp
sudo ufw deny 4000/tcp
sudo ufw deny 8080/tcp
sudo ufw enable
sudo ufw status verbose
```

### nftables example

```nft
table inet ssims {
  chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    iif lo accept
    ip saddr 203.0.113.0/24 tcp dport 22 accept
    tcp dport { 80, 443 } accept
    tcp dport { 5432, 4000, 8080 } drop
    counter drop
  }
}
```

### Windows local development

Only Vite (5173) and API (4000) need loopback access. PostgreSQL should listen on `127.0.0.1` only. Do not expose 5432 through Windows Defender Firewall.

---

## 5. Nginx edge controls

Configuration: `infra/nginx/default.conf`.

### TLS

- TLS 1.2 and 1.3 only.
- ECDHE cipher suites.
- Session cache and tickets disabled.
- HTTP/2.
- HTTP to HTTPS 301 redirect.
- Certificate chain and key mounted read-only from a dedicated volume.
- CA private key is not mounted into Nginx.

### Headers

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy` with no inline scripts and no object embedding
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` denies camera, microphone, geolocation, payment and USB
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `server_tokens off`

### Rate limiting

```nginx
limit_req_zone $binary_remote_addr zone=ssims_api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=ssims_auth:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=ssims_webhook:10m rate=20r/s;
limit_conn_zone $binary_remote_addr zone=ssims_conn:10m;
```

- `/api/auth/login`: 20 requests/minute, burst 10.
- Registration/forgot/reset: 20 requests/minute, burst 6.
- General API: 30 requests/second, burst 60.
- Webhook: 20 requests/second, burst 40.
- 40 concurrent connections per source IP.
- Exceeded limits return HTTP 429 JSON.
- Body limit 1 MiB; API parser limit 100 KiB.
- Client/body/read timeouts are bounded.

### Application layer

Express adds independent rate limits, account lockout, human verification and IP rules. Multiple layers are intentional: Nginx sheds obvious traffic before Node.js, while the application can reason about accounts and policies.

---

## 6. Database not externally reachable

- No `ports:` entry for `db`.
- PostgreSQL `listen_addresses` remains internal.
- `pg_hba.conf` rejects `hostnossl`.
- Hostname `db` and a project CA are used with `verify-full`.
- Only `app_net`/`db_net`/`admin_net` services can reach 5432.
- Adminer is the only optional admin UI and is loopback-only.

Verify on the host:

```bash
ss -lntp | grep 5432       # should not show a Docker-published 0.0.0.0:5432
docker compose port db 5432 # should report no public port
```

---

## 7. Secure communication summary

| Path | Protection |
|---|---|
| Browser → Nginx | HTTPS TLS 1.2/1.3, HSTS, certificate |
| Browser → API | HTTPS through same-origin Nginx; JWT + CSRF |
| Nginx → API | Internal Docker `app_net`; no public port |
| API → PostgreSQL | TLS with `verify-full`, CA, hostname `db` |
| Webhook sender → API | HTTPS + HMAC-SHA256 + timestamp + unique ID |
| Admin → Adminer | Localhost-only host binding; optional profile |
| Container images | Built from pinned base tags; `.dockerignore` excludes secrets |

Internal application networks are not encrypted at the link layer; they are isolated and not routable from the public edge. A high-assurance deployment can add service mesh mTLS, but that is outside this academic scope.

---

## 8. DDoS protection

### 8.1 What this project demonstrates

- Controlled low-volume request burst (12 calls).
- Real application-level token bucket.
- Real HTTP 429 responses.
- Nginx `limit_req` and `limit_conn` configuration.
- Timeouts and body limits.
- A separate probe endpoint so normal users are unaffected.

The lab sends **8 accepted + 4 throttled** requests. It does not attempt to saturate bandwidth.

### 8.2 Why application rate limiting is not enough

A volumetric DDoS can exhaust:

- upstream transit capacity;
- ISP links;
- stateful firewalls/NAT;
- TLS handshakes;
- connection tables;
- reverse-proxy worker capacity.

By the time packets reach Nginx, the network may already be saturated. Application-level limits protect the application from abusive clients but cannot add bandwidth or absorb a botnet.

### 8.3 Upstream mitigation

A production deployment should use:

1. A CDN/anycast network to distribute and absorb traffic.
2. A cloud DDoS protection service (e.g., provider scrubbing, always-on L3/L4 protection).
3. A WAF for L7 rules, bot detection and managed rule sets.
4. Rate limiting at the edge and application layers.
5. Autoscaling for legitimate load, with a circuit breaker.
6. Monitoring and alerting on packet rate, connection rate, 429/5xx ratios and TLS handshake failures.
7. Incident response runbooks and provider escalation contacts.
8. Separation of the public edge from origin so origin IPs are not directly reachable.

### 8.4 Connection exhaustion controls

- Nginx keepalive/timeouts.
- Per-IP connection cap.
- API body limit.
- PostgreSQL pool limits and statement timeouts.
- Health-check-based restart policies.

### 8.5 Webhook flood protection

- Dedicated Nginx rate zone.
- Dedicated Express limiter.
- Unique event ID database constraint.
- Rejected events are logged but do not execute business actions.
- HMAC verification happens before payload processing.

---

## 9. Administrative access

- Adminer is in an optional Compose profile and bound to `127.0.0.1`.
- The database is attached to `admin_net` only for this purpose.
- In production, replace Adminer with a bastion/VPN/zero-trust session and never publish a DB UI.
- Administrative SSH should come from a dedicated management network or VPN, with MFA and key-based authentication.
- Security policy and role changes are audited.

---

## 10. Network verification commands

```bash
docker compose ps
docker compose port nginx 443
docker compose port db 5432
docker network inspect ssims_db_net
docker network inspect ssims_app_net
curl -I http://localhost
curl -kI https://localhost
openssl s_client -connect localhost:443 -servername localhost < /dev/null
```

Expected:

- only 80/443 published;
- HTTP returns 301 to HTTPS;
- HTTPS returns HSTS/CSP headers;
- DB has no published port;
- internal networks are marked internal;
- API/frontend are not reachable from the host.

---

## 11. Limitations

- Single-host Compose is not a highly available network design.
- No formal DDoS load test.
- No WAF configured inside the project (documented as an upstream control).
- Self-signed local CA must be replaced in production.
- Docker runtime verification was not possible in the test environment (no Docker daemon); configuration and file relationships were validated.
