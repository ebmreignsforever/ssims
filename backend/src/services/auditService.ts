import { Request } from 'express';
import { query } from '../db/pool';
import { cleanText } from '../utils/validation';
import { logger } from '../utils/logger';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEventInput {
  userId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  eventType: string;
  severity: Severity;
  description: string;
  metadata?: Record<string, unknown>;
  request?: Request;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Append a security event. This table is append-only at the database layer.
 * Metadata is reduced to scalar values and length-limited; credentials,
 * tokens and payload bodies must never be passed here.
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const metadata = sanitizeMetadata(input.metadata ?? {});
    await query(
      `INSERT INTO security_events
        (user_id, actor_email, ip, event_type, severity, description, metadata, request_id, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        input.userId && UUID_PATTERN.test(input.userId) ? input.userId : null,
        input.actorEmail ? cleanText(input.actorEmail, 254) : null,
        input.ip || null,
        cleanText(input.eventType, 80),
        input.severity,
        cleanText(input.description, 500),
        JSON.stringify(metadata),
        input.request?.requestId ?? null,
        input.request?.get('user-agent')?.slice(0, 300) ?? null,
      ],
    );
  } catch (error) {
    // Audit failures are operationally significant but must not crash the request.
    logger.error({ err: error, eventType: input.eventType }, 'Failed to persist security event');
  }
}

export function requestIp(req: Request): string | null {
  return req.ip ? req.ip.replace(/^::ffff:/, '') : null;
}

export async function recordRequestEvent(
  req: Request,
  event: Omit<SecurityEventInput, 'request' | 'ip' | 'userId' | 'actorEmail'> & {
    userId?: string | null;
    actorEmail?: string | null;
  },
): Promise<void> {
  await recordSecurityEvent({
    ...event,
    ip: requestIp(req),
    request: req,
    userId: event.userId ?? req.auth?.userId ?? null,
    actorEmail: event.actorEmail ?? req.auth?.email ?? null,
  });
}

function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || depth > 2) return {};
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|signature|authorization|cookie|hash|mfa|backup/i.test(key)) continue;
    if (raw === null || typeof raw === 'boolean' || typeof raw === 'number') {
      result[key] = raw;
    } else if (typeof raw === 'string') {
      result[key] = cleanText(raw, 300);
    } else if (Array.isArray(raw)) {
      result[key] = raw
        .slice(0, 20)
        .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
        .map((item) => (typeof item === 'string' ? cleanText(item, 120) : item));
    } else if (typeof raw === 'object' && depth < 2) {
      result[key] = sanitizeMetadata(raw, depth + 1);
    }
  }
  return result;
}
