"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRoles = requireRoles;
exports.requirePermission = requirePermission;
exports.permissionsFor = permissionsFor;
const pool_1 = require("../db/pool");
const auditService_1 = require("../services/auditService");
const tokenService_1 = require("../services/tokenService");
const errors_1 = require("../utils/errors");
const ROLE_PERMISSIONS = {
    super_admin: new Set([
        '*',
        'dashboard:admin',
        'users:read',
        'users:manage',
        'roles:assign_admin',
        'students:manage',
        'staff:manage',
        'courses:manage',
        'departments:manage',
        'security:read',
        'audit:read',
        'lab:run',
        'policies:read',
        'policies:write',
        'kerberos:demo',
    ]),
    administrator: new Set([
        'dashboard:admin',
        'users:read',
        'users:manage',
        'students:manage',
        'staff:manage',
        'courses:manage',
        'departments:manage',
        'security:read',
        'audit:read',
        'lab:run',
        'policies:read',
        'kerberos:demo',
    ]),
    lecturer: new Set(['dashboard:lecturer', 'courses:read:own', 'students:read:enrolled', 'grades:write:own']),
    student: new Set(['dashboard:student', 'profile:read:own', 'profile:write:own', 'grades:read:own', 'mfa:manage']),
};
/**
 * Every protected request verifies the JWT, the live session record and the
 * current account status. A role change, suspension or logout therefore takes
 * effect immediately rather than waiting for the access token to expire.
 */
async function authenticate(req, _res, next) {
    try {
        const header = req.get('authorization') || '';
        const [scheme, token] = header.split(' ');
        if (scheme !== 'Bearer' || !token)
            throw (0, errors_1.unauthorized)('A Bearer access token is required');
        const claims = (0, tokenService_1.verifyAccessToken)(token);
        const row = await (0, pool_1.queryOne)(`SELECT u.id AS user_id, u.email, u.full_name, u.role, u.status, u.mfa_enabled,
              u.must_change_password,
              s.id AS session_id, s.expires_at, s.revoked_at, s.last_used_at,
              p.session_timeout_minutes, p.require_mfa_for_admins, p.require_mfa_for_lecturers
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         CROSS JOIN security_policies p
        WHERE s.id = $1 AND u.id = $2 AND p.id = 1`, [claims.sid, claims.sub]);
        if (!row)
            throw (0, errors_1.unauthorized)('Session not found');
        if (row.revoked_at)
            throw (0, errors_1.unauthorized)('Session has been revoked');
        if (new Date(row.expires_at).getTime() <= Date.now())
            throw (0, errors_1.unauthorized)('Session has expired');
        if (row.status === 'suspended')
            throw (0, errors_1.forbidden)('This account has been suspended');
        if (row.status === 'locked')
            throw (0, errors_1.forbidden)('This account is locked. Contact an administrator.');
        const idleMs = Date.now() - new Date(row.last_used_at).getTime();
        if (idleMs > row.session_timeout_minutes * 60_000) {
            await (0, pool_1.queryOne)(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'idle_timeout'
          WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [row.session_id]);
            await (0, auditService_1.recordRequestEvent)(req, {
                userId: row.user_id,
                actorEmail: row.email,
                eventType: 'SESSION_IDLE_TIMEOUT',
                severity: 'low',
                description: 'Session revoked after exceeding the configured idle timeout',
            });
            throw (0, errors_1.unauthorized)('Session expired due to inactivity');
        }
        const path = req.originalUrl.split('?')[0];
        const accountSetupPaths = [
            '/api/auth/me',
            '/api/auth/csrf',
            '/api/auth/logout',
            '/api/auth/change-password',
            '/api/auth/mfa/setup',
            '/api/auth/mfa/enable',
        ];
        if (row.must_change_password && !accountSetupPaths.includes(path)) {
            await (0, auditService_1.recordRequestEvent)(req, {
                userId: row.user_id,
                actorEmail: row.email,
                eventType: 'PASSWORD_CHANGE_REQUIRED',
                severity: 'medium',
                description: 'Access limited because the account must change its bootstrap or temporary password',
                metadata: { path },
            });
            throw new errors_1.ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before using the portal');
        }
        const mfaRequiredByPolicy = ((row.role === 'super_admin' || row.role === 'administrator') && row.require_mfa_for_admins) ||
            (row.role === 'lecturer' && row.require_mfa_for_lecturers);
        if (mfaRequiredByPolicy && !row.mfa_enabled && !accountSetupPaths.includes(path)) {
            await (0, auditService_1.recordRequestEvent)(req, {
                userId: row.user_id,
                actorEmail: row.email,
                eventType: 'MFA_ENROLLMENT_REQUIRED',
                severity: 'medium',
                description: 'Access limited because security policy requires MFA enrollment',
                metadata: { path },
            });
            throw (0, errors_1.forbidden)('Multi-factor authentication enrollment is required by security policy');
        }
        req.auth = {
            userId: row.user_id,
            email: row.email,
            role: row.role,
            sessionId: row.session_id,
            fullName: row.full_name,
        };
        // Throttle last-seen writes to at most once per minute.
        if (idleMs > 60_000) {
            await (0, pool_1.queryOne)('UPDATE sessions SET last_used_at = now(), last_ip = $2 WHERE id = $1 RETURNING id', [
                row.session_id,
                req.ip || null,
            ]);
        }
        next();
    }
    catch (error) {
        next(error);
    }
}
function requireRoles(...roles) {
    return (req, _res, next) => {
        if (!req.auth)
            return next((0, errors_1.unauthorized)());
        if (!roles.includes(req.auth.role)) {
            void (0, auditService_1.recordRequestEvent)(req, {
                eventType: 'UNAUTHORIZED_ACCESS',
                severity: 'high',
                description: `Role ${req.auth.role} attempted to access an endpoint restricted to ${roles.join(', ')}`,
                metadata: { path: req.originalUrl.split('?')[0], method: req.method },
            });
            return next((0, errors_1.forbidden)());
        }
        next();
    };
}
function requirePermission(permission) {
    return (req, _res, next) => {
        if (!req.auth)
            return next((0, errors_1.unauthorized)());
        const permissions = ROLE_PERMISSIONS[req.auth.role];
        if (!permissions.has('*') && !permissions.has(permission)) {
            void (0, auditService_1.recordRequestEvent)(req, {
                eventType: 'UNAUTHORIZED_ACCESS',
                severity: 'high',
                description: `Permission ${permission} denied for role ${req.auth.role}`,
                metadata: { path: req.originalUrl.split('?')[0], method: req.method },
            });
            return next((0, errors_1.forbidden)());
        }
        next();
    };
}
function permissionsFor(role) {
    return [...ROLE_PERMISSIONS[role]];
}
//# sourceMappingURL=auth.js.map