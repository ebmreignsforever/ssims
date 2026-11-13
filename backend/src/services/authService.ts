import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { config } from '../config';
import { query, queryOne, withTransaction } from '../db/pool';
import { permissionsFor, AppRole } from '../middleware/auth';
import { ApiError, badRequest, conflict, forbidden, unauthorized } from '../utils/errors';
import { decryptSecret, encryptSecret, pepperedHash, randomToken, safeEqual } from '../utils/crypto';
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from '../utils/passwordPolicy';
import { buildOtpAuthUrl, generateBackupCodes, generateTotpSecret, verifyTotpStep } from '../utils/totp';
import { recordRequestEvent, recordSecurityEvent } from './auditService';
import {
  clearCsrfCookie,
  clearRefreshCookie,
  createCsrfToken,
  createRefreshToken,
  hashRefreshToken,
  setCsrfCookie,
  setRefreshCookie,
  signAccessToken,
} from './tokenService';

export interface Policy {
  max_login_attempts: number;
  lockout_minutes: number;
  challenge_after_failures: number;
  password_history_count: number;
  session_timeout_minutes: number;
  require_mfa_for_admins: boolean;
  require_mfa_for_lecturers: boolean;
  password_max_age_days: number;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: AppRole;
  status: 'active' | 'locked' | 'suspended' | 'pending';
  student_id: string | null;
  staff_id: string | null;
  department_id: string | null;
  phone: string | null;
  address: string | null;
  programme: string | null;
  level: string | null;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_pending_secret_enc: string | null;
  mfa_last_totp_step: string | null;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_password_change_at: Date;
  created_at: Date;
  department_name?: string | null;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  status: string;
  studentId: string | null;
  staffId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  phone: string | null;
  address: string | null;
  programme: string | null;
  level: string | null;
  mfaEnabled: boolean;
  mfaEnrollmentRequired: boolean;
  mustChangePassword: boolean;
  passwordExpired: boolean;
  backupCodesRemaining: number;
  lastLoginAt: string | null;
  createdAt: string;
  permissions: string[];
}

export function toSafeUser(row: UserRow, backupCodesRemaining = 0, policy?: Policy): SafeUser {
  const passwordExpired = policy
    ? Date.now() - new Date(row.last_password_change_at).getTime() > policy.password_max_age_days * 86_400_000
    : false;
  const mfaRequiredByPolicy = Boolean(
    policy &&
      (((row.role === 'super_admin' || row.role === 'administrator') && policy.require_mfa_for_admins) ||
        (row.role === 'lecturer' && policy.require_mfa_for_lecturers)),
  );
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
    permissions: permissionsFor(row.role),
  };
}

export async function getPolicy(): Promise<Policy> {
  const policy = await queryOne<Policy>('SELECT * FROM security_policies WHERE id = 1');
  if (!policy) throw new Error('Security policy row missing');
  return policy;
}

export async function loadUserByEmail(email: string, client?: PoolClient): Promise<UserRow | null> {
  const sql = `SELECT u.*, d.name AS department_name
                 FROM users u LEFT JOIN departments d ON d.id = u.department_id
                WHERE lower(u.email) = lower($1)`;
  if (client) {
    const result = await client.query<UserRow>(sql, [email]);
    return result.rows[0] ?? null;
  }
  return queryOne<UserRow>(sql, [email]);
}

export async function loadUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT u.*, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [id],
  );
}

export async function getSafeUserById(id: string, providedPolicy?: Policy): Promise<SafeUser | null> {
  const user = await loadUserById(id);
  if (!user) return null;
  const policy = providedPolicy ?? (await getPolicy());
  const count = await queryOne<{ count: string }>(
    'SELECT count(*)::text FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL',
    [id],
  );
  return toSafeUser(user, Number(count?.count ?? 0), policy);
}

let dummyHashPromise: Promise<string> | null = null;

async function dummyHash(): Promise<string> {
  // Equalise timing between an unknown email and a known email with a wrong
  // password. Generated once per process and kept only in memory.
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomToken(24));
  return dummyHashPromise;
}

interface ChallengeRow {
  id: string;
  identifier: string;
  answer_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
}

async function issueChallenge(identifier: string, ip: string | null): Promise<{ challengeId: string; prompt: string; expiresInSeconds: number }> {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(2, 10);
  const answer = String(a + b);
  const prompt = `Human verification: what is ${a} + ${b}?`;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO auth_challenges (identifier, ip, prompt, answer_hash, expires_at)
     VALUES (lower($1), $2, $3, $4, now() + interval '5 minutes') RETURNING id`,
    [identifier, ip, prompt, pepperedHash(answer, 'auth-challenge')],
  );
  return { challengeId: row!.id, prompt, expiresInSeconds: 300 };
}

async function verifyChallenge(
  challengeId: string,
  identifier: string,
  answer: string,
  ip: string | null,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return false;
  const row = await queryOne<ChallengeRow>(
    `SELECT id, identifier, answer_hash, expires_at, consumed_at
       FROM auth_challenges WHERE id = $1 AND lower(identifier) = lower($2)`,
    [challengeId, identifier],
  );
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) return false;
  await query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [row.id]);
  const candidate = pepperedHash(answer.trim(), 'auth-challenge');
  return safeEqual(candidate, row.answer_hash);
}

async function recentFailureCount(email: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `WITH last_success AS (
       SELECT max(created_at) AS at FROM login_attempts
        WHERE lower(email) = lower($1) AND successful = TRUE
     )
     SELECT count(*)::text AS count
       FROM login_attempts, last_success
      WHERE lower(email) = lower($1)
        AND successful = FALSE
        AND created_at > now() - interval '15 minutes'
        AND created_at > COALESCE(last_success.at, to_timestamp(0))`,
    [email],
  );
  return Number(row?.count ?? 0);
}

async function recordLoginAttempt(
  email: string,
  ip: string | null,
  successful: boolean,
  failureReason: string | null,
  userAgent: string | undefined,
): Promise<void> {
  await query(
    `INSERT INTO login_attempts (email, ip, successful, failure_reason, user_agent)
     VALUES (lower($1), $2, $3, $4, $5)`,
    [email, ip, successful, failureReason, userAgent?.slice(0, 300) ?? null],
  );
}

async function registerFailure(
  user: UserRow,
  policy: Policy,
  reason: string,
  req: Request,
): Promise<void> {
  const nextCount = user.failed_login_count + 1;
  const shouldLock = nextCount >= policy.max_login_attempts;
  const lockedUntil = shouldLock ? new Date(Date.now() + policy.lockout_minutes * 60_000) : null;
  await query(
    `UPDATE users
        SET failed_login_count = $2,
            status = CASE WHEN $3 THEN 'locked'::account_status ELSE status END,
            locked_until = $4
      WHERE id = $1`,
    [user.id, nextCount, shouldLock, lockedUntil],
  );
  await recordLoginAttempt(user.email, req.ip?.replace(/^::ffff:/, '') ?? null, false, reason, req.get('user-agent'));
  await recordRequestEvent(req, {
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

async function verifyMfaForUser(
  user: UserRow,
  totpCode: string | undefined,
  backupCode: string | undefined,
): Promise<{ ok: boolean; usedBackupCode: boolean; reason?: string }> {
  if (backupCode) {
    const normalized = backupCode.replace(/\s+/g, '').toUpperCase();
    const hash = pepperedHash(normalized, 'mfa-backup');
    const code = await queryOne<{ id: string }>(
      `UPDATE mfa_backup_codes SET used_at = now()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
        RETURNING id`,
      [user.id, hash],
    );
    return code ? { ok: true, usedBackupCode: true } : { ok: false, usedBackupCode: true, reason: 'invalid_backup_code' };
  }

  if (!user.mfa_secret_enc || !totpCode) {
    return { ok: false, usedBackupCode: false, reason: 'mfa_code_required' };
  }

  const secret = decryptSecret(user.mfa_secret_enc);
  const step = verifyTotpStep(secret, totpCode);
  if (step === null) return { ok: false, usedBackupCode: false, reason: 'invalid_totp' };

  const previousStep = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
  if (step <= previousStep) {
    return { ok: false, usedBackupCode: false, reason: 'totp_replay' };
  }
  await query('UPDATE users SET mfa_last_totp_step = $2 WHERE id = $1', [user.id, step]);
  return { ok: true, usedBackupCode: false };
}

async function createSession(
  user: UserRow,
  req: Request,
  res: Response,
): Promise<{ accessToken: string; csrfToken: string; expiresIn: number }> {
  const { raw, hash } = createRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
  await query(
    `INSERT INTO sessions (user_id, current_refresh_hash, expires_at, created_ip, last_ip, user_agent)
     VALUES ($1, $2, $3, $4, $4, $5)`,
    [user.id, hash, expiresAt, req.ip?.replace(/^::ffff:/, '') ?? null, req.get('user-agent')?.slice(0, 300) ?? null],
  );
  const refreshTtlMs = config.refreshTokenTtlDays * 86_400_000;
  setRefreshCookie(res, raw, refreshTtlMs);
  const csrfToken = createCsrfToken();
  setCsrfCookie(res, csrfToken);

  const session = await queryOne<{ id: string }>(
    'SELECT id FROM sessions WHERE current_refresh_hash = $1',
    [hash],
  );
  const access = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: session!.id,
  });
  return { accessToken: access.token, csrfToken, expiresIn: access.expiresIn };
}

export interface LoginInput {
  email: string;
  password: string;
  mfaCode?: string;
  backupCode?: string;
  challengeId?: string;
  challengeAnswer?: string;
}

export async function login(
  input: LoginInput,
  req: Request,
  res: Response,
): Promise<{ user: SafeUser; accessToken: string; csrfToken: string; expiresIn: number }> {
  const policy = await getPolicy();
  const user = await loadUserByEmail(input.email);
  const ip = req.ip?.replace(/^::ffff:/, '') ?? null;

  if (!user) {
    // Constant-work dummy verification plus generic response prevents account enumeration.
    await verifyPassword(await dummyHash(), input.password);
    await recordLoginAttempt(input.email, ip, false, 'unknown_email', req.get('user-agent'));
    await recordRequestEvent(req, {
      eventType: 'LOGIN_FAILED',
      severity: 'medium',
      description: 'Failed login for an unknown account',
      metadata: { email: input.email },
    });
    throw unauthorized('Invalid email or password');
  }

  if (user.status === 'suspended') {
    await recordLoginAttempt(input.email, ip, false, 'account_suspended', req.get('user-agent'));
    await recordRequestEvent(req, {
      userId: user.id,
      actorEmail: user.email,
      eventType: 'LOGIN_BLOCKED',
      severity: 'high',
      description: 'Login blocked for a suspended account',
    });
    throw forbidden('This account is suspended. Contact the administrator.');
  }

  if (user.status === 'locked') {
    if (user.locked_until && new Date(user.locked_until).getTime() <= Date.now()) {
      // Temporary lock has elapsed: allow a fresh set of attempts.
      await query(
        "UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL WHERE id = $1",
        [user.id],
      );
      user.status = 'active';
      user.failed_login_count = 0;
    } else {
      const remaining = user.locked_until
        ? Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000))
        : null;
      await recordLoginAttempt(input.email, ip, false, 'account_locked', req.get('user-agent'));
      throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is locked due to repeated failed logins', {
        retryAfterMinutes: remaining,
      });
    }
  }

  const passwordOk = await verifyPassword(user.password_hash, input.password);
  if (!passwordOk) {
    await registerFailure(user, policy, 'invalid_password', req);
    throw unauthorized('Invalid email or password');
  }

  // Ask for the MFA code first when MFA is enabled. This keeps the human
  // challenge unconsumed until the final authentication step, so a user never
  // has to solve two challenges merely because MFA is also active.
  if (user.mfa_enabled && !input.mfaCode && !input.backupCode) {
    // Intermediate step, not a failed credential attempt.
    throw new ApiError(401, 'MFA_REQUIRED', 'Enter the verification code from your authenticator app');
  }

  // A correct password after repeated failures triggers additional human
  // verification. Wrong-password attempts continue to drive progressive lockout.
  const failures = await recentFailureCount(input.email);
  if (failures >= policy.challenge_after_failures) {
    if (!input.challengeId || !input.challengeAnswer) {
      const challenge = await issueChallenge(input.email, ip);
      throw new ApiError(401, 'CHALLENGE_REQUIRED', 'Additional human verification is required', challenge);
    }
    const validChallenge = await verifyChallenge(input.challengeId, input.email, input.challengeAnswer, ip);
    if (!validChallenge) {
      await registerFailure(user, policy, 'challenge_failed', req);
      throw new ApiError(401, 'CHALLENGE_FAILED', 'Human verification failed. A new challenge is required.');
    }
  }

  if (user.mfa_enabled) {
    const mfa = await verifyMfaForUser(user, input.mfaCode, input.backupCode);
    if (!mfa.ok) {
      await registerFailure(user, policy, mfa.reason || 'mfa_failed', req);
      await recordRequestEvent(req, {
        userId: user.id,
        actorEmail: user.email,
        eventType: 'MFA_VERIFICATION_FAILED',
        severity: 'high',
        description: `MFA verification failed (${mfa.reason || 'invalid_code'})`,
        metadata: { backupCodeUsed: mfa.usedBackupCode },
      });
      throw unauthorized(mfa.reason === 'totp_replay' ? 'That verification code was already used' : 'Invalid verification code');
    }
  }

  if (await needsRehash(user.password_hash)) {
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(input.password)]);
  }

  await query(
    `UPDATE users
        SET failed_login_count = 0, locked_until = NULL, status = 'active',
            last_login_at = now(), last_login_ip = $2,
            must_change_password = CASE
              WHEN last_password_change_at < now() - ($3 || ' days')::interval THEN TRUE
              ELSE must_change_password END
      WHERE id = $1`,
    [user.id, ip, String(policy.password_max_age_days)],
  );
  await recordLoginAttempt(user.email, ip, true, null, req.get('user-agent'));

  const session = await createSession(user, req, res);
  const freshPolicy = policy;
  const safeUser = (await getSafeUserById(user.id, freshPolicy))!;
  await recordRequestEvent(req, {
    userId: user.id,
    actorEmail: user.email,
    eventType: 'LOGIN_SUCCESS',
    severity: 'info',
    description: 'Successful login',
    metadata: { role: user.role, mfa: user.mfa_enabled, backupCodeUsed: Boolean(input.backupCode) },
  });
  return { user: safeUser, ...session };
}

export async function refreshSession(
  rawToken: string | undefined,
  req: Request,
  res: Response,
): Promise<{ user: SafeUser; accessToken: string; csrfToken: string; expiresIn: number }> {
  if (!rawToken) throw unauthorized('Refresh token is missing');
  const hash = hashRefreshToken(rawToken);
  const session = await queryOne<
    UserRow & {
      session_id: string;
      current_refresh_hash: string;
      previous_refresh_hash: string | null;
      session_expires_at: Date;
      session_last_used_at: Date;
      session_timeout_minutes: number;
      revoked_at: Date | null;
    }
  >(
    `SELECT u.*, d.name AS department_name,
            s.id AS session_id, s.current_refresh_hash, s.previous_refresh_hash,
            s.expires_at AS session_expires_at, s.last_used_at AS session_last_used_at,
            s.revoked_at, p.session_timeout_minutes
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       CROSS JOIN security_policies p
      WHERE (s.current_refresh_hash = $1 OR s.previous_refresh_hash = $1) AND p.id = 1
      LIMIT 1`,
    [hash],
  );

  if (!session) {
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    throw unauthorized('Invalid refresh token');
  }

  if (session.previous_refresh_hash && safeEqual(session.previous_refresh_hash, hash)) {
    // Rotation reuse: the only legitimate copy was already exchanged. Revoke the
    // entire session family and record a critical event.
    await query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'refresh_token_reuse'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.id],
    );
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    await recordRequestEvent(req, {
      userId: session.id,
      actorEmail: session.email,
      eventType: 'REFRESH_TOKEN_REUSE',
      severity: 'critical',
      description: 'Refresh token reuse detected; all sessions for the user were revoked',
    });
    throw unauthorized('Refresh token reuse detected. Please sign in again.');
  }

  if (session.revoked_at) {
    clearRefreshCookie(res);
    throw unauthorized('Session revoked');
  }
  if (session.status !== 'active') throw forbidden('Account is not active');
  if (new Date(session.session_expires_at).getTime() <= Date.now()) {
    clearRefreshCookie(res);
    throw unauthorized('Session expired');
  }
  if (Date.now() - new Date(session.session_last_used_at).getTime() > session.session_timeout_minutes * 60_000) {
    await query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'idle_timeout' WHERE id = $1`,
      [session.session_id],
    );
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    throw unauthorized('Session expired due to inactivity');
  }

  const { raw, hash: newHash } = createRefreshToken();
  await query(
    `UPDATE sessions
        SET previous_refresh_hash = current_refresh_hash,
            current_refresh_hash = $2,
            last_used_at = now(),
            last_ip = $3
      WHERE id = $1`,
    [session.session_id, newHash, req.ip?.replace(/^::ffff:/, '') ?? null],
  );

  const remainingMs = new Date(session.session_expires_at).getTime() - Date.now();
  setRefreshCookie(res, raw, remainingMs);
  const csrfToken = createCsrfToken();
  setCsrfCookie(res, csrfToken);

  const access = signAccessToken({
    userId: session.id,
    email: session.email,
    role: session.role,
    sessionId: session.session_id,
  });
  const policy = await getPolicy();
  const safeUser = (await getSafeUserById(session.id, policy))!;
  return { user: safeUser, accessToken: access.token, csrfToken, expiresIn: access.expiresIn };
}

export async function logout(rawToken: string | undefined, req: Request, res: Response): Promise<void> {
  if (rawToken) {
    const hash = hashRefreshToken(rawToken);
    const session = await queryOne<{ id: string; user_id: string }>(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
        WHERE (current_refresh_hash = $1 OR previous_refresh_hash = $1) AND revoked_at IS NULL
        RETURNING id, user_id`,
      [hash],
    );
    if (session) {
      await recordSecurityEvent({
        userId: session.user_id,
        ip: req.ip?.replace(/^::ffff:/, '') ?? null,
        eventType: 'LOGOUT',
        severity: 'info',
        description: 'User logged out and session was revoked',
        request: req,
      });
    }
  }
  clearRefreshCookie(res);
  clearCsrfCookie(res);
}

export async function revokeAllSessions(userId: string, reason: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

export async function assertPasswordNotReused(userId: string, newPassword: string, limit: number): Promise<void> {
  const history = await query<{ password_hash: string }>(
    `SELECT password_hash FROM password_history
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  for (const entry of history) {
    if (await verifyPassword(entry.password_hash, newPassword)) {
      throw badRequest(`You cannot reuse any of your last ${limit} passwords`, {
        password: ['Choose a password you have not used recently'],
      });
    }
  }
}

export async function addPasswordHistory(
  userId: string,
  passwordHash: string,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
    return;
  }
  await query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  req: Request,
): Promise<void> {
  const user = await loadUserById(userId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    await recordRequestEvent(req, {
      eventType: 'PASSWORD_CHANGE_FAILED',
      severity: 'medium',
      description: 'Password change rejected: current password was incorrect',
    });
    throw badRequest('Current password is incorrect');
  }
  const policy = await getPolicy();
  assertStrongPasswordOrThrow(newPassword, user);
  await assertPasswordNotReused(userId, newPassword, policy.password_history_count);

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, must_change_password = FALSE,
              last_password_change_at = now() WHERE id = $1`,
      [userId, newHash],
    );
    await addPasswordHistory(userId, newHash, client);
  });
  // Invalidate every session, including the current one, after a credential change.
  await revokeAllSessions(userId, 'password_changed');
  await recordRequestEvent(req, {
    eventType: 'PASSWORD_CHANGED',
    severity: 'high',
    description: 'Password changed; all existing sessions were revoked',
  });
}

function assertStrongPasswordOrThrow(password: string, user: UserRow): void {
  const problems = passwordProblems(password, { email: user.email, fullName: user.full_name });
  if (problems.length > 0) throw badRequest('Password does not meet the security policy', { password: problems });
}

export interface ForgotResult {
  developmentResetUrl?: string;
}

export async function requestPasswordReset(email: string, req: Request): Promise<ForgotResult> {
  const user = await loadUserByEmail(email);
  if (!user) {
    // Always return the same public response to prevent account enumeration.
    return {};
  }
  const token = randomToken(32);
  const expiry = new Date(Date.now() + 30 * 60_000);
  // Invalidate older outstanding links so only the newest request can be used.
  await query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [user.id],
  );
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, $3, $4)`,
    [user.id, pepperedHash(token, 'password-reset'), expiry, req.ip?.replace(/^::ffff:/, '') ?? null],
  );
  const resetUrl = `${config.frontendOrigin}/reset-password?token=${encodeURIComponent(token)}`;
  await recordRequestEvent(req, {
    userId: user.id,
    actorEmail: user.email,
    eventType: 'PASSWORD_RESET_REQUESTED',
    severity: 'medium',
    description: 'Password reset token issued (delivered out-of-band)',
  });
  // Production integrates an email provider here. The token itself is NEVER logged.
  return config.exposeResetToken ? { developmentResetUrl: resetUrl } : {};
}

export async function resetPassword(token: string, newPassword: string, req: Request): Promise<void> {
  const tokenHash = pepperedHash(token, 'password-reset');
  const record = await queryOne<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) {
    throw badRequest('This password reset link is invalid or has expired');
  }
  const user = await loadUserById(record.user_id);
  if (!user) throw badRequest('This password reset link is invalid or has expired');
  assertStrongPasswordOrThrow(newPassword, user);
  const policy = await getPolicy();
  await assertPasswordNotReused(user.id, newPassword, policy.password_history_count);

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, must_change_password = FALSE,
              failed_login_count = 0, locked_until = NULL, status = 'active',
              last_password_change_at = now() WHERE id = $1`,
      [user.id, newHash],
    );
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [record.id]);
    await addPasswordHistory(user.id, newHash, client);
  });
  await revokeAllSessions(user.id, 'password_reset');
  await recordRequestEvent(req, {
    userId: user.id,
    actorEmail: user.email,
    eventType: 'PASSWORD_RESET_COMPLETED',
    severity: 'high',
    description: 'Password reset completed; all sessions were revoked',
  });
}

export async function startMfaSetup(
  userId: string,
  currentPassword: string,
): Promise<{ qrCodeDataUrl: string; otpauthUrl: string; secret: string }> {
  const user = await loadUserById(userId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    throw badRequest('Current password is incorrect');
  }
  if (user.mfa_enabled) throw conflict('MFA is already enabled');
  const secret = generateTotpSecret();
  await query('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [userId, encryptSecret(secret)]);
  const otpauthUrl = buildOtpAuthUrl(secret, user.email);
  const QRCode = await import('qrcode');
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return { qrCodeDataUrl, otpauthUrl, secret };
}

export async function enableMfa(userId: string, code: string, req: Request): Promise<{ backupCodes: string[] }> {
  const user = await loadUserById(userId);
  if (!user) throw unauthorized();
  if (user.mfa_enabled) throw conflict('MFA is already enabled');
  if (!user.mfa_pending_secret_enc) throw badRequest('Start MFA setup before verifying a code');
  const secret = decryptSecret(user.mfa_pending_secret_enc);
  const step = verifyTotpStep(secret, code);
  if (step === null) {
    await recordRequestEvent(req, {
      eventType: 'MFA_VERIFICATION_FAILED',
      severity: 'medium',
      description: 'MFA enrollment code was invalid',
    });
    throw badRequest('Invalid authenticator code');
  }

  const backupCodes = generateBackupCodes(10);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET mfa_enabled = TRUE, mfa_secret_enc = $2,
              mfa_pending_secret_enc = NULL, mfa_last_totp_step = $3
        WHERE id = $1`,
      [userId, encryptSecret(secret), step],
    );
    await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
    for (const backupCode of backupCodes) {
      await client.query('INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
        userId,
        pepperedHash(backupCode, 'mfa-backup'),
      ]);
    }
  });
  await recordRequestEvent(req, {
    eventType: 'MFA_ENABLED',
    severity: 'high',
    description: 'TOTP multi-factor authentication enabled and backup codes generated',
  });
  return { backupCodes };
}

export async function disableMfa(
  userId: string,
  currentPassword: string,
  code: string,
  req: Request,
): Promise<void> {
  const user = await loadUserById(userId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.password_hash, currentPassword))) throw badRequest('Current password is incorrect');
  if (!user.mfa_enabled || !user.mfa_secret_enc) throw badRequest('MFA is not enabled');
  const step = verifyTotpStep(decryptSecret(user.mfa_secret_enc), code);
  const previous = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
  if (step === null || step <= previous) throw badRequest('Invalid or already-used authenticator code');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET mfa_enabled = FALSE, mfa_secret_enc = NULL,
              mfa_last_totp_step = NULL WHERE id = $1`,
      [userId],
    );
    await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
  });
  await recordRequestEvent(req, {
    eventType: 'MFA_DISABLED',
    severity: 'critical',
    description: 'TOTP multi-factor authentication was disabled',
  });
}

export async function regenerateBackupCodes(
  userId: string,
  currentPassword: string,
  code: string,
  req: Request,
): Promise<{ backupCodes: string[] }> {
  const user = await loadUserById(userId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.password_hash, currentPassword))) throw badRequest('Current password is incorrect');
  if (!user.mfa_enabled || !user.mfa_secret_enc) throw badRequest('MFA is not enabled');
  const step = verifyTotpStep(decryptSecret(user.mfa_secret_enc), code);
  const previous = user.mfa_last_totp_step ? Number(user.mfa_last_totp_step) : -1;
  if (step === null || step <= previous) throw badRequest('Invalid or already-used authenticator code');

  const backupCodes = generateBackupCodes(10);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
    for (const backupCode of backupCodes) {
      await client.query('INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
        userId,
        pepperedHash(backupCode, 'mfa-backup'),
      ]);
    }
    await client.query('UPDATE users SET mfa_last_totp_step = $2 WHERE id = $1', [userId, step]);
  });
  await recordRequestEvent(req, {
    eventType: 'MFA_BACKUP_CODES_REGENERATED',
    severity: 'high',
    description: 'MFA backup recovery codes were regenerated',
  });
  return { backupCodes };
}
