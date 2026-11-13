"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../config");
const pool_1 = require("../db/pool");
const passwordPolicy_1 = require("../utils/passwordPolicy");
const logger_1 = require("../utils/logger");
/**
 * Idempotent bootstrap seed.
 * - Creates academic departments and sample courses.
 * - Creates the initial super administrator and administrator from environment
 *   variables. Passwords are hashed with Argon2id and are never logged.
 * - Creates lecturer/student demo accounts and an isolated lab target.
 * - Seeds enrollments and two grades so dashboards are populated immediately.
 *
 * Run `pnpm seed` after migrations. Change bootstrap passwords after first login.
 */
async function upsertDepartment(client, code, name, description) {
    const result = await client.query(`INSERT INTO departments (code, name, description) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING id`, [code, name, description]);
    return result.rows[0].id;
}
async function upsertUser(client, input) {
    const existing = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [input.email]);
    if (existing.rowCount)
        return existing.rows[0].id;
    const hash = await (0, passwordPolicy_1.hashPassword)(input.password);
    const result = await client.query(`INSERT INTO users
       (email, password_hash, full_name, role, status, student_id, staff_id, department_id,
        programme, level, phone, address, must_change_password)
     VALUES (lower($1), $2, $3, $4::user_role, 'active', $5, $6, $7, $8, $9, $10, $11, FALSE)
     RETURNING id`, [
        input.email,
        hash,
        input.fullName,
        input.role,
        input.studentId || null,
        input.staffId || null,
        input.departmentId || null,
        input.programme || null,
        input.level || null,
        input.phone || null,
        input.address || null,
    ]);
    const id = result.rows[0].id;
    await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [id, hash]);
    return id;
}
async function main() {
    const superPassword = config_1.config.seed.superAdminPassword;
    const adminPassword = config_1.config.seed.adminPassword;
    const lecturerPassword = config_1.config.seed.lecturerPassword;
    const studentPassword = config_1.config.seed.studentPassword;
    const labPassword = config_1.config.seed.labPassword || `Lab!${node_crypto_1.default.randomBytes(18).toString('base64url')}`;
    if (!superPassword || !adminPassword || !lecturerPassword || !studentPassword) {
        throw new Error('Set SEED_SUPER_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD, SEED_LECTURER_PASSWORD and SEED_STUDENT_PASSWORD before seeding.');
    }
    const client = await pool_1.pool.connect();
    try {
        await client.query('BEGIN');
        const cs = await upsertDepartment(client, 'CS', 'Computer Science', 'Software engineering, algorithms, artificial intelligence and computing research.');
        const it = await upsertDepartment(client, 'IT', 'Information Technology', 'Networks, cybersecurity, cloud infrastructure and IT operations.');
        const bus = await upsertDepartment(client, 'BUS', 'Business School', 'Management, accounting, entrepreneurship and business analytics.');
        const eng = await upsertDepartment(client, 'ENG', 'Engineering', 'Civil, electrical and mechanical engineering programmes.');
        const hs = await upsertDepartment(client, 'HS', 'Health Sciences', 'Nursing, public health and biomedical science programmes.');
        const superAdminId = await upsertUser(client, {
            email: config_1.config.seed.superAdminEmail,
            password: superPassword,
            fullName: 'System Super Administrator',
            role: 'super_admin',
            staffId: 'ADM-0001',
            departmentId: cs,
        });
        const adminId = await upsertUser(client, {
            email: config_1.config.seed.adminEmail,
            password: adminPassword,
            fullName: 'University Registrar',
            role: 'administrator',
            staffId: 'ADM-0002',
            departmentId: cs,
        });
        const lecturerId = await upsertUser(client, {
            email: config_1.config.seed.lecturerEmail,
            password: lecturerPassword,
            fullName: 'Dr. Amina Okafor',
            role: 'lecturer',
            staffId: 'LEC-0001',
            departmentId: it,
        });
        const lecturer2Id = await upsertUser(client, {
            email: 'grace.mensah@ssims.edu',
            password: `Lec!${node_crypto_1.default.randomBytes(18).toString('base64url')}`,
            fullName: 'Dr. Grace Mensah',
            role: 'lecturer',
            staffId: 'LEC-0002',
            departmentId: cs,
        });
        const studentId = await upsertUser(client, {
            email: config_1.config.seed.studentEmail,
            password: studentPassword,
            fullName: 'Daniel Boateng',
            role: 'student',
            studentId: 'STU-2026-0001',
            departmentId: cs,
            programme: 'BSc Computer Science',
            level: '300',
            phone: '+233 20 000 0001',
            address: '12 University Avenue, Campus Hall A',
        });
        await upsertUser(client, {
            email: config_1.config.seed.labEmail,
            password: labPassword,
            fullName: 'Security Laboratory Test Account',
            role: 'student',
            studentId: 'LAB-0001',
            departmentId: it,
            programme: 'Authorized Security Testing',
            level: 'LAB',
        });
        const extraStudents = [
            { email: 'abena.mensah@ssims.edu', name: 'Abena Mensah', number: 'STU-2026-0002', programme: 'BSc Information Technology' },
            { email: 'kwame.asante@ssims.edu', name: 'Kwame Asante', number: 'STU-2026-0003', programme: 'BSc Computer Science' },
            { email: 'efua.owusu@ssims.edu', name: 'Efua Owusu', number: 'STU-2026-0004', programme: 'BSc Business Administration' },
            { email: 'kojo.adjei@ssims.edu', name: 'Kojo Adjei', number: 'STU-2026-0005', programme: 'BSc Information Technology' },
            { email: 'nana.ampofo@ssims.edu', name: 'Nana Ampofo', number: 'STU-2026-0006', programme: 'BSc Computer Science' },
        ];
        const extraStudentIds = [];
        for (const [index, student] of extraStudents.entries()) {
            extraStudentIds.push(await upsertUser(client, {
                email: student.email,
                password: `Stu!${node_crypto_1.default.randomBytes(18).toString('base64url')}`,
                fullName: student.name,
                role: 'student',
                studentId: student.number,
                departmentId: index < 2 ? cs : index === 2 ? bus : it,
                programme: student.programme,
                level: index < 2 ? '200' : '300',
            }));
        }
        const courses = [
            { code: 'CS101', title: 'Introduction to Programming', dept: cs, lecturer: lecturer2Id, credits: 3, semester: 'Semester 1' },
            { code: 'CS205', title: 'Database Systems', dept: cs, lecturer: lecturerId, credits: 4, semester: 'Semester 1' },
            { code: 'IT210', title: 'Network Security', dept: it, lecturer: lecturerId, credits: 3, semester: 'Semester 1' },
            { code: 'CS310', title: 'Web Application Security', dept: it, lecturer: lecturerId, credits: 4, semester: 'Semester 2' },
            { code: 'BUS120', title: 'Principles of Management', dept: bus, lecturer: lecturer2Id, credits: 3, semester: 'Semester 1' },
            { code: 'IT305', title: 'Cloud Infrastructure', dept: it, lecturer: lecturerId, credits: 3, semester: 'Semester 2' },
        ];
        const courseIds = new Map();
        for (const course of courses) {
            const result = await client.query(`INSERT INTO courses (code, title, description, department_id, lecturer_id, credits, semester, academic_year, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '2025/2026', TRUE)
         ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`, [
                course.code,
                course.title,
                `${course.title} — sample course for the SSIMS academic demonstration.`,
                course.dept,
                course.lecturer,
                course.credits,
                course.semester,
            ]);
            courseIds.set(course.code, result.rows[0].id);
        }
        async function enroll(student, code) {
            const result = await client.query(`INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)
         ON CONFLICT (student_id, course_id) DO UPDATE SET student_id = EXCLUDED.student_id
         RETURNING id`, [student, courseIds.get(code)]);
            return result.rows[0].id;
        }
        const danielCourses = ['CS101', 'CS205', 'IT210', 'CS310'];
        const enrollments = {};
        for (const code of danielCourses)
            enrollments[code] = await enroll(studentId, code);
        for (const [index, id] of extraStudentIds.entries()) {
            await enroll(id, index % 2 === 0 ? 'CS101' : 'CS205');
            await enroll(id, index % 3 === 0 ? 'IT210' : 'IT305');
        }
        const seededGrades = [
            { enrollmentId: enrollments.CS101, score: 88, remarks: 'Strong practical work' },
            { enrollmentId: enrollments.CS205, score: 92, remarks: 'Excellent database design project' },
        ];
        for (const grade of seededGrades) {
            await client.query(`INSERT INTO grades (enrollment_id, score, letter_grade, remarks, graded_by)
         VALUES ($1, $2, 'F', $3, $4)
         ON CONFLICT (enrollment_id) DO NOTHING`, [grade.enrollmentId, grade.score, grade.remarks, lecturerId]);
        }
        await client.query(`INSERT INTO security_events (event_type, severity, description, metadata)
       SELECT 'SYSTEM_INITIALIZED', 'info', 'SSIMS database bootstrap and seed completed', $1::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM security_events WHERE event_type = 'SYSTEM_INITIALIZED')`, [JSON.stringify({ courses: courses.length, departments: 5, seededBy: 'seed script' })]);
        await client.query('COMMIT');
        logger_1.logger.info({
            superAdmin: config_1.config.seed.superAdminEmail,
            administrator: config_1.config.seed.adminEmail,
            lecturer: config_1.config.seed.lecturerEmail,
            student: config_1.config.seed.studentEmail,
            labAccount: config_1.config.seed.labEmail,
            departments: 5,
            courses: courses.length,
        }, 'Seed complete. Change bootstrap passwords after first login; credentials are not written to logs.');
        logger_1.logger.info('Note: extra sample accounts use random unrecorded passwords and can be reset by an administrator.');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
        await pool_1.pool.end();
    }
}
main().catch((error) => {
    logger_1.logger.error({ err: error }, 'Seed failed');
    process.exit(1);
});
//# sourceMappingURL=seed.js.map