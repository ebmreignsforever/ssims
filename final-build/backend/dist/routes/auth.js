"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const errors_1 = require("../utils/errors");
const validation_1 = require("../utils/validation");
const csrf_1 = require("../middleware/csrf");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const authService_1 = require("../services/authService");
const userService_1 = require("../services/userService");
const tokenService_1 = require("../services/tokenService");
exports.authRouter = (0, express_1.Router)();
const loginSchema = zod_1.z.object({
    email: validation_1.emailSchema,
    password: zod_1.z.string().min(1).max(128),
    mfaCode: zod_1.z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
    backupCode: zod_1.z.string().min(6).max(32).optional(),
    challengeId: validation_1.uuidSchema.optional(),
    challengeAnswer: zod_1.z.string().min(1).max(10).optional(),
});
exports.authRouter.post('/login', rateLimit_1.loginIpLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await (0, authService_1.login)(body, req, res);
    res.json({ success: true, data: result });
}));
const registerSchema = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(120),
    email: validation_1.emailSchema,
    password: validation_1.passwordSchema,
    studentId: zod_1.z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{4,20}$/, 'Student ID must be 4-20 letters, numbers or hyphens'),
    departmentId: validation_1.uuidSchema.optional().or(zod_1.z.literal('').transform(() => undefined)),
    phone: zod_1.z.string().trim().max(30).optional(),
});
exports.authRouter.post('/register', rateLimit_1.passwordResetLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const result = await (0, userService_1.createUser)({
        email: body.email,
        fullName: body.fullName,
        password: body.password,
        role: 'student',
        studentId: body.studentId,
        departmentId: body.departmentId,
        phone: body.phone,
        mustChangePassword: false,
    }, req);
    res.status(201).json({ success: true, data: { user: result.user } });
}));
exports.authRouter.post('/refresh', rateLimit_1.refreshLimiter, csrf_1.requireCsrf, (0, errors_1.asyncHandler)(async (req, res) => {
    const raw = req.cookies?.[config_1.cookieNames.refresh];
    const result = await (0, authService_1.refreshSession)(raw, req, res);
    res.json({ success: true, data: result });
}));
exports.authRouter.post('/logout', csrf_1.requireCsrf, (0, errors_1.asyncHandler)(async (req, res) => {
    await (0, authService_1.logout)(req.cookies?.[config_1.cookieNames.refresh], req, res);
    res.json({ success: true, data: { message: 'Signed out' } });
}));
exports.authRouter.get('/me', auth_1.authenticate, (0, errors_1.asyncHandler)(async (req, res) => {
    const policy = await (0, authService_1.getPolicy)();
    const user = await (0, authService_1.getSafeUserById)(req.auth.userId, policy);
    res.json({ success: true, data: { user } });
}));
const changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1).max(128),
    newPassword: validation_1.passwordSchema,
    confirmPassword: validation_1.passwordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
exports.authRouter.post('/change-password', auth_1.authenticate, csrf_1.requireCsrf, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    await (0, authService_1.changePassword)(req.auth.userId, body.currentPassword, body.newPassword, req);
    (0, tokenService_1.clearRefreshCookie)(res);
    (0, tokenService_1.clearCsrfCookie)(res);
    res.json({
        success: true,
        data: { message: 'Password changed. All sessions were signed out; please sign in again.' },
    });
}));
const forgotSchema = zod_1.z.object({ email: validation_1.emailSchema });
exports.authRouter.post('/forgot-password', rateLimit_1.passwordResetLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const result = await (0, authService_1.requestPasswordReset)(body.email, req);
    res.json({
        success: true,
        data: {
            message: 'If an account exists for that email, a password reset link has been issued.',
            ...(result.developmentResetUrl
                ? { developmentResetUrl: result.developmentResetUrl, developmentNotice: true }
                : {}),
        },
    });
}));
const resetSchema = zod_1.z.object({
    token: zod_1.z.string().min(20).max(200),
    newPassword: validation_1.passwordSchema,
    confirmPassword: validation_1.passwordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
exports.authRouter.post('/reset-password', rateLimit_1.passwordResetLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = resetSchema.parse(req.body);
    await (0, authService_1.resetPassword)(body.token, body.newPassword, req);
    (0, tokenService_1.clearRefreshCookie)(res);
    (0, tokenService_1.clearCsrfCookie)(res);
    res.json({ success: true, data: { message: 'Password reset. You can now sign in with your new password.' } });
}));
const mfaSetupSchema = zod_1.z.object({ currentPassword: zod_1.z.string().min(1).max(128) });
exports.authRouter.post('/mfa/setup', auth_1.authenticate, csrf_1.requireCsrf, rateLimit_1.mfaLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = mfaSetupSchema.parse(req.body);
    const result = await (0, authService_1.startMfaSetup)(req.auth.userId, body.currentPassword);
    res.json({ success: true, data: result });
}));
const mfaEnableSchema = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/) });
exports.authRouter.post('/mfa/enable', auth_1.authenticate, csrf_1.requireCsrf, rateLimit_1.mfaLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = mfaEnableSchema.parse(req.body);
    const result = await (0, authService_1.enableMfa)(req.auth.userId, body.code, req);
    res.json({ success: true, data: result });
}));
const mfaDisableSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1).max(128),
    code: zod_1.z.string().regex(/^\d{6}$/),
});
exports.authRouter.post('/mfa/disable', auth_1.authenticate, csrf_1.requireCsrf, rateLimit_1.mfaLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = mfaDisableSchema.parse(req.body);
    await (0, authService_1.disableMfa)(req.auth.userId, body.currentPassword, body.code, req);
    res.json({ success: true, data: { message: 'MFA disabled' } });
}));
const backupSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1).max(128),
    code: zod_1.z.string().regex(/^\d{6}$/),
});
exports.authRouter.post('/mfa/backup-codes', auth_1.authenticate, csrf_1.requireCsrf, rateLimit_1.mfaLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const body = backupSchema.parse(req.body);
    const result = await (0, authService_1.regenerateBackupCodes)(req.auth.userId, body.currentPassword, body.code, req);
    res.json({ success: true, data: result });
}));
exports.authRouter.get('/csrf', auth_1.authenticate, (0, errors_1.asyncHandler)(async (req, res) => {
    // Allows the SPA to recover a fresh double-submit token after a hard reload.
    const { createCsrfToken, setCsrfCookie } = await Promise.resolve().then(() => __importStar(require('../services/tokenService')));
    const token = createCsrfToken();
    setCsrfCookie(res, token);
    res.json({ success: true, data: { csrfToken: token } });
}));
exports.authRouter.use((_req, _res, next) => next((0, errors_1.badRequest)('Unknown authentication endpoint')));
//# sourceMappingURL=auth.js.map