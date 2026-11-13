"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = createUser;
exports.resetUserPasswordByAdmin = resetUserPasswordByAdmin;
exports.unlockUser = unlockUser;
exports.listUsers = listUsers;
const node_crypto_1 = __importDefault(require("node:crypto"));
const pool_1 = require("../db/pool");
const errors_1 = require("../utils/errors");
const passwordPolicy_1 = require("../utils/passwordPolicy");
const auditService_1 = require("./auditService");
const authService_1 = require("./authService");
function generateTemporaryPassword() {
    // Guaranteed to satisfy complexity, still only a bootstrap credential: the
    // account is forced to change it at first login.
    return `Tmp9!${node_crypto_1.default.randomBytes(12).toString('base64url')}`;
}
function isUniqueViolation(error) {
    return Boolean(error && typeof error === 'object' && error.code === '23505');
}
async function createUser(input, req) {
    if (input.role === 'student' && !input.studentId)
        throw (0, errors_1.badRequest)('A student ID is required for student accounts');
    if (input.departmentId) {
        const department = await (0, pool_1.queryOne)('SELECT id FROM departments WHERE id = $1', [input.departmentId]);
        if (!department)
            throw (0, errors_1.badRequest)('Selected department does not exist');
    }
    const temporaryPassword = input.password ? undefined : generateTemporaryPassword();
    const password = input.password || temporaryPassword;
    (0, passwordPolicy_1.assertStrongPassword)(password, { email: input.email, fullName: input.fullName });
    const passwordHash = await (0, passwordPolicy_1.hashPassword)(password);
    try {
        const user = await (0, pool_1.withTransaction)(async (client) => {
            const inserted = await client.query(`INSERT INTO users
           (email, password_hash, full_name, role, status, student_id, staff_id,
            department_id, phone, address, programme, level, must_change_password)
         VALUES (lower($1), $2, $3, $4::user_role, 'active', $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`, [
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
            ]);
            const id = inserted.rows[0].id;
            await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [id, passwordHash]);
            return id;
        });
        await (0, auditService_1.recordRequestEvent)(req, {
            userId: user,
            actorEmail: input.email,
            eventType: 'USER_CREATED',
            severity: input.role === 'administrator' || input.role === 'super_admin' ? 'high' : 'medium',
            description: `Account created with role ${input.role}`,
            metadata: { role: input.role, createdBy: req.auth?.email ?? 'self-registration' },
        });
        return {
            user: (await (0, authService_1.getSafeUserById)(user)),
            temporaryPassword,
        };
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            const detail = error.detail || '';
            if (detail.includes('email'))
                throw (0, errors_1.conflict)('An account with this email already exists');
            if (detail.includes('student_id'))
                throw (0, errors_1.conflict)('This student ID is already registered');
            if (detail.includes('staff_id'))
                throw (0, errors_1.conflict)('This staff ID is already registered');
            throw (0, errors_1.conflict)('An account with these details already exists');
        }
        throw error;
    }
}
async function resetUserPasswordByAdmin(userId, req) {
    const target = await (0, pool_1.queryOne)('SELECT id, email, role FROM users WHERE id = $1', [userId]);
    if (!target)
        throw (0, errors_1.notFound)('User not found');
    if (target.id === req.auth?.userId) {
        throw (0, errors_1.badRequest)('Use the change-password flow to reset your own password');
    }
    if ((target.role === 'super_admin' || target.role === 'administrator') &&
        req.auth?.role !== 'super_admin') {
        throw (0, errors_1.conflict)('Only a super administrator can reset an administrative account password');
    }
    const temporaryPassword = generateTemporaryPassword();
    const hash = await (0, passwordPolicy_1.hashPassword)(temporaryPassword);
    await (0, pool_1.query)(`UPDATE users SET password_hash = $2, must_change_password = TRUE,
            failed_login_count = 0, locked_until = NULL, status = 'active',
            last_password_change_at = now()
      WHERE id = $1`, [userId, hash]);
    await (0, pool_1.query)('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, hash]);
    await (0, pool_1.query)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'admin_password_reset'
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await (0, auditService_1.recordRequestEvent)(req, {
        userId,
        actorEmail: target.email,
        eventType: 'ADMIN_PASSWORD_RESET',
        severity: 'high',
        description: 'Administrator issued a temporary password; user sessions were revoked',
        metadata: { targetRole: target.role },
    });
    return { temporaryPassword };
}
async function unlockUser(userId, req) {
    const updated = await (0, pool_1.queryOne)(`UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL
      WHERE id = $1 RETURNING id`, [userId]);
    if (!updated)
        throw (0, errors_1.notFound)('User not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        userId,
        eventType: 'ACCOUNT_UNLOCKED',
        severity: 'medium',
        description: 'Administrator unlocked the account and cleared failed login counters',
    });
    return (await (0, authService_1.getSafeUserById)(userId));
}
async function listUsers(input) {
    const conditions = [];
    const params = [];
    if (input.search) {
        params.push(`%${input.search}%`);
        conditions.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.student_id ILIKE $${params.length} OR u.staff_id ILIKE $${params.length})`);
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
    const count = await (0, pool_1.queryOne)(`SELECT count(*)::text AS count FROM users u ${where}`, params);
    params.push(input.limit, (input.page - 1) * input.limit);
    const rows = await (0, pool_1.query)(`SELECT u.id, u.email, u.full_name, u.role, u.status, u.student_id, u.staff_id,
            u.department_id, d.name AS department_name, u.programme, u.level,
            u.mfa_enabled, u.must_change_password, u.failed_login_count,
            u.locked_until, u.last_login_at, u.created_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ${where}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total: Number(count?.count ?? 0) };
}
//# sourceMappingURL=userService.js.map