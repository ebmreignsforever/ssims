import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hmacSha256, safeEqual } from '../src/utils/crypto';
import { passwordProblems } from '../src/utils/passwordPolicy';
import { buildOtpAuthUrl, generateTotpCode, generateTotpSecret, verifyTotpStep } from '../src/utils/totp';
import { runKerberosSimulation } from '../src/services/kerberosSimulation';
import { verifyAccessToken, signAccessToken } from '../src/services/tokenService';

describe('password policy', () => {
  it('rejects passwords shorter than 12 characters', () => {
    expect(passwordProblems('Short1!')).toContain('Password must be at least 12 characters');
  });

  it('requires all character classes', () => {
    const problems = passwordProblems('abcdefghijkl');
    expect(problems).toContain('Password must contain an uppercase letter');
    expect(problems).toContain('Password must contain a number');
    expect(problems).toContain('Password must contain a special character');
  });

  it('rejects known compromised patterns', () => {
    expect(passwordProblems('Password123!')).toContain('This password appears on a list of commonly compromised passwords');
  });

  it('rejects passwords containing the account name', () => {
    expect(passwordProblems('Amina-Secure!2026', { email: 'amina@ssims.edu', fullName: 'Amina Okafor' })).toContain(
      'Password must not contain your email address',
    );
  });

  it('accepts a strong passphrase', () => {
    expect(passwordProblems('Correct-Horse!Battery9', { email: 'student@ssims.edu' })).toEqual([]);
  });
});

describe('TOTP', () => {
  it('generates a valid six-digit code and accepts its time step', () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpStep(secret, code, now)).toBe(Math.floor(now / 1000 / 30));
  });

  it('rejects a code from an unrelated secret and malformed input', () => {
    const secret = generateTotpSecret();
    const other = generateTotpSecret();
    const code = generateTotpCode(other);
    expect(verifyTotpStep(secret, code)).toBeNull();
    expect(verifyTotpStep(secret, 'abcdef')).toBeNull();
  });

  it('produces an otpauth QR-compatible enrollment URI', () => {
    const secret = generateTotpSecret();
    const url = buildOtpAuthUrl(secret, 'student@ssims.edu');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('issuer=SSIMS+University');
    expect(url).toContain(`secret=${secret}`);
  });
});

describe('cryptographic helpers', () => {
  it('encrypts TOTP secrets with AES-256-GCM and detects tampering', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    const parts = encrypted.split('.');
    parts[3] = `${parts[3].slice(0, -2)}AA`;
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('round-trips Base32 and uses constant-time comparison semantics', () => {
    const buffer = Buffer.from('SSIMS-secure-value');
    expect(base32Decode(base32Encode(buffer)).toString()).toBe(buffer.toString());
    expect(safeEqual('same-value', 'same-value')).toBe(true);
    expect(safeEqual('same-value', 'other-value')).toBe(false);
    expect(hmacSha256('secret', 'payload')).toHaveLength(64);
  });
});

describe('JWT access tokens', () => {
  it('signs and verifies claims with issuer and audience constraints', () => {
    const signed = signAccessToken({
      userId: '4f3c4f38-7cc0-4a03-917e-c73e90f71f35',
      email: 'student@ssims.edu',
      role: 'student',
      sessionId: 'e7f1e76b-bd6a-4fdd-95b9-1cc11b5f2b6b',
    });
    const claims = verifyAccessToken(signed.token);
    expect(claims.sub).toBe('4f3c4f38-7cc0-4a03-917e-c73e90f71f35');
    expect(claims.role).toBe('student');
    expect(claims.sid).toBe('e7f1e76b-bd6a-4fdd-95b9-1cc11b5f2b6b');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('Kerberos simulation', () => {
  it('completes mutual authentication and rejects a replayed authenticator', () => {
    const result = runKerberosSimulation();
    expect(result.simulation).toBe(true);
    expect(result.result).toBe('passed');
    expect(result.checks.tgtIssued).toBe(true);
    expect(result.checks.serviceTicketIssued).toBe(true);
    expect(result.checks.mutualAuthentication).toBe(true);
    expect(result.checks.replayRejected).toBe(true);
    expect(result.steps).toHaveLength(7);
  });
});
