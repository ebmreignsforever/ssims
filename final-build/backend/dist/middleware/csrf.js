"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireCsrf = void 0;
exports.csrfProtection = csrfProtection;
const config_1 = require("../config");
const auditService_1 = require("../services/auditService");
const tokenService_1 = require("../services/tokenService");
const crypto_1 = require("../utils/crypto");
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * CSRF defence:
 *  1. Validate the Origin header when a browser supplies one.
 *  2. Require a custom header containing the same token as the readable cookie
 *     (double-submit). A cross-site attacker cannot read the cookie to set the header.
 *  3. Compare values in constant time and verify the server's HMAC signature.
 *
 * Combined with SameSite=Strict cookies this blocks classic form-based CSRF.
 */
async function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        next();
        return;
    }
    const origin = req.get('origin');
    if (origin && !config_1.config.allowedOrigins.includes(origin)) {
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'CSRF_REJECTED',
            severity: 'high',
            description: 'Request rejected because its Origin header was not trusted',
            metadata: { origin, path: req.originalUrl.split('?')[0] },
        });
        res.status(403).json({
            success: false,
            error: { code: 'CSRF_VALIDATION_FAILED', message: 'Request origin is not trusted' },
        });
        return;
    }
    const cookieToken = req.cookies?.[config_1.cookieNames.csrf];
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken || !(0, crypto_1.safeEqual)(cookieToken, headerToken) || !(0, tokenService_1.isValidCsrfToken)(cookieToken)) {
        await (0, auditService_1.recordRequestEvent)(req, {
            eventType: 'CSRF_REJECTED',
            severity: 'high',
            description: 'Request rejected due to a missing or invalid CSRF token',
            metadata: { path: req.originalUrl.split('?')[0], method: req.method },
        });
        res.status(403).json({
            success: false,
            error: { code: 'CSRF_VALIDATION_FAILED', message: 'Missing or invalid CSRF token' },
        });
        return;
    }
    next();
}
// Friendly alias used by routers.
exports.requireCsrf = csrfProtection;
//# sourceMappingURL=csrf.js.map