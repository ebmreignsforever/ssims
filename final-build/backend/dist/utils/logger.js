"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
/**
 * Structured JSON logging with aggressive redaction. Security rule: passwords,
 * JWTs, TOTP secrets, cookies, reset tokens and webhook signatures must never
 * reach application logs, even if a request body is accidentally logged.
 */
exports.logger = (0, pino_1.default)({
    level: config_1.config.logLevel,
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
    base: { service: 'ssims-api', environment: config_1.config.nodeEnv },
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
});
//# sourceMappingURL=logger.js.map