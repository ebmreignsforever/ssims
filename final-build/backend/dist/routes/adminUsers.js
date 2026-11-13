"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminUsersRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const userService_1 = require("../services/userService");
const authService_1 = require("../services/authService");
const auditService_1 = require("../services/auditService");
exports.adminUsersRouter = (0, express_1.Router)();
const roleSchema = zod_1.z.enum(['super_admin', 'administrator', 'lecturer', 'student']);
exports.adminUsersRouter.get('/', (0, auth_1.requirePermission)('users:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const page = validation_1.paginationSchema.parse(req.query);
    const filters = zod_1.z
        .object({
        search: zod_1.z.string().trim().max(100).optional(),
        role: roleSchema.optional(),
        status: zod_1.z.enum(['active', 'locked', 'suspended', 'pending']).optional(),
    })
        .parse(req.query);
    const result = await (0, userService_1.listUsers)({ ...page, ...filters });
    res.json({
        success: true,
        data: result.rows,
        meta: {
            ...page,
            total: result.total,
            totalPages: Math.ceil(result.total / page.limit),
        },
    });
}));
exports.adminUsersRouter.get('/:id', (0, auth_1.requirePermission)('users:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const user = await (0, authService_1.getSafeUserById)(id);
    if (!user)
        throw (0, errors_1.notFound)('User not found');
    const enrollments = await (0, pool_1.query)(`SELECT e.id AS enrollment_id, c.id AS course_id, c.code, c.title, c.credits,
              c.semester, c.academic_year, g.score, g.letter_grade,
              lu.full_name AS lecturer_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.student_id = $1
        ORDER BY c.code`, [id]);
    res.json({ success: true, data: { user, enrollments } });
}));
const createSchema = zod_1.z.object({
    email: validation_1.emailSchema,
    fullName: zod_1.z.string().trim().min(2).max(120),
    role: roleSchema,
    password: zod_1.z.string().min(12).max(128).optional(),
    studentId: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,20}$/).optional(),
    staffId: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/).optional(),
    departmentId: validation_1.uuidSchema.optional().nullable(),
    phone: zod_1.z.string().trim().max(30).optional(),
    address: zod_1.z.string().trim().max(300).optional(),
    programme: zod_1.z.string().trim().max(120).optional(),
    level: zod_1.z.string().trim().max(30).optional(),
});
exports.adminUsersRouter.post('/', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const body = createSchema.parse(req.body);
    if ((body.role === 'administrator' || body.role === 'super_admin') && req.auth.role !== 'super_admin') {
        throw (0, errors_1.forbidden)('Only a super administrator can create administrative accounts');
    }
    if (body.role === 'super_admin' && req.auth.role !== 'super_admin')
        throw (0, errors_1.forbidden)();
    const result = await (0, userService_1.createUser)({
        ...body,
        mustChangePassword: true,
    }, req);
    res.status(201).json({ success: true, data: result });
}));
const updateSchema = zod_1.z.object({
    email: validation_1.emailSchema.optional(),
    fullName: zod_1.z.string().trim().min(2).max(120).optional(),
    studentId: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,20}$/).nullable().optional(),
    staffId: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/).nullable().optional(),
    departmentId: validation_1.uuidSchema.nullable().optional(),
    phone: zod_1.z.string().trim().max(30).nullable().optional(),
    address: zod_1.z.string().trim().max(300).nullable().optional(),
    programme: zod_1.z.string().trim().max(120).nullable().optional(),
    level: zod_1.z.string().trim().max(30).nullable().optional(),
    mustChangePassword: zod_1.z.boolean().optional(),
});
exports.adminUsersRouter.patch('/:id', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const body = updateSchema.parse(req.body);
    const current = await (0, pool_1.queryOne)('SELECT id, role, email FROM users WHERE id = $1', [id]);
    if (!current)
        throw (0, errors_1.notFound)('User not found');
    if ((current.role === 'super_admin' || current.role === 'administrator') &&
        req.auth.role !== 'super_admin' &&
        id !== req.auth.userId) {
        throw (0, errors_1.forbidden)('Only a super administrator can modify another administrative account');
    }
    if (body.departmentId) {
        const department = await (0, pool_1.queryOne)('SELECT id FROM departments WHERE id = $1', [body.departmentId]);
        if (!department)
            throw (0, errors_1.badRequest)('Department not found');
    }
    const fields = [];
    const params = [];
    const map = {
        email: body.email,
        full_name: body.fullName,
        student_id: body.studentId,
        staff_id: body.staffId,
        department_id: body.departmentId,
        phone: body.phone,
        address: body.address,
        programme: body.programme,
        level: body.level,
        must_change_password: body.mustChangePassword,
    };
    for (const [column, value] of Object.entries(map)) {
        if (value !== undefined) {
            params.push(value);
            fields.push(`${column} = $${params.length}`);
        }
    }
    if (fields.length === 0)
        throw (0, errors_1.badRequest)('No changes supplied');
    params.push(id);
    try {
        await (0, pool_1.query)(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }
    catch (error) {
        if (error.code === '23505')
            throw (0, errors_1.conflict)('That email or identifier is already in use');
        throw error;
    }
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: id,
        actorEmail: current.email,
        eventType: 'ADMIN_USER_UPDATED',
        severity: 'medium',
        description: 'Administrator updated account details',
        metadata: { fields: Object.keys(map).filter((key) => map[key] !== undefined) },
    });
    res.json({ success: true, data: { user: await (0, authService_1.getSafeUserById)(id) } });
}));
const roleChangeSchema = zod_1.z.object({ role: roleSchema });
exports.adminUsersRouter.patch('/:id/role', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const { role } = roleChangeSchema.parse(req.body);
    if (id === req.auth.userId)
        throw (0, errors_1.badRequest)('You cannot change your own role');
    const target = await (0, pool_1.queryOne)('SELECT id, role, email FROM users WHERE id = $1', [id]);
    if (!target)
        throw (0, errors_1.notFound)('User not found');
    if (req.auth.role !== 'super_admin' && (target.role === 'super_admin' || role === 'administrator' || role === 'super_admin')) {
        throw (0, errors_1.forbidden)('Only a super administrator can assign or modify administrative roles');
    }
    if (role === 'super_admin' && req.auth.role !== 'super_admin')
        throw (0, errors_1.forbidden)();
    if (role === 'student') {
        const student = await (0, pool_1.queryOne)('SELECT student_id FROM users WHERE id = $1', [id]);
        if (!student?.student_id)
            throw (0, errors_1.badRequest)('Assign a student ID before changing this account to student');
    }
    await (0, pool_1.query)("UPDATE users SET role = $2::user_role, staff_id = CASE WHEN $2 = 'student' THEN NULL ELSE staff_id END WHERE id = $1", [
        id,
        role,
    ]);
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: id,
        actorEmail: target.email,
        eventType: 'ROLE_CHANGED',
        severity: 'critical',
        description: `Role changed from ${target.role} to ${role}`,
        metadata: { previousRole: target.role, newRole: role },
    });
    res.json({ success: true, data: { user: await (0, authService_1.getSafeUserById)(id) } });
}));
const statusSchema = zod_1.z.object({
    status: zod_1.z.enum(['active', 'suspended', 'locked']),
    reason: zod_1.z.string().trim().max(300).optional(),
});
exports.adminUsersRouter.patch('/:id/status', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const body = statusSchema.parse(req.body);
    if (id === req.auth.userId)
        throw (0, errors_1.badRequest)('You cannot change your own account status');
    const target = await (0, pool_1.queryOne)('SELECT id, role, email, status FROM users WHERE id = $1', [id]);
    if (!target)
        throw (0, errors_1.notFound)('User not found');
    if ((target.role === 'super_admin' || target.role === 'administrator') &&
        req.auth.role !== 'super_admin') {
        throw (0, errors_1.forbidden)('Only a super administrator can change an administrative account status');
    }
    await (0, pool_1.query)(`UPDATE users SET status = $2::account_status,
              failed_login_count = CASE WHEN $2 = 'active' THEN 0 ELSE failed_login_count END,
              locked_until = NULL
        WHERE id = $1`, [id, body.status]);
    if (body.status !== 'active')
        await (0, authService_1.revokeAllSessions)(id, `admin_${body.status}`);
    await (0, auditService_1.recordRequestEvent)(req, {
        userId: id,
        actorEmail: target.email,
        eventType: 'ACCOUNT_STATUS_CHANGED',
        severity: body.status === 'active' ? 'medium' : 'high',
        description: `Administrator set account status to ${body.status}`,
        metadata: { previousStatus: target.status, newStatus: body.status, reason: body.reason },
    });
    res.json({ success: true, data: { user: await (0, authService_1.getSafeUserById)(id) } });
}));
exports.adminUsersRouter.post('/:id/unlock', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const user = await (0, userService_1.unlockUser)(id, req);
    res.json({ success: true, data: { user } });
}));
exports.adminUsersRouter.post('/:id/reset-password', (0, auth_1.requirePermission)('users:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const result = await (0, userService_1.resetUserPasswordByAdmin)(id, req);
    res.json({ success: true, data: result });
}));
//# sourceMappingURL=adminUsers.js.map