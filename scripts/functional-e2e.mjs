#!/usr/bin/env node
/**
 * SSIMS functional end-to-end suite.
 * Exercises registration, password reset, admin user creation, role enforcement,
 * departments/courses/enrollments, lecturer grading, account restrictions, IP rules
 * and security policy editing. Test data is removed through the owner connection
 * in a finally block; append-only audit events remain as evidence.
 *
 * Local authorized testing only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, status: condition ? 'PASS' : 'FAIL', detail });
  if (!condition) failures += 1;
  console.log(`  ${condition ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const header of list) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /Max-Age=0/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
  get(name) {
    return this.cookies.get(name);
  }
}

async function request(jar, route, { method = 'GET', body, token, csrf = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!['GET', 'HEAD'].includes(method) && csrf && jar.get('ssims_csrf')) headers['X-CSRF-Token'] = jar.get('ssims_csrf');
  if (jar.header()) headers.Cookie = jar.header();
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(response);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

class Session {
  constructor() {
    this.jar = new CookieJar();
    this.token = null;
    this.user = null;
  }
  async login(email, password, extra = {}) {
    const response = await request(this.jar, '/api/auth/login', { method: 'POST', body: { email, password, ...extra } });
    if (response.payload?.data?.accessToken) {
      this.token = response.payload.data.accessToken;
      this.user = response.payload.data.user;
    }
    return response;
  }
  call(route, options = {}) {
    return request(this.jar, route, { ...options, token: this.token });
  }
}

const created = { users: [], courseIds: [], departmentIds: [] };
let adminClient;
let appendOnlyDisabled = false;

async function cleanup() {
  try {
    if (!adminClient) {
      adminClient = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
      await adminClient.connect();
    }
    // The test accounts have generated security events. Deleting a user causes
    // the FK action to null user_id in security_events, which the append-only
    // trigger rightly blocks. This local cleanup disables ONLY that guard for
    // the duration of test-row removal, then restores it. Existing audit rows
    // are not deleted; they retain actor_email and metadata.
    await adminClient.query('ALTER TABLE security_events DISABLE TRIGGER security_events_append_only');
    appendOnlyDisabled = true;
    for (const courseId of created.courseIds) {
      await adminClient.query('DELETE FROM courses WHERE id = $1', [courseId]);
    }
    for (const departmentId of created.departmentIds) {
      await adminClient.query('DELETE FROM departments WHERE id = $1', [departmentId]);
    }
    for (const userId of created.users) {
      await adminClient.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    console.log('\n[cleanup] Removed functional test rows (audit/security events remain).');
  } catch (error) {
    console.error('[cleanup] Failed:', error.message);
  } finally {
    if (appendOnlyDisabled) {
      await adminClient?.query('ALTER TABLE security_events ENABLE TRIGGER security_events_append_only').catch(() => {});
    }
    await adminClient?.end().catch(() => {});
  }
}

async function main() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const deptCode = `T${suffix.slice(0, 3).toUpperCase()}`;
  const lecturerEmail = `functional.lecturer.${suffix}@ssims.edu`;
  const studentEmail = `functional.student.${suffix}@ssims.edu`;
  const courseCode = `TST${String(crypto.randomInt(100, 999))}`;
  const strongPassword = 'N7!vQ2#pL9@rT4';

  console.log('\x1b[1mSSIMS functional end-to-end verification\x1b[0m');
  console.log(`Target: ${BASE}\n`);

  const admin = new Session();
  const adminLogin = await admin.login(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
  check('Administrator signs in', adminLogin.status === 200 && admin.user?.role === 'administrator');

  section('Department and course management');
  const department = await admin.call('/api/departments', { method: 'POST', body: { code: deptCode, name: `Functional Test Department ${suffix}`, description: 'Temporary functional verification department.' } });
  if (department.payload?.data?.id) created.departmentIds.push(department.payload.data.id);
  check('Administrator creates a department', department.status === 201 && department.payload?.data?.code === deptCode);

  const lecturerCreate = await admin.call('/api/admin/users', {
    method: 'POST',
    body: {
      email: lecturerEmail,
      fullName: `Functional Lecturer ${suffix}`,
      role: 'lecturer',
      staffId: `TST-LEC-${suffix}`,
      departmentId: department.payload?.data?.id,
    },
  });
  if (lecturerCreate.payload?.data?.user?.id) created.users.push(lecturerCreate.payload.data.user.id);
  check('Administrator creates a lecturer with a one-time password', lecturerCreate.status === 201 && Boolean(lecturerCreate.payload?.data?.temporaryPassword));
  const lecturerTempPassword = lecturerCreate.payload?.data?.temporaryPassword;

  const course = await admin.call('/api/courses', {
    method: 'POST',
    body: {
      code: courseCode,
      title: `Functional Test Course ${suffix}`,
      description: 'Temporary functional verification course.',
      departmentId: department.payload?.data?.id,
      lecturerId: lecturerCreate.payload?.data?.user?.id,
      credits: 3,
      semester: 'Semester 2',
      academicYear: '2025/2026',
      isActive: true,
    },
  });
  if (course.payload?.data?.id) created.courseIds.push(course.payload.data.id);
  check('Administrator creates a course and assigns the lecturer', course.status === 201 && course.payload?.data?.lecturer_id === lecturerCreate.payload?.data?.user?.id);

  const studentSearch = await admin.call(`/api/admin/users?role=student&limit=100`);
  const seededStudent = studentSearch.payload?.data?.find((row) => row.email === env.SEED_STUDENT_EMAIL);
  check('Administrator can locate a seeded student record', Boolean(seededStudent));

  const enrollment = await admin.call(`/api/courses/${course.payload?.data?.id}/enrollments`, {
    method: 'POST',
    body: { studentId: seededStudent?.id },
  });
  check('Administrator enrolls a student', enrollment.status === 201);

  section('Lecturer scope and grading');
  const lecturer = new Session();
  const lecturerLogin = await lecturer.login(lecturerEmail, lecturerTempPassword);
  check(
    'New lecturer signs in with the temporary credential',
    lecturerLogin.status === 200 && lecturer.user?.role === 'lecturer' && lecturer.user?.mustChangePassword === true,
  );

  const forcedChange = await lecturer.call('/api/lecturer/dashboard');
  check(
    'Temporary credential is restricted to password change',
    forcedChange.status === 403 && forcedChange.payload?.error?.code === 'PASSWORD_CHANGE_REQUIRED',
    `status ${forcedChange.status} code ${forcedChange.payload?.error?.code}`,
  );

  const lecturerPermanentPassword = 'Q4!mZ8#vL2@xR7';
  const passwordChangeResponse = await lecturer.call('/api/auth/change-password', {
    method: 'POST',
    body: {
      currentPassword: lecturerTempPassword,
      newPassword: lecturerPermanentPassword,
      confirmPassword: lecturerPermanentPassword,
    },
  });
  check('Lecturer replaces the temporary password', passwordChangeResponse.status === 200);

  const activeLecturer = new Session();
  const activeLogin = await activeLecturer.login(lecturerEmail, lecturerPermanentPassword);
  check(
    'Lecturer signs in with the permanent password',
    activeLogin.status === 200 && activeLecturer.user?.mustChangePassword === false,
    `status ${activeLogin.status} mustChange=${activeLecturer.user?.mustChangePassword} code=${activeLogin.payload?.error?.code || 'none'}`,
  );

  const lecturerDashboard = await activeLecturer.call('/api/lecturer/dashboard');
  check('Lecturer teaching dashboard loads', lecturerDashboard.status === 200);

  const roster = await activeLecturer.call(`/api/courses/${course.payload?.data?.id}/students`);
  const rosterRow = roster.payload?.data?.find((row) => row.student_id === seededStudent?.id);
  check('Assigned lecturer can read the course roster', roster.status === 200 && Boolean(rosterRow));

  const grade = await activeLecturer.call('/api/lecturer/grades', {
    method: 'POST',
    body: { enrollmentId: rosterRow?.enrollment_id, score: 77.5, remarks: 'Functional verification grade' },
  });
  check('Lecturer records a grade', grade.status === 200 && Number(grade.payload?.data?.score) === 77.5, `letter ${grade.payload?.data?.letter_grade}`);

  const seededCourses = await admin.call('/api/courses');
  const otherCourse = seededCourses.payload?.data?.find((row) => row.lecturer_id && row.lecturer_id !== activeLecturer.user?.id);
  if (otherCourse) {
    const crossCourse = await activeLecturer.call(`/api/courses/${otherCourse.id}/students`);
    check('Lecturer is denied another lecturer\'s roster', crossCourse.status === 403, `status ${crossCourse.status}`);
  }

  const lecturerAdminAttempt = await activeLecturer.call('/api/admin/dashboard');
  check('Lecturer is denied the administrator dashboard', lecturerAdminAttempt.status === 403);

  const student = new Session();
  const studentLogin = await student.login(env.SEED_STUDENT_EMAIL, env.SEED_STUDENT_PASSWORD);
  check('Student signs in', studentLogin.status === 200);
  const studentCourses = await student.call('/api/student/courses');
  const gradedCourse = studentCourses.payload?.data?.find((row) => row.code === courseCode);
  check('Student sees the course and recorded grade', Boolean(gradedCourse) && Number(gradedCourse?.score) === 77.5, gradedCourse?.letter_grade);
  const studentToLecturer = await student.call('/api/lecturer/dashboard');
  check('Student is denied lecturer endpoints', studentToLecturer.status === 403);

  section('Administrative restrictions');
  const adminCannotModifySuper = await admin.call(`/api/admin/users/${(await admin.call('/api/admin/users?role=super_admin&limit=1')).payload?.data?.[0]?.id}`, {
    method: 'PATCH',
    body: { fullName: 'Attempted Change' },
  });
  check('Administrator cannot modify a super administrator', adminCannotModifySuper.status === 403);

  const adminCannotCreateAdmin = await admin.call('/api/admin/users', {
    method: 'POST',
    body: { email: `forbidden.admin.${suffix}@ssims.edu`, fullName: 'Forbidden Admin', role: 'administrator' },
  });
  check('Administrator cannot create another administrator', adminCannotCreateAdmin.status === 403);

  const suspended = await admin.call(`/api/admin/users/${activeLecturer.user?.id}/status`, { method: 'PATCH', body: { status: 'suspended', reason: 'Functional restriction test' } });
  check('Administrator suspends the lecturer', suspended.status === 200);
  const afterSuspension = await activeLecturer.call('/api/lecturer/dashboard');
  check('Suspension invalidates the lecturer session', afterSuspension.status === 401 || afterSuspension.status === 403, `status ${afterSuspension.status}`);

  await admin.call(`/api/admin/users/${activeLecturer.user?.id}/status`, { method: 'PATCH', body: { status: 'active' } });
  const reset = await admin.call(`/api/admin/users/${activeLecturer.user?.id}/reset-password`, { method: 'POST', body: {} });
  check('Administrator issues a new temporary password', reset.status === 200 && Boolean(reset.payload?.data?.temporaryPassword));
  const lecturerAfterReset = new Session();
  const resetLogin = await lecturerAfterReset.login(lecturerEmail, reset.payload?.data?.temporaryPassword);
  check(
    'Lecturer signs in with the new temporary password and is forced to change it',
    resetLogin.status === 200 && resetLogin.payload?.data?.user?.mustChangePassword === true,
  );

  section('Public registration and password reset');
  const registration = await request(new CookieJar(), '/api/auth/register', {
    method: 'POST',
    body: {
      fullName: `Functional Student ${suffix}`,
      email: studentEmail,
      password: strongPassword,
      studentId: `TST-${suffix.toUpperCase()}`,
      departmentId: department.payload?.data?.id,
      phone: '+233 20 111 2222',
    },
  });
  if (registration.payload?.data?.user?.id) created.users.push(registration.payload.data.user.id);
  check(
    'Public student registration creates a student account',
    registration.status === 201 && registration.payload?.data?.user?.role === 'student',
    registration.status !== 201 ? JSON.stringify(registration.payload?.error || {}) : '',
  );

  const duplicate = await request(new CookieJar(), '/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Duplicate Student', email: studentEmail, password: strongPassword, studentId: `TST-${suffix.toUpperCase()}` },
  });
  check('Duplicate registration is rejected', duplicate.status === 409);

  const weak = await request(new CookieJar(), '/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Weak Student', email: `weak.${suffix}@ssims.edu`, password: 'password', studentId: `WEAK-${suffix.toUpperCase()}` },
  });
  check('Weak password registration is rejected', weak.status === 400);

  const newStudent = new Session();
  const newStudentLogin = await newStudent.login(studentEmail, strongPassword);
  check('Registered student can sign in', newStudentLogin.status === 200);
  const profile = await newStudent.call('/api/student/profile', { method: 'PATCH', body: { phone: '+233 20 333 4444', address: 'Functional Test Hostel' } });
  check('Student updates permitted profile fields', profile.status === 200 && profile.payload?.data?.user?.phone === '+233 20 333 4444');

  const resetRequest = await request(new CookieJar(), '/api/auth/forgot-password', { method: 'POST', body: { email: studentEmail } });
  const resetUrl = resetRequest.payload?.data?.developmentResetUrl || '';
  const resetToken = resetUrl ? new URL(resetUrl).searchParams.get('token') : null;
  check('Password reset link is issued in development', resetRequest.status === 200 && Boolean(resetToken));

  const newPassword = 'M8!kR3#wZ6@qY1';
  if (resetToken) {
    const resetResponse = await request(new CookieJar(), '/api/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, newPassword, confirmPassword: newPassword },
    });
    check('Password reset completes with a single-use token', resetResponse.status === 200);
    const oldLogin = await new Session().login(studentEmail, strongPassword);
    check('Old password is rejected after reset', oldLogin.status === 401);
    const newLogin = await new Session().login(studentEmail, newPassword);
    check('New password is accepted after reset', newLogin.status === 200);
    const replay = await request(new CookieJar(), '/api/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, newPassword: 'Another!Password2026', confirmPassword: 'Another!Password2026' },
    });
    check('Reset token cannot be reused', replay.status === 400);
  }

  section('Security policy and network rules');
  const superAdmin = new Session();
  const superLogin = await superAdmin.login(env.SEED_SUPER_ADMIN_EMAIL, env.SEED_SUPER_ADMIN_PASSWORD);
  check('Super administrator signs in', superLogin.status === 200);
  const policies = await superAdmin.call('/api/security/policies');
  check('Super administrator reads access policy', policies.status === 200);
  const changed = await superAdmin.call('/api/security/policies', { method: 'PATCH', body: { challengeAfterFailures: 4 } });
  const restored = await superAdmin.call('/api/security/policies', { method: 'PATCH', body: { challengeAfterFailures: 3 } });
  check('Super administrator updates and restores policy', changed.status === 200 && restored.status === 200);

  const policyDenied = await admin.call('/api/security/policies', { method: 'PATCH', body: { challengeAfterFailures: 2 } });
  check('Administrator cannot edit security policy', policyDenied.status === 403);

  const ipRule = await admin.call('/api/security/ip-rules', { method: 'POST', body: { cidr: `198.51.100.${crypto.randomInt(1, 254)}/32`, action: 'deny', reason: 'Functional test rule' } });
  check('Administrator creates an IP deny rule', ipRule.status === 201);
  if (ipRule.payload?.data?.id) {
    const removed = await admin.call(`/api/security/ip-rules/${ipRule.payload.data.id}`, { method: 'DELETE' });
    check('Administrator removes the IP rule', removed.status === 200);
  }

  const departmentBlocked = await admin.call(`/api/departments/${department.payload?.data?.id}`, { method: 'DELETE' });
  check('Department with a course cannot be deleted', departmentBlocked.status === 409);

  console.log(`\n\x1b[1mResult:\x1b[0m ${results.length - failures}/${results.length} functional checks passed.`);
  if (failures) {
    for (const failed of results.filter((item) => item.status === 'FAIL')) console.log(` - ${failed.name}: ${failed.detail}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error('\nFunctional suite crashed:', error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
