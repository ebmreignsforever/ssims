import { NextFunction, Request, Response } from 'express';
import { sanitizeRequestValue } from '../utils/validation';

/**
 * Defensive input sanitisation for free text. The API still validates every
 * field with Zod, uses parameterised SQL, and the React client escapes output.
 * Password/token fields are intentionally untouched so strong passwords with
 * punctuation are not silently altered.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeRequestValue(req.body);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeRequestValue(req.params) as typeof req.params;
  }
  next();
}
