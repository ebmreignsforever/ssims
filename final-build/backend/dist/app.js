"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const pool_1 = require("./db/pool");
const auth_1 = require("./middleware/auth");
const csrf_1 = require("./middleware/csrf");
const ipRules_1 = require("./middleware/ipRules");
const rateLimit_1 = require("./middleware/rateLimit");
const sanitize_1 = require("./middleware/sanitize");
const requestContext_1 = require("./middleware/requestContext");
const securityHeaders_1 = require("./middleware/securityHeaders");
const errors_1 = require("./utils/errors");
const logger_1 = require("./utils/logger");
const auth_2 = require("./routes/auth");
const public_1 = require("./routes/public");
const webhooks_1 = require("./routes/webhooks");
const adminUsers_1 = require("./routes/adminUsers");
const departments_1 = require("./routes/departments");
const courses_1 = require("./routes/courses");
const student_1 = require("./routes/student");
const lecturer_1 = require("./routes/lecturer");
const adminDashboard_1 = require("./routes/adminDashboard");
const security_1 = require("./routes/security");
const lab_1 = require("./routes/lab");
const kerberos_1 = require("./routes/kerberos");
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('query parser', 'simple');
    // Only trust the first hop (Nginx). Never trust arbitrary client-supplied
    // X-Forwarded-For values for rate limiting or audit IP attribution.
    app.set('trust proxy', config_1.config.trustProxy);
    app.use(requestContext_1.requestContext);
    app.use(securityHeaders_1.securityHeaders);
    // JSON API responses are deliberately not compressed: they can contain CSRF
    // tokens and compression side-channels (BREACH) should be avoided.
    app.use((0, cors_1.default)({
        origin(origin, callback) {
            if (!origin || config_1.config.allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(new errors_1.ApiError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
        exposedHeaders: ['X-Request-Id', 'Retry-After'],
        maxAge: 600,
    }));
    app.use((0, cookie_parser_1.default)(config_1.config.cookieSecret));
    app.use(express_1.default.json({
        limit: '100kb',
        type: ['application/json', 'application/*+json'],
        verify: (req, _res, buffer) => {
            // Raw bytes are required for HMAC verification of signed webhooks.
            req.rawBody = Buffer.from(buffer);
        },
    }));
    app.use(sanitize_1.sanitizeBody);
    // Lightweight structured request logging, without bodies, cookies, auth headers
    // or query strings. Request IDs correlate logs with security events.
    app.use((req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
            logger_1.logger.info({
                requestId: req.requestId,
                method: req.method,
                path: req.originalUrl.split('?')[0],
                status: res.statusCode,
                durationMs: Math.round(durationMs),
                ip: req.ip,
            }, 'HTTP request');
        });
        next();
    });
    app.get('/health', async (_req, res) => {
        try {
            const result = await pool_1.pool.query('SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl');
            res.json({
                status: 'ok',
                service: 'ssims-api',
                database: 'connected',
                databaseTls: Boolean(result.rows[0]?.ssl),
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.round(process.uptime()),
            });
        }
        catch {
            res.status(503).json({ status: 'degraded', service: 'ssims-api', database: 'unavailable' });
        }
    });
    // All browser API traffic passes through the global limiter and the network
    // access policy before authentication. The webhook endpoint is signature-based
    // and mounted separately; it is still rate limited inside its router.
    app.use('/api', rateLimit_1.globalApiLimiter, ipRules_1.ipAccessControl);
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Pragma', 'no-cache');
        }
        next();
    });
    app.use('/api/public', public_1.publicRouter);
    app.use('/api/auth', auth_2.authRouter);
    app.use('/api/webhooks', webhooks_1.webhookRouter);
    const secureApi = express_1.default.Router();
    secureApi.use(auth_1.authenticate);
    // The double-submit CSRF check applies to every unsafe method on protected
    // API routes. Public auth endpoints implement their own checks where relevant.
    secureApi.use(csrf_1.csrfProtection);
    secureApi.use('/admin/users', adminUsers_1.adminUsersRouter);
    secureApi.use('/departments', departments_1.departmentsRouter);
    secureApi.use('/courses', courses_1.coursesRouter);
    secureApi.use('/student', student_1.studentRouter);
    secureApi.use('/lecturer', lecturer_1.lecturerRouter);
    secureApi.use('/admin/dashboard', adminDashboard_1.adminDashboardRouter);
    secureApi.use('/security', security_1.securityRouter);
    secureApi.use('/lab', lab_1.labRouter);
    secureApi.use('/kerberos', kerberos_1.kerberosRouter);
    secureApi.use((_req, _res, next) => next(new errors_1.ApiError(404, 'NOT_FOUND', 'API endpoint not found')));
    app.use('/api', secureApi);
    if (config_1.config.serveFrontend) {
        const indexPath = node_path_1.default.join(config_1.config.frontendDist, 'index.html');
        if (node_fs_1.default.existsSync(indexPath)) {
            app.use(express_1.default.static(config_1.config.frontendDist, {
                index: false,
                maxAge: '1y',
                immutable: true,
                setHeaders: (res, filePath) => {
                    if (filePath.endsWith('index.html')) {
                        res.setHeader('Cache-Control', 'no-store');
                        res.setHeader('Content-Security-Policy', securityHeaders_1.SPA_CONTENT_SECURITY_POLICY);
                    }
                },
            }));
            app.get('*', (req, res, next) => {
                if (req.path.startsWith('/api') || req.path === '/health' || node_path_1.default.extname(req.path)) {
                    next();
                    return;
                }
                // Helmet's restrictive API CSP runs globally; the HTML document needs
                // the SPA policy so its own JS/CSS bundles can load.
                res.setHeader('Content-Security-Policy', securityHeaders_1.SPA_CONTENT_SECURITY_POLICY);
                res.setHeader('Cache-Control', 'no-store');
                res.sendFile(indexPath);
            });
            logger_1.logger.info({ frontendDist: config_1.config.frontendDist }, 'Serving compiled SPA from Express');
        }
        else {
            logger_1.logger.warn({ frontendDist: config_1.config.frontendDist }, 'SERVE_FRONTEND is enabled but index.html was not found');
        }
    }
    app.use(errors_1.notFoundHandler);
    app.use(errors_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map