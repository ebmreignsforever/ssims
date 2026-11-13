# Implemented Security Mechanisms

This document explains how each security control is implemented, where the code lives and what evidence demonstrates that it works. It is intentionally concrete: configuration and code, not only intent.

## 1. Trust boundaries

| Boundary | Trusted? | Controls |
|---|---|---|
| Browser input | No | Zod validation, sanitisation, output escaping, CSP |
| Access token | Treated as bearer until verified | JWT signature, issuer/audience, live session lookup, expiry |
| Refresh cookie | No | HttpOnly, SameSite, rotation, hash lookup, reuse detection |
| API | Trusted code | Central error handling, RBAC, parameterised SQL, audit |
| PostgreSQL | Trusted data store | TLS, least-privilege roles, constraints, triggers |
| Docker network | Segmented | Public edge only Nginx; DB internal-only |
| Webhook caller | No | HMAC signature, timestamp, unique event ID |
| Lab tester | Authorized administrator only | `lab:run` permission, low-volume tests, case evidence |

The backend never treats client-side role checks or UI state as authorization.

---

## 2. Fail-closed configuration

**Files:** `backend/src/config/index.ts`, `docker-compose.yml`, `.env.example`

- All cryptographic secrets are validated at process start.
- JWT/CSRF/challenge/webhook secrets must be at least 32 characters.
- `MFA_ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes).
- Production mode refuses:
  - `COOKIE_SECURE=false`;
  - `EXPOSE_RESET_TOKEN=true`;
  - `DB_SSL_MODE=disable`.
- Compose uses `${VAR:?message}` so missing secrets prevent startup.
- `.dockerignore` excludes `.env` from images.
- The API disables `X-Powered-By` and does not return stack traces.

**Why:** A service that starts with a default or missing secret is worse than one that refuses to start.

---

## 3. Password security

**Files:** `backend/src/utils/passwordPolicy.ts`, `commonPasswords.ts`, `backend/src/services/authService.ts`

### 3.1 Hashing

Argon2id with:

```ts
{
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
}
```

Argon2 embeds a unique random salt and parameters in each hash. No plaintext password is stored. The project includes a regression test that hashes and verifies a password through the native module.

### 3.2 Policy

- 12–128 characters.
- Uppercase, lowercase, number and special character.
- Local compromise denylist (common passwords).
- Checks for keyboard patterns, repeated characters and common words.
- Rejects the account's email local part and name components.
- The same policy is used for registration, admin-created accounts, password change and password reset.

### 3.3 Reuse prevention

`password_history` stores prior hashes. On a password change/reset, the last `security_policies.password_history_count` hashes (default 5) are verified with Argon2. Reuse returns HTTP 400.

### 3.4 Password reset

- `crypto.randomBytes(32)` token.
- Stored as `HMAC-SHA256(CHALLENGE_SECRET, purpose + token)`.
- 30-minute expiry and single-use marker.
- All sessions revoked after reset.
- Forgot-password always returns the same generic message.
- In development, `EXPOSE_RESET_TOKEN=true` returns a reset URL to make the academic demo usable. Production validation rejects this setting.
- The token is never logged.

### 3.5 Password changes

`POST /api/auth/change-password` requires the current password, validates the new password, checks history, and revokes every session after the update. The UI signs the user out and requires reauthentication.

Accounts with `must_change_password` (including administrator-created accounts and password-reset accounts) are enforced by middleware: all protected API routes except `/auth/me`, `/auth/csrf`, `/auth/change-password`, `/auth/mfa/setup`, `/auth/mfa/enable` and logout return HTTP 403 `PASSWORD_CHANGE_REQUIRED`. The SPA redirects those users to the security settings page until the temporary credential is replaced.

---

## 4. Multi-factor authentication

**Files:** `backend/src/utils/totp.ts`, `backend/src/services/authService.ts`, `frontend/src/pages/shared/SettingsPage.tsx`

- Secret: 20 random bytes, Base32, TOTP RFC 6238, 30-second step, six digits, SHA-1.
- QR: generated with `qrcode.toDataURL`, compatible with standard authenticator apps.
- Secret at rest: AES-256-GCM (`encryptSecret`), with random IV and authentication tag.
- Replay: the matched TOTP time step is stored in `users.mfa_last_totp_step`; a code at or below that step is rejected.
- Clock drifts: ±1 step.
- Enrollment requires the current password before a new secret is displayed.
- Enabling requires a valid code; ten recovery codes are then generated.
- Recovery codes are stored as HMAC hashes and can be used once.
- Disabling requires both the password and a fresh TOTP.
- Policy enforcement: if `require_mfa_for_admins` or `require_mfa_for_lecturers` is enabled, an unenrolled session is restricted to `/auth/me`, `/auth/csrf`, `/auth/change-password`, `/auth/logout`, `/auth/mfa/setup` and `/auth/mfa/enable` until enrollment completes.

**Verification:** The E2E suite enrols MFA, confirms password-only login returns `MFA_REQUIRED`, logs in with a recovery code, then disables MFA with a fresh TOTP. A manual policy test confirmed a non-compliant administrator was restricted (HTTP 403) while still able to reach `/auth/me`.

---

## 5. JWT access tokens and refresh sessions

**Files:** `backend/src/services/tokenService.ts`, `authService.ts`, `backend/src/middleware/auth.ts`, `frontend/src/api/client.ts`

### Access token

- HS256 JWT with issuer `ssims-api`, audience `ssims-web`, subject, role, session ID, type and expiry.
- Default 15 minutes.
- Sent in `Authorization: Bearer`.
- Stored in a module-scoped variable in the SPA, not browser storage.
- On each request, the API verifies the signature and then loads the session, user role, status and policy from PostgreSQL. A stale token cannot preserve revoked access.

### Refresh token

- Opaque random value, 48 bytes.
- HMAC-SHA256 hash stored in `sessions.current_refresh_hash`.
- Cookie attributes: `HttpOnly`, `Secure` in production, `SameSite=Strict`, `Path=/api/auth`.
- Rotation: current hash → `previous_refresh_hash`; new raw token → cookie.
- Reuse detection: presenting the previous hash revokes every session for the user and records `REFRESH_TOKEN_REUSE` at `critical`.
- Absolute expiry 7 days.
- Idle expiry from `security_policies.session_timeout_minutes` (default 60), checked in both `authenticate` and refresh.
- Logout revokes the session.
- Password change/reset revoke all sessions.
- Account suspension/lock revoke sessions.

### CSRF token

- Random nonce + HMAC signature with `COOKIE_SECRET`.
- Readable `ssims_csrf` cookie plus `X-CSRF-Token` header.
- Server validates HMAC and constant-time equality.
- Rotated on refresh.
- Sent only with same-site SPA requests.

**Verification:** Tests cover refresh rotation, old-refresh replay (401 and family revocation), missing CSRF header (403), and logout invalidation.

---

## 6. Role-based access control

**Files:** `backend/src/middleware/auth.ts`, `backend/src/routes/*`, `database/migrations/001_schema.sql`

Roles: `super_admin`, `administrator`, `lecturer`, `student`.

The API uses both:

1. **Route permission guards** (`requireRoles`, `requirePermission`) that read the current database role.
2. **Data-scoped SQL**, for example lecturer roster queries include `c.lecturer_id = $2` and student queries include `e.student_id = $1`.

Key rules:

- Students are created only by public registration (role fixed to `student`) or by an administrator.
- Only super administrators can create administrative accounts or assign administrative roles.
- Administrators cannot modify a super administrator.
- Users cannot change their own role or status.
- Lecturers can grade only enrollments belonging to their assigned courses.
- Students can never select another student's record through an endpoint parameter; their identity comes from the verified session.
- MFA-required policy restrictions are enforced in middleware.

**Verification:** A real student access token called `/api/admin/users` and received 403; the Security Lab repeats this with a short-lived ephemeral token and records the response.

---

## 7. SQL injection defence

**Files:** all route/service queries, `backend/src/db/pool.ts`

- Every user value is passed as a bound parameter (`$1`, `$2`, …).
- Dynamic search filters append only fixed SQL clauses; user values go into the parameter array.
- Zod validates type/length/format.
- Database errors are converted to generic API errors by the central error handler.
- The API role cannot create schema objects.
- The lab executes a classic injection payload against a parameterised course query. PostgreSQL treats it as a literal; zero rows match and no query-structure change occurs.
- Evidence is recorded in `security_events` and `security_test_runs`.

---

## 8. XSS defence

**Files:** `backend/src/utils/validation.ts`, `backend/src/middleware/sanitize.ts`, React pages, `infra/nginx/default.conf`

- Recursive body sanitisation strips HTML tags/attributes and control characters.
- Sensitive credential fields are excluded from sanitisation so strong passwords are not altered; they are hashed and never rendered.
- React automatically escapes strings in JSX.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` exists in the frontend.
- Nginx adds:
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ...`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
- The lab processes a script/event-handler payload and demonstrates that executable markup is removed.

---

## 9. CSRF defence

**Files:** `backend/src/middleware/csrf.ts`, `backend/src/services/tokenService.ts`, `frontend/src/api/client.ts`

- Applied to every unsafe method under the authenticated API.
- Origin validation when the browser supplies an Origin.
- Double-submit token with HMAC signature.
- Constant-time comparison.
- SameSite=Strict cookies.
- Missing/forged token returns 403 `CSRF_VALIDATION_FAILED` and creates a high-severity security event.

The lab sends a forged refresh request with a plausible Origin and an invalid cookie/header pair and receives 403.

---

## 10. Brute force and account lockout

**Files:** `backend/src/middleware/rateLimit.ts`, `backend/src/services/authService.ts`

- Global API limiter: 500 requests / 5 minutes.
- Login limiter: 25 requests / 15 minutes per source IP.
- Per-account failed counter.
- Default lockout after 5 failures for 15 minutes.
- Human verification after 3 recent failures, required when a correct password is submitted; answers are hashed and expire after five minutes.
- MFA failures count toward lockout.
- Every attempt is written to `login_attempts` with IP, result and failure reason.
- Password, token and code values are excluded from logs.
- Administrators can unlock, lock or suspend accounts; restrictions revoke sessions.

**Verification:** The lab drives the real authentication service through multiple failures and observes HTTP 423 with a lockout timestamp, then restores the isolated account.

---

## 11. Database security

**Files:** `database/migrations/*.sql`, `database/init/00-roles.sh`, `infra/postgres/*`, `backend/src/db/pool.ts`

### Roles

- `ssims_owner`: schema/migration owner; no superuser.
- `ssims_app`: runtime DML only, column-limited `users` updates, no DDL, no security-log mutation.
- `ssims_readonly`: SELECT only.
- PostgreSQL superuser is used only for initial container bootstrap.

### TLS

- Compose starts PostgreSQL with `ssl=on`, certificate/key/CA files.
- `pg_hba.conf`: `hostssl ... scram-sha-256`; `hostnossl ... reject`.
- API uses `DB_SSL_MODE=verify-full`, CA file and `servername=db`.
- Production config refuses `DB_SSL_MODE=disable`.

### Audit and immutability

- Triggers audit row changes in `users`, `grades`, `courses`, `enrollments` and `departments`.
- Sensitive user columns are stripped from audit snapshots.
- Security event/login attempt/webhook/test/audit tables reject UPDATE/DELETE.
- The app role lacks permission to update or delete these tables.
- The lab evidence is append-only.

### Constraints

- Enums for role/status/severity.
- Unique email case-insensitive index.
- Student ID uniqueness and role consistency.
- Score 0–100.
- Letter grade computed by trigger.
- Foreign keys protect referential integrity.

**Verification:** psql as `ssims_app` showed `is_superuser=false`; UPDATE/DELETE on `security_events` was denied; CREATE TABLE was denied; hashes began with `$argon2id$v=19$m`.

---

## 12. Security monitoring and immutable logs

**Files:** `backend/src/services/auditService.ts`, `backend/src/routes/security.ts`, `frontend/src/pages/admin/SecurityMonitoringPage.tsx`

Recorded events include successful/failed logins, MFA failures, lockouts, password changes/resets, CSRF rejections, rate limits, unauthorized access, IP blocks, role/status changes, policy changes, webhook acceptance/rejection/replay, laboratory tests, SQL injection/XSS attempts and database audit rows.

Each event includes:

- timestamp;
- user ID / actor email;
- source IP;
- event type;
- severity;
- description;
- structured metadata;
- request ID and user agent.

The admin UI filters by severity, event type, date range and free text; it supports pagination and CSV export. CSV values beginning with `=`, `+`, `-` or `@` are prefixed with an apostrophe to prevent formula injection. Security records cannot be edited or deleted through ordinary application permissions.

---

## 13. IP access restrictions

**Files:** `backend/src/middleware/ipRules.ts`, `backend/src/routes/security.ts`

- CIDR rules stored in `ip_rules`.
- Deny wins.
- Any allow rule activates default-deny for addresses not matched.
- IPv4 and IPv6 supported via `ipaddr.js`.
- Rules can expire.
- Cache refreshes within 30 seconds.
- Blocked requests return 403 and create `IP_ACCESS_BLOCKED`.

---

## 14. Signed webhooks

**Files:** `backend/src/routes/webhooks.ts`, `database/migrations/001_schema.sql`

Canonical input:

```text
<unix timestamp>.<event id>.<raw JSON body>
```

Signature:

```text
hex(HMAC-SHA256(WEBHOOK_SECRET, canonical input))
```

Headers:

```text
X-SSIMS-Event-Id
X-SSIMS-Timestamp
X-SSIMS-Event-Type
X-SSIMS-Signature
```

Checks:

1. Header syntax.
2. Raw-body HMAC with constant-time comparison.
3. Timestamp within ±300 seconds.
4. Unique `event_id` insert.
5. Safe JSON persistence and security event.

Responses:

- `202` accepted;
- `400` malformed headers;
- `401` invalid signature/expired timestamp;
- `409` replayed event ID.

The secret is server-only. The lab sends a forged all-zero signature and receives 401; the E2E suite signs a valid event, gets 202, replays it and gets 409.

---

## 15. Kerberos simulation

**Files:** `backend/src/services/kerberosSimulation.ts`, `backend/src/routes/kerberos.ts`, `frontend/src/pages/admin/KerberosPage.tsx`

The simulation demonstrates:

- AS pre-authentication using an encrypted timestamp;
- TGT encrypted with the TGS long-term key;
- client/TGS session key protected by the client key;
- TGS request with a TGT and timestamped authenticator;
- service ticket encrypted with the service key;
- AP request and mutual authentication response (timestamp + 1);
- replay rejection.

AES-256-GCM is used for simulated tickets. Keys are derived from a local simulation secret. The UI prominently states it is **not real Kerberos**, does not contact a KDC and is not wire-compatible. The report and a dedicated document list the boundaries.

---

## 16. Security Testing Lab

**Files:** `backend/src/services/labService.ts`, `backend/src/routes/lab.ts`, `frontend/src/pages/admin/SecurityLabPage.tsx`

The lab is administrator-only (`lab:run`) and restricted to local endpoints. It runs:

1. SQL injection (parameterised query).
2. Brute force and lockout (real auth service, isolated account).
3. XSS sanitisation/output encoding.
4. Unauthorized access (ephemeral student session calls admin API).
5. MITM/transport evidence (`pg_stat_ssl`, runtime SSL mode).
6. CSRF forged refresh.
7. Webhook forgery.
8. Controlled DDoS (12 calls to a dedicated 8/10s limiter; real 429s).

Each run writes a `security_test_runs` row with description, procedure, expected, actual, mechanism, evidence, actor, IP and timestamp. The page shows the evidence ledger and supports reset of the lab account.

---

## 17. Transport and infrastructure security

**Files:** `infra/nginx/default.conf`, `docker-compose.yml`, `infra/certs/*`, `infra/postgres/*`

- HTTPS listener with TLS 1.2/1.3 and ECDHE suites.
- HTTP 301 redirect to HTTPS.
- HSTS one year.
- CSP, frame denial, nosniff, referrer policy, permissions policy, COOP/CORP.
- Server tokens off.
- Rate and connection limits for API, login, webhook and all requests.
- Request size/timeouts.
- Upstream backend/frontend names only on internal Docker networks.
- DB and API ports unpublished.
- CA private key only in `ca_certs`; web/db certificates isolated. The API receives a bind-mounted CA certificate file only, never the database server private key or CA private key.
- Non-root runtime containers, read-only filesystems, tmpfs, `no-new-privileges`.

A volumetric DDoS cannot be stopped by Nginx rate limiting alone. Production requires upstream scrubbing/CDN capacity; this is documented rather than falsely claimed.

---

## 18. Logging and secret hygiene

**Files:** `backend/src/utils/logger.ts`, `backend/src/services/auditService.ts`

- Pino redaction covers authorization/cookie/signature headers and password/token/MFA fields.
- Request logging includes method, path, status, latency and IP—not bodies or query strings.
- Security metadata filtering drops sensitive key names.
- Error responses are generic.
- Temporary passwords are shown once in the admin UI and are not stored in plaintext.
- Reset and refresh tokens are stored only as hashes.
- TOTP secrets are encrypted.
- The frontend never contains `WEBHOOK_SECRET`, `JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY` or database credentials.

---

## 19. Verification map

| Mechanism | Automated evidence |
|---|---|
| Argon2id/TOTP/AES/JWT/Kerberos | 12 unit tests |
| Login, MFA, refresh rotation, reuse detection | E2E section 2–5 |
| RBAC and data scope | E2E section 3; functional section 2 |
| CSRF, webhooks, lab, audit, Kerberos, logout | E2E sections 4–10 |
| Registration, password reset, admin CRUD, grading | 41-check functional suite |
| Database immutability/least privilege | psql negative tests |
| UI rendering, responsive layout and refresh restoration | 29 browser checks, 16 screenshots |
| Session restoration after full reload | Admin and student pages reload from the HttpOnly refresh cookie without a redirect loop |
| MFA policy enforcement | Manual API test: 403 for dashboard, 200 for `/auth/me`, policy reset restored access |

---

## 20. Security limitations

- Self-signed CA and local trust.
- TOTP rather than phishing-resistant WebAuthn.
- No external email provider.
- In-memory rate limiting for a single instance.
- Kerberos simulation only.
- Docker Compose is single-host; no Kubernetes/host hardening beyond the documented controls.
- No formal penetration test or third-party audit.
- Local UI verification uses Microsoft Edge; CI should provision a pinned browser.
