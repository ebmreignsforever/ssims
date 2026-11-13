"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeaders = exports.SPA_CONTENT_SECURITY_POLICY = void 0;
const helmet_1 = __importDefault(require("helmet"));
const config_1 = require("../config");
/**
 * Content-Security-Policy for the SPA when Express serves the built frontend in
 * the single-container PaaS deployment. Nginx uses the same policy in Compose.
 */
exports.SPA_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
/**
 * API security headers. Nginx applies an equivalent set (plus the SPA
 * Content-Security-Policy) to browser-facing responses.
 */
exports.securityHeaders = (0, helmet_1.default)({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            'default-src': ["'none'"],
            'base-uri': ["'none'"],
            'frame-ancestors': ["'none'"],
            'form-action': ["'none'"],
            'connect-src': ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config_1.config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    frameguard: { action: 'deny' },
    noSniff: true,
});
//# sourceMappingURL=securityHeaders.js.map