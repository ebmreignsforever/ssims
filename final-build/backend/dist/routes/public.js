"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRouter = void 0;
const express_1 = require("express");
const pool_1 = require("../db/pool");
const errors_1 = require("../utils/errors");
exports.publicRouter = (0, express_1.Router)();
// Department names are non-sensitive directory data needed by the registration
// form. No user records or internal identifiers beyond the department ID leak.
exports.publicRouter.get('/departments', (0, errors_1.asyncHandler)(async (_req, res) => {
    const rows = await (0, pool_1.query)('SELECT id, code, name FROM departments ORDER BY name');
    res.json({ success: true, data: rows });
}));
exports.publicRouter.get('/meta', (0, errors_1.asyncHandler)(async (_req, res) => {
    res.json({
        success: true,
        data: {
            application: 'Secure Student Information Management System',
            institution: 'SSIMS University',
            securityFeatures: [
                'Argon2id password hashing',
                'TOTP multi-factor authentication',
                'JWT access tokens with rotating refresh sessions',
                'Role-based access control enforced server-side',
                'CSRF double-submit protection',
                'Parameterised PostgreSQL queries',
                'Append-only security audit trail',
                'HMAC-SHA256 signed webhooks',
                'Rate limiting and account lockout',
            ],
        },
    });
}));
//# sourceMappingURL=public.js.map