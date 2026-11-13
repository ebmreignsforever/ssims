import argon2 from 'argon2';
import { COMMON_PASSWORDS } from './commonPasswords';
import { badRequest } from './errors';

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1).
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordContext {
  email?: string;
  fullName?: string;
}

export function passwordProblems(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  if (password.length < MIN_LENGTH) problems.push(`Password must be at least ${MIN_LENGTH} characters`);
  if (password.length > MAX_LENGTH) problems.push(`Password must not exceed ${MAX_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter');
  if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter');
  if (!/[0-9]/.test(password)) problems.push('Password must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Password must contain a special character');

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    problems.push('This password appears on a list of commonly compromised passwords');
  }

  // Block obvious keyboard patterns and repeated characters.
  if (/(.)\1{4,}/.test(password)) problems.push('Password must not contain a long repeated character sequence');
  if (/12345|qwerty|password|letmein|welcome|admin/i.test(password)) {
    problems.push('Password contains a commonly abused word or sequence');
  }

  if (context.email) {
    const localPart = context.email.split('@')[0].toLowerCase();
    if (localPart.length >= 3 && normalized.includes(localPart)) {
      problems.push('Password must not contain your email address');
    }
  }
  if (context.fullName) {
    for (const part of context.fullName.toLowerCase().split(/\s+/)) {
      if (part.length >= 3 && normalized.includes(part)) {
        problems.push('Password must not contain your name');
        break;
      }
    }
  }
  return [...new Set(problems)];
}

export function assertStrongPassword(password: string, context: PasswordContext = {}): void {
  const problems = passwordProblems(password, context);
  if (problems.length > 0) {
    throw badRequest('Password does not meet the security policy', { password: problems });
  }
}

export async function hashPassword(password: string): Promise<string> {
  // Argon2id creates a unique salt automatically and embeds parameters in the hash.
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function needsRehash(hash: string): Promise<boolean> {
  try {
    return argon2.needsRehash(hash, ARGON_OPTIONS);
  } catch {
    return true;
  }
}
