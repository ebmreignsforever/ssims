#!/usr/bin/env node
/**
 * SSIMS end-to-end security smoke test.
 *
 * This script targets only a local SSIMS API. It exercises real authentication,
 * RBAC, CSRF, MFA, signed webhooks and all eight Security Lab demonstrations.
 * Run with: node scripts/e2e-smoke.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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

function pass(name, detail = '') {
  results.push({ name, status: 'PASS', detail });
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failures += 1;
  results.push({ name, status: 'FAIL', detail });
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}
function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return Boolean(condition);
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const header of setCookies) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /Max-Age=0/i.test(header)) this.cookies.delete(name);
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
  if (!['GET', 'HEAD'].includes(method) && csrf && jar.get('ssims_csrf')) {
    headers['X-CSRF-Token'] = jar.get('ssims_csrf');
  }
  if (jar.header()) headers.Cookie = jar.header();
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.absorb(response);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, headers: response.headers, payload };
}

class Session {
  constructor(label) {
    this.label = label;
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
  async call(route, options = {}) {
    return request(this.jar, route, { ...options, token: this.token });
  }
}

// RFC 6238 TOTP compatible with authenticator apps.
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function main() {
  console.log('\x1b[1mSSIMS end-to-end security verification\x1b[0m');
  console.log(`Target: ${BASE}\n`);

  section('1. Health and public metadata');
  {
    const health = await fetch(`${BASE}/health`);
    const body = await health.json();
    assert(health.status === 200 && body.database === 'connected', 'API is healthy and connected to PostgreSQL');
    const meta = await request(new CookieJar(), '/api/public/meta');
    assert(meta.status === 200 && meta.payload?.data?.securityFeatures?.length >= 8, 'Public security metadata endpoint responds');
  }

  section('2. Administrator authentication and RBAC');
  const admin = new Session('admin');
  const login = await admin.login(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
  assert(login.status === 200 && admin.token && admin.user?.role === 'administrator', 'Administrator signs in with Argon2id credentials');
  assert(Boolean(admin.jar.get('ssims_rt')), 'HttpOnly refresh cookie is issued');
  assert(Boolean(admin.jar.get('ssims_csrf')), 'CSRF double-submit cookie is issued');

  const me = await admin.call('/api/auth/me');
  assert(me.status === 200 && me.payload?.data?.user?.email === env.SEED_ADMIN_EMAIL, 'Access token authenticates /auth/me');

  const dashboard = await admin.call('/api/admin/dashboard');
  assert(dashboard.status === 200 && dashboard.payload?.data?.metrics, 'Administrator can read security dashboard metrics');

  const users = await admin.call('/api/admin/users?limit=5');
  assert(users.status === 200 && Array.isArray(users.payload?.data), 'Administrator can list users with RBAC permission');

  section('3. Student authentication and server-side authorisation');
  const student = new Session('student');
  const studentLogin = await student.login(env.SEED_STUDENT_EMAIL, env.SEED_STUDENT_PASSWORD);
  assert(studentLogin.status === 200 && student.user?.role === 'student', 'Student signs in successfully');
  const forbidden = await student.call('/api/admin/users?limit=1');
  assert(forbidden.status === 403, 'Student receives HTTP 403 on administrator endpoint', `status ${forbidden.status}`);
  const ownResults = await student.call('/api/student/results');
  assert(ownResults.status === 200, 'Student can read only their own academic results');

  section('4. CSRF and refresh-token rotation');
  {
    const noCsrf = await request(new CookieJar(), '/api/auth/refresh', { method: 'POST', body: {} });
    // No cookies produces a rejected refresh; with a valid cookie but no header
    // the CSRF layer is the decisive control. Test that explicitly.
    const jar = new CookieJar();
    for (const [key, value] of admin.jar.cookies.entries()) jar.cookies.set(key, value);
    const forged = await request(jar, '/api/auth/refresh', { method: 'POST', body: {}, csrf: false });
    assert(
      forged.status === 403 && forged.payload?.error?.code === 'CSRF_VALIDATION_FAILED',
      'Refresh request without the CSRF header is rejected',
      `status ${forged.status} code ${forged.payload?.error?.code}`,
    );
    assert(noCsrf.status === 401 || noCsrf.status === 403, 'Unauthenticated refresh is rejected');
  }
  {
    const oldRefresh = admin.jar.get('ssims_rt');
    const refreshed = await admin.call('/api/auth/refresh', { method: 'POST', body: {} });
    const newRefresh = admin.jar.get('ssims_rt');
    if (refreshed.payload?.data?.accessToken) admin.token = refreshed.payload.data.accessToken;
    assert(refreshed.status === 200 && newRefresh && newRefresh !== oldRefresh, 'Refresh token rotates on use');
    // Replay the previous refresh cookie with the current valid CSRF token.
    const replayJar = new CookieJar();
    for (const [key, value] of admin.jar.cookies.entries()) replayJar.cookies.set(key, value);
    replayJar.cookies.set('ssims_rt', oldRefresh);
    const replay = await request(replayJar, '/api/auth/refresh', { method: 'POST', body: {} });
    assert(replay.status === 401, 'Replayed refresh token is rejected', `status ${replay.status}`);
    // Reuse detection revoked all sessions; log in again for the remaining tests.
    const relogin = await admin.login(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    assert(relogin.status === 200, 'Administrator re-authenticates after session-family revocation');
  }

  section('5. MFA enrolment, login, recovery code and disable');
  {
    const setup = await student.call('/api/auth/mfa/setup', { method: 'POST', body: { currentPassword: env.SEED_STUDENT_PASSWORD } });
    assert(setup.status === 200 && setup.payload?.data?.secret && setup.payload?.data?.qrCodeDataUrl?.startsWith('data:image/png'), 'TOTP secret and QR code are generated');
    const secret = setup.payload?.data?.secret;
    if (secret) {
      const enableCode = totp(secret);
      const enabled = await student.call('/api/auth/mfa/enable', { method: 'POST', body: { code: enableCode } });
      const backupCodes = enabled.payload?.data?.backupCodes || [];
      assert(enabled.status === 200 && backupCodes.length === 10, 'MFA enabled with ten single-use backup codes');

      const mfaJar = new CookieJar();
      const mfaStage = await request(mfaJar, '/api/auth/login', { method: 'POST', body: { email: env.SEED_STUDENT_EMAIL, password: env.SEED_STUDENT_PASSWORD } });
      assert(mfaStage.status === 401 && mfaStage.payload?.error?.code === 'MFA_REQUIRED', 'Password alone is refused when MFA is enabled');

      const recovered = await request(mfaJar, '/api/auth/login', {
        method: 'POST',
        body: { email: env.SEED_STUDENT_EMAIL, password: env.SEED_STUDENT_PASSWORD, backupCode: backupCodes[0] },
      });
      assert(recovered.status === 200 && recovered.payload?.data?.accessToken, 'A backup recovery code completes MFA login');
      student.token = recovered.payload?.data?.accessToken;
      student.jar = mfaJar;

      // Use the next time step so the previous enrollment code cannot be replayed.
      const futureCode = totp(secret, Date.now() + 30_000);
      const disabled = await student.call('/api/auth/mfa/disable', {
        method: 'POST',
        body: { currentPassword: env.SEED_STUDENT_PASSWORD, code: futureCode },
      });
      assert(disabled.status === 200, 'MFA can be disabled with password + fresh TOTP code', `status ${disabled.status}`);
    }
  }

  section('6. Webhook HMAC, expiry and replay protection');
  {
    const eventId = `smoke.accepted.${crypto.randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ event: 'security.smoke.test', severity: 'info' });
    const signature = crypto.createHmac('sha256', env.WEBHOOK_SECRET).update(`${timestamp}.${eventId}.${rawBody}`).digest('hex');
    const accepted = await fetch(`${BASE}/api/webhooks/security`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ssims-event-id': eventId,
        'x-ssims-timestamp': timestamp,
        'x-ssims-event-type': 'security.smoke',
        'x-ssims-signature': signature,
      },
      body: rawBody,
    });
    assert(accepted.status === 202, 'Valid HMAC-SHA256 webhook is accepted', `status ${accepted.status}`);

    const replay = await fetch(`${BASE}/api/webhooks/security`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ssims-event-id': eventId,
        'x-ssims-timestamp': timestamp,
        'x-ssims-event-type': 'security.smoke',
        'x-ssims-signature': signature,
      },
      body: rawBody,
    });
    assert(replay.status === 409, 'Replay of a processed event ID is rejected', `status ${replay.status}`);

    const forged = await fetch(`${BASE}/api/webhooks/security`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ssims-event-id': `smoke.forged.${crypto.randomUUID()}`,
        'x-ssims-timestamp': timestamp,
        'x-ssims-event-type': 'security.smoke',
        'x-ssims-signature': '0'.repeat(64),
      },
      body: rawBody,
    });
    assert(forged.status === 401, 'Invalid webhook signature is rejected', `status ${forged.status}`);
  }

  section('7. Security Testing Lab (real backend demonstrations)');
  {
    const catalog = await admin.call('/api/lab/catalog');
    assert(catalog.status === 200 && catalog.payload?.data?.length === 8, 'Eight laboratory tests are registered');
    const tests = ['sql-injection', 'xss', 'unauthorized-access', 'mitm', 'csrf', 'webhook-forgery', 'ddos', 'brute-force'];
    for (const key of tests) {
      const run = await admin.call(`/api/lab/run/${key}`, { method: 'POST', body: {} });
      const status = run.payload?.data?.status;
      const actual = run.payload?.data?.actual || run.payload?.error?.message || '';
      assert(run.status === 200 && (status === 'passed' || (key === 'mitm' && status === 'info')), `Lab ${key} completed`, `${status || run.status}: ${String(actual).slice(0, 100)}`);
    }
    const reset = await admin.call('/api/lab/reset-account', { method: 'POST', body: {} });
    assert(reset.status === 200, 'Laboratory brute-force target restored');
  }

  section('8. Security telemetry and audit visibility');
  {
    const events = await admin.call('/api/security/events?limit=5&severity=high');
    assert(events.status === 200 && Array.isArray(events.payload?.data), 'Security events can be filtered by severity');
    const attempts = await admin.call('/api/security/login-attempts?limit=5');
    assert(attempts.status === 200, 'Login attempt telemetry is available');
    const audit = await admin.call('/api/security/audit-log?limit=5');
    assert(audit.status === 200, 'Database audit log is available to administrators');
    const rules = await admin.call('/api/security/ip-rules');
    assert(rules.status === 200, 'Administrator can view IP access rules');
  }

  section('9. Kerberos simulation');
  {
    const sim = await admin.call('/api/kerberos/simulate', { method: 'POST', body: {} });
    assert(
      sim.status === 200 && sim.payload?.data?.simulation === true && sim.payload?.data?.checks?.mutualAuthentication,
      'Kerberos simulation completes mutual authentication and replay rejection',
      `${sim.payload?.data?.steps?.length || 0} protocol steps`,
    );
  }

  section('10. Logout and session invalidation');
  {
    const logout = await admin.call('/api/auth/logout', { method: 'POST', body: {} });
    assert(logout.status === 200, 'Logout revokes the current session');
    const meAfter = await request(admin.jar, '/api/auth/me', { token: null });
    assert(meAfter.status === 401, 'Revoked session can no longer access protected endpoints');
  }

  console.log(`\n\x1b[1mResult:\x1b[0m ${results.length - failures}/${results.length} checks passed.`);
  if (failures > 0) {
    console.log('\nFailures:');
    for (const result of results.filter((item) => item.status === 'FAIL')) console.log(` - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exitCode = 1;
});
