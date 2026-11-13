"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSecurityEvent = recordSecurityEvent;
exports.requestIp = requestIp;
exports.recordRequestEvent = recordRequestEvent;
const pool_1 = require("../db/pool");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Append a security event. This table is append-only at the database layer.
 * Metadata is reduced to scalar values and length-limited; credentials,
 * tokens and payload bodies must never be passed here.
 */
async function recordSecurityEvent(input) {
    try {
        const metadata = sanitizeMetadata(input.metadata ?? {});
        await (0, pool_1.query)(`INSERT INTO security_events
        (user_id, actor_email, ip, event_type, severity, description, metadata, request_id, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`, [
            input.userId && UUID_PATTERN.test(input.userId) ? input.userId : null,
            input.actorEmail ? (0, validation_1.cleanText)(input.actorEmail, 254) : null,
            input.ip || null,
            (0, validation_1.cleanText)(input.eventType, 80),
            input.severity,
            (0, validation_1.cleanText)(input.description, 500),
            JSON.stringify(metadata),
            input.request?.requestId ?? null,
            input.request?.get('user-agent')?.slice(0, 300) ?? null,
        ]);
    }
    catch (error) {
        // Audit failures are operationally significant but must not crash the request.
        logger_1.logger.error({ err: error, eventType: input.eventType }, 'Failed to persist security event');
    }
}
function requestIp(req) {
    return req.ip ? req.ip.replace(/^::ffff:/, '') : null;
}
async function recordRequestEvent(req, event) {
    await recordSecurityEvent({
        ...event,
        ip: requestIp(req),
        request: req,
        userId: event.userId ?? req.auth?.userId ?? null,
        actorEmail: event.actorEmail ?? req.auth?.email ?? null,
    });
}
function sanitizeMetadata(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 2)
        return {};
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
        if (/password|token|secret|signature|authorization|cookie|hash|mfa|backup/i.test(key))
            continue;
        if (raw === null || typeof raw === 'boolean' || typeof raw === 'number') {
            result[key] = raw;
        }
        else if (typeof raw === 'string') {
            result[key] = (0, validation_1.cleanText)(raw, 300);
        }
        else if (Array.isArray(raw)) {
            result[key] = raw
                .slice(0, 20)
                .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
                .map((item) => (typeof item === 'string' ? (0, validation_1.cleanText)(item, 120) : item));
        }
        else if (typeof raw === 'object' && depth < 2) {
            result[key] = sanitizeMetadata(raw, depth + 1);
        }
    }
    return result;
}
//# sourceMappingURL=auditService.js.map