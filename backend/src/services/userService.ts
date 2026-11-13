import crypto from 'node:crypto';
import { Request } from 'express';
import { query, queryOne, withTransaction } from '../db/pool';
import { AppRole } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../utils/errors';
import { randomToken } from '../utils/crypto';
import { assertStrongPassword, hashPassword } from '../utils/passwordPolicy';
import { recordRequestEvent } from './auditService';
import { addPasswordHistory, getSafeUserById, SafeUser } from './authService';

export interface CreateUserInput {
  email: string;
  fullName: string;
  role: AppRole;
  password?: string;
  studentId?: string | null;
  staffId?: string | null;
  departmentId?: string | null;
  phone?: string | null;
  address?: string | null;
  programme?: string | null;
  level?: string | null;
  mustChangePassword?: boolean;
}

export interface CreateUserResult {
  user: SafeUser;
  temporaryPassword?: string;
}

function generateTemporaryPassword(): string {
  // Guaranteed to satisfy complexity, still only a bootstrap credential: the
  // account is forced to change it at first login.
  return `Tmp9!${crypto.randomBytes(12).toString('base64url')}`;
}

function isUniqueViolation(error: unknown): error is { code: string; constraint?: string; detail?: string } {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

export async function createUser(input: CreateUserInput, req: Request): Promise<CreateUserResult> {
  if (input.role === 'student' && !input.studentId) throw badRequest('A student ID is required for student accounts');
  if (input.departmentId) {
    const department = await queryOne('SELECT id FROM departments WHERE id = $1', [input.departmentId]);
    if (!department) throw badRequest('Selected department does not exist');
  }

  const temporaryPassword = input.password ? undefined : generateTemporaryPassword();
  const password = input.password || temporaryPassword!;
  assertStrongPassword(password, { email: input.email, fullName: input.fullName });
  const passwordHash = await hashPassword(password);

  try {
    const user = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users
           (email, password_hash, full_name, role, status, student_id, staff_id,
            department_id, phone, address, programme, level, must_change_password)
         VALUES (lower($1), $2, $3, $4::user_role, 'active', $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          input.email,
          passwordHash,
          input.fullName,
          input.role,
          input.studentId || null,
          input.staffId || null,
          input.departmentId || null,
          input.phone || null,
          input.address || null,
          input.programme || null,
          input.level || null,
          input.mustChangePassword ?? Boolean(temporaryPassword),
        ],
      );
      const id = inserted.rows[0].id;
      await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [id, passwordHash]);
      return id;
    });

    await recordRequestEvent(req, {
      userId: user,
      actorEmail: input.email,
      eventType: 'USER_CREATED',
      severity: input.role === 'administrator' || input.role === 'super_admin' ? 'high' : 'medium',
      description: `Account created with role ${input.role}`,
      metadata: { role: input.role, createdBy: req.auth?.email ?? 'self-registration' },
    });

    return {
      user: (await getSafeUserById(user))!,
      temporaryPassword,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const detail = error.detail || '';
      if (detail.includes('email')) throw conflict('An account with this email already exists');
      if (detail.includes('student_id')) throw conflict('This student ID is already registered');
      if (detail.includes('staff_id')) throw conflict('This staff ID is already registered');
      throw conflict('An account with these details already exists');
    }
    throw error;
  }
}

export async function resetUserPasswordByAdmin(
  userId: string,
  req: Request,
): Promise<{ temporaryPassword: string }> {
  const target = await queryOne<{ id: string; email: string; role: AppRole }>(
    'SELECT id, email, role FROM users WHERE id = $1',
    [userId],
  );
  if (!target) throw notFound('User not found');
  if (target.id === req.auth?.userId) {
    throw badRequest('Use the change-password flow to reset your own password');
  }
  if (
    (target.role === 'super_admin' || target.role === 'administrator') &&
    req.auth?.role !== 'super_admin'
  ) {
    throw conflict('Only a super administrator can reset an administrative account password');
  }
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = TRUE,
            failed_login_count = 0, locked_until = NULL, status = 'active',
            last_password_change_at = now()
      WHERE id = $1`,
    [userId, hash],
  );
  await query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, hash]);
  await query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'admin_password_reset'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  await recordRequestEvent(req, {
    userId,
    actorEmail: target.email,
    eventType: 'ADMIN_PASSWORD_RESET',
    severity: 'high',
    description: 'Administrator issued a temporary password; user sessions were revoked',
    metadata: { targetRole: target.role },
  });
  return { temporaryPassword };
}

export async function unlockUser(userId: string, req: Request): Promise<SafeUser> {
  const updated = await queryOne<{ id: string }>(
    `UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL
      WHERE id = $1 RETURNING id`,
    [userId],
  );
  if (!updated) throw notFound('User not found');

  await recordRequestEvent(req, {
    userId,
    eventType: 'ACCOUNT_UNLOCKED',
    severity: 'medium',
    description: 'Administrator unlocked the account and cleared failed login counters',
  });
  return (await getSafeUserById(userId))!;
}

export async function listUsers(input: {
  page: number;
  limit: number;
  search?: string;
  role?: string;
  status?: string;
}): Promise<{ rows: unknown[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (input.search) {
    params.push(`%${input.search}%`);
    conditions.push(
      `(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.student_id ILIKE $${params.length} OR u.staff_id ILIKE $${params.length})`,
    );
  }
  if (input.role) {
    params.push(input.role);
    conditions.push(`u.role = $${params.length}::user_role`);
  }
  if (input.status) {
    params.push(input.status);
    conditions.push(`u.status = $${params.length}::account_status`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const count = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM users u ${where}`,
    params,
  );
  params.push(input.limit, (input.page - 1) * input.limit);
  const rows = await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.student_id, u.staff_id,
            u.department_id, d.name AS department_name, u.programme, u.level,
            u.mfa_enabled, u.must_change_password, u.failed_login_count,
            u.locked_until, u.last_login_at, u.created_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ${where}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: Number(count?.count ?? 0) };
}
