"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminDashboardRouter = void 0;
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
exports.adminDashboardRouter = (0, express_1.Router)();
exports.adminDashboardRouter.use((0, auth_1.requireRoles)('super_admin', 'administrator'));
exports.adminDashboardRouter.get('/', (0, errors_1.asyncHandler)(async (_req, res) => {
    const counts = await (0, pool_1.queryOne)(`SELECT
        (SELECT count(*) FROM users)::text AS total_users,
        (SELECT count(*) FROM users WHERE status = 'active')::text AS active_accounts,
        (SELECT count(*) FROM users WHERE status = 'locked' OR (locked_until IS NOT NULL AND locked_until > now()))::text AS locked_accounts,
        (SELECT count(*) FROM users WHERE status = 'suspended')::text AS suspended_accounts,
        (SELECT count(*) FROM users WHERE mfa_enabled)::text AS mfa_users,
        (SELECT count(*) FROM login_attempts WHERE successful = FALSE AND created_at > now() - interval '24 hours')::text AS failed_logins,
        (SELECT count(*) FROM security_events WHERE severity IN ('high','critical') AND occurred_at > now() - interval '24 hours')::text AS suspicious_events,
        (SELECT count(*) FROM enrollments e LEFT JOIN grades g ON g.enrollment_id = e.id WHERE g.id IS NULL)::text AS ungraded_enrollments`);
    const loginTrend = await (0, pool_1.query)(`SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(CASE WHEN la.successful THEN 1 ELSE 0 END), 0)::int AS successful,
              COALESCE(SUM(CASE WHEN la.successful = FALSE THEN 1 ELSE 0 END), 0)::int AS failed
         FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') AS d(day)
         LEFT JOIN login_attempts la ON la.created_at >= d.day AND la.created_at < d.day + interval '1 day'
        GROUP BY d.day ORDER BY d.day`);
    const severity = await (0, pool_1.query)(`SELECT severity, count(*)::int AS count
         FROM security_events
        WHERE occurred_at > now() - interval '7 days'
        GROUP BY severity
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`);
    const roles = await (0, pool_1.query)(`SELECT role, count(*)::int AS count FROM users GROUP BY role ORDER BY count DESC`);
    const recentEvents = await (0, pool_1.query)(`SELECT e.id, e.occurred_at, e.actor_email, e.ip::text AS ip, e.event_type,
              e.severity, e.description, u.full_name
         FROM security_events e LEFT JOIN users u ON u.id = e.user_id
        ORDER BY e.occurred_at DESC LIMIT 10`);
    const testResults = await (0, pool_1.query)(`SELECT id, test_key, name, status, mechanism, created_at
         FROM security_test_runs ORDER BY created_at DESC LIMIT 6`);
    const recentLogins = await (0, pool_1.query)(`SELECT la.email, la.successful, la.failure_reason, la.ip::text AS ip, la.created_at,
              u.full_name, u.role
         FROM login_attempts la LEFT JOIN users u ON lower(u.email) = lower(la.email)
        ORDER BY la.created_at DESC LIMIT 8`);
    res.json({
        success: true,
        data: {
            metrics: {
                totalUsers: Number(counts?.total_users ?? 0),
                activeAccounts: Number(counts?.active_accounts ?? 0),
                lockedAccounts: Number(counts?.locked_accounts ?? 0),
                suspendedAccounts: Number(counts?.suspended_accounts ?? 0),
                mfaUsers: Number(counts?.mfa_users ?? 0),
                failedLogins24h: Number(counts?.failed_logins ?? 0),
                suspiciousEvents24h: Number(counts?.suspicious_events ?? 0),
                ungradedEnrollments: Number(counts?.ungraded_enrollments ?? 0),
            },
            loginTrend,
            severity,
            roles,
            recentEvents,
            testResults,
            recentLogins,
        },
    });
}));
//# sourceMappingURL=adminDashboard.js.map