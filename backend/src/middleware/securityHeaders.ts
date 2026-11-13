import helmet from 'helmet';
import { config } from '../config';

/**
 * Content-Security-Policy for the SPA when Express serves the built frontend in
 * the single-container PaaS deployment. Nginx uses the same policy in Compose.
 */
export const SPA_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

/**
 * API security headers. Nginx applies an equivalent set (plus the SPA
 * Content-Security-Policy) to browser-facing responses.
 */
export const securityHeaders = helmet({
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
  hsts: config.isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
  frameguard: { action: 'deny' },
  noSniff: true,
});
