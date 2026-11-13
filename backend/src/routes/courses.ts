import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { requirePermission, requireRoles } from '../middleware/auth';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { uuidSchema } from '../utils/validation';
import { recordRequestEvent } from '../services/auditService';

export const coursesRouter = Router();

coursesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    let scope = '';
    if (req.auth!.role === 'lecturer') {
      params.push(req.auth!.userId);
      scope = `WHERE c.lecturer_id = $${params.length}`;
    } else if (req.auth!.role === 'student') {
      params.push(req.auth!.userId);
      scope = `WHERE EXISTS (SELECT 1 FROM enrollments se WHERE se.course_id = c.id AND se.student_id = $${params.length})`;
    }
    const rows = await query(
      `SELECT c.id, c.code, c.title, c.description, c.credits, c.semester,
              c.academic_year, c.is_active, c.department_id, c.lecturer_id,
              d.name AS department_name, d.code AS department_code,
              lu.full_name AS lecturer_name,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count,
              (SELECT count(*)::int FROM enrollments e JOIN grades g ON g.enrollment_id = e.id WHERE e.course_id = c.id) AS graded_count
         FROM courses c
         JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         ${scope}
        ORDER BY c.code`,
      params,
    );
    res.json({ success: true, data: rows });
  }),
);

coursesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const course = await queryOne<{
      id: string;
      lecturer_id: string | null;
    }>(
      `SELECT c.*, d.name AS department_name, lu.full_name AS lecturer_name,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count
         FROM courses c JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
        WHERE c.id = $1`,
      [id],
    );
    if (!course) throw notFound('Course not found');
    if (req.auth!.role === 'lecturer' && course.lecturer_id !== req.auth!.userId) throw forbidden();
    if (req.auth!.role === 'student') {
      const enrolled = await queryOne(
        'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2',
        [id, req.auth!.userId],
      );
      if (!enrolled) throw forbidden();
    }
    res.json({ success: true, data: course });
  }),
);

const courseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}[0-9]{3,4}$/, 'Course code format: CS101 or COMP1010'),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).default(''),
  departmentId: uuidSchema,
  lecturerId: uuidSchema.nullable().optional(),
  credits: z.coerce.number().int().min(1).max(12).default(3),
  semester: z.string().trim().min(2).max(30).default('Semester 1'),
  academicYear: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format 2025/2026').default('2025/2026'),
  isActive: z.boolean().default(true),
});

async function validateCourseReferences(departmentId: string, lecturerId?: string | null): Promise<void> {
  const department = await queryOne('SELECT id FROM departments WHERE id = $1', [departmentId]);
  if (!department) throw badRequest('Department not found');
  if (lecturerId) {
    const lecturer = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [lecturerId]);
    if (!lecturer || lecturer.role !== 'lecturer') throw badRequest('Selected lecturer account is not a lecturer');
  }
}

coursesRouter.post(
  '/',
  requirePermission('courses:manage'),
  asyncHandler(async (req, res) => {
    const body = courseSchema.parse(req.body);
    await validateCourseReferences(body.departmentId, body.lecturerId);
    try {
      const row = await queryOne(
        `INSERT INTO courses (code, title, description, department_id, lecturer_id, credits, semester, academic_year, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          body.code,
          body.title,
          body.description,
          body.departmentId,
          body.lecturerId || null,
          body.credits,
          body.semester,
          body.academicYear,
          body.isActive,
        ],
      );
      await recordRequestEvent(req, {
        eventType: 'COURSE_CREATED',
        severity: 'medium',
        description: `Course ${body.code} created`,
        metadata: { code: body.code, departmentId: body.departmentId },
      });
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('A course with that code already exists');
      throw error;
    }
  }),
);

coursesRouter.patch(
  '/:id',
  requirePermission('courses:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const body = courseSchema.partial().parse(req.body);
    if (body.departmentId || body.lecturerId !== undefined) {
      const current = await queryOne<{ department_id: string }>('SELECT department_id FROM courses WHERE id = $1', [id]);
      if (!current) throw notFound('Course not found');
      await validateCourseReferences(body.departmentId || current.department_id, body.lecturerId);
    }
    const map: Record<string, unknown> = {
      code: body.code,
      title: body.title,
      description: body.description,
      department_id: body.departmentId,
      lecturer_id: body.lecturerId,
      credits: body.credits,
      semester: body.semester,
      academic_year: body.academicYear,
      is_active: body.isActive,
    };
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries(map)) {
      if (value !== undefined) {
        params.push(value);
        fields.push(`${column} = $${params.length}`);
      }
    }
    if (fields.length === 0) throw badRequest('No changes supplied');
    params.push(id);
    const row = await queryOne(`UPDATE courses SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!row) throw notFound('Course not found');
    await recordRequestEvent(req, {
      eventType: 'COURSE_UPDATED',
      severity: 'low',
      description: 'Course details updated',
      metadata: { courseId: id },
    });
    res.json({ success: true, data: row });
  }),
);

const enrollSchema = z.object({ studentId: uuidSchema });
coursesRouter.post(
  '/:id/enrollments',
  requirePermission('courses:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const { studentId } = enrollSchema.parse(req.body);
    const student = await queryOne<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1', [studentId]);
    if (!student || student.role !== 'student') throw badRequest('Selected account is not a student');
    try {
      const row = await queryOne(
        `INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)
         RETURNING id, student_id, course_id, enrolled_at`,
        [studentId, id],
      );
      await recordRequestEvent(req, {
        eventType: 'STUDENT_ENROLLED',
        severity: 'low',
        description: 'Student enrolled in a course',
        metadata: { courseId: id, studentId },
      });
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') throw conflict('Student is already enrolled in this course');
      if (code === '23503') throw badRequest('Course or student not found');
      throw error;
    }
  }),
);

coursesRouter.delete(
  '/:id/enrollments/:enrollmentId',
  requirePermission('courses:manage'),
  asyncHandler(async (req, res) => {
    const { id, enrollmentId } = z
      .object({ id: uuidSchema, enrollmentId: uuidSchema })
      .parse(req.params);
    const deleted = await queryOne(
      'DELETE FROM enrollments WHERE id = $1 AND course_id = $2 RETURNING id',
      [enrollmentId, id],
    );
    if (!deleted) throw notFound('Enrollment not found');
    await recordRequestEvent(req, {
      eventType: 'STUDENT_UNENROLLED',
      severity: 'medium',
      description: 'Enrollment removed from a course',
      metadata: { courseId: id, enrollmentId },
    });
    res.json({ success: true, data: { message: 'Enrollment removed' } });
  }),
);

coursesRouter.get(
  '/:id/students',
  requireRoles('super_admin', 'administrator', 'lecturer'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const course = await queryOne<{ lecturer_id: string | null; code: string }>(
      'SELECT lecturer_id, code FROM courses WHERE id = $1',
      [id],
    );
    if (!course) throw notFound('Course not found');
    if (req.auth!.role === 'lecturer' && course.lecturer_id !== req.auth!.userId) throw forbidden();
    const rows = await query(
      `SELECT e.id AS enrollment_id, u.id AS student_id, u.full_name, u.email,
              u.student_id AS student_number, u.programme, u.level,
              g.score, g.letter_grade, g.remarks, g.updated_at AS grade_updated_at
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.course_id = $1
        ORDER BY u.full_name`,
      [id],
    );
    res.json({ success: true, data: rows });
  }),
);
