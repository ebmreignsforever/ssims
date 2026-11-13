import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth';
import { labLimiter, labProbeLimiter } from '../middleware/rateLimit';
import { asyncHandler, notFound } from '../utils/errors';
import { recordRequestEvent } from '../services/auditService';
import { LAB_TESTS, listLabRuns, resetLabAccount, runLabTest } from '../services/labService';

export const labRouter = Router();

labRouter.get(
  '/catalog',
  requirePermission('lab:run'),
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: LAB_TESTS });
  }),
);

labRouter.get(
  '/results',
  requirePermission('lab:run'),
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit ?? 30);
    res.json({ success: true, data: await listLabRuns(limit) });
  }),
);

const testKeySchema = z.object({
  testKey: z.enum(['sql-injection', 'brute-force', 'xss', 'unauthorized-access', 'mitm', 'csrf', 'webhook-forgery', 'ddos']),
});

labRouter.post(
  '/run/:testKey',
  requirePermission('lab:run'),
  labLimiter,
  asyncHandler(async (req, res) => {
    const { testKey } = testKeySchema.parse(req.params);
    const result = await runLabTest(testKey, req);
    res.json({ success: true, data: result });
  }),
);

labRouter.post(
  '/reset-account',
  requirePermission('lab:run'),
  asyncHandler(async (req, res) => {
    await resetLabAccount();
    await recordRequestEvent(req, {
      eventType: 'LAB_ACCOUNT_RESET',
      severity: 'low',
      description: 'Security laboratory target account restored to active status',
    });
    res.json({ success: true, data: { message: 'Laboratory target account restored' } });
  }),
);

/**
 * Dedicated endpoint for the controlled DDoS demonstration. It deliberately has
 * a very small 8-request/10-second bucket. The parent lab runner calls this
 * endpoint 12 times over loopback to observe real 429 responses.
 */
labRouter.get(
  '/probe',
  requirePermission('lab:run'),
  labProbeLimiter,
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        probe: 'ok',
        message: 'Controlled rate-limit probe accepted',
        timestamp: new Date().toISOString(),
      },
    });
  }),
);

labRouter.use((_req, _res, next) => next(notFound('Unknown laboratory endpoint')));
