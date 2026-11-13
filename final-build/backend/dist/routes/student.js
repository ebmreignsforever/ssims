"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.studentRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const auditService_1 = require("../services/auditService");
const authService_1 = require("../services/authService");
exports.studentRouter = (0, express_1.Router)();
exports.studentRouter.use((0, auth_1.requireRoles)('student'));
const GPA_SQL = `
  COALESCE(ROUND(SUM(
    CASE g.letter_grade
      WHEN 'A' THEN 4.0 WHEN 'B' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'D' THEN 1.0 ELSE 0.0
    END * c.credits
  ) / NULLIF(SUM(c.credits) FILTER (WHERE g.id IS NOT NULL), 0), 2), 0)`;
exports.studentRouter.get('/dashboard', (0, errors_1.asyncHandler)(async (req, res) => {
    const summary = await (0, pool_1.queryOne)(`SELECT u.full_name, u.student_id, u.programme,
              count(e.id)::text AS course_count,
              count(g.id)::text AS graded_count,
              ${GPA_SQL}::text AS gpa,
              COALESCE(SUM(c.credits) FILTER (WHERE g.id IS NOT NULL), 0)::text AS credits
         FROM users u
         LEFT JOIN enrollments e ON e.student_id = u.id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE u.id = $1
        GROUP BY u.id`, [req.auth.userId]);
    const recent = await (0, pool_1.query)(`SELECT c.code, c.title, g.score, g.letter_grade, g.updated_at
         FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = $1 ORDER BY g.updated_at DESC LIMIT 5`, [req.auth.userId]);
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
}));
exports.studentRouter.get('/courses', (0, errors_1.asyncHandler)(async (req, res) => {
    const rows = await (0, pool_1.query)(`SELECT c.id, c.code, c.title, c.description, c.credits, c.semester, c.academic_year,
              d.name AS department_name, lu.full_name AS lecturer_name,
              g.score, g.letter_grade, g.remarks, g.updated_at AS grade_updated_at
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.student_id = $1
        ORDER BY c.academic_year DESC, c.code`, [req.auth.userId]);
    res.json({ success: true, data: rows });
}));
exports.studentRouter.get('/results', (0, errors_1.asyncHandler)(async (req, res) => {
    const rows = await (0, pool_1.query)(`SELECT g.id, c.code, c.title, c.credits, c.semester, c.academic_year,
              g.score, g.letter_grade, g.remarks, g.updated_at,
              lu.full_name AS lecturer_name
         FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
        WHERE e.student_id = $1
        ORDER BY c.academic_year DESC, c.semester, c.code`, [req.auth.userId]);
    const gpa = await (0, pool_1.queryOne)(`SELECT ${GPA_SQL}::text AS gpa
         FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
         JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = $1`, [req.auth.userId]);
    res.json({ success: true, data: rows, meta: { gpa: Number(gpa?.gpa ?? 0) } });
}));
const profileSchema = zod_1.z.object({
    phone: zod_1.z.string().trim().max(30).nullable().optional(),
    address: zod_1.z.string().trim().max(300).nullable().optional(),
});
exports.studentRouter.patch('/profile', (0, errors_1.asyncHandler)(async (req, res) => {
    const body = profileSchema.parse(req.body);
    if (body.phone === undefined && body.address === undefined) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No permitted fields supplied' } });
        return;
    }
    const row = await (0, pool_1.queryOne)(`UPDATE users SET phone = COALESCE($2, phone), address = COALESCE($3, address)
        WHERE id = $1 RETURNING id`, [req.auth.userId, body.phone ?? null, body.address ?? null]);
    if (!row)
        throw (0, errors_1.notFound)('Account not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'PROFILE_UPDATED',
        severity: 'info',
        description: 'Student updated permitted profile fields',
        metadata: { fields: Object.keys(body) },
    });
    const policy = await (0, authService_1.getPolicy)();
    res.json({ success: true, data: { user: await (0, authService_1.getSafeUserById)(req.auth.userId, policy) } });
}));
//# sourceMappingURL=student.js.map