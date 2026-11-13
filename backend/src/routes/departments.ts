import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { requirePermission } from '../middleware/auth';
import { asyncHandler, conflict, notFound } from '../utils/errors';
import { uuidSchema } from '../utils/validation';
import { recordRequestEvent } from '../services/auditService';

export const departmentsRouter = Router();

departmentsRouter.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT d.id, d.code, d.name, d.description, d.created_at,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id AND u.role = 'student') AS student_count,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id AND u.role = 'lecturer') AS lecturer_count,
              (SELECT count(*)::int FROM courses c WHERE c.department_id = d.id) AS course_count
         FROM departments d ORDER BY d.name`,
    );
    res.json({ success: true, data: rows });
  }),
);

const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'Code must be 2-12 uppercase letters, digits or hyphens'),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).default(''),
});

departmentsRouter.post(
  '/',
  requirePermission('departments:manage'),
  asyncHandler(async (req, res) => {
    const body = departmentSchema.parse(req.body);
    try {
      const row = await queryOne(
        `INSERT INTO departments (code, name, description) VALUES ($1, $2, $3)
         RETURNING id, code, name, description, created_at`,
        [body.code, body.name, body.description],
      );
      await recordRequestEvent(req, {
        eventType: 'DEPARTMENT_CREATED',
        severity: 'medium',
        description: `Department ${body.code} created`,
        metadata: { code: body.code },
      });
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('A department with that code or name already exists');
      throw error;
    }
  }),
);

departmentsRouter.patch(
  '/:id',
  requirePermission('departments:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const body = departmentSchema.partial().parse(req.body);
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries({ code: body.code, name: body.name, description: body.description })) {
      if (value !== undefined) {
        params.push(value);
        fields.push(`${column} = $${params.length}`);
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No changes supplied' } });
      return;
    }
    params.push(id);
    const row = await queryOne(
      `UPDATE departments SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, code, name, description, created_at`,
      params,
    );
    if (!row) throw notFound('Department not found');
    await recordRequestEvent(req, {
      eventType: 'DEPARTMENT_UPDATED',
      severity: 'low',
      description: 'Department details updated',
      metadata: { departmentId: id },
    });
    res.json({ success: true, data: row });
  }),
);

departmentsRouter.delete(
  '/:id',
  requirePermission('departments:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const courses = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM courses WHERE department_id = $1', [id]);
    if (Number(courses?.count) > 0) throw conflict('Move or delete the department courses before removing it');
    const deleted = await queryOne<{ id: string; code: string }>(
      'DELETE FROM departments WHERE id = $1 RETURNING id, code',
      [id],
    );
    if (!deleted) throw notFound('Department not found');
    await recordRequestEvent(req, {
      eventType: 'DEPARTMENT_DELETED',
      severity: 'high',
      description: `Department ${deleted.code} deleted`,
      metadata: { code: deleted.code },
    });
    res.json({ success: true, data: { message: 'Department deleted' } });
  }),
);
