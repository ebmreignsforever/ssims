"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.departmentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const auditService_1 = require("../services/auditService");
exports.departmentsRouter = (0, express_1.Router)();
exports.departmentsRouter.get('/', (0, auth_1.requirePermission)('users:read'), (0, errors_1.asyncHandler)(async (_req, res) => {
    const rows = await (0, pool_1.query)(`SELECT d.id, d.code, d.name, d.description, d.created_at,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id AND u.role = 'student') AS student_count,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id AND u.role = 'lecturer') AS lecturer_count,
              (SELECT count(*)::int FROM courses c WHERE c.department_id = d.id) AS course_count
         FROM departments d ORDER BY d.name`);
    res.json({ success: true, data: rows });
}));
const departmentSchema = zod_1.z.object({
    code: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'Code must be 2-12 uppercase letters, digits or hyphens'),
    name: zod_1.z.string().trim().min(2).max(160),
    description: zod_1.z.string().trim().max(1000).default(''),
});
exports.departmentsRouter.post('/', (0, auth_1.requirePermission)('departments:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const body = departmentSchema.parse(req.body);
    try {
        const row = await (0, pool_1.queryOne)(`INSERT INTO departments (code, name, description) VALUES ($1, $2, $3)
         RETURNING id, code, name, description, created_at`, [body.code, body.name, body.description]);
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'DEPARTMENT_CREATED',
            severity: 'medium',
            description: `Department ${body.code} created`,
            metadata: { code: body.code },
        });
        res.status(201).json({ success: true, data: row });
    }
    catch (error) {
        if (error.code === '23505')
            throw (0, errors_1.conflict)('A department with that code or name already exists');
        throw error;
    }
}));
exports.departmentsRouter.patch('/:id', (0, auth_1.requirePermission)('departments:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const body = departmentSchema.partial().parse(req.body);
    const fields = [];
    const params = [];
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
    const row = await (0, pool_1.queryOne)(`UPDATE departments SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, code, name, description, created_at`, params);
    if (!row)
        throw (0, errors_1.notFound)('Department not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'DEPARTMENT_UPDATED',
        severity: 'low',
        description: 'Department details updated',
        metadata: { departmentId: id },
    });
    res.json({ success: true, data: row });
}));
exports.departmentsRouter.delete('/:id', (0, auth_1.requirePermission)('departments:manage'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const courses = await (0, pool_1.queryOne)('SELECT count(*)::text AS count FROM courses WHERE department_id = $1', [id]);
    if (Number(courses?.count) > 0)
        throw (0, errors_1.conflict)('Move or delete the department courses before removing it');
    const deleted = await (0, pool_1.queryOne)('DELETE FROM departments WHERE id = $1 RETURNING id, code', [id]);
    if (!deleted)
        throw (0, errors_1.notFound)('Department not found');
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'DEPARTMENT_DELETED',
        severity: 'high',
        description: `Department ${deleted.code} deleted`,
        metadata: { code: deleted.code },
    });
    res.json({ success: true, data: { message: 'Department deleted' } });
}));
//# sourceMappingURL=departments.js.map