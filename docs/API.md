# SSIMS REST API Reference

Base URL in local development: `http://127.0.0.1:4000`  
Base URL in Docker: `https://localhost/api` (through Nginx)

All browser traffic is same-origin through Nginx. The frontend never connects directly to PostgreSQL.

---

## 1. Response format

Success:

```json
{
  "success": true,
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action",
    "details": {}
  }
}
```

`details` may contain field-level validation errors or challenge metadata. Error responses never include SQL errors, stack traces, passwords or tokens.

Common status codes:

| Status | Meaning |
|---:|---|
| 200 | Success |
| 201 | Created |
| 202 | Webhook accepted |
| 400 | Validation or domain error |
| 401 | Authentication required / invalid credentials / MFA required |
| 403 | Authenticated but forbidden, CSRF failed, IP blocked |
| 404 | Not found |
| 409 | Conflict/replay/already exists |
| 423 | Account locked |
| 429 | Rate limited |
| 500 | Unexpected error (generic) |

---

## 2. Authentication

### Access token

Protected endpoints require:

```http
Authorization: Bearer <access-jwt>
```

Access tokens expire after 15 minutes. The frontend holds them in memory and refreshes through the HttpOnly refresh cookie.

### CSRF

Unsafe methods on protected API paths require:

```http
X-CSRF-Token: <value of ssims_csrf cookie>
```

The token must match the signed double-submit cookie. A missing or forged token returns 403 `CSRF_VALIDATION_FAILED`.

### Cookies

| Cookie | Attributes | Purpose |
|---|---|---|
| `ssims_rt` | HttpOnly; Secure (prod); SameSite=Strict; Path=/api/auth | Rotating refresh token |
| `ssims_csrf` | Readable; Secure (prod); SameSite=Strict; Path=/ | Double-submit CSRF |

---

## 3. Public endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | API and database health, DB TLS indicator, uptime |
| GET | `/api/public/departments` | Public department list for registration |
| GET | `/api/public/meta` | Application security metadata |
| POST | `/api/auth/login` | Email/password, optional TOTP/backup code, optional challenge |
| POST | `/api/auth/register` | Student self-registration |
| POST | `/api/auth/forgot-password` | Generic reset request |
| POST | `/api/auth/reset-password` | Consume reset token |
| POST | `/api/auth/refresh` | Rotate refresh token (CSRF required) |
| POST | `/api/auth/logout` | Revoke session (CSRF required) |
| POST | `/api/webhooks/security` | HMAC-signed webhook receiver |

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "student@ssims.edu",
  "password": "...",
  "mfaCode": "123456",          // optional
  "backupCode": "ABCDE-12345",  // optional, instead of TOTP
  "challengeId": "uuid",        // when CHALLENGE_REQUIRED
  "challengeAnswer": "13"
}
```

Possible responses:

- `200` — session issued: `user`, `accessToken`, `csrfToken`, `expiresIn`.
- `401 MFA_REQUIRED` — resubmit with TOTP or backup code.
- `401 CHALLENGE_REQUIRED` — details contain `challengeId`, `prompt`, `expiresInSeconds`.
- `401 CHALLENGE_FAILED` — request a new challenge.
- `401 UNAUTHORIZED` — generic invalid credentials.
- `403 FORBIDDEN` — suspended account.
- `423 ACCOUNT_LOCKED` — temporary lock; details include retry minutes.
- `429 RATE_LIMITED`.

### Refresh

Requires the refresh cookie and CSRF header. Rotates the refresh token. A reused previous token revokes all sessions.

### Registration

```json
{
  "fullName": "Ama Serwaa",
  "email": "ama@ssims.edu",
  "password": "Strong-Passphrase!9",
  "studentId": "STU-2026-0007",
  "departmentId": "uuid (optional)",
  "phone": "+233..."
}
```

Role is forced to `student`; clients cannot register as staff.

### Webhook

Headers:

```text
X-SSIMS-Event-Id: evt-uuid
X-SSIMS-Timestamp: 1760000000
X-SSIMS-Event-Type: grade.published
X-SSIMS-Signature: <64 hex chars>
```

Signature:

```text
HMAC-SHA256(secret, timestamp + "." + eventId + "." + rawBody)
```

Timestamp tolerance: 300 seconds. Event ID must be unique.

---

## 4. Authenticated account endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/me` | Current user, role, MFA state, permissions |
| GET | `/api/auth/csrf` | Issue a fresh CSRF token |
| POST | `/api/auth/change-password` | Current/new password; revokes sessions |
| POST | `/api/auth/mfa/setup` | Password + generate secret/QR |
| POST | `/api/auth/mfa/enable` | Verify TOTP; return backup codes |
| POST | `/api/auth/mfa/disable` | Password + TOTP |
| POST | `/api/auth/mfa/backup-codes` | Password + TOTP; regenerate codes |

MFA setup body:

```json
{ "currentPassword": "..." }
```

MFA enable:

```json
{ "code": "123456" }
```

Response:

```json
{
  "success": true,
  "data": {
    "qrCodeDataUrl": "data:image/png;base64,...",
    "otpauthUrl": "otpauth://totp/...",
    "secret": "BASE32SECRET"
  }
}
```

---

## 5. Administrator endpoints

Requires `super_admin` or `administrator` unless stated. All unsafe methods require CSRF.

### Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/dashboard` | User, MFA, lockout, failed-login, severity, trend, test-run metrics |

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users?page=&limit=&search=&role=&status=` | Paginated users |
| POST | `/api/admin/users` | Create account; returns temporary password if none supplied |
| GET | `/api/admin/users/:id` | User detail + enrollments |
| PATCH | `/api/admin/users/:id` | Update permitted profile fields |
| PATCH | `/api/admin/users/:id/role` | Assign role (super admin restrictions) |
| PATCH | `/api/admin/users/:id/status` | active / suspended / locked |
| POST | `/api/admin/users/:id/unlock` | Clear lockout |
| POST | `/api/admin/users/:id/reset-password` | Temporary password; revokes sessions |

Role constraints:

- Only super administrators can create/modify administrative accounts.
- Only super administrators can assign `super_admin`.
- Users cannot change their own role or status.

### Departments

| Method | Path |
|---|---|
| GET | `/api/departments` |
| POST | `/api/departments` |
| PATCH | `/api/departments/:id` |
| DELETE | `/api/departments/:id` |

### Courses

| Method | Path | Description |
|---|---|---|
| GET | `/api/courses` | Admin: all; lecturer: own; student: enrolled |
| GET | `/api/courses/:id` | Scoped course detail |
| POST | `/api/courses` | Create (admin) |
| PATCH | `/api/courses/:id` | Update (admin) |
| POST | `/api/courses/:id/enrollments` | Enroll student (admin) |
| DELETE | `/api/courses/:id/enrollments/:enrollmentId` | Remove enrollment (admin) |
| GET | `/api/courses/:id/students` | Roster (admin or assigned lecturer) |

---

## 6. Lecturer endpoints

Requires role `lecturer`. Course ownership is enforced on each call.

| Method | Path | Description |
|---|---|---|
| GET | `/api/lecturer/dashboard` | Scoped teaching metrics and recent grades |
| POST | `/api/lecturer/grades` | Upsert a grade for an enrollment in the lecturer's course |
| GET | `/api/lecturer/grades/recent` | Recent grade activity |
| GET | `/api/lecturer/students/:studentId` | Student details for a student in the lecturer's course |

Grade body:

```json
{
  "enrollmentId": "uuid",
  "score": 88.5,
  "remarks": "Strong project work"
}
```

The letter grade is calculated by a PostgreSQL trigger.

---

## 7. Student endpoints

Requires role `student`. Data is scoped to the authenticated session.

| Method | Path | Description |
|---|---|---|
| GET | `/api/student/dashboard` | GPA, course/credit counts, recent results |
| GET | `/api/student/courses` | Own enrolled courses and grades |
| GET | `/api/student/results` | Own transcript plus GPA metadata |
| PATCH | `/api/student/profile` | Permitted phone/address updates |

---

## 8. Security monitoring endpoints

Administrator-only.

| Method | Path | Description |
|---|---|---|
| GET | `/api/security/events?page=&limit=&severity=&eventType=&search=&from=&to=` | Filtered immutable security events |
| GET | `/api/security/events/export.csv?...` | CSV export with formula-injection hardening |
| GET | `/api/security/login-attempts` | Login telemetry |
| GET | `/api/security/audit-log` | Database row audit |
| GET | `/api/security/policies` | Current security policy |
| PATCH | `/api/security/policies` | Update policy (super admin only) |
| GET | `/api/security/ip-rules` | CIDR rules |
| POST | `/api/security/ip-rules` | Add allow/deny rule |
| DELETE | `/api/security/ip-rules/:id` | Remove rule |
| GET | `/api/security/transport-security` | Edge/DB transport evidence |

Policy body fields use camelCase:

```json
{
  "maxLoginAttempts": 5,
  "lockoutMinutes": 15,
  "challengeAfterFailures": 3,
  "passwordHistoryCount": 5,
  "sessionTimeoutMinutes": 60,
  "requireMfaForAdmins": false,
  "requireMfaForLecturers": false,
  "passwordMaxAgeDays": 365
}
```

---

## 9. Security Testing Lab

Administrator-only. All tests are restricted to the local deployment.

| Method | Path | Description |
|---|---|---|
| GET | `/api/lab/catalog` | Eight test definitions |
| GET | `/api/lab/results` | Append-only evidence ledger |
| POST | `/api/lab/run/:testKey` | Run one test |
| POST | `/api/lab/reset-account` | Restore isolated brute-force target |
| GET | `/api/lab/probe` | Rate-limit probe used by the DDoS test |

Valid `testKey` values:

`sql-injection`, `brute-force`, `xss`, `unauthorized-access`, `mitm`, `csrf`, `webhook-forgery`, `ddos`.

Test result fields:

```json
{
  "testKey": "sql-injection",
  "name": "SQL Injection",
  "status": "passed",
  "description": "...",
  "procedure": "...",
  "expected": "...",
  "actual": "...",
  "mechanism": "...",
  "evidence": {},
  "createdAt": "..."
}
```

---

## 10. Kerberos simulation

| Method | Path | Description |
|---|---|---|
| POST | `/api/kerberos/simulate` | Run the educational exchange |

Returns `simulation: true`, a seven-step transcript, six checks, a result and explicit limitations. Not real Kerberos.

---

## 11. Pagination and filtering

- `page` default 1.
- `limit` default 20, maximum 100.
- `meta.total`, `meta.totalPages`.
- Security events support severity, event type, free-text search, `from`/`to` ISO timestamps.

Search values are parameterised. SQL wildcards are treated as data by the database, not as query structure.

---

## 12. Rate limits

Application defaults:

| Scope | Limit |
|---|---|
| Global API | 500 / 5 min |
| Login | 25 / 15 min per IP |
| Refresh | 120 / 15 min |
| Password reset/register | 6 / hour per IP |
| MFA verification | 30 / 15 min |
| Lab | 120 / min |
| Lab probe | 8 / 10s per administrator |

Nginx adds edge-level limits. Limits are memory-backed in this single-instance deployment.

---

## 13. cURL examples

### Login

```bash
curl -i -c cookies.txt -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  --data-binary '{"email":"admin@ssims.edu","password":"..."}'
```

### Use access token

```bash
ACCESS=$(curl -s -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:4000/api/auth/refresh \
  -H "X-CSRF-Token: $(awk '$6=="ssims_csrf" {print $7}' cookies.txt)" \
  | jq -r '.data.accessToken')

curl -s http://127.0.0.1:4000/api/admin/dashboard \
  -H "Authorization: Bearer $ACCESS"
```

### Run a lab test

```bash
CSRF=$(awk '$6=="ssims_csrf" {print $7}' cookies.txt)
curl -s -X POST http://127.0.0.1:4000/api/lab/run/sql-injection \
  -H "Authorization: Bearer $ACCESS" \
  -H "X-CSRF-Token: $CSRF"
```

---

## 14. Notes for integrators

- Do not store access tokens in local storage.
- Do not cache authenticated API responses in shared caches.
- Always include the CSRF header for unsafe methods.
- Treat 401 `MFA_REQUIRED` and `CHALLENGE_REQUIRED` as multi-step continuation states, not terminal errors.
- Do not call the webhook endpoint without a valid HMAC from a trusted backend.
- The lab endpoints are not for production integration or external testing.
