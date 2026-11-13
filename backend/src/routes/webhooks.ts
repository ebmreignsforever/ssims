import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { queryOne } from '../db/pool';
import { asyncHandler } from '../utils/errors';
import { hmacSha256, safeEqual } from '../utils/crypto';
import { recordRequestEvent } from '../services/auditService';
import { logger } from '../utils/logger';

export const webhookRouter = Router();

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Webhook rate limit exceeded' } });
  },
});

const TOLERANCE_SECONDS = 300;

/**
 * Signed webhook receiver.
 * canonical string = "<unix timestamp>.<event id>.<raw JSON body>"
 * signature        = hex(HMAC-SHA256(WEBHOOK_SECRET, canonical string))
 *
 * Verification uses the raw request bytes, constant-time comparison, a ±5 minute
 * timestamp window, and a database UNIQUE event_id to stop replay attacks.
 * The signing secret exists only in server environment variables.
 */
webhookRouter.post(
  '/security',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const eventId = String(req.get('x-ssims-event-id') || '').trim();
    const timestamp = String(req.get('x-ssims-timestamp') || '').trim();
    const eventType = String(req.get('x-ssims-event-type') || 'security.event').trim().slice(0, 80);
    const signatureHeader = String(req.get('x-ssims-signature') || '').replace(/^sha256=/i, '').trim();
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const sourceIp = req.ip?.replace(/^::ffff:/, '') ?? null;

    if (!eventId || !/^[A-Za-z0-9_.:-]{4,120}$/.test(eventId) || !timestamp || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signatureHeader)) {
      await recordRequestEvent(req, {
        eventType: 'WEBHOOK_REJECTED',
        severity: 'medium',
        description: 'Webhook rejected because required headers were malformed or missing',
        metadata: { eventId: eventId.slice(0, 120), hasTimestamp: Boolean(timestamp) },
      });
      res.status(400).json({
        success: false,
        error: { code: 'WEBHOOK_INVALID', message: 'Missing or malformed webhook headers' },
      });
      return;
    }

    const timestampSeconds = Number(timestamp);
    const skew = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
    const canonical = `${timestamp}.${eventId}.${rawBody.toString('utf8')}`;
    const expected = hmacSha256(config.webhookSecret, canonical);
    const signatureValid = safeEqual(expected, signatureHeader.toLowerCase());

    if (!signatureValid) {
      await queryOne(
        `INSERT INTO webhook_events (event_id, event_type, payload, signature_valid, status, rejection_reason, source_ip)
         VALUES ($1, $2, $3::jsonb, FALSE, 'rejected', 'invalid_signature', $4)
         ON CONFLICT (event_id) DO NOTHING RETURNING id`,
        [eventId, eventType, JSON.stringify(req.body ?? {}), sourceIp],
      );
      await recordRequestEvent(req, {
        eventType: 'WEBHOOK_SIGNATURE_REJECTED',
        severity: 'high',
        description: 'Webhook rejected due to an invalid HMAC-SHA256 signature',
        metadata: { eventId, source: 'webhook' },
      });
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
      });
      return;
    }

    if (skew > TOLERANCE_SECONDS) {
      await queryOne(
        `INSERT INTO webhook_events (event_id, event_type, payload, signature_valid, status, rejection_reason, source_ip)
         VALUES ($1, $2, $3::jsonb, TRUE, 'rejected', 'expired_timestamp', $4)
         ON CONFLICT (event_id) DO NOTHING RETURNING id`,
        [eventId, eventType, JSON.stringify(req.body ?? {}), sourceIp],
      );
      await recordRequestEvent(req, {
        eventType: 'WEBHOOK_TIMESTAMP_REJECTED',
        severity: 'high',
        description: `Webhook rejected because its timestamp was outside the ${TOLERANCE_SECONDS}s tolerance window`,
        metadata: { eventId, skewSeconds: skew },
      });
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_EXPIRED', message: 'Webhook timestamp is outside the allowed window' },
      });
      return;
    }

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO webhook_events (event_id, event_type, payload, signature_valid, status, source_ip)
       VALUES ($1, $2, $3::jsonb, TRUE, 'accepted', $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [eventId, eventType, JSON.stringify(req.body ?? {}), sourceIp],
    );

    if (!inserted) {
      await recordRequestEvent(req, {
        eventType: 'WEBHOOK_REPLAY_REJECTED',
        severity: 'critical',
        description: 'Replay attempt rejected: this webhook event ID was already processed',
        metadata: { eventId },
      });
      res.status(409).json({
        success: false,
        error: { code: 'WEBHOOK_REPLAY', message: 'This webhook event has already been processed' },
      });
      return;
    }

    await recordRequestEvent(req, {
      eventType: 'WEBHOOK_ACCEPTED',
      severity: 'info',
      description: `Signed webhook ${eventType} accepted`,
      metadata: { eventId, eventType, source: 'webhook' },
    });
    logger.info({ eventId, eventType }, 'Signed webhook accepted');
    res.status(202).json({
      success: true,
      data: { eventId, status: 'accepted', processedAt: new Date().toISOString() },
    });
  }),
);

// Utility for administrators testing an upstream integration: generates a valid
// signature server-side. The frontend never receives WEBHOOK_SECRET.
export function signWebhookPayload(input: { eventId: string; timestamp: string; rawBody: string }): string {
  const canonical = `${input.timestamp}.${input.eventId}.${input.rawBody}`;
  return crypto.createHmac('sha256', config.webhookSecret).update(canonical).digest('hex');
}
