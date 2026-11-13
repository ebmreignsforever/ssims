import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { requirePermission } from '../middleware/auth';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { emailSchema, paginationSchema, uuidSchema } from '../utils/validation';
import { createUser, listUsers, resetUserPasswordByAdmin, unlockUser } from '../services/userService';
import { getSafeUserById, revokeAllSessions } from '../services/authService';
import { recordRequestEvent } from '../services/auditService';

export const adminUsersRouter = Router();

const roleSchema = z.enum(['super_admin', 'administrator', 'lecturer', 'student']);

adminUsersRouter.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const page = paginationSchema.parse(req.query);
    const filters = z
      .object({
        search: z.string().trim().max(100).optional(),
        role: roleSchema.optional(),
        status: z.enum(['active', 'locked', 'suspended', 'pending']).optional(),
      })
      .parse(req.query);
    const result = await listUsers({ ...page, ...filters });
    res.json({
      success: true,
      data: result.rows,
      meta: {
        ...page,
        total: result.total,
        totalPages: Math.ceil(result.total / page.limit),
      },
    });
  }),
);

adminUsersRouter.get(
  '/:id',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const user = await getSafeUserById(id);
    if (!user) throw notFound('User not found');
    const enrollments = await query(
      `SELECT e.id AS enrollment_id, c.id AS course_id, c.code, c.title, c.credits,
              c.semester, c.academic_year, g.score, g.letter_grade,
              lu.full_name AS lecturer_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.student_id = $1
        ORDER BY c.code`,
      [id],
    );
    res.json({ success: true, data: { user, enrollments } });
  }),
);

const createSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  role: roleSchema,
  password: z.string().min(12).max(128).optional(),
  studentId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,20}$/).optional(),
  staffId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/).optional(),
  departmentId: uuidSchema.optional().nullable(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  programme: z.string().trim().max(120).optional(),
  level: z.string().trim().max(30).optional(),
});

adminUsersRouter.post(
  '/',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if ((body.role === 'administrator' || body.role === 'super_admin') && req.auth!.role !== 'super_admin') {
      throw forbidden('Only a super administrator can create administrative accounts');
    }
    if (body.role === 'super_admin' && req.auth!.role !== 'super_admin') throw forbidden();
    const result = await createUser(
      {
        ...body,
        mustChangePassword: true,
      },
      req,
    );
    res.status(201).json({ success: true, data: result });
  }),
);

const updateSchema = z.object({
  email: emailSchema.optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  studentId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,20}$/).nullable().optional(),
  staffId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/).nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  programme: z.string().trim().max(120).nullable().optional(),
  level: z.string().trim().max(30).nullable().optional(),
  mustChangePassword: z.boolean().optional(),
});

adminUsersRouter.patch(
  '/:id',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const body = updateSchema.parse(req.body);
    const current = await queryOne<{ id: string; role: string; email: string }>(
      'SELECT id, role, email FROM users WHERE id = $1',
      [id],
    );
    if (!current) throw notFound('User not found');
    if (
      (current.role === 'super_admin' || current.role === 'administrator') &&
      req.auth!.role !== 'super_admin' &&
      id !== req.auth!.userId
    ) {
      throw forbidden('Only a super administrator can modify another administrative account');
    }
    if (body.departmentId) {
      const department = await queryOne('SELECT id FROM departments WHERE id = $1', [body.departmentId]);
      if (!department) throw badRequest('Department not found');
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, unknown> = {
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
    if (fields.length === 0) throw badRequest('No changes supplied');
    params.push(id);
    try {
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('That email or identifier is already in use');
      throw error;
    }
    await recordRequestEvent(req, {
      userId: id,
      actorEmail: current.email,
      eventType: 'ADMIN_USER_UPDATED',
      severity: 'medium',
      description: 'Administrator updated account details',
      metadata: { fields: Object.keys(map).filter((key) => map[key] !== undefined) },
    });
    res.json({ success: true, data: { user: await getSafeUserById(id) } });
  }),
);

const roleChangeSchema = z.object({ role: roleSchema });
adminUsersRouter.patch(
  '/:id/role',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const { role } = roleChangeSchema.parse(req.body);
    if (id === req.auth!.userId) throw badRequest('You cannot change your own role');
    const target = await queryOne<{ id: string; role: string; email: string }>(
      'SELECT id, role, email FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw notFound('User not found');
    if (req.auth!.role !== 'super_admin' && (target.role === 'super_admin' || role === 'administrator' || role === 'super_admin')) {
      throw forbidden('Only a super administrator can assign or modify administrative roles');
    }
    if (role === 'super_admin' && req.auth!.role !== 'super_admin') throw forbidden();
    if (role === 'student') {
      const student = await queryOne<{ student_id: string | null }>('SELECT student_id FROM users WHERE id = $1', [id]);
      if (!student?.student_id) throw badRequest('Assign a student ID before changing this account to student');
    }
    await query("UPDATE users SET role = $2::user_role, staff_id = CASE WHEN $2 = 'student' THEN NULL ELSE staff_id END WHERE id = $1", [
      id,
      role,
    ]);
    await recordRequestEvent(req, {
      userId: id,
      actorEmail: target.email,
      eventType: 'ROLE_CHANGED',
      severity: 'critical',
      description: `Role changed from ${target.role} to ${role}`,
      metadata: { previousRole: target.role, newRole: role },
    });
    res.json({ success: true, data: { user: await getSafeUserById(id) } });
  }),
);

const statusSchema = z.object({
  status: z.enum(['active', 'suspended', 'locked']),
  reason: z.string().trim().max(300).optional(),
});
adminUsersRouter.patch(
  '/:id/status',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const body = statusSchema.parse(req.body);
    if (id === req.auth!.userId) throw badRequest('You cannot change your own account status');
    const target = await queryOne<{ id: string; role: string; email: string; status: string }>(
      'SELECT id, role, email, status FROM users WHERE id = $1',
      [id],
    );
    if (!target) throw notFound('User not found');
    if (
      (target.role === 'super_admin' || target.role === 'administrator') &&
      req.auth!.role !== 'super_admin'
    ) {
      throw forbidden('Only a super administrator can change an administrative account status');
    }
    await query(
      `UPDATE users SET status = $2::account_status,
              failed_login_count = CASE WHEN $2 = 'active' THEN 0 ELSE failed_login_count END,
              locked_until = NULL
        WHERE id = $1`,
      [id, body.status],
    );
    if (body.status !== 'active') await revokeAllSessions(id, `admin_${body.status}`);
    await recordRequestEvent(req, {
      userId: id,
      actorEmail: target.email,
      eventType: 'ACCOUNT_STATUS_CHANGED',
      severity: body.status === 'active' ? 'medium' : 'high',
      description: `Administrator set account status to ${body.status}`,
      metadata: { previousStatus: target.status, newStatus: body.status, reason: body.reason },
    });
    res.json({ success: true, data: { user: await getSafeUserById(id) } });
  }),
);

adminUsersRouter.post(
  '/:id/unlock',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const user = await unlockUser(id, req);
    res.json({ success: true, data: { user } });
  }),
);

adminUsersRouter.post(
  '/:id/reset-password',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const result = await resetUserPasswordByAdmin(id, req);
    res.json({ success: true, data: result });
  }),
);
