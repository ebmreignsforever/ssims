import { Router } from 'express';
import { query } from '../db/pool';
import { asyncHandler } from '../utils/errors';

export const publicRouter = Router();

// Department names are non-sensitive directory data needed by the registration
// form. No user records or internal identifiers beyond the department ID leak.
publicRouter.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      'SELECT id, code, name FROM departments ORDER BY name',
    );
    res.json({ success: true, data: rows });
  }),
);

publicRouter.get(
  '/meta',
  asyncHandler(async (_req, res) => {
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
  }),
);
