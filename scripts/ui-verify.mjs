#!/usr/bin/env node
/**
 * Local UI verification with the installed Microsoft Edge browser.
 * Captures desktop and mobile screenshots and reports console/API errors.
 * Requires the Vite dev server on http://127.0.0.1:5173 and the API on :4000.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

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
const BASE = process.env.UI_BASE || 'http://localhost:5173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(ROOT, 'artifacts', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const report = { checks: [], consoleErrors: [], apiErrors: [], screenshots: [] };
function check(name, condition, detail = '') {
  report.checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail });
  console.log(`${condition ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name, fullPage = true) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  report.screenshots.push(path.relative(ROOT, file));
  console.log(`  \x1b[90mcaptured ${path.relative(ROOT, file)}\x1b[0m`);
}

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ page: label, message: message.text() });
  });
  page.on('pageerror', (error) => report.consoleErrors.push({ page: label, message: error.message }));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      // Expected auth probes during sign-in are ignored.
      if (response.status() === 401 && response.url().includes('/auth/me')) return;
      if (response.status() === 401 && response.url().includes('/auth/refresh')) return;
      report.apiErrors.push({ page: label, status: response.status(), url: response.url() });
    }
  });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /sign in securely/i }).click();
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--disable-gpu'] });

try {
  // -------------------------------------------------------------------------
  // Administrator
  // -------------------------------------------------------------------------
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  watch(admin, 'admin');
  await admin.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  check('Login page renders', (await admin.getByText('Sign in to your portal').count()) > 0);
  check('Security portal branding renders', (await admin.getByText('Protected by design.').count()) > 0);
  await shot(admin, '01-login-desktop', false);

  await login(admin, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
  await admin.waitForURL('**/admin', { timeout: 15_000 });
  await admin.waitForLoadState('networkidle');
  await admin.getByText('Administrator control centre').waitFor({ state: 'visible', timeout: 10_000 });
  await admin.waitForTimeout(800);
  check('Administrator dashboard loads', (await admin.getByText('Administrator control centre').count()) > 0);
  check('Dashboard metrics render', (await admin.getByText('Registered users').count()) > 0);
  check('Authentication chart renders', (await admin.getByText('Authentication activity').count()) > 0);
  await shot(admin, '02-admin-dashboard');

  // Regression: refresh must restore the session from the HttpOnly cookie and
  // render the dashboard, not fall into a /login redirect loop with a blank root.
  await admin.reload({ waitUntil: 'networkidle' });
  await admin.getByText('Administrator control centre').waitFor({ state: 'visible', timeout: 10_000 });
  check('Administrator session survives a full page refresh', admin.url().endsWith('/admin') && (await admin.getByText('Registered users').count()) > 0);

  await admin.getByRole('link', { name: /users & students/i }).click();
  await admin.waitForURL('**/admin/users');
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(500);
  check('User management page loads', (await admin.getByText('Identify administration').count()) + (await admin.getByText('Users & student records').count()) > 0);
  await shot(admin, '03-admin-users');

  await admin.getByRole('link', { name: /^courses$/i }).click();
  await admin.waitForURL('**/admin/courses');
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(500);
  check('Course catalogue renders', (await admin.getByText('Course catalogue').count()) > 0);
  await shot(admin, '04-admin-courses');

  await admin.getByRole('link', { name: /security monitoring/i }).click();
  await admin.waitForURL('**/admin/security');
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(500);
  check('Security monitoring page loads', (await admin.getByText('Monitoring & audit').count()) > 0);
  check('Security event rows render', (await admin.locator('tbody tr').count()) > 0, `${await admin.locator('tbody tr').count()} rows`);
  await shot(admin, '05-security-monitoring');

  await admin.getByRole('link', { name: /security testing lab/i }).click();
  await admin.waitForURL('**/admin/lab');
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(500);
  check('Security Testing Lab loads', (await admin.getByText('Authorized adversary simulation').count()) > 0);
  check('Eight test cards render', (await admin.getByText(/^TEST \d\d$/).count()) === 8, `${await admin.getByText(/^TEST \d\d$/).count()} cards`);
  await shot(admin, '06-security-lab');

  await admin.getByRole('link', { name: /kerberos simulation/i }).click();
  await admin.waitForURL('**/admin/kerberos');
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(500);
  check('Kerberos simulation page loads', (await admin.getByText('Kerberos authentication simulation').count()) > 0);
  check('Simulation disclaimer is visible', (await admin.getByText('Educational simulation — not real Kerberos').count()) > 0);
  await shot(admin, '07-kerberos');

  await admin.goto(`${BASE}/settings/security`, { waitUntil: 'networkidle' });
  check('Administrator security settings load', (await admin.getByText('Profile & security settings').count()) > 0);
  await shot(admin, '08-security-settings');

  // -------------------------------------------------------------------------
  // Student
  // -------------------------------------------------------------------------
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const student = await studentContext.newPage();
  watch(student, 'student');
  await login(student, env.SEED_STUDENT_EMAIL, env.SEED_STUDENT_PASSWORD);
  await student.waitForURL('**/student', { timeout: 15_000 });
  await student.waitForLoadState('networkidle');
  await student.getByText('Student portal').waitFor({ state: 'visible', timeout: 10_000 });
  await student.waitForTimeout(800);
  check('Student dashboard loads', (await student.getByText('Student portal').count()) > 0);
  check('Student GPA card renders', (await student.getByText('Cumulative GPA').count()) > 0);
  await shot(student, '09-student-dashboard');

  await student.reload({ waitUntil: 'networkidle' });
  await student.getByText('Student portal').waitFor({ state: 'visible', timeout: 10_000 });
  check('Student session survives a full page refresh', student.url().endsWith('/student') && (await student.getByText('Cumulative GPA').count()) > 0);

  await student.getByRole('link', { name: /academic results/i }).first().click();
  await student.waitForURL('**/student/results');
  await student.waitForLoadState('networkidle');
  await student.waitForTimeout(500);
  check('Student results transcript loads', (await student.getByText('Transcript').count()) > 0);
  await shot(student, '10-student-results');

  await student.getByRole('link', { name: /profile & security/i }).click();
  await student.waitForURL('**/settings/security');
  await student.waitForLoadState('networkidle');
  await student.waitForTimeout(500);
  check('MFA management controls render', (await student.getByText('Multi-factor authentication').count()) > 0);
  await shot(student, '11-student-security');

  // -------------------------------------------------------------------------
  // Lecturer
  // -------------------------------------------------------------------------
  const lecturerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const lecturer = await lecturerContext.newPage();
  watch(lecturer, 'lecturer');
  await login(lecturer, env.SEED_LECTURER_EMAIL, env.SEED_LECTURER_PASSWORD);
  await lecturer.waitForURL('**/lecturer', { timeout: 15_000 });
  await lecturer.waitForLoadState('networkidle');
  await lecturer.getByText('Lecturer workspace').waitFor({ state: 'visible', timeout: 10_000 });
  await lecturer.waitForTimeout(800);
  check('Lecturer dashboard loads', (await lecturer.getByText('Lecturer workspace').count()) > 0);
  check('Teaching metrics render', (await lecturer.getByText('Assigned courses').count()) > 0);
  await shot(lecturer, '12-lecturer-dashboard');

  await lecturer.getByRole('link', { name: /my courses/i }).first().click();
  await lecturer.waitForURL('**/lecturer/courses');
  await lecturer.waitForLoadState('networkidle');
  await lecturer.waitForTimeout(500);
  check('Lecturer course cards render', (await lecturer.getByText('Open course workspace').count()) > 0);
  await shot(lecturer, '13-lecturer-courses');

  await lecturer.getByText('Open course workspace').first().click();
  await lecturer.waitForURL(/\/lecturer\/courses\/.+/);
  await lecturer.waitForLoadState('networkidle');
  await lecturer.getByText('Course roster').waitFor({ state: 'visible', timeout: 10_000 });
  await lecturer.waitForTimeout(600);
  check('Course workspace roster loads', (await lecturer.getByText('Course roster').count()) > 0);
  await shot(lecturer, '14-course-workspace');

  // -------------------------------------------------------------------------
  // Mobile responsiveness
  // -------------------------------------------------------------------------
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  check('Mobile login page renders without horizontal overflow', (await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await shot(mobile, '15-login-mobile', false);

  // Verify the authenticated mobile shell and drawer.
  await mobile.locator('input[name="email"]').fill(env.SEED_STUDENT_EMAIL);
  await mobile.locator('input[name="password"]').fill(env.SEED_STUDENT_PASSWORD);
  await mobile.getByRole('button', { name: /sign in securely/i }).click();
  await mobile.waitForURL('**/student', { timeout: 15_000 });
  await mobile.waitForLoadState('networkidle');
  await mobile.getByText('Student portal').waitFor({ state: 'visible', timeout: 10_000 });
  await mobile.waitForTimeout(700);
  check('Mobile student dashboard renders', (await mobile.getByText('Student portal').count()) > 0);
  await mobile.getByRole('button', { name: /open navigation/i }).click();
  await mobile.waitForTimeout(300);
  check('Mobile navigation drawer opens', (await mobile.getByText('My Overview').count()) > 0);
  await shot(mobile, '16-mobile-dashboard', false);

  const uniqueConsoleErrors = [...new Map(report.consoleErrors.map((item) => [`${item.page}:${item.message}`, item])).values()];
  const uniqueApiErrors = [...new Map(report.apiErrors.map((item) => [`${item.page}:${item.status}:${item.url}`, item])).values()];
  check('No browser console errors', uniqueConsoleErrors.length === 0, `${uniqueConsoleErrors.length} unique`);
  check('No unexpected API errors during UI navigation', uniqueApiErrors.length === 0, `${uniqueApiErrors.length} unique`);

  report.consoleErrors = uniqueConsoleErrors;
  report.apiErrors = uniqueApiErrors;
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'ui-verification.json'), JSON.stringify(report, null, 2));
  const failed = report.checks.filter((checkItem) => checkItem.status === 'FAIL').length;
  console.log(`\n${failed === 0 ? '\x1b[32mUI verification passed\x1b[0m' : `\x1b[31m${failed} UI checks failed\x1b[0m`} — ${report.checks.length - failed}/${report.checks.length}`);
  if (uniqueConsoleErrors.length) console.log(JSON.stringify(uniqueConsoleErrors, null, 2));
  if (uniqueApiErrors.length) console.log(JSON.stringify(uniqueApiErrors, null, 2));
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await browser.close();
}
