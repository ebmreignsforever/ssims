import { Router } from 'express';
import { z } from 'zod';
import { cookieNames } from '../config';
import { asyncHandler, badRequest } from '../utils/errors';
import { emailSchema, passwordSchema, uuidSchema } from '../utils/validation';
import { requireCsrf } from '../middleware/csrf';
import { authenticate } from '../middleware/auth';
import { loginIpLimiter, mfaLimiter, passwordResetLimiter, refreshLimiter } from '../middleware/rateLimit';
import {
  changePassword,
  disableMfa,
  enableMfa,
  getPolicy,
  getSafeUserById,
  login,
  logout,
  refreshSession,
  regenerateBackupCodes,
  requestPasswordReset,
  resetPassword,
  startMfaSetup,
} from '../services/authService';
import { createUser } from '../services/userService';
import { clearCsrfCookie, clearRefreshCookie } from '../services/tokenService';

export const authRouter = Router();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
  backupCode: z.string().min(6).max(32).optional(),
  challengeId: uuidSchema.optional(),
  challengeAnswer: z.string().min(1).max(10).optional(),
});

authRouter.post(
  '/login',
  loginIpLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await login(body, req, res);
    res.json({ success: true, data: result });
  }),
);

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  studentId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,20}$/, 'Student ID must be 4-20 letters, numbers or hyphens'),
  departmentId: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().max(30).optional(),
});

authRouter.post(
  '/register',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const result = await createUser(
      {
        email: body.email,
        fullName: body.fullName,
        password: body.password,
        role: 'student',
        studentId: body.studentId,
        departmentId: body.departmentId,
        phone: body.phone,
        mustChangePassword: false,
      },
      req,
    );
    res.status(201).json({ success: true, data: { user: result.user } });
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[cookieNames.refresh] as string | undefined;
    const result = await refreshSession(raw, req, res);
    res.json({ success: true, data: result });
  }),
);

authRouter.post(
  '/logout',
  requireCsrf,
  asyncHandler(async (req, res) => {
    await logout(req.cookies?.[cookieNames.refresh] as string | undefined, req, res);
    res.json({ success: true, data: { message: 'Signed out' } });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const policy = await getPolicy();
    const user = await getSafeUserById(req.auth!.userId, policy);
    res.json({ success: true, data: { user } });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

authRouter.post(
  '/change-password',
  authenticate,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    await changePassword(req.auth!.userId, body.currentPassword, body.newPassword, req);
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    res.json({
      success: true,
      data: { message: 'Password changed. All sessions were signed out; please sign in again.' },
    });
  }),
);

const forgotSchema = z.object({ email: emailSchema });
authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const result = await requestPasswordReset(body.email, req);
    res.json({
      success: true,
      data: {
        message: 'If an account exists for that email, a password reset link has been issued.',
        ...(result.developmentResetUrl
          ? { developmentResetUrl: result.developmentResetUrl, developmentNotice: true }
          : {}),
      },
    });
  }),
);

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const body = resetSchema.parse(req.body);
    await resetPassword(body.token, body.newPassword, req);
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    res.json({ success: true, data: { message: 'Password reset. You can now sign in with your new password.' } });
  }),
);

const mfaSetupSchema = z.object({ currentPassword: z.string().min(1).max(128) });
authRouter.post(
  '/mfa/setup',
  authenticate,
  requireCsrf,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const body = mfaSetupSchema.parse(req.body);
    const result = await startMfaSetup(req.auth!.userId, body.currentPassword);
    res.json({ success: true, data: result });
  }),
);

const mfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
authRouter.post(
  '/mfa/enable',
  authenticate,
  requireCsrf,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const body = mfaEnableSchema.parse(req.body);
    const result = await enableMfa(req.auth!.userId, body.code, req);
    res.json({ success: true, data: result });
  }),
);

const mfaDisableSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});
authRouter.post(
  '/mfa/disable',
  authenticate,
  requireCsrf,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const body = mfaDisableSchema.parse(req.body);
    await disableMfa(req.auth!.userId, body.currentPassword, body.code, req);
    res.json({ success: true, data: { message: 'MFA disabled' } });
  }),
);

const backupSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});
authRouter.post(
  '/mfa/backup-codes',
  authenticate,
  requireCsrf,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const body = backupSchema.parse(req.body);
    const result = await regenerateBackupCodes(req.auth!.userId, body.currentPassword, body.code, req);
    res.json({ success: true, data: result });
  }),
);

authRouter.get(
  '/csrf',
  authenticate,
  asyncHandler(async (req, res) => {
    // Allows the SPA to recover a fresh double-submit token after a hard reload.
    const { createCsrfToken, setCsrfCookie } = await import('../services/tokenService');
    const token = createCsrfToken();
    setCsrfCookie(res, token);
    res.json({ success: true, data: { csrfToken: token } });
  }),
);

authRouter.use((_req, _res, next) => next(badRequest('Unknown authentication endpoint')));
