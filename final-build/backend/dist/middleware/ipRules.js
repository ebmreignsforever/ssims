"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateIpRuleCache = invalidateIpRuleCache;
exports.ipAccessControl = ipAccessControl;
const ipaddr_js_1 = __importDefault(require("ipaddr.js"));
const pool_1 = require("../db/pool");
const auditService_1 = require("../services/auditService");
const logger_1 = require("../utils/logger");
let cachedRules = null;
let cacheExpiresAt = 0;
async function loadRules() {
    const now = Date.now();
    if (cachedRules && now < cacheExpiresAt)
        return cachedRules;
    try {
        cachedRules = await (0, pool_1.query)(`SELECT cidr::text, action, reason
         FROM ip_rules
        WHERE expires_at IS NULL OR expires_at > now()
        ORDER BY action, cidr`);
        cacheExpiresAt = now + 30_000;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Unable to load IP access rules; request allowed');
        return cachedRules ?? [];
    }
    return cachedRules;
}
function invalidateIpRuleCache() {
    cachedRules = null;
    cacheExpiresAt = 0;
}
function matches(ip, cidr) {
    try {
        const address = ipaddr_js_1.default.process(ip);
        const range = ipaddr_js_1.default.parseCIDR(cidr);
        return address.match(range);
    }
    catch {
        return false;
    }
}
/**
 * Network access policy stored in the database and administered in the UI.
 * Deny rules always win. If one or more allow rules exist, traffic must match an
 * allow rule (default deny). Keep an allow rule for your admin network before
 * enabling allow-list mode or you will lock yourself out.
 */
async function ipAccessControl(req, res, next) {
    const ip = req.ip?.replace(/^::ffff:/, '');
    if (!ip) {
        next();
        return;
    }
    const rules = await loadRules();
    if (rules.length === 0) {
        next();
        return;
    }
    const denied = rules.find((rule) => rule.action === 'deny' && matches(ip, rule.cidr));
    const allowRules = rules.filter((rule) => rule.action === 'allow');
    const allowed = allowRules.length === 0 || allowRules.some((rule) => matches(ip, rule.cidr));
    if (denied || !allowed) {
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'IP_ACCESS_BLOCKED',
            severity: 'high',
            description: denied
                ? `Request blocked by IP deny rule (${denied.reason || 'no reason supplied'})`
                : 'Request did not match any configured IP allow rule',
            metadata: { ip, path: req.originalUrl.split('?')[0] },
        });
        res.status(403).json({
            success: false,
            error: { code: 'IP_BLOCKED', message: 'Access from this network is not permitted' },
        });
        return;
    }
    next();
}
//# sourceMappingURL=ipRules.js.map