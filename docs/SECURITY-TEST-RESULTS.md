# Security Test Procedures and Results

**Execution date:** 11 November 2026  
**Scope:** Local SSIMS deployment only (authorized test environment)  
**API:** `http://127.0.0.1:4000`  
**UI:** `http://localhost:5173` (Vite + live API)  
**Database:** PostgreSQL 18.6 local verification cluster  
**Runtime:** Node.js 24.21.0, Argon2id 0.41.1, React 18, React Router 7.18.5, Vite 6.4.6, Zod 4.6.7  
**Browser:** Microsoft Edge headless controlled by Playwright Core

> All tests were run only against the project's own local instance. No third-party system was contacted.

---

## 1. Executive result

| Suite | Passed | Total | Result |
|---|---:|---:|---|
| Backend security unit tests | 12 | 12 | PASS |
| Live API/security E2E checks | 41 | 41 | PASS |
| Functional E2E checks | 41 | 41 | PASS |
| Headless UI/browser checks | 27 | 27 | PASS |
| Database privilege negative checks | 3 | 3 | PASS (denied as expected) |
| Security Lab exercises | 8 | 8 completed | 7 PASS + 1 INFO (MITM local) |
| Production dependency audit (`pnpm audit --prod`) | — | — | **No known vulnerabilities** |

---

## 2. Unit tests

Command:

```bash
pnpm --dir backend test
```

Result:

```text
Test Files  1 passed (1)
Tests       12 passed (12)
```

Coverage:

1. Password shorter than 12 rejected.
2. Missing uppercase/number/special rejected.
3. Common compromised password rejected.
4. Password containing email local part rejected.
5. Strong passphrase accepted.
6. TOTP code generated and matched to the correct time step.
7. Wrong-secret TOTP rejected.
8. Malformed TOTP rejected.
9. `otpauth://` enrollment URI contains issuer and secret.
10. AES-256-GCM encrypt/decrypt round trip and tamper detection.
11. Base32 round trip and constant-time-style comparison helper.
12. JWT claims signed/verified; Kerberos simulation completes all checks including replay rejection.

The Kerberos simulation assertion covers pre-authentication, TGT, service ticket, authenticator freshness, mutual authentication and replay rejection.

---

## 3. Live API/security E2E suite

Command:

```bash
pnpm test:e2e
```

The runner uses a real cookie jar, real JWTs, real CSRF headers and the real database. It does not mock the API.

### 3.1 Health and public metadata (2)

| Check | Result |
|---|---|
| API healthy and PostgreSQL connected | PASS |
| Public security metadata endpoint responds | PASS |

### 3.2 Administrator authentication and RBAC (6)

| Check | Result | Evidence |
|---|---|---|
| Administrator signs in with Argon2id credentials | PASS | HTTP 200 |
| HttpOnly refresh cookie issued | PASS | `ssims_rt` cookie |
| CSRF double-submit cookie issued | PASS | `ssims_csrf` cookie |
| Access token authenticates `/auth/me` | PASS | HTTP 200 |
| Dashboard metrics readable | PASS | HTTP 200 |
| User list readable with permission | PASS | HTTP 200 |

### 3.3 Student authentication and authorization (3)

| Check | Result | Evidence |
|---|---|---|
| Student signs in | PASS | HTTP 200 |
| Student denied administrator endpoint | PASS | **HTTP 403** |
| Student can read own results | PASS | HTTP 200 |

### 3.4 CSRF and refresh-token rotation (5)

| Check | Result | Evidence |
|---|---|---|
| Refresh without CSRF header rejected | PASS | **HTTP 403 `CSRF_VALIDATION_FAILED`** |
| Unauthenticated refresh rejected | PASS | HTTP 401/403 |
| Refresh rotates on use | PASS | New cookie differs |
| Replayed previous refresh token rejected | PASS | **HTTP 401**; family revoked |
| Reauthentication after revocation | PASS | HTTP 200 |

### 3.5 MFA enrolment and login (5)

| Check | Result | Evidence |
|---|---|---|
| TOTP secret + QR generated | PASS | PNG data URL and Base32 secret |
| MFA enabled; 10 backup codes | PASS | HTTP 200 |
| Password alone refused | PASS | **HTTP 401 `MFA_REQUIRED`** |
| Backup code completes login | PASS | HTTP 200 + access token |
| MFA disabled with fresh TOTP | PASS | HTTP 200 |

### 3.6 Webhook security (3)

| Check | Result | Evidence |
|---|---|---|
| Valid HMAC accepted | PASS | **HTTP 202** |
| Replayed event ID rejected | PASS | **HTTP 409** |
| Invalid signature rejected | PASS | **HTTP 401** |

A correctly signed webhook whose timestamp was 600 seconds in the past was also tested manually and rejected with **HTTP 401 `WEBHOOK_EXPIRED`**.

### 3.7 Security Testing Lab (10)

| Check | Result | Actual |
|---|---|---|
| Eight tests registered | PASS | 8 definitions |
| SQL injection | PASS | Payload treated as literal; 0 rows; no SQL error |
| XSS | PASS | Script/event handler stripped |
| Unauthorized access | PASS | HTTP 403 from administrator endpoint |
| MITM | INFO | Local HTTP/DB-without-TLS dev; Docker configuration is HTTPS + verify-full |
| CSRF | PASS | HTTP 403 `CSRF_VALIDATION_FAILED` |
| Webhook forgery | PASS | HTTP 401 `WEBHOOK_INVALID_SIGNATURE` |
| DDoS | PASS | 8×200, 4×429 |
| Brute force | PASS | HTTP 423; 5 failures; challenge issued |
| Lab target restored | PASS | HTTP 200 |

### 3.8 Monitoring and audit visibility (4)

| Check | Result |
|---|---|
| Filtered security events | PASS |
| Login attempt telemetry | PASS |
| Database audit log | PASS |
| IP rule listing | PASS |

### 3.9 Kerberos simulation (1)

| Check | Result | Evidence |
|---|---|---|
| Mutual authentication + replay rejection | PASS | 7 protocol steps, all six checks true |

### 3.10 Logout and session invalidation (2)

| Check | Result |
|---|---|
| Logout revokes current session | PASS |
| Revoked session cannot access protected endpoint | PASS (HTTP 401) |

---

## 4. Functional end-to-end suite

Command:

```bash
pnpm test:functional
```

Result: **41 / 41 passed**. The suite creates temporary records, verifies the workflow, then removes test rows through a controlled owner cleanup; audit and security events remain.

Coverage:

| Area | Checks |
|---|---|
| Department management | Create department |
| User administration | Create lecturer with one-time password; locate seeded student; administrator restrictions |
| Course management | Create course; assign lecturer; enroll student |
| Lecturer workflow | Temporary-credential login; forced password-change restriction; permanent-password login; dashboard; roster; record grade; cross-course denial; admin-route denial |
| Student workflow | Login; sees own course/grade; denied lecturer API |
| Account restrictions | Administrator cannot modify super admin; cannot create another administrator; suspension invalidates session; temporary password reset |
| Registration | Successful registration; duplicate rejection; weak-password rejection; login; permitted profile update |
| Password reset | Development reset link; single-use token; old password rejected; new password accepted; token reuse rejected |
| Policy and network | Super-admin policy edit/restore; admin policy denial; IP deny rule add/remove; department deletion blocked while courses exist |
| Cleanup | Temporary users/course/department removed; append-only guard restored |

Output: `artifacts/functional-e2e-output.txt`.

---

## 5. Headless UI verification

Command:

```bash
pnpm test:ui
```

Result: **29 / 29 passed**. Browser console errors: **0**. Unexpected API errors during navigation: **0**.

| Group | Checks |
|---|---|
| Login | Page renders; branding renders |
| Administrator | Dashboard; metrics; chart; full-page refresh session restoration; user management; course catalogue; security monitoring; 20 event rows; lab; 8 lab cards; Kerberos; disclaimer; settings |
| Student | Dashboard; GPA card; full-page refresh session restoration; transcript; MFA controls |
| Lecturer | Dashboard; teaching metrics; course cards; roster |
| Mobile | No horizontal overflow; student dashboard; navigation drawer opens |
| Quality | No console errors; no unexpected API errors |

Screenshots:

| File | View |
|---|---|
| `artifacts/screenshots/01-login-desktop.png` | Secure login |
| `02-admin-dashboard.png` | Administrator security dashboard |
| `03-admin-users.png` | User/account management |
| `04-admin-courses.png` | Course catalogue |
| `05-security-monitoring.png` | Security events and audit |
| `06-security-lab.png` | Eight test lab + evidence ledger |
| `07-kerberos.png` | Kerberos simulation |
| `08-security-settings.png` | Admin profile/security |
| `09-student-dashboard.png` | Student overview |
| `10-student-results.png` | Student transcript |
| `11-student-security.png` | Student profile/MFA |
| `12-lecturer-dashboard.png` | Lecturer overview |
| `13-lecturer-courses.png` | Lecturer course cards |
| `14-course-workspace.png` | Roster/grading workspace |
| `15-login-mobile.png` | Mobile login |
| `16-mobile-dashboard.png` | Mobile navigation |

Raw check data: `artifacts/ui-verification.json`. The complete API suite output is saved at `artifacts/e2e-smoke-output.txt`.

---

## 6. Database negative tests

Authenticated as the runtime role `ssims_app`:

```sql
SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
-- ssims_app | f
```

| Attempt | Result |
|---|---|
| `UPDATE security_events SET description='tampered' ...` | `ERROR: permission denied for table security_events` |
| `DELETE FROM security_events ...` | `ERROR: permission denied for table security_events` |
| `CREATE TABLE should_fail(id int)` | `ERROR: permission denied for schema public` |

Additional observations:

- All sampled password hashes begin `$argon2id$v=19$m`.
- `users` grants to the app role are INSERT + SELECT plus column-limited UPDATE, not arbitrary table-wide update.
- `security_events` grants are INSERT + SELECT only.
- `audit_log` grants are SELECT only; the audit trigger runs with definer privileges.

Those results prove that the application role cannot modify its own security evidence through normal SQL permissions, even before the append-only trigger fires.

---

## 7. MFA policy enforcement check

Procedure:

1. Sign in as an administrator without MFA.
2. Enable `require_mfa_for_admins` directly in the policy row (equivalent to a super administrator saving the policy).
3. Request the security dashboard.
4. Request `/auth/me`.
5. Reset the policy.

Actual:

| Request | Status | Body/field |
|---|---:|---|
| `GET /api/admin/dashboard` | **403** | “Multi-factor authentication enrollment is required by security policy” |
| `GET /api/auth/me` | 200 | `mfaEnrollmentRequired: true` |
| `GET /api/admin/dashboard` after policy reset | 200 | Dashboard data |

This verifies that policy is enforced in middleware and that the enrollment path remains reachable.

---

## 8. Security Lab result details

### 7.1 SQL injection

- Input: `' OR '1'='1' --`
- Bind style: `$1` via node-postgres.
- Rows returned: 0.
- SQL error exposed: false.
- Database role: `ssims_app` (DML only, no DDL, no SUPERUSER).
- Security event: `SQL_INJECTION_ATTEMPT`, severity high.

### 7.2 Brute force

- Target: isolated `security.lab@ssims.edu` account.
- Policy: 5 maximum failures, 15-minute lockout, challenge after 3 failures.
- Observed statuses: repeated 401, challenge issued on correct-password probe, then **423**.
- Final state: `locked`, 5 failures, lockout timestamp present.
- Evidence shows the challenge prompt count.
- Reset restores the account and marks outstanding challenges consumed.

### 7.3 XSS

- Payload includes `<script>alert('SSIMS-XSS')</script>` and `<img onerror=...>`.
- Sanitised output contains no angle brackets or event handler.
- React would render the text escaped; no `dangerouslySetInnerHTML` exists.
- CSP is applied at Nginx in Docker.

### 7.4 Unauthorized access

- Ephemeral student session inserted for the test.
- Student JWT calls `GET /api/admin/users`.
- Response: **403 FORBIDDEN**.
- Session deleted immediately.
- `UNAUTHORIZED_ACCESS` event recorded.

### 7.5 MITM

Local evidence:

- API-to-database SSL: false (local dev cluster has TLS disabled).
- `DB_SSL_MODE=disable` in local verification.
- Status: `info` because the local environment intentionally does not emulate the Docker TLS path.

Docker path:

- Nginx HTTPS 443 with TLS 1.2/1.3, HSTS.
- PostgreSQL `hostssl` only.
- API `DB_SSL_MODE=verify-full`.
- Project CA and `servername=db`.

Because no Docker daemon was available in the verification environment, this hard-pass path was not runtime-executed; it is configuration-verified. This is stated in the limitations.

### 7.6 CSRF

- Internal POST to `/api/auth/refresh` with forged cookie/header.
- Response: 403 `CSRF_VALIDATION_FAILED`.
- Security event created.

### 7.7 Webhook forgery

- All-zero HMAC signature.
- Response: 401 `WEBHOOK_INVALID_SIGNATURE`.
- Rejected webhook row appended.
- No business action executed.

### 7.8 DDoS

- 12 sequential local requests in a 10-second window.
- 8 HTTP 200 and 4 HTTP 429.
- `Retry-After` headers observed.
- Scope is an isolated authenticated probe endpoint.
- Nginx adds rate and connection limits in Docker, but volumetric attacks require upstream mitigation.

---

## 9. Reproduction

Prerequisites: API running with a seeded database; for UI, Vite dev server running.

```bash
pnpm test
pnpm test:e2e
pnpm test:functional
pnpm test:ui
```

Expected: 12 unit, 41 security E2E, 41 functional and 29 UI checks pass.

The E2E suite requires `.env` at the repository root. It reads `WEBHOOK_SECRET` only to sign test webhooks from the trusted local test process; no secret is exposed to browser code.

The UI suite expects Microsoft Edge at:

```text
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
```

Change `EDGE` in `scripts/ui-verify.mjs` to use another Chromium installation.

---

## 10. Dependency advisory check

```bash
pnpm audit --prod --audit-level=moderate
# No known vulnerabilities found
```

During verification, advisories in Zod (memory exhaustion) and React Router (open redirect / constructor injection) were identified and remediated by upgrading to Zod 4.6.7 and React Router 7.18.5. The full API and UI suites were re-run after the upgrades and passed.

---

## 11. What was not tested

- Live Docker Compose startup (Docker daemon absent in the verification environment).
- Volumetric DDoS / upstream scrubbing.
- A real Kerberos KDC.
- A real SMTP provider.
- External penetration testing.
- Multi-replica rate limiter/session coordination.
- Browser matrix beyond Microsoft Edge.

These are documented limitations, not silently claimed passes.
