import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

/** Strip tags/control characters from untrusted free text. Passwords are never sanitised. */
export function cleanText(value: string, maxLength = 5000): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordconfirm',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'signature',
  'authorization',
  'cookie',
  'mfasecret',
  'backupcode',
  'code',
  'answer',
]);

/**
 * Recursively sanitise incoming JSON. Sensitive credential fields are skipped so
 * legitimate password characters (e.g. "<" or "&") are preserved; those fields
 * are validated for strength and hashed, never rendered as HTML.
 */
export function sanitizeRequestValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return value;
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeRequestValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        sanitizeRequestValue(child, childKey),
      ]),
    );
  }
  return value;
}

export const emailSchema = z
  .string()
  .trim()
  .min(5)
  .max(254)
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z.string().min(12).max(128);
export const uuidSchema = z.string().uuid('Invalid identifier');
export const idParamSchema = z.object({ id: uuidSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function clientIp(value: string | undefined): string | null {
  if (!value) return null;
  // Express resolves the trusted proxy chain; strip an IPv6-mapped prefix.
  const ip = value.replace(/^::ffff:/, '').split(',')[0].trim();
  return ip.length > 0 && ip.length <= 64 ? ip : null;
}
