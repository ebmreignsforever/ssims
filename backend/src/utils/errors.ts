import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'CONFLICT', message, details);
export const tooManyRequests = (message = 'Too many requests') =>
  new ApiError(429, 'RATE_LIMITED', message);

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wrap async route handlers so rejected promises reach the central error handler. */
export const asyncHandler = (handler: AsyncRoute) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'One or more fields are invalid', details },
    });
    return;
  }

  const bodyError = error as { type?: string; status?: number };
  if (bodyError?.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 100 KiB limit' },
    });
    return;
  }
  if (error instanceof SyntaxError && bodyError.status === 400) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON' },
    });
    return;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, path: req.path, requestId: res.locals.requestId }, 'API error');
    }
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  // Never leak SQL errors, stack traces, secrets or internal paths to clients.
  logger.error(
    {
      err: error,
      path: req.path,
      method: req.method,
      requestId: res.locals.requestId,
    },
    'Unhandled request error',
  );
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    requestId: res.locals.requestId,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist' },
  });
}
