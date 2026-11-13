"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.tooManyRequests = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.ApiError = void 0;
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
const zod_1 = require("zod");
const logger_1 = require("./logger");
class ApiError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
exports.ApiError = ApiError;
const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
exports.badRequest = badRequest;
const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
exports.unauthorized = unauthorized;
const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', message);
exports.forbidden = forbidden;
const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);
exports.notFound = notFound;
const conflict = (message, details) => new ApiError(409, 'CONFLICT', message, details);
exports.conflict = conflict;
const tooManyRequests = (message = 'Too many requests') => new ApiError(429, 'RATE_LIMITED', message);
exports.tooManyRequests = tooManyRequests;
/** Wrap async route handlers so rejected promises reach the central error handler. */
const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
function errorHandler(error, req, res, _next) {
    if (error instanceof zod_1.ZodError) {
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
    const bodyError = error;
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
            logger_1.logger.error({ err: error, path: req.path, requestId: res.locals.requestId }, 'API error');
        }
        res.status(error.statusCode).json({
            success: false,
            error: { code: error.code, message: error.message, details: error.details },
        });
        return;
    }
    // Never leak SQL errors, stack traces, secrets or internal paths to clients.
    logger_1.logger.error({
        err: error,
        path: req.path,
        method: req.method,
        requestId: res.locals.requestId,
    }, 'Unhandled request error');
    res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        requestId: res.locals.requestId,
    });
}
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist' },
    });
}
//# sourceMappingURL=errors.js.map