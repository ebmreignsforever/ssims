import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { requireRoles } from '../middleware/auth';
import { asyncHandler, notFound } from '../utils/errors';
import { recordRequestEvent } from '../services/auditService';
import { getPolicy, getSafeUserById } from '../services/authService';

export const studentRouter = Router();
studentRouter.use(requireRoles('student'));

const GPA_SQL = `
  COALESCE(ROUND(SUM(
    CASE g.letter_grade
      WHEN 'A' THEN 4.0 WHEN 'B' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'D' THEN 1.0 ELSE 0.0
    END * c.credits
  ) / NULLIF(SUM(c.credits) FILTER (WHERE g.id IS NOT NULL), 0), 2), 0)`;

studentRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const summary = await queryOne<{
      course_count: string;
      graded_count: string;
      gpa: string;
      credits: string;
      full_name: string;
      student_id: string;
      programme: string | null;
    }>(
      `SELECT u.full_name, u.student_id, u.programme,
              count(e.id)::text AS course_count,
              count(g.id)::text AS graded_count,
              ${GPA_SQL}::text AS gpa,
              COALESCE(SUM(c.credits) FILTER (WHERE g.id IS NOT NULL), 0)::text AS credits
         FROM users u
         LEFT JOIN enrollments e ON e.student_id = u.id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE u.id = $1
        GROUP BY u.id`,
      [req.auth!.userId],
    );
    const recent = await query(
      `SELECT c.code, c.title, g.score, g.letter_grade, g.updated_at
         FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = $1 ORDER BY g.updated_at DESC LIMIT 5`,
      [req.auth!.userId],
    );
    res.json({
      success: true,
      data: {
        summary: {
          fullName: summary?.full_name,
          studentId: summary?.student_id,
          programme: summary?.programme,
          courseCount: Number(summary?.course_count ?? 0),
          gradedCount: Number(summary?.graded_count ?? 0),
          gpa: Number(summary?.gpa ?? 0),
          credits: Number(summary?.credits ?? 0),
        },
        recentResults: recent,
      },
    });
  }),
);

studentRouter.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT c.id, c.code, c.title, c.description, c.credits, c.semester, c.academic_year,
              d.name AS department_name, lu.full_name AS lecturer_name,
              g.score, g.letter_grade, g.remarks, g.updated_at AS grade_updated_at
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.student_id = $1
        ORDER BY c.academic_year DESC, c.code`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: rows });
  }),
);

studentRouter.get(
  '/results',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT g.id, c.code, c.title, c.credits, c.semester, c.academic_year,
              g.score, g.letter_grade, g.remarks, g.updated_at,
              lu.full_name AS lecturer_name
         FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
        WHERE e.student_id = $1
        ORDER BY c.academic_year DESC, c.semester, c.code`,
      [req.auth!.userId],
    );
    const gpa = await queryOne<{ gpa: string }>(
      `SELECT ${GPA_SQL}::text AS gpa
         FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = $1`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: rows, meta: { gpa: Number(gpa?.gpa ?? 0) } });
  }),
);

const profileSchema = z.object({
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
});
studentRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const body = profileSchema.parse(req.body);
    if (body.phone === undefined && body.address === undefined) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No permitted fields supplied' } });
      return;
    }
    const row = await queryOne(
      `UPDATE users SET phone = COALESCE($2, phone), address = COALESCE($3, address)
        WHERE id = $1 RETURNING id`,
      [req.auth!.userId, body.phone ?? null, body.address ?? null],
    );
    if (!row) throw notFound('Account not found');
    await recordRequestEvent(req, {
      eventType: 'PROFILE_UPDATED',
      severity: 'info',
      description: 'Student updated permitted profile fields',
      metadata: { fields: Object.keys(body) },
    });
    const policy = await getPolicy();
    res.json({ success: true, data: { user: await getSafeUserById(req.auth!.userId, policy) } });
  }),
);
