import crypto from 'node:crypto';
import { base32Decode, base32Encode, randomToken, safeEqual } from './crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpAuthUrl(secret: string, email: string, issuer = 'SSIMS University'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function codeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verify a TOTP with a ±1 time-step window for modest clock drift. Comparison
 * is constant-time. Replay prevention is provided by authenticating one login
 * at a time; production systems should additionally persist the last used step.
 */
export function generateTotpCode(secret: string, now = Date.now()): string {
  return codeForCounter(secret, Math.floor(now / 1000 / STEP_SECONDS));
}

export function verifyTotp(secret: string, token: string, now = Date.now()): boolean {
  return verifyTotpStep(secret, token, now) !== null;
}

/**
 * Returns the matched time-step so it can be persisted and the same code cannot
 * be replayed within its validity window.
 */
export function verifyTotpStep(secret: string, token: string, now = Date.now()): number | null {
  const normalized = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    if (safeEqual(codeForCounter(secret, counter + offset), normalized)) return counter + offset;
  }
  return null;
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomToken(10).replace(/[-_]/g, '').slice(0, 10).toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
