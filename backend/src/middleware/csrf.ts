import { NextFunction, Request, Response } from 'express';
import { config, cookieNames } from '../config';
import { recordRequestEvent } from '../services/auditService';
import { isValidCsrfToken } from '../services/tokenService';
import { safeEqual } from '../utils/crypto';

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
export async function csrfProtection(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin && !config.allowedOrigins.includes(origin)) {
    await recordRequestEvent(req, {
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

  const cookieToken = req.cookies?.[cookieNames.csrf] as string | undefined;
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken) || !isValidCsrfToken(cookieToken)) {
    await recordRequestEvent(req, {
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
export const requireCsrf = csrfProtection;
