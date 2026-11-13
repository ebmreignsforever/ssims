import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool';
import { requireRoles } from '../middleware/auth';
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/errors';
import { uuidSchema } from '../utils/validation';
import { recordRequestEvent } from '../services/auditService';

export const lecturerRouter = Router();
lecturerRouter.use(requireRoles('lecturer'));

lecturerRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const summary = await queryOne<{
      course_count: string;
      student_count: string;
      graded_count: string;
      average_score: string | null;
    }>(
      `SELECT count(DISTINCT c.id)::text AS course_count,
              count(DISTINCT e.student_id)::text AS student_count,
              count(g.id)::text AS graded_count,
              ROUND(avg(g.score), 1)::text AS average_score
         FROM courses c
         LEFT JOIN enrollments e ON e.course_id = c.id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE c.lecturer_id = $1`,
      [req.auth!.userId],
    );
    const courses = await query(
      `SELECT c.id, c.code, c.title, c.credits, c.semester, c.academic_year,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count,
              (SELECT count(*)::int FROM enrollments e JOIN grades g ON g.enrollment_id = e.id WHERE e.course_id = c.id) AS graded_count
         FROM courses c WHERE c.lecturer_id = $1 ORDER BY c.code`,
      [req.auth!.userId],
    );
    const recent = await query(
      `SELECT g.id, g.score, g.letter_grade, g.updated_at, c.code AS course_code,
              c.title AS course_title, u.full_name AS student_name, u.student_id AS student_number
         FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = e.student_id
        WHERE c.lecturer_id = $1
        ORDER BY g.updated_at DESC LIMIT 8`,
      [req.auth!.userId],
    );
    res.json({
      success: true,
      data: {
        summary: {
          courseCount: Number(summary?.course_count ?? 0),
          studentCount: Number(summary?.student_count ?? 0),
          gradedCount: Number(summary?.graded_count ?? 0),
          averageScore: summary?.average_score ? Number(summary.average_score) : null,
        },
        courses,
        recentGrades: recent,
      },
    });
  }),
);

const gradeSchema = z.object({
  enrollmentId: uuidSchema,
  score: z.coerce.number().min(0).max(100),
  remarks: z.string().trim().max(500).default(''),
});

lecturerRouter.post(
  '/grades',
  asyncHandler(async (req, res) => {
    const body = gradeSchema.parse(req.body);
    const enrollment = await queryOne<{
      enrollment_id: string;
      course_id: string;
      lecturer_id: string | null;
      student_id: string;
      course_code: string;
      student_name: string;
    }>(
      `SELECT e.id AS enrollment_id, c.id AS course_id, c.lecturer_id,
              e.student_id, c.code AS course_code, u.full_name AS student_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = e.student_id
        WHERE e.id = $1`,
      [body.enrollmentId],
    );
    if (!enrollment) throw notFound('Enrollment not found');
    if (enrollment.lecturer_id !== req.auth!.userId) {
      await recordRequestEvent(req, {
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'high',
        description: 'Lecturer attempted to grade a student outside their assigned course',
        metadata: { enrollmentId: body.enrollmentId },
      });
      throw forbidden('You can only grade students in your assigned courses');
    }

    const previous = await queryOne<{ score: string | null }>(
      'SELECT score::text FROM grades WHERE enrollment_id = $1',
      [body.enrollmentId],
    );

    const grade = await withTransaction(async (client) => {
      // Make the actor visible to the database audit trigger for this transaction.
      await client.query("SELECT set_config('ssims.actor_id', $1, true)", [req.auth!.userId]);
      const result = await client.query(
        `INSERT INTO grades (enrollment_id, score, letter_grade, remarks, graded_by)
         VALUES ($1, $2, 'F', $3, $4)
         ON CONFLICT (enrollment_id)
         DO UPDATE SET score = EXCLUDED.score, remarks = EXCLUDED.remarks,
                       graded_by = EXCLUDED.graded_by, updated_at = now()
         RETURNING id, enrollment_id, score, letter_grade, remarks, updated_at`,
        [body.enrollmentId, body.score, body.remarks, req.auth!.userId],
      );
      return result.rows[0];
    });

    await recordRequestEvent(req, {
      eventType: previous ? 'GRADE_UPDATED' : 'GRADE_ADDED',
      severity: 'medium',
      description: `${previous ? 'Updated' : 'Recorded'} grade for ${enrollment.student_name} in ${enrollment.course_code}`,
      metadata: {
        enrollmentId: body.enrollmentId,
        courseId: enrollment.course_id,
        studentId: enrollment.student_id,
        previousScore: previous?.score ?? null,
        newScore: body.score,
      },
    });
    res.json({ success: true, data: grade });
  }),
);

lecturerRouter.get(
  '/grades/recent',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT g.id, g.score, g.letter_grade, g.remarks, g.updated_at,
              c.code AS course_code, c.title AS course_title,
              u.full_name AS student_name, u.student_id AS student_number
         FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = e.student_id
        WHERE c.lecturer_id = $1
        ORDER BY g.updated_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json({ success: true, data: rows });
  }),
);

lecturerRouter.get(
  '/students/:studentId',
  asyncHandler(async (req, res) => {
    const { studentId } = z.object({ studentId: uuidSchema }).parse(req.params);
    // Authorisation is data-scoped: the lecturer may see the student only if the
    // student is enrolled in a course assigned to that lecturer. Only results
    // for the lecturer's own courses are returned.
    const student = await queryOne(
      `SELECT DISTINCT u.id, u.full_name, u.email, u.student_id AS student_number,
              u.programme, u.level, d.name AS department_name
         FROM users u
         JOIN enrollments e ON e.student_id = u.id
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1 AND c.lecturer_id = $2`,
      [studentId, req.auth!.userId],
    );
    if (!student) throw notFound('Student not found in your assigned courses');
    const results = await query(
      `SELECT c.code, c.title, c.credits, c.semester, c.academic_year,
              g.score, g.letter_grade, g.remarks
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.student_id = $1 AND c.lecturer_id = $2
        ORDER BY c.code`,
      [studentId, req.auth!.userId],
    );
    res.json({ success: true, data: { student, results } });
  }),
);
