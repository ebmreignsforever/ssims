"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coursesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const auditService_1 = require("../services/auditService");
exports.coursesRouter = (0, express_1.Router)();
exports.coursesRouter.get('/', (0, errors_1.asyncHandler)(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.auth.role === 'lecturer') {
        params.push(req.auth.userId);
        scope = `WHERE c.lecturer_id = $${params.length}`;
    }
    else if (req.auth.role === 'student') {
        params.push(req.auth.userId);
        scope = `WHERE EXISTS (SELECT 1 FROM enrollments se WHERE se.course_id = c.id AND se.student_id = $${params.length})`;
    }
    const rows = await (0, pool_1.query)(`SELECT c.id, c.code, c.title, c.description, c.credits, c.semester,
              c.academic_year, c.is_active, c.department_id, c.lecturer_id,
              d.name AS department_name, d.code AS department_code,
              lu.full_name AS lecturer_name,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count,
              (SELECT count(*)::int FROM enrollments e JOIN grades g ON g.enrollment_id = e.id WHERE e.course_id = c.id) AS graded_count
         FROM courses c
         JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
         ${scope}
        ORDER BY c.code`, params);
    res.json({ success: true, data: rows });
}));
exports.coursesRouter.get('/:id', (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const course = await (0, pool_1.queryOne)(`SELECT c.*, d.name AS department_name, lu.full_name AS lecturer_name,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count
         FROM courses c JOIN departments d ON d.id = c.department_id
         LEFT JOIN users lu ON lu.id = c.lecturer_id
        WHERE c.id = $1`, [id]);
    if (!course)
        throw (0, errors_1.notFound)('Course not found');
    if (req.auth.role === 'lecturer' && course.lecturer_id !== req.auth.userId)
        throw (0, errors_1.forbidden)();
    if (req.auth.role === 'student') {
        const enrolled = await (0, pool_1.queryOne)('SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2', [id, req.auth.userId]);
        if (!enrolled)
            throw (0, errors_1.forbidden)();
    }
    res.json({ success: true, data: course });
}));
const courseSchema = zod_1.z.object({
    code: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}[0-9]{3,4}$/, 'Course code format: CS101 or COMP1010'),
    title: zod_1.z.string().trim().min(3).max(160),
    description: zod_1.z.string().trim().max(2000).default(''),
    departmentId: validation_1.uuidSchema,
    lecturerId: validation_1.uuidSchema.nullable().optional(),
    credits: zod_1.z.coerce.number().int().min(1).max(12).default(3),
    semester: zod_1.z.string().trim().min(2).max(30).default('Semester 1'),
    academicYear: zod_1.z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Use the format 2025/2026').default('2025/2026'),
    isActive: zod_1.z.boolean().default(true),
});
async function validateCourseReferences(departmentId, lecturerId) {
    const department = await (0, pool_1.queryOne)('SELECT id FROM departments WHERE id = $1', [departmentId]);
    if (!department)
        throw (0, errors_1.badRequest)('Department not found');
    if (lecturerId) {
        const lecturer = await (0, pool_1.queryOne)('SELECT role FROM users WHERE id = $1', [lecturerId]);
        if (!lecturer || lecturer.role !== 'lecturer')
            throw (0, errors_1.badRequest)('Selected lecturer account is not a lecturer');
    }
}
exports.coursesRouter.post('/', (0, auth_1.requirePermission)('courses:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const body = courseSchema.parse(req.body);
    await validateCourseReferences(body.departmentId, body.lecturerId);
    try {
        const row = await (0, pool_1.queryOne)(`INSERT INTO courses (code, title, description, department_id, lecturer_id, credits, semester, academic_year, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`, [
            body.code,
            body.title,
            body.description,
            body.departmentId,
            body.lecturerId || null,
            body.credits,
            body.semester,
            body.academicYear,
            body.isActive,
        ]);
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'COURSE_CREATED',
            severity: 'medium',
            description: `Course ${body.code} created`,
            metadata: { code: body.code, departmentId: body.departmentId },
        });
        res.status(201).json({ success: true, data: row });
    }
    catch (error) {
        if (error.code === '23505')
            throw (0, errors_1.conflict)('A course with that code already exists');
        throw error;
    }
}));
exports.coursesRouter.patch('/:id', (0, auth_1.requirePermission)('courses:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const body = courseSchema.partial().parse(req.body);
    if (body.departmentId || body.lecturerId !== undefined) {
        const current = await (0, pool_1.queryOne)('SELECT department_id FROM courses WHERE id = $1', [id]);
        if (!current)
            throw (0, errors_1.notFound)('Course not found');
        await validateCourseReferences(body.departmentId || current.department_id, body.lecturerId);
    }
    const map = {
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
    const fields = [];
    const params = [];
    for (const [column, value] of Object.entries(map)) {
        if (value !== undefined) {
            params.push(value);
            fields.push(`${column} = $${params.length}`);
        }
    }
    if (fields.length === 0)
        throw (0, errors_1.badRequest)('No changes supplied');
    params.push(id);
    const row = await (0, pool_1.queryOne)(`UPDATE courses SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!row)
        throw (0, errors_1.notFound)('Course not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'COURSE_UPDATED',
        severity: 'low',
        description: 'Course details updated',
        metadata: { courseId: id },
    });
    res.json({ success: true, data: row });
}));
const enrollSchema = zod_1.z.object({ studentId: validation_1.uuidSchema });
exports.coursesRouter.post('/:id/enrollments', (0, auth_1.requirePermission)('courses:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const { studentId } = enrollSchema.parse(req.body);
    const student = await (0, pool_1.queryOne)('SELECT role, status FROM users WHERE id = $1', [studentId]);
    if (!student || student.role !== 'student')
        throw (0, errors_1.badRequest)('Selected account is not a student');
    try {
        const row = await (0, pool_1.queryOne)(`INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)
         RETURNING id, student_id, course_id, enrolled_at`, [studentId, id]);
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'STUDENT_ENROLLED',
            severity: 'low',
            description: 'Student enrolled in a course',
            metadata: { courseId: id, studentId },
        });
        res.status(201).json({ success: true, data: row });
    }
    catch (error) {
        const code = error.code;
        if (code === '23505')
            throw (0, errors_1.conflict)('Student is already enrolled in this course');
        if (code === '23503')
            throw (0, errors_1.badRequest)('Course or student not found');
        throw error;
    }
}));
exports.coursesRouter.delete('/:id/enrollments/:enrollmentId', (0, auth_1.requirePermission)('courses:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id, enrollmentId } = zod_1.z
        .object({ id: validation_1.uuidSchema, enrollmentId: validation_1.uuidSchema })
        .parse(req.params);
    const deleted = await (0, pool_1.queryOne)('DELETE FROM enrollments WHERE id = $1 AND course_id = $2 RETURNING id', [enrollmentId, id]);
    if (!deleted)
        throw (0, errors_1.notFound)('Enrollment not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'STUDENT_UNENROLLED',
        severity: 'medium',
        description: 'Enrollment removed from a course',
        metadata: { courseId: id, enrollmentId },
    });
    res.json({ success: true, data: { message: 'Enrollment removed' } });
}));
exports.coursesRouter.get('/:id/students', (0, auth_1.requireRoles)('super_admin', 'administrator', 'lecturer'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const course = await (0, pool_1.queryOne)('SELECT lecturer_id, code FROM courses WHERE id = $1', [id]);
    if (!course)
        throw (0, errors_1.notFound)('Course not found');
    if (req.auth.role === 'lecturer' && course.lecturer_id !== req.auth.userId)
        throw (0, errors_1.forbidden)();
    const rows = await (0, pool_1.query)(`SELECT e.id AS enrollment_id, u.id AS student_id, u.full_name, u.email,
              u.student_id AS student_number, u.programme, u.level,
              g.score, g.letter_grade, g.remarks, g.updated_at AS grade_updated_at
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         LEFT JOIN grades g ON g.enrollment_id = e.id
        WHERE e.course_id = $1
        ORDER BY u.full_name`, [id]);
    res.json({ success: true, data: rows });
}));
//# sourceMappingURL=courses.js.map