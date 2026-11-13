"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSafeUser = toSafeUser;
exports.getPolicy = getPolicy;
exports.loadUserByEmail = loadUserByEmail;
exports.loadUserById = loadUserById;
exports.getSafeUserById = getSafeUserById;
exports.login = login;
exports.refreshSession = refreshSession;
exports.logout = logout;
exports.revokeAllSessions = revokeAllSessions;
exports.assertPasswordNotReused = assertPasswordNotReused;
exports.addPasswordHistory = addPasswordHistory;
exports.changePassword = changePassword;
exports.requestPasswordReset = requestPasswordReset;
exports.resetPassword = resetPassword;
exports.startMfaSetup = startMfaSetup;
exports.enableMfa = enableMfa;
exports.disableMfa = disableMfa;
exports.regenerateBackupCodes = regenerateBackupCodes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../config");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const crypto_1 = require("../utils/crypto");
const passwordPolicy_1 = require("../utils/passwordPolicy");
const totp_1 = require("../utils/totp");
const auditService_1 = require("./auditService");
const tokenService_1 = require("./tokenService");
function toSafeUser(row, backupCodesRemaining = 0, policy) {
    const passwordExpired = policy
        ? Date.now() - new Date(row.last_password_change_at).getTime() > policy.password_max_age_days * 86_400_000
        : false;
    const mfaRequiredByPolicy = Boolean(policy &&
        (((row.role === 'super_admin' || row.role === 'administrator') && policy.require_mfa_for_admins) ||
            (row.role === 'lecturer' && policy.require_mfa_for_lecturers)));
    return {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        status: row.status,
        studentId: row.student_id,
        staffId: row.staff_id,
        departmentId: row.department_id,
        departmentName: row.department_name ?? null,
        phone: row.phone,
        address: row.address,
        programme: row.programme,
        level: row.level,
        mfaEnabled: row.mfa_enabled,
        mfaEnrollmentRequired: mfaRequiredByPolicy && !row.mfa_enabled,
        mustChangePassword: row.must_change_password || passwordExpired,
        passwordExpired,
        backupCodesRemaining,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        permissions: (0, auth_1.permissionsFor)(row.role),
    };
}
async function getPolicy() {
    const policy = await (0, pool_1.queryOne)('SELECT * FROM security_policies WHERE id = 1');
    if (!policy)
        throw new Error('Security policy row missing');
    return policy;
}
async function loadUserByEmail(email, client) {
    const sql = `SELECT u.*, d.name AS department_name
                 FROM users u LEFT JOIN departments d ON d.id = u.department_id
                WHERE lower(u.email) = lower($1)`;
    if (client) {
        const result = await client.query(sql, [email]);
        return result.rows[0] ?? null;
    }
    return (0, pool_1.queryOne)(sql, [email]);
}
async function loadUserById(id) {
    return (0, pool_1.queryOne)(`SELECT u.*, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`, [id]);
}
async function getSafeUserById(id, providedPolicy) {
    const user = await loadUserById(id);
    if (!user)
        return null;
    const policy = providedPolicy ?? (await getPolicy());
    const count = await (0, pool_1.queryOne)('SELECT count(*)::text FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL', [id]);
    return toSafeUser(user, Number(count?.count ?? 0), policy);
}
let dummyHashPromise = null;
async function dummyHash() {
    // Equalise timing between an unknown email and a known email with a wrong
    // password. Generated once per process and kept only in memory.
    if (!dummyHashPromise)
        dummyHashPromise = (0, passwordPolicy_1.hashPassword)((0, crypto_1.randomToken)(24));
    return dummyHashPromise;
}
async function issueChallenge(identifier, ip) {
    const a = node_crypto_1.default.randomInt(2, 10);
    const b = node_crypto_1.default.randomInt(2, 10);
    const answer = String(a + b);
    const prompt = `Human verification: what is ${a} + ${b}?`;
    const row = await (0, pool_1.queryOne)(`INSERT INTO auth_challenges (identifier, ip, prompt, answer_hash, expires_at)
     VALUES (lower($1), $2, $3, $4, now() + interval '5 minutes') RETURNING id`, [identifier, ip, prompt, (0, crypto_1.pepperedHash)(answer, 'auth-challenge')]);
    return { challengeId: row.id, prompt, expiresInSeconds: 300 };
}
async function verifyChallenge(challengeId, identifier, answer, ip) {
    if (!/^[0-9a-f-]{36}$/i.test(challengeId))
        return false;
    const row = await (0, pool_1.queryOne)(`SELECT id, identifier, answer_hash, expires_at, consumed_at
       FROM auth_challenges WHERE id = $1 AND lower(identifier) = lower($2)`, [challengeId, identifier]);
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now())
        return false;
    await (0, pool_1.query)('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [row.id]);
    const candidate = (0, crypto_1.pepperedHash)(answer.trim(), 'auth-challenge');
    return (0, crypto_1.safeEqual)(candidate, row.answer_hash);
}
async function recentFailureCount(email) {
    const row = await (0, pool_1.queryOne)(`WITH last_success AS (
       SELECT max(created_at) AS at FROM login_attempts
        WHERE lower(email) = lower($1) AND successful = TRUE
     )
     SELECT count(*)::text AS count
       FROM login_attempts, last_success
      WHERE lower(email) = lower($1)
        AND successful = FALSE
        AND created_at > now() - interval '15 minutes'
        AND created_at > COALESCE(last_success.at, to_timestamp(0))`, [email]);
    return Number(row?.count ?? 0);
}
async function recordLoginAttempt(email, ip, successful, failureReason, userAgent) {
    await (0, pool_1.query)(`INSERT INTO login_attempts (email, ip, successful, failure_reason, user_agent)
     VALUES (lower($1), $2, $3, $4, $5)`, [email, ip, successful, failureReason, userAgent?.slice(0, 300) ?? null]);
}
async function registerFailure(user, policy, reason, req) {
    const nextCount = user.failed_login_count + 1;
    const shouldLock = nextCount >= policy.max_login_attempts;
    const lockedUntil = shouldLock ? new Date(Date.now() + policy.lockout_minutes * 60_000) : null;
    await (0, pool_1.query)(`UPDATE users
        SET failed_login_count = $2,
            status = CASE WHEN $3 THEN 'locked'::account_status ELSE status END,
            locked_until = $4
      WHERE id = $1`, [user.id, nextCount, shouldLock, lockedUntil]);
    await recordLoginAttempt(user.email, req.ip?.replace(/^::ffff:/, '') ?? null, false, reason, req.get('user-agent'));
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: user.id,
        actorEmail: user.email,
        eventType: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        severity: shouldLock ? 'high' : 'medium',
        description: shouldLock
            ? `Account locked after ${nextCount} failed authentication attempts`
            : `Failed login attempt (${reason})`,
        metadata: { reason, attempt: nextCount },
    });
}
async function verifyMfaForUser(user, totpCode, backupCode) {
    if (backupCode) {
        const normalized = backupCode.replace(/\s+/g, '').toUpperCase();
        const hash = (0, crypto_1.pepperedHash)(normalized, 'mfa-backup');
        const code = await (0, pool_1.queryOne)(`UPDATE mfa_backup_codes SET used_at = now()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
        RETURNING id`, [user.id, hash]);
        return code ? { ok: true, usedBackupCode: true } : { ok: false, usedBackupCode: true, reason: 'invalid_backup_code' };
    }
    if (!user.mfa_secret_enc || !totpCode) {
        return { ok: false, usedBackupCode: false, reason: 'mfa_code_required' };
    }
    const secret = (0, crypto_1.decryptSecret)(user.mfa_secret_enc);
    const step = (0, totp_1.verifyTotpStep)(secret, totpCode);
    if (step === null)
        return { ok: false, usedBackupCode: false, reason: 'invalid_totp' };
    const previousStep = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
    if (step <= previousStep) {
        return { ok: false, usedBackupCode: false, reason: 'totp_replay' };
    }
    await (0, pool_1.query)('UPDATE users SET mfa_last_totp_step = $2 WHERE id = $1', [user.id, step]);
    return { ok: true, usedBackupCode: false };
}
async function createSession(user, req, res) {
    const { raw, hash } = (0, tokenService_1.createRefreshToken)();
    const expiresAt = new Date(Date.now() + config_1.config.refreshTokenTtlDays * 86_400_000);
    await (0, pool_1.query)(`INSERT INTO sessions (user_id, current_refresh_hash, expires_at, created_ip, last_ip, user_agent)
     VALUES ($1, $2, $3, $4, $4, $5)`, [user.id, hash, expiresAt, req.ip?.replace(/^::ffff:/, '') ?? null, req.get('user-agent')?.slice(0, 300) ?? null]);
    const refreshTtlMs = config_1.config.refreshTokenTtlDays * 86_400_000;
    (0, tokenService_1.setRefreshCookie)(res, raw, refreshTtlMs);
    const csrfToken = (0, tokenService_1.createCsrfToken)();
    (0, tokenService_1.setCsrfCookie)(res, csrfToken);
    const session = await (0, pool_1.queryOne)('SELECT id FROM sessions WHERE current_refresh_hash = $1', [hash]);
    const access = (0, tokenService_1.signAccessToken)({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
    });
    return { accessToken: access.token, csrfToken, expiresIn: access.expiresIn };
}
async function login(input, req, res) {
    const policy = await getPolicy();
    const user = await loadUserByEmail(input.email);
    const ip = req.ip?.replace(/^::ffff:/, '') ?? null;
    if (!user) {
        // Constant-work dummy verification plus generic response prevents account enumeration.
        await (0, passwordPolicy_1.verifyPassword)(await dummyHash(), input.password);
        await recordLoginAttempt(input.email, ip, false, 'unknown_email', req.get('user-agent'));
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'LOGIN_FAILED',
            severity: 'medium',
            description: 'Failed login for an unknown account',
            metadata: { email: input.email },
        });
        throw (0, errors_1.unauthorized)('Invalid email or password');
    }
    if (user.status === 'suspended') {
        await recordLoginAttempt(input.email, ip, false, 'account_suspended', req.get('user-agent'));
        await (0, auditService_1.recordRequestEvent)(req, {
            userId: user.id,
            actorEmail: user.email,
            eventType: 'LOGIN_BLOCKED',
            severity: 'high',
            description: 'Login blocked for a suspended account',
        });
        throw (0, errors_1.forbidden)('This account is suspended. Contact the administrator.');
    }
    if (user.status === 'locked') {
        if (user.locked_until && new Date(user.locked_until).getTime() <= Date.now()) {
            // Temporary lock has elapsed: allow a fresh set of attempts.
            await (0, pool_1.query)("UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL WHERE id = $1", [user.id]);
            user.status = 'active';
            user.failed_login_count = 0;
        }
        else {
            const remaining = user.locked_until
                ? Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000))
                : null;
            await recordLoginAttempt(input.email, ip, false, 'account_locked', req.get('user-agent'));
            throw new errors_1.ApiError(423, 'ACCOUNT_LOCKED', 'Account is locked due to repeated failed logins', {
                retryAfterMinutes: remaining,
            });
        }
    }
    const passwordOk = await (0, passwordPolicy_1.verifyPassword)(user.password_hash, input.password);
    if (!passwordOk) {
        await registerFailure(user, policy, 'invalid_password', req);
        throw (0, errors_1.unauthorized)('Invalid email or password');
    }
    // Ask for the MFA code first when MFA is enabled. This keeps the human
    // challenge unconsumed until the final authentication step, so a user never
    // has to solve two challenges merely because MFA is also active.
    if (user.mfa_enabled && !input.mfaCode && !input.backupCode) {
        // Intermediate step, not a failed credential attempt.
        throw new errors_1.ApiError(401, 'MFA_REQUIRED', 'Enter the verification code from your authenticator app');
    }
    // A correct password after repeated failures triggers additional human
    // verification. Wrong-password attempts continue to drive progressive lockout.
    const failures = await recentFailureCount(input.email);
    if (failures >= policy.challenge_after_failures) {
        if (!input.challengeId || !input.challengeAnswer) {
            const challenge = await issueChallenge(input.email, ip);
            throw new errors_1.ApiError(401, 'CHALLENGE_REQUIRED', 'Additional human verification is required', challenge);
        }
        const validChallenge = await verifyChallenge(input.challengeId, input.email, input.challengeAnswer, ip);
        if (!validChallenge) {
            await registerFailure(user, policy, 'challenge_failed', req);
            throw new errors_1.ApiError(401, 'CHALLENGE_FAILED', 'Human verification failed. A new challenge is required.');
        }
    }
    if (user.mfa_enabled) {
        const mfa = await verifyMfaForUser(user, input.mfaCode, input.backupCode);
        if (!mfa.ok) {
            await registerFailure(user, policy, mfa.reason || 'mfa_failed', req);
            await (0, auditService_1.recordRequestEvent)(req, {
                userId: user.id,
                actorEmail: user.email,
                eventType: 'MFA_VERIFICATION_FAILED',
                severity: 'high',
                description: `MFA verification failed (${mfa.reason || 'invalid_code'})`,
                metadata: { backupCodeUsed: mfa.usedBackupCode },
            });
            throw (0, errors_1.unauthorized)(mfa.reason === 'totp_replay' ? 'That verification code was already used' : 'Invalid verification code');
        }
    }
    if (await (0, passwordPolicy_1.needsRehash)(user.password_hash)) {
        await (0, pool_1.query)('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await (0, passwordPolicy_1.hashPassword)(input.password)]);
    }
    await (0, pool_1.query)(`UPDATE users
        SET failed_login_count = 0, locked_until = NULL, status = 'active',
            last_login_at = now(), last_login_ip = $2,
            must_change_password = CASE
              WHEN last_password_change_at < now() - ($3 || ' days')::interval THEN TRUE
              ELSE must_change_password END
      WHERE id = $1`, [user.id, ip, String(policy.password_max_age_days)]);
    await recordLoginAttempt(user.email, ip, true, null, req.get('user-agent'));
    const session = await createSession(user, req, res);
    const freshPolicy = policy;
    const safeUser = (await getSafeUserById(user.id, freshPolicy));
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: user.id,
        actorEmail: user.email,
        eventType: 'LOGIN_SUCCESS',
        severity: 'info',
        description: 'Successful login',
        metadata: { role: user.role, mfa: user.mfa_enabled, backupCodeUsed: Boolean(input.backupCode) },
    });
    return { user: safeUser, ...session };
}
async function refreshSession(rawToken, req, res) {
    if (!rawToken)
        throw (0, errors_1.unauthorized)('Refresh token is missing');
    const hash = (0, tokenService_1.hashRefreshToken)(rawToken);
    const session = await (0, pool_1.queryOne)(`SELECT u.*, d.name AS department_name,
            s.id AS session_id, s.current_refresh_hash, s.previous_refresh_hash,
            s.expires_at AS session_expires_at, s.last_used_at AS session_last_used_at,
            s.revoked_at, p.session_timeout_minutes
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       CROSS JOIN security_policies p
      WHERE (s.current_refresh_hash = $1 OR s.previous_refresh_hash = $1) AND p.id = 1
      LIMIT 1`, [hash]);
    if (!session) {
        (0, tokenService_1.clearRefreshCookie)(res);
        (0, tokenService_1.clearCsrfCookie)(res);
        throw (0, errors_1.unauthorized)('Invalid refresh token');
    }
    if (session.previous_refresh_hash && (0, crypto_1.safeEqual)(session.previous_refresh_hash, hash)) {
        // Rotation reuse: the only legitimate copy was already exchanged. Revoke the
        // entire session family and record a critical event.
        await (0, pool_1.query)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'refresh_token_reuse'
        WHERE user_id = $1 AND revoked_at IS NULL`, [session.id]);
        (0, tokenService_1.clearRefreshCookie)(res);
        (0, tokenService_1.clearCsrfCookie)(res);
        await (0, auditService_1.recordRequestEvent)(req, {
            userId: session.id,
            actorEmail: session.email,
            eventType: 'REFRESH_TOKEN_REUSE',
            severity: 'critical',
            description: 'Refresh token reuse detected; all sessions for the user were revoked',
        });
        throw (0, errors_1.unauthorized)('Refresh token reuse detected. Please sign in again.');
    }
    if (session.revoked_at) {
        (0, tokenService_1.clearRefreshCookie)(res);
        throw (0, errors_1.unauthorized)('Session revoked');
    }
    if (session.status !== 'active')
        throw (0, errors_1.forbidden)('Account is not active');
    if (new Date(session.session_expires_at).getTime() <= Date.now()) {
        (0, tokenService_1.clearRefreshCookie)(res);
        throw (0, errors_1.unauthorized)('Session expired');
    }
    if (Date.now() - new Date(session.session_last_used_at).getTime() > session.session_timeout_minutes * 60_000) {
        await (0, pool_1.query)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'idle_timeout' WHERE id = $1`, [session.session_id]);
        (0, tokenService_1.clearRefreshCookie)(res);
        (0, tokenService_1.clearCsrfCookie)(res);
        throw (0, errors_1.unauthorized)('Session expired due to inactivity');
    }
    const { raw, hash: newHash } = (0, tokenService_1.createRefreshToken)();
    await (0, pool_1.query)(`UPDATE sessions
        SET previous_refresh_hash = current_refresh_hash,
            current_refresh_hash = $2,
            last_used_at = now(),
            last_ip = $3
      WHERE id = $1`, [session.session_id, newHash, req.ip?.replace(/^::ffff:/, '') ?? null]);
    const remainingMs = new Date(session.session_expires_at).getTime() - Date.now();
    (0, tokenService_1.setRefreshCookie)(res, raw, remainingMs);
    const csrfToken = (0, tokenService_1.createCsrfToken)();
    (0, tokenService_1.setCsrfCookie)(res, csrfToken);
    const access = (0, tokenService_1.signAccessToken)({
        userId: session.id,
        email: session.email,
        role: session.role,
        sessionId: session.session_id,
    });
    const policy = await getPolicy();
    const safeUser = (await getSafeUserById(session.id, policy));
    return { user: safeUser, accessToken: access.token, csrfToken, expiresIn: access.expiresIn };
}
async function logout(rawToken, req, res) {
    if (rawToken) {
        const hash = (0, tokenService_1.hashRefreshToken)(rawToken);
        const session = await (0, pool_1.queryOne)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
        WHERE (current_refresh_hash = $1 OR previous_refresh_hash = $1) AND revoked_at IS NULL
        RETURNING id, user_id`, [hash]);
        if (session) {
            await (0, auditService_1.recordSecurityEvent)({
                userId: session.user_id,
                ip: req.ip?.replace(/^::ffff:/, '') ?? null,
                eventType: 'LOGOUT',
                severity: 'info',
                description: 'User logged out and session was revoked',
                request: req,
            });
        }
    }
    (0, tokenService_1.clearRefreshCookie)(res);
    (0, tokenService_1.clearCsrfCookie)(res);
}
async function revokeAllSessions(userId, reason) {
    await (0, pool_1.query)(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
}
async function assertPasswordNotReused(userId, newPassword, limit) {
    const history = await (0, pool_1.query)(`SELECT password_hash FROM password_history
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    for (const entry of history) {
        if (await (0, passwordPolicy_1.verifyPassword)(entry.password_hash, newPassword)) {
            throw (0, errors_1.badRequest)(`You cannot reuse any of your last ${limit} passwords`, {
                password: ['Choose a password you have not used recently'],
            });
        }
    }
}
async function addPasswordHistory(userId, passwordHash, client) {
    if (client) {
        await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
        return;
    }
    await (0, pool_1.query)('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
}
async function changePassword(userId, currentPassword, newPassword, req) {
    const user = await loadUserById(userId);
    if (!user)
        throw (0, errors_1.unauthorized)();
    if (!(await (0, passwordPolicy_1.verifyPassword)(user.password_hash, currentPassword))) {
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'PASSWORD_CHANGE_FAILED',
            severity: 'medium',
            description: 'Password change rejected: current password was incorrect',
        });
        throw (0, errors_1.badRequest)('Current password is incorrect');
    }
    const policy = await getPolicy();
    assertStrongPasswordOrThrow(newPassword, user);
    await assertPasswordNotReused(userId, newPassword, policy.password_history_count);
    const newHash = await (0, passwordPolicy_1.hashPassword)(newPassword);
    await (0, pool_1.withTransaction)(async (client) => {
        await client.query(`UPDATE users SET password_hash = $2, must_change_password = FALSE,
              last_password_change_at = now() WHERE id = $1`, [userId, newHash]);
        await addPasswordHistory(userId, newHash, client);
    });
    // Invalidate every session, including the current one, after a credential change.
    await revokeAllSessions(userId, 'password_changed');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'PASSWORD_CHANGED',
        severity: 'high',
        description: 'Password changed; all existing sessions were revoked',
    });
}
function assertStrongPasswordOrThrow(password, user) {
    const problems = (0, passwordPolicy_1.passwordProblems)(password, { email: user.email, fullName: user.full_name });
    if (problems.length > 0)
        throw (0, errors_1.badRequest)('Password does not meet the security policy', { password: problems });
}
async function requestPasswordReset(email, req) {
    const user = await loadUserByEmail(email);
    if (!user) {
        // Always return the same public response to prevent account enumeration.
        return {};
    }
    const token = (0, crypto_1.randomToken)(32);
    const expiry = new Date(Date.now() + 30 * 60_000);
    // Invalidate older outstanding links so only the newest request can be used.
    await (0, pool_1.query)('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await (0, pool_1.query)(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, $3, $4)`, [user.id, (0, crypto_1.pepperedHash)(token, 'password-reset'), expiry, req.ip?.replace(/^::ffff:/, '') ?? null]);
    const resetUrl = `${config_1.config.frontendOrigin}/reset-password?token=${encodeURIComponent(token)}`;
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: user.id,
        actorEmail: user.email,
        eventType: 'PASSWORD_RESET_REQUESTED',
        severity: 'medium',
        description: 'Password reset token issued (delivered out-of-band)',
    });
    // Production integrates an email provider here. The token itself is NEVER logged.
    return config_1.config.exposeResetToken ? { developmentResetUrl: resetUrl } : {};
}
async function resetPassword(token, newPassword, req) {
    const tokenHash = (0, crypto_1.pepperedHash)(token, 'password-reset');
    const record = await (0, pool_1.queryOne)(`SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`, [tokenHash]);
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) {
        throw (0, errors_1.badRequest)('This password reset link is invalid or has expired');
    }
    const user = await loadUserById(record.user_id);
    if (!user)
        throw (0, errors_1.badRequest)('This password reset link is invalid or has expired');
    assertStrongPasswordOrThrow(newPassword, user);
    const policy = await getPolicy();
    await assertPasswordNotReused(user.id, newPassword, policy.password_history_count);
    const newHash = await (0, passwordPolicy_1.hashPassword)(newPassword);
    await (0, pool_1.withTransaction)(async (client) => {
        await client.query(`UPDATE users SET password_hash = $2, must_change_password = FALSE,
              failed_login_count = 0, locked_until = NULL, status = 'active',
              last_password_change_at = now() WHERE id = $1`, [user.id, newHash]);
        await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [record.id]);
        await addPasswordHistory(user.id, newHash, client);
    });
    await revokeAllSessions(user.id, 'password_reset');
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: user.id,
        actorEmail: user.email,
        eventType: 'PASSWORD_RESET_COMPLETED',
        severity: 'high',
        description: 'Password reset completed; all sessions were revoked',
    });
}
async function startMfaSetup(userId, currentPassword) {
    const user = await loadUserById(userId);
    if (!user)
        throw (0, errors_1.unauthorized)();
    if (!(await (0, passwordPolicy_1.verifyPassword)(user.password_hash, currentPassword))) {
        throw (0, errors_1.badRequest)('Current password is incorrect');
    }
    if (user.mfa_enabled)
        throw (0, errors_1.conflict)('MFA is already enabled');
    const secret = (0, totp_1.generateTotpSecret)();
    await (0, pool_1.query)('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [userId, (0, crypto_1.encryptSecret)(secret)]);
    const otpauthUrl = (0, totp_1.buildOtpAuthUrl)(secret, user.email);
    const QRCode = await Promise.resolve().then(() => __importStar(require('qrcode')));
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
        color: { dark: '#0f172a', light: '#ffffff' },
    });
    return { qrCodeDataUrl, otpauthUrl, secret };
}
async function enableMfa(userId, code, req) {
    const user = await loadUserById(userId);
    if (!user)
        throw (0, errors_1.unauthorized)();
    if (user.mfa_enabled)
        throw (0, errors_1.conflict)('MFA is already enabled');
    if (!user.mfa_pending_secret_enc)
        throw (0, errors_1.badRequest)('Start MFA setup before verifying a code');
    const secret = (0, crypto_1.decryptSecret)(user.mfa_pending_secret_enc);
    const step = (0, totp_1.verifyTotpStep)(secret, code);
    if (step === null) {
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'MFA_VERIFICATION_FAILED',
            severity: 'medium',
            description: 'MFA enrollment code was invalid',
        });
        throw (0, errors_1.badRequest)('Invalid authenticator code');
    }
    const backupCodes = (0, totp_1.generateBackupCodes)(10);
    await (0, pool_1.withTransaction)(async (client) => {
        await client.query(`UPDATE users SET mfa_enabled = TRUE, mfa_secret_enc = $2,
              mfa_pending_secret_enc = NULL, mfa_last_totp_step = $3
        WHERE id = $1`, [userId, (0, crypto_1.encryptSecret)(secret), step]);
        await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
        for (const backupCode of backupCodes) {
            await client.query('INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
                userId,
                (0, crypto_1.pepperedHash)(backupCode, 'mfa-backup'),
            ]);
        }
    });
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'MFA_ENABLED',
        severity: 'high',
        description: 'TOTP multi-factor authentication enabled and backup codes generated',
    });
    return { backupCodes };
}
async function disableMfa(userId, currentPassword, code, req) {
    const user = await loadUserById(userId);
    if (!user)
        throw (0, errors_1.unauthorized)();
    if (!(await (0, passwordPolicy_1.verifyPassword)(user.password_hash, currentPassword)))
        throw (0, errors_1.badRequest)('Current password is incorrect');
    if (!user.mfa_enabled || !user.mfa_secret_enc)
        throw (0, errors_1.badRequest)('MFA is not enabled');
    const step = (0, totp_1.verifyTotpStep)((0, crypto_1.decryptSecret)(user.mfa_secret_enc), code);
    const previous = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
    if (step === null || step <= previous)
        throw (0, errors_1.badRequest)('Invalid or already-used authenticator code');
    await (0, pool_1.withTransaction)(async (client) => {
        await client.query(`UPDATE users SET mfa_enabled = FALSE, mfa_secret_enc = NULL,
              mfa_last_totp_step = NULL WHERE id = $1`, [userId]);
        await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
    });
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'MFA_DISABLED',
        severity: 'critical',
        description: 'TOTP multi-factor authentication was disabled',
    });
}
async function regenerateBackupCodes(userId, currentPassword, code, req) {
    const user = await loadUserById(userId);
    if (!user)
        throw (0, errors_1.unauthorized)();
    if (!(await (0, passwordPolicy_1.verifyPassword)(user.password_hash, currentPassword)))
        throw (0, errors_1.badRequest)('Current password is incorrect');
    if (!user.mfa_enabled || !user.mfa_secret_enc)
        throw (0, errors_1.badRequest)('MFA is not enabled');
    const step = (0, totp_1.verifyTotpStep)((0, crypto_1.decryptSecret)(user.mfa_secret_enc), code);
    const previous = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
    if (step === null || step <= previous)
        throw (0, errors_1.badRequest)('Invalid or already-used authenticator code');
    const backupCodes = (0, totp_1.generateBackupCodes)(10);
    await (0, pool_1.withTransaction)(async (client) => {
        await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
        for (const backupCode of backupCodes) {
            await client.query('INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
                userId,
                (0, crypto_1.pepperedHash)(backupCode, 'mfa-backup'),
            ]);
        }
        await client.query('UPDATE users SET mfa_last_totp_step = $2 WHERE id = $1', [userId, step]);
    });
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'MFA_BACKUP_CODES_REGENERATED',
        severity: 'high',
        description: 'MFA backup recovery codes were regenerated',
    });
    return { backupCodes };
}
//# sourceMappingURL=authService.js.map