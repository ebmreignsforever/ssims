import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { pool } from './db/pool';
import { authenticate } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { ipAccessControl } from './middleware/ipRules';
import { globalApiLimiter } from './middleware/rateLimit';
import { sanitizeBody } from './middleware/sanitize';
import { requestContext } from './middleware/requestContext';
import { SPA_CONTENT_SECURITY_POLICY, securityHeaders } from './middleware/securityHeaders';
import { ApiError, errorHandler, notFoundHandler } from './utils/errors';
import { logger } from './utils/logger';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { webhookRouter } from './routes/webhooks';
import { adminUsersRouter } from './routes/adminUsers';
import { departmentsRouter } from './routes/departments';
import { coursesRouter } from './routes/courses';
import { studentRouter } from './routes/student';
import { lecturerRouter } from './routes/lecturer';
import { adminDashboardRouter } from './routes/adminDashboard';
import { securityRouter } from './routes/security';
import { labRouter } from './routes/lab';
import { kerberosRouter } from './routes/kerberos';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  // Only trust the first hop (Nginx). Never trust arbitrary client-supplied
  // X-Forwarded-For values for rate limiting or audit IP attribution.
  app.set('trust proxy', config.trustProxy);

  app.use(requestContext);
  app.use(securityHeaders);
  // CORS is only meaningful for API calls. Applying it globally also filters
  // same-origin module-script/style requests for /assets/*, which browsers send
  // with an Origin header when the SPA is served by Express. Keep static assets
  // outside the CORS policy; API requests still enforce the exact origin list.
  app.use(
    '/api',
    cors({
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new ApiError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(cookieParser(config.cookieSecret));

  app.use(
    express.json({
      limit: '100kb',
      type: ['application/json', 'application/*+json'],
      verify: (req: Request, _res: Response, buffer: Buffer) => {
        // Raw bytes are required for HMAC verification of signed webhooks.
        req.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(sanitizeBody);

  // Lightweight structured request logging, without bodies, cookies, auth headers
  // or query strings. Request IDs correlate logs with security events.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          ip: req.ip,
        },
        'HTTP request',
      );
    });
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      const result = await pool.query<{ ssl: boolean }>(
        'SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl',
      );
      res.json({
        status: 'ok',
        service: 'ssims-api',
        database: 'connected',
        databaseTls: Boolean(result.rows[0]?.ssl),
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'ssims-api', database: 'unavailable' });
    }
  });

  // All browser API traffic passes through the global limiter and the network
  // access policy before authentication. The webhook endpoint is signature-based
  // and mounted separately; it is still rate limited inside its router.
  app.use('/api', globalApiLimiter, ipAccessControl);
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/webhooks', webhookRouter);

  const secureApi = express.Router();
  secureApi.use(authenticate);
  // The double-submit CSRF check applies to every unsafe method on protected
  // API routes. Public auth endpoints implement their own checks where relevant.
  secureApi.use(csrfProtection);
  secureApi.use('/admin/users', adminUsersRouter);
  secureApi.use('/departments', departmentsRouter);
  secureApi.use('/courses', coursesRouter);
  secureApi.use('/student', studentRouter);
  secureApi.use('/lecturer', lecturerRouter);
  secureApi.use('/admin/dashboard', adminDashboardRouter);
  secureApi.use('/security', securityRouter);
  secureApi.use('/lab', labRouter);
  secureApi.use('/kerberos', kerberosRouter);
  secureApi.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'API endpoint not found')));
  app.use('/api', secureApi);

  if (config.serveFrontend) {
    const indexPath = path.join(config.frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      app.use(
        express.static(config.frontendDist, {
          index: false,
          maxAge: '1y',
          immutable: true,
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
              res.setHeader('Content-Security-Policy', SPA_CONTENT_SECURITY_POLICY);
            }
          },
        }),
      );
      app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api') || req.path === '/health' || path.extname(req.path)) {
          next();
          return;
        }
        // Helmet's restrictive API CSP runs globally; the HTML document needs
        // the SPA policy so its own JS/CSS bundles can load.
        res.setHeader('Content-Security-Policy', SPA_CONTENT_SECURITY_POLICY);
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(indexPath);
      });
      logger.info({ frontendDist: config.frontendDist }, 'Serving compiled SPA from Express');
    } else {
      logger.warn({ frontendDist: config.frontendDist }, 'SERVE_FRONTEND is enabled but index.html was not found');
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
