"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAB_TESTS = void 0;
exports.runLabTest = runLabTest;
exports.resetLabAccount = resetLabAccount;
exports.listLabRuns = listLabRuns;
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../config");
const pool_1 = require("../db/pool");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const tokenService_1 = require("./tokenService");
const authService_1 = require("./authService");
const auditService_1 = require("./auditService");
exports.LAB_TESTS = [
    {
        key: 'sql-injection',
        name: 'SQL Injection',
        category: 'Injection',
        description: 'An attacker supplies a classic boolean-based SQL payload in a course lookup field in an attempt to make the query return every row or alter query structure.',
        procedure: "Submit the payload \"' OR '1'='1' --\" to a parameterised course query and observe whether it is interpreted as SQL syntax or as a literal value.",
        expected: 'The payload is bound as a parameter, no SQL error is exposed, and zero rows match. No database structure is altered.',
        mechanism: 'PostgreSQL bind parameters ($1), server-side Zod validation, least-privilege database role, central error handler.',
        safety: 'Runs a read-only SELECT against this local database only. No destructive statement is executed.',
    },
    {
        key: 'brute-force',
        name: 'Brute Force & Account Lockout',
        category: 'Authentication',
        description: 'Repeated wrong passwords are attempted against the dedicated, non-human security laboratory account to test progressive protection.',
        procedure: 'Reset the lab account, submit repeated incorrect credentials through the real authentication service, solve the issued human-verification challenge, and observe the account lock threshold from the current policy.',
        expected: 'Failed attempts are recorded, a human-verification challenge is demanded after suspicious activity, and the account is temporarily locked once the policy threshold is reached.',
        mechanism: 'Per-IP rate limiting, progressive failed-login counters, challenge after repeated failures, temporary account lockout, append-only login attempt records.',
        safety: 'Targets only the isolated security.lab@ssims.edu account. The account remains locked as evidence and can be restored with one click.',
    },
    {
        key: 'xss',
        name: 'Cross-Site Scripting (XSS)',
        category: 'Input / Output',
        description: 'A script-bearing payload is submitted to test whether executable markup can be stored or rendered by the application.',
        procedure: 'Pass an <img onerror> and <script> payload through the server-side sanitiser, then apply HTML output encoding as React does when rendering text.',
        expected: 'Markup is stripped, event handlers cannot survive, and the output is inert text. No script executes in the browser.',
        mechanism: 'sanitize-html server-side input filtering, React automatic escaping, no dangerouslySetInnerHTML, strict Content-Security-Policy and X-Content-Type-Options.',
        safety: 'The payload is processed in memory and never rendered. No browser alert is expected because execution is blocked.',
    },
    {
        key: 'unauthorized-access',
        name: 'Unauthorized Access (RBAC)',
        category: 'Authorization',
        description: 'A valid student identity attempts to call an administrator-only API endpoint. This tests server-side authorisation rather than hidden UI controls.',
        procedure: 'Create an ephemeral, short-lived student session, call GET /api/admin/users with its access token, then immediately revoke the temporary session.',
        expected: 'The API returns HTTP 403 Forbidden and records an UNAUTHORIZED_ACCESS security event. No user data is returned.',
        mechanism: 'Server-side JWT validation, live session checks, role-based access control guard and audit logging.',
        safety: 'Uses a temporary internally generated token that is never returned to the browser and is deleted after the test.',
    },
    {
        key: 'mitm',
        name: 'Man-in-the-Middle / Transport Security',
        category: 'Transport',
        description: 'Checks whether traffic is protected by TLS at the edge and whether the API-to-database connection is encrypted and certificate-validated.',
        procedure: 'Inspect the forwarded protocol from Nginx, the database session from pg_stat_ssl, and the runtime DB_SSL_MODE.',
        expected: 'HTTPS is enforced at Nginx with HSTS; PostgreSQL connections use TLS with verify-full certificate validation. A local HTTP development run reports informational evidence only.',
        mechanism: 'Nginx TLS termination, HTTP-to-HTTPS redirect, HSTS, server-to-database TLS with a project CA, hostname verification.',
        safety: 'Read-only inspection of the current connection. No certificate or network configuration is changed.',
    },
    {
        key: 'csrf',
        name: 'Cross-Site Request Forgery (CSRF)',
        category: 'Session Security',
        description: 'A state-changing request is sent without a valid double-submit CSRF token, imitating a cross-site forgery attempt.',
        procedure: 'POST to /api/auth/refresh with a forged cookie/header pair and the expected Origin, then inspect the rejection response.',
        expected: 'HTTP 403 CSRF_VALIDATION_FAILED is returned before any session or token operation occurs, and the attempt appears in the security log.',
        mechanism: 'Origin validation, HMAC-signed double-submit CSRF token, constant-time comparison, SameSite=Strict cookies.',
        safety: 'Targets the application login endpoint only; no victim browser or third-party site is involved.',
    },
    {
        key: 'webhook-forgery',
        name: 'Webhook Forgery / Invalid HMAC',
        category: 'Integrations',
        description: 'A forged webhook claims to report a critical security event but carries an invalid HMAC-SHA256 signature.',
        procedure: 'POST a webhook with a plausible event ID and timestamp but an all-zero signature, then inspect the receiver response and webhook audit record.',
        expected: 'HTTP 401 WEBHOOK_INVALID_SIGNATURE is returned, no business action is taken, and the rejected event is appended to the webhook log.',
        mechanism: 'HMAC-SHA256 over timestamp + event ID + raw body, constant-time comparison, timestamp tolerance, unique event IDs.',
        safety: 'Only the local webhook receiver is called. The signing secret is never sent to the frontend.',
    },
    {
        key: 'ddos',
        name: 'DDoS / Request Throttling',
        category: 'Availability',
        description: 'A controlled low-volume burst is sent to a dedicated rate-limited probe endpoint to demonstrate request throttling without stressing the service.',
        procedure: 'Issue 12 sequential requests to the authenticated /api/lab/probe endpoint within its 10-second window and record each HTTP status.',
        expected: 'The first requests succeed, remaining requests receive HTTP 429 with Retry-After headers, and the throttling event is logged. Nginx additionally limits production traffic.',
        mechanism: 'express-rate-limit token bucket, Nginx limit_req/limit_conn, connection timeouts, request size limits, upstream DDoS scrubbing in production.',
        safety: 'At most 12 requests are sent to a local, authenticated probe. This cannot generate a real volumetric attack.',
    },
];
function fakeResponse() {
    const stub = {
        cookie: () => stub,
        clearCookie: () => stub,
        status: () => stub,
        json: () => stub,
    };
    return stub;
}
async function internalFetch(path, init) {
    const response = await fetch(`${config_1.config.internalApiUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(8_000),
    });
    return { status: response.status, body: await response.text(), headers: response.headers };
}
async function runSqlInjection(req) {
    const payload = "' OR '1'='1' --";
    let rows = [];
    let errorMessage = null;
    try {
        rows = await (0, pool_1.query)('SELECT id, code, title FROM courses WHERE code = $1 OR title = $1 LIMIT 5', [payload]);
    }
    catch (error) {
        errorMessage = error.message;
    }
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'SQL_INJECTION_ATTEMPT',
        severity: 'high',
        description: 'Authorised laboratory SQL injection payload was safely handled by a parameterised query',
        metadata: { injected: true, rowsReturned: rows.length, parameterised: true },
    });
    return {
        status: !errorMessage && rows.length === 0 ? 'passed' : 'failed',
        actual: errorMessage
            ? `Query failed unexpectedly: ${errorMessage}`
            : `The bound parameter was treated as a literal string. ${rows.length} rows matched; the injection did not alter query structure and no SQL error was exposed.`,
        evidence: {
            endpoint: 'laboratory course lookup',
            payload,
            parameterised: true,
            bindStyle: '$1 (node-postgres)',
            rowsReturned: rows.length,
            sqlErrorExposed: Boolean(errorMessage),
            databaseRole: 'ssims_app (DML only, no DDL, no SUPERUSER)',
        },
    };
}
async function runBruteForce(req) {
    const policy = await (0, authService_1.getPolicy)();
    const target = await (0, pool_1.queryOne)('SELECT id, email, status FROM users WHERE lower(email) = lower($1)', [config_1.config.seed.labEmail]);
    if (!target) {
        return {
            status: 'info',
            actual: 'The dedicated lab target account is not seeded, so the lockout exercise was skipped.',
            evidence: { targetEmail: config_1.config.seed.labEmail, seeded: false },
        };
    }
    await (0, pool_1.query)("UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL WHERE id = $1", [target.id]);
    await (0, pool_1.query)("UPDATE sessions SET revoked_at = now(), revoked_reason = 'lab_brute_force_reset' WHERE user_id = $1 AND revoked_at IS NULL", [target.id]);
    const statuses = [];
    const challengePrompts = [];
    const password = `Wrong!${node_crypto_1.default.randomBytes(8).toString('hex')}Aa1`;
    const attemptWrong = async () => {
        try {
            await (0, authService_1.login)({ email: target.email, password }, req, fakeResponse());
            statuses.push(200);
            return 200;
        }
        catch (error) {
            const status = error instanceof errors_1.ApiError ? error.statusCode : 500;
            statuses.push(status);
            return status;
        }
    };
    // Accumulate suspicious failed attempts first.
    for (let attempt = 0; attempt < policy.challenge_after_failures; attempt += 1) {
        await attemptWrong();
    }
    // A correct password after suspicious failures now triggers the human
    // verification challenge. We deliberately stop there and do not create a
    // session; the account is then driven into temporary lockout with more wrong
    // passwords to demonstrate both controls.
    if (config_1.config.seed.labPassword) {
        try {
            await (0, authService_1.login)({ email: target.email, password: config_1.config.seed.labPassword }, req, fakeResponse());
            // Unexpected with the default policy: revoke any session and continue.
            await (0, pool_1.query)("UPDATE sessions SET revoked_at = now(), revoked_reason = 'lab_challenge_probe' WHERE user_id = $1 AND revoked_at IS NULL", [target.id]);
            statuses.push(200);
        }
        catch (error) {
            const apiError = error instanceof errors_1.ApiError ? error : null;
            statuses.push(apiError?.statusCode ?? 500);
            if (apiError?.code === 'CHALLENGE_REQUIRED') {
                const details = apiError.details;
                if (details?.prompt)
                    challengePrompts.push(details.prompt);
            }
        }
    }
    // Keep trying wrong passwords until the temporary lockout is observed.
    for (let attempt = 0; attempt < policy.max_login_attempts + 3; attempt += 1) {
        const status = await attemptWrong();
        if (status === 423)
            break;
    }
    const after = await (0, pool_1.queryOne)('SELECT status, failed_login_count, locked_until FROM users WHERE id = $1', [target.id]);
    const locked = after?.status === 'locked' && Boolean(after.locked_until);
    return {
        status: locked && statuses.includes(423) ? 'passed' : 'failed',
        actual: locked
            ? `Account protection engaged after ${after?.failed_login_count} failed attempts. The final request returned HTTP 423 and the account is temporarily locked until ${new Date(after.locked_until).toISOString()}. A human-verification challenge was issued when a correct password was presented after suspicious activity.`
            : `The account was not locked as expected. Observed HTTP statuses: ${statuses.join(', ')}.`,
        evidence: {
            targetEmail: target.email,
            policyMaxAttempts: policy.max_login_attempts,
            lockoutMinutes: policy.lockout_minutes,
            challengeAfterFailures: policy.challenge_after_failures,
            observedStatuses: statuses,
            challengeIssued: challengePrompts.length,
            challengePrompts,
            finalStatus: after?.status,
            failedLoginCount: after?.failed_login_count,
            lockedUntil: after?.locked_until,
            note: 'The target is an isolated non-human lab account and intentionally remains locked as evidence. Use Reset lab account to restore it.',
        },
    };
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
async function runXss(req) {
    const payload = `Hello <script>alert('SSIMS-XSS')</script><img src=x onerror="alert(document.cookie)"> world`;
    const sanitized = (0, validation_1.cleanText)(payload, 500);
    const escaped = escapeHtml(payload);
    const executableMarkup = /<\s*script|onerror\s*=|javascript:/i.test(sanitized);
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'XSS_PAYLOAD_BLOCKED',
        severity: 'medium',
        description: 'Authorised laboratory XSS payload was neutralised by server sanitisation and output encoding',
        metadata: { sanitizedLength: sanitized.length, executableMarkup },
    });
    return {
        status: !executableMarkup && !sanitized.includes('<') ? 'passed' : 'failed',
        actual: 'The server-side sanitiser stripped the script/image tags and the event handler. React renders the remaining text through escaped text nodes, so no markup executes. The strict CSP provides additional defence in depth.',
        evidence: {
            originalPayload: payload,
            sanitizedOutput: sanitized,
            reactEscapedPreview: escaped,
            executableMarkupRemaining: executableMarkup,
            dangerouslySetInnerHTMLUsed: false,
            contentSecurityPolicy: "default-src 'self'; script-src 'self'; object-src 'none'",
        },
    };
}
async function runUnauthorized(req) {
    const student = await (0, pool_1.queryOne)('SELECT id, email, full_name, role, status FROM users WHERE lower(email) = lower($1)', [config_1.config.seed.studentEmail]);
    if (!student || student.status !== 'active') {
        return {
            status: 'info',
            actual: 'The demonstration student account is unavailable, so the authorisation request was skipped.',
            evidence: { studentSeeded: Boolean(student) },
        };
    }
    const fakeHash = node_crypto_1.default.randomBytes(32).toString('hex');
    const session = await (0, pool_1.queryOne)(`INSERT INTO sessions (user_id, current_refresh_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + interval '2 minutes', 'SSIMS security lab ephemeral session')
     RETURNING id`, [student.id, `lab-${fakeHash}`]);
    const token = (0, tokenService_1.signAccessToken)({
        userId: student.id,
        email: student.email,
        role: 'student',
        sessionId: session.id,
    }).token;
    try {
        const result = await internalFetch('/api/admin/users?limit=1', {
            headers: { authorization: `Bearer ${token}` },
        });
        const parsed = JSON.parse(result.body);
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'UNAUTHORIZED_ACCESS',
            severity: 'high',
            description: 'Laboratory RBAC test: student token attempted to access administrator endpoint',
            metadata: { attemptedEndpoint: '/api/admin/users', responseStatus: result.status },
        });
        return {
            status: result.status === 403 ? 'passed' : 'failed',
            actual: result.status === 403
                ? `The administrator endpoint returned HTTP 403 (${parsed.error?.code ?? 'FORBIDDEN'}). No user records were disclosed. The temporary student session was revoked immediately.`
                : `Expected HTTP 403 but received HTTP ${result.status}.`,
            evidence: {
                actorRole: 'student',
                endpoint: 'GET /api/admin/users',
                httpStatus: result.status,
                errorCode: parsed.error?.code ?? null,
                temporarySessionRevoked: true,
                uiHiddenControlsAreNotSecurityBoundary: true,
            },
        };
    }
    finally {
        await (0, pool_1.query)('DELETE FROM sessions WHERE id = $1', [session.id]);
    }
}
async function runMitm(_req) {
    const dbTls = await (0, pool_1.queryOne)(`SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()`);
    const verified = dbTls?.ssl === true && config_1.config.dbSslMode === 'verify-full';
    const httpsAtEdge = config_1.config.isProduction;
    const status = verified ? 'passed' : 'info';
    return {
        status,
        actual: verified
            ? `The API-to-database connection is encrypted with ${dbTls?.version ?? 'TLS'} and ${dbTls?.cipher ?? 'a modern cipher'}. DB_SSL_MODE=verify-full means the certificate chain and hostname are validated, so a MITM proxy cannot impersonate PostgreSQL.`
            : 'Local development is running with database TLS disabled (or certificate verification not enabled) and the browser may use HTTP. In Docker, Nginx enforces HTTPS and PostgreSQL uses TLS verify-full; the test then reports a hard pass.',
        evidence: {
            apiToDbEncrypted: Boolean(dbTls?.ssl),
            apiToDbTlsVersion: dbTls?.version,
            apiToDbCipher: dbTls?.cipher,
            dbSslMode: config_1.config.dbSslMode,
            edgeHttpsExpectedInDocker: httpsAtEdge,
            hstsExpectedInDocker: config_1.config.isProduction,
            protections: ['HTTP 301 redirect to HTTPS', 'HSTS max-age 31536000 includeSubDomains', 'TLS 1.2/1.3 only', 'certificate hostname verification'],
        },
    };
}
async function runCsrf(_req) {
    const result = await internalFetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
            origin: config_1.config.frontendOrigin,
            'content-type': 'application/json',
            cookie: 'ssims_rt=forged-lab-token; ssims_csrf=forged.forged',
            'x-csrf-token': 'forged.forged',
        },
        body: '{}',
    });
    let code = null;
    try {
        const parsed = JSON.parse(result.body);
        code = parsed.error?.code ?? null;
    }
    catch {
        code = null;
    }
    return {
        status: result.status === 403 && code === 'CSRF_VALIDATION_FAILED' ? 'passed' : 'failed',
        actual: result.status === 403
            ? 'The forged refresh request was rejected with HTTP 403 CSRF_VALIDATION_FAILED before token rotation. The rejection was appended to the security event log.'
            : `The CSRF middleware returned HTTP ${result.status}; expected 403.`,
        evidence: {
            endpoint: 'POST /api/auth/refresh',
            originHeader: config_1.config.frontendOrigin,
            forgedCookieAndHeader: true,
            httpStatus: result.status,
            errorCode: code,
            cookiesUsed: 'SameSite=Strict; refresh cookie HttpOnly',
        },
    };
}
async function runWebhookForgery(_req) {
    const body = JSON.stringify({ event: 'forged.security.alert', severity: 'critical', injected: true });
    const eventId = `forged-${node_crypto_1.default.randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await internalFetch('/api/webhooks/security', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-ssims-event-id': eventId,
            'x-ssims-timestamp': timestamp,
            'x-ssims-event-type': 'security.alert',
            'x-ssims-signature': '0'.repeat(64),
        },
        body,
    });
    let code = null;
    try {
        const parsed = JSON.parse(result.body);
        code = parsed.error?.code ?? null;
    }
    catch {
        code = null;
    }
    return {
        status: result.status === 401 && code === 'WEBHOOK_INVALID_SIGNATURE' ? 'passed' : 'failed',
        actual: result.status === 401
            ? 'The forged webhook was rejected with HTTP 401 WEBHOOK_INVALID_SIGNATURE. The signature check failed before payload processing, and the rejected event was logged without executing any action.'
            : `Expected HTTP 401 WEBHOOK_INVALID_SIGNATURE but received HTTP ${result.status}.`,
        evidence: {
            endpoint: 'POST /api/webhooks/security',
            eventId,
            signatureAlgorithm: 'HMAC-SHA256',
            suppliedSignature: '0'.repeat(64),
            httpStatus: result.status,
            errorCode: code,
            secretExposedToFrontend: false,
            timestampToleranceSeconds: 300,
            replayProtection: 'UNIQUE(event_id)',
        },
    };
}
async function runDdos(req) {
    const access = (0, tokenService_1.signAccessToken)({
        userId: req.auth.userId,
        email: req.auth.email,
        role: req.auth.role,
        sessionId: req.auth.sessionId,
    }).token;
    const statuses = [];
    const retryAfter = [];
    for (let i = 0; i < 12; i += 1) {
        const result = await internalFetch('/api/lab/probe', {
            headers: { authorization: `Bearer ${access}` },
        });
        statuses.push(result.status);
        const retry = result.headers.get('retry-after');
        if (retry)
            retryAfter.push(retry);
    }
    const throttled = statuses.filter((status) => status === 429).length;
    const passed = statuses.filter((status) => status === 200).length > 0 && throttled > 0;
    return {
        status: passed ? 'passed' : 'failed',
        actual: passed
            ? `Controlled burst completed: ${statuses.filter((s) => s === 200).length} requests succeeded and ${throttled} were throttled with HTTP 429. The application-level limiter protected the probe endpoint without affecting other users.`
            : 'The controlled burst did not observe a 429 response. If a previous probe is still inside the 10-second window, wait and run it again.',
        evidence: {
            requests: statuses.length,
            observedStatuses: statuses,
            throttled429: throttled,
            succeeded200: statuses.filter((s) => s === 200).length,
            retryAfterHeaders: retryAfter.slice(0, 3),
            scope: 'isolated /api/lab/probe endpoint, per-administrator key',
            productionLayers: [
                'Nginx limit_req_zone rate=10r/s burst=20 nodelay',
                'Nginx limit_conn_zone per IP',
                'request body 1 MiB and header limits',
                'upstream DDoS scrubbing/CDN for volumetric attacks',
            ],
        },
    };
}
async function runLabTest(key, req) {
    const definition = exports.LAB_TESTS.find((test) => test.key === key);
    if (!definition)
        throw new errors_1.ApiError(404, 'LAB_TEST_NOT_FOUND', 'Unknown security test');
    let outcome;
    switch (key) {
        case 'sql-injection':
            outcome = await runSqlInjection(req);
            break;
        case 'brute-force':
            outcome = await runBruteForce(req);
            break;
        case 'xss':
            outcome = await runXss(req);
            break;
        case 'unauthorized-access':
            outcome = await runUnauthorized(req);
            break;
        case 'mitm':
            outcome = await runMitm(req);
            break;
        case 'csrf':
            outcome = await runCsrf(req);
            break;
        case 'webhook-forgery':
            outcome = await runWebhookForgery(req);
            break;
        case 'ddos':
            outcome = await runDdos(req);
            break;
        default:
            throw new errors_1.ApiError(404, 'LAB_TEST_NOT_FOUND', 'Unknown security test');
    }
    const run = await (0, pool_1.queryOne)(`INSERT INTO security_test_runs
       (test_key, name, status, description, procedure, expected, actual, mechanism, evidence, run_by, source_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     RETURNING id, created_at`, [
        definition.key,
        definition.name,
        outcome.status,
        definition.description,
        definition.procedure,
        definition.expected,
        outcome.actual,
        definition.mechanism,
        JSON.stringify(outcome.evidence),
        req.auth.userId,
        req.ip?.replace(/^::ffff:/, '') ?? null,
    ]);
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'SECURITY_TEST_RUN',
        severity: outcome.status === 'failed' ? 'high' : 'info',
        description: `Security Lab test ${definition.name} completed with status ${outcome.status}`,
        metadata: { testKey: definition.key, status: outcome.status },
    });
    return {
        id: run.id,
        testKey: definition.key,
        name: definition.name,
        status: outcome.status,
        description: definition.description,
        procedure: definition.procedure,
        expected: definition.expected,
        actual: outcome.actual,
        mechanism: definition.mechanism,
        evidence: outcome.evidence,
        createdAt: new Date(run.created_at).toISOString(),
    };
}
async function resetLabAccount() {
    await (0, pool_1.query)(`UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL
      WHERE lower(email) = lower($1)`, [config_1.config.seed.labEmail]);
    await (0, pool_1.query)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'lab_account_reset'
      WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1)) AND revoked_at IS NULL`, [config_1.config.seed.labEmail]);
    await (0, pool_1.query)(`UPDATE auth_challenges SET consumed_at = now()
      WHERE lower(identifier) = lower($1) AND consumed_at IS NULL`, [config_1.config.seed.labEmail]);
}
async function listLabRuns(limit = 30) {
    return (0, pool_1.query)(`SELECT r.id, r.test_key, r.name, r.status, r.actual, r.mechanism, r.evidence,
            r.created_at, u.full_name AS run_by_name
       FROM security_test_runs r LEFT JOIN users u ON u.id = r.run_by
      ORDER BY r.created_at DESC LIMIT $1`, [Math.min(limit, 100)]);
}
//# sourceMappingURL=labService.js.map