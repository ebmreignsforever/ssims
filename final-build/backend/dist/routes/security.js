"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityRouter = void 0;
const express_1 = require("express");
const ipaddr_js_1 = __importDefault(require("ipaddr.js"));
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const ipRules_1 = require("../middleware/ipRules");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const auditService_1 = require("../services/auditService");
const authService_1 = require("../services/authService");
exports.securityRouter = (0, express_1.Router)();
exports.securityRouter.use((0, auth_1.requireRoles)('super_admin', 'administrator'));
const eventFilters = zod_1.z.object({
    severity: zod_1.z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
    eventType: zod_1.z.string().trim().max(80).optional(),
    search: zod_1.z.string().trim().max(120).optional(),
    from: zod_1.z.coerce.date().optional(),
    to: zod_1.z.coerce.date().optional(),
});
function eventWhere(input) {
    const conditions = [];
    const params = [];
    if (input.severity) {
        params.push(input.severity);
        conditions.push(`e.severity = $${params.length}::severity_level`);
    }
    if (input.eventType) {
        params.push(input.eventType);
        conditions.push(`e.event_type = $${params.length}`);
    }
    if (input.search) {
        params.push(`%${input.search}%`);
        conditions.push(`(e.description ILIKE $${params.length} OR e.actor_email ILIKE $${params.length} OR e.ip::text ILIKE $${params.length} OR e.event_type ILIKE $${params.length})`);
    }
    if (input.from) {
        params.push(input.from);
        conditions.push(`e.occurred_at >= $${params.length}`);
    }
    if (input.to) {
        params.push(input.to);
        conditions.push(`e.occurred_at <= $${params.length}`);
    }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}
exports.securityRouter.get('/events', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const page = validation_1.paginationSchema.parse(req.query);
    const filters = eventFilters.parse(req.query);
    const { where, params } = eventWhere(filters);
    const count = await (0, pool_1.queryOne)(`SELECT count(*)::text AS count FROM security_events e ${where}`, params);
    const listParams = [...params, page.limit, (page.page - 1) * page.limit];
    const rows = await (0, pool_1.query)(`SELECT e.id, e.occurred_at, e.user_id, e.actor_email, e.ip::text AS ip,
              e.event_type, e.severity, e.description, e.metadata, e.request_id,
              e.user_agent, u.full_name
         FROM security_events e LEFT JOIN users u ON u.id = e.user_id
         ${where}
        ORDER BY e.occurred_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
    res.json({
        success: true,
        data: rows,
        meta: { ...page, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / page.limit) },
    });
}));
exports.securityRouter.get('/events/export.csv', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const filters = eventFilters.parse(req.query);
    const { where, params } = eventWhere(filters);
    const paramsWithLimit = [...params, 5000];
    const rows = await (0, pool_1.query)(`SELECT e.occurred_at, e.actor_email, e.ip::text AS ip, e.event_type, e.severity, e.description
         FROM security_events e ${where} ORDER BY e.occurred_at DESC LIMIT $${paramsWithLimit.length}`, paramsWithLimit);
    const escapeCsv = (value) => {
        let text = value === null || value === undefined ? '' : String(value);
        // Prevent spreadsheet formula injection in exported logs.
        if (/^[=+\-@]/.test(text))
            text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [
        ['timestamp', 'actor_email', 'ip', 'event_type', 'severity', 'description'].join(','),
        ...rows.map((row) => [row.occurred_at, row.actor_email, row.ip, row.event_type, row.severity, row.description]
            .map(escapeCsv)
            .join(',')),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ssims-security-events-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
}));
exports.securityRouter.get('/login-attempts', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const page = validation_1.paginationSchema.parse(req.query);
    const rows = await (0, pool_1.query)(`SELECT la.id, la.email, la.successful, la.failure_reason, la.ip::text AS ip,
              la.user_agent, la.created_at, u.full_name
         FROM login_attempts la LEFT JOIN users u ON lower(u.email) = lower(la.email)
        ORDER BY la.created_at DESC LIMIT $1 OFFSET $2`, [page.limit, (page.page - 1) * page.limit]);
    const count = await (0, pool_1.queryOne)('SELECT count(*)::text AS count FROM login_attempts');
    res.json({
        success: true,
        data: rows,
        meta: { ...page, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / page.limit) },
    });
}));
exports.securityRouter.get('/audit-log', (0, auth_1.requirePermission)('audit:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const page = validation_1.paginationSchema.parse(req.query);
    const rows = await (0, pool_1.query)(`SELECT id, table_name, operation, row_pk, old_data, new_data, changed_by, changed_at
         FROM audit_log ORDER BY changed_at DESC LIMIT $1 OFFSET $2`, [page.limit, (page.page - 1) * page.limit]);
    const count = await (0, pool_1.queryOne)('SELECT count(*)::text AS count FROM audit_log');
    res.json({
        success: true,
        data: rows,
        meta: { ...page, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / page.limit) },
    });
}));
exports.securityRouter.get('/policies', (0, auth_1.requirePermission)('policies:read'), (0, errors_1.asyncHandler)(async (_req, res) => {
    res.json({ success: true, data: await (0, authService_1.getPolicy)() });
}));
const policySchema = zod_1.z.object({
    maxLoginAttempts: zod_1.z.coerce.number().int().min(3).max(20).optional(),
    lockoutMinutes: zod_1.z.coerce.number().int().min(1).max(1440).optional(),
    challengeAfterFailures: zod_1.z.coerce.number().int().min(1).max(10).optional(),
    passwordHistoryCount: zod_1.z.coerce.number().int().min(1).max(20).optional(),
    sessionTimeoutMinutes: zod_1.z.coerce.number().int().min(5).max(1440).optional(),
    requireMfaForAdmins: zod_1.z.boolean().optional(),
    requireMfaForLecturers: zod_1.z.boolean().optional(),
    passwordMaxAgeDays: zod_1.z.coerce.number().int().min(30).max(3650).optional(),
});
exports.securityRouter.patch('/policies', (0, auth_1.requirePermission)('policies:write'), (0, errors_1.asyncHandler)(async (req, res) => {
    const body = policySchema.parse(req.body);
    const map = {
        max_login_attempts: body.maxLoginAttempts,
        lockout_minutes: body.lockoutMinutes,
        challenge_after_failures: body.challengeAfterFailures,
        password_history_count: body.passwordHistoryCount,
        session_timeout_minutes: body.sessionTimeoutMinutes,
        require_mfa_for_admins: body.requireMfaForAdmins,
        require_mfa_for_lecturers: body.requireMfaForLecturers,
        password_max_age_days: body.passwordMaxAgeDays,
    };
    const fields = [];
    const params = [];
    for (const [column, value] of Object.entries(map)) {
        if (value !== undefined) {
            params.push(value);
            fields.push(`${column} = $${params.length}`);
        }
    }
    if (fields.length === 0)
        throw (0, errors_1.badRequest)('No policy changes supplied');
    params.push(req.auth.userId);
    await (0, pool_1.query)(`UPDATE security_policies SET ${fields.join(', ')}, updated_by = $${params.length}, updated_at = now() WHERE id = 1`, params);
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'SECURITY_POLICY_UPDATED',
        severity: 'high',
        description: 'Security policy settings were updated',
        metadata: { changed: Object.keys(map).filter((key) => map[key] !== undefined) },
    });
    res.json({ success: true, data: await (0, authService_1.getPolicy)() });
}));
exports.securityRouter.get('/ip-rules', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (_req, res) => {
    const rows = await (0, pool_1.query)(`SELECT id, cidr::text AS cidr, action, reason, expires_at, created_at
         FROM ip_rules ORDER BY action, cidr`);
    res.json({ success: true, data: rows });
}));
const ipRuleSchema = zod_1.z.object({
    cidr: zod_1.z
        .string()
        .trim()
        .min(3)
        .max(64)
        .refine((value) => {
        try {
            ipaddr_js_1.default.parseCIDR(value);
            return true;
        }
        catch {
            return false;
        }
    }, 'Enter a valid IPv4 or IPv6 CIDR range, for example 203.0.113.0/24'),
    action: zod_1.z.enum(['allow', 'deny']),
    reason: zod_1.z.string().trim().max(300).default(''),
    expiresAt: zod_1.z.string().datetime().nullable().optional(),
});
exports.securityRouter.post('/ip-rules', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const body = ipRuleSchema.parse(req.body);
    try {
        const row = await (0, pool_1.queryOne)(`INSERT INTO ip_rules (cidr, action, reason, created_by, expires_at)
         VALUES ($1::cidr, $2, $3, $4, $5)
         RETURNING id, cidr::text AS cidr, action, reason, expires_at, created_at`, [body.cidr, body.action, body.reason, req.auth.userId, body.expiresAt || null]);
        (0, ipRules_1.invalidateIpRuleCache)();
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'IP_RULE_CREATED',
            severity: 'high',
            description: `IP ${body.action} rule created for ${body.cidr}`,
            metadata: { cidr: body.cidr, action: body.action },
        });
        res.status(201).json({ success: true, data: row });
    }
    catch (error) {
        if (error.code === '23505')
            throw (0, errors_1.conflict)('A rule for that network already exists');
        throw error;
    }
}));
exports.securityRouter.delete('/ip-rules/:id', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    const { id } = zod_1.z.object({ id: validation_1.uuidSchema }).parse(req.params);
    const row = await (0, pool_1.queryOne)('DELETE FROM ip_rules WHERE id = $1 RETURNING cidr::text AS cidr, action', [id]);
    if (!row)
        throw (0, errors_1.notFound)('IP rule not found');
    (0, ipRules_1.invalidateIpRuleCache)();
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'IP_RULE_DELETED',
        severity: 'high',
        description: `IP ${row.action} rule deleted for ${row.cidr}`,
        metadata: row,
    });
    res.json({ success: true, data: { message: 'IP rule removed' } });
}));
exports.securityRouter.get('/transport-security', (0, auth_1.requirePermission)('security:read'), (0, errors_1.asyncHandler)(async (req, res) => {
    // The edge Nginx terminates TLS and forwards these headers. In direct local
    // development the request may legitimately be HTTP; the UI explains the
    // distinction and Docker always serves HTTPS.
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol;
    const tlsVersion = req.get('x-ssl-protocol') || null;
    const cipher = req.get('x-ssl-cipher') || null;
    res.json({
        success: true,
        data: {
            requestProtocol: forwardedProto,
            httpsActive: forwardedProto === 'https',
            forwardedForTlsTermination: Boolean(req.get('x-forwarded-proto')),
            tlsVersion,
            cipher,
            hstsEnabled: process.env.NODE_ENV === 'production',
            databaseTlsConfigured: process.env.DB_SSL_MODE !== 'disable',
            note: 'TLS terminates at Nginx; the API verifies the database TLS chain with verify-full.',
        },
    });
}));
//# sourceMappingURL=security.js.map