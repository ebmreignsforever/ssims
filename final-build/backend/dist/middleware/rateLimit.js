"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.labProbeLimiter = exports.labLimiter = exports.mfaLimiter = exports.passwordResetLimiter = exports.refreshLimiter = exports.loginIpLimiter = exports.globalApiLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auditService_1 = require("../services/auditService");
function limitedHandler(scope) {
    return (req, res) => {
        void (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'RATE_LIMIT_TRIGGERED',
            severity: 'medium',
            description: `Rate limit exceeded for ${scope}`,
            metadata: { scope, path: req.originalUrl.split('?')[0], method: req.method },
        });
        res.status(429).json({
            success: false,
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please slow down and try again later.',
            },
        });
    };
}
const common = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // In-memory store is appropriate for the single API container used here; a
    // multi-replica deployment must use a shared Redis store.
};
exports.globalApiLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 5 * 60 * 1000,
    limit: 500,
    handler: limitedHandler('global API'),
});
/**
 * Login is limited per source IP. Account-level progressive lockout and the
 * CAPTCHA-style challenge are enforced inside authService for distributed
 * attempts that rotate IP addresses.
 */
exports.loginIpLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 25,
    skipSuccessfulRequests: false,
    handler: limitedHandler('login endpoint'),
});
exports.refreshLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 120,
    handler: limitedHandler('token refresh'),
});
exports.passwordResetLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 60 * 60 * 1000,
    limit: 6,
    handler: limitedHandler('password reset'),
});
exports.mfaLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: 30,
    handler: limitedHandler('MFA verification'),
});
exports.labLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 60 * 1000,
    limit: 120,
    handler: limitedHandler('security testing lab'),
});
/**
 * Dedicated low-volume probe used by the DDoS laboratory exercise. Keyed by the
 * authenticated administrator so it cannot disturb real users' limits.
 */
exports.labProbeLimiter = (0, express_rate_limit_1.default)({
    ...common,
    windowMs: 10 * 1000,
    limit: 8,
    keyGenerator: (req) => `lab:${req.auth?.userId || req.ip}`,
    handler: limitedHandler('lab rate-limit probe'),
});
//# sourceMappingURL=rateLimit.js.map