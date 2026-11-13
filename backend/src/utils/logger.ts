import pino from 'pino';
import { config } from '../config';

/**
 * Structured JSON logging with aggressive redaction. Security rule: passwords,
 * JWTs, TOTP secrets, cookies, reset tokens and webhook signatures must never
 * reach application logs, even if a request body is accidentally logged.
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-ssims-signature"]',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.confirmPassword',
      'req.body.mfaCode',
      'req.body.backupCode',
      'req.body.code',
      'req.body.token',
      'req.body.secret',
      'req.body.signature',
      'req.body.answer',
      '*.password',
      '*.passwordHash',
      '*.mfaSecret',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'ssims-api', environment: config.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
});
