import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { recordRequestEvent } from '../services/auditService';

function limitedHandler(scope: string) {
  return (req: Request, res: import('express').Response): void => {
    void recordRequestEvent(req, {
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
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  // In-memory store is appropriate for the single API container used here; a
  // multi-replica deployment must use a shared Redis store.
};

export const globalApiLimiter = rateLimit({
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
export const loginIpLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 25,
  skipSuccessfulRequests: false,
  handler: limitedHandler('login endpoint'),
});

export const refreshLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  handler: limitedHandler('token refresh'),
});

export const passwordResetLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 6,
  handler: limitedHandler('password reset'),
});

export const mfaLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  handler: limitedHandler('MFA verification'),
});

export const labLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 120,
  handler: limitedHandler('security testing lab'),
});

/**
 * Dedicated low-volume probe used by the DDoS laboratory exercise. Keyed by the
 * authenticated administrator so it cannot disturb real users' limits.
 */
export const labProbeLimiter = rateLimit({
  ...common,
  windowMs: 10 * 1000,
  limit: 8,
  keyGenerator: (req: Request) => `lab:${req.auth?.userId || req.ip}`,
  handler: limitedHandler('lab rate-limit probe'),
});
