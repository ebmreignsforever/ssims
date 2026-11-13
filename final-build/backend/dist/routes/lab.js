"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.labRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const errors_1 = require("../utils/errors");
const auditService_1 = require("../services/auditService");
const labService_1 = require("../services/labService");
exports.labRouter = (0, express_1.Router)();
exports.labRouter.get('/catalog', (0, auth_1.requirePermission)('lab:run'), (0, errors_1.asyncHandler)(async (_req, res) => {
    res.json({ success: true, data: labService_1.LAB_TESTS });
}));
exports.labRouter.get('/results', (0, auth_1.requirePermission)('lab:run'), (0, errors_1.asyncHandler)(async (req, res) => {
    const limit = zod_1.z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit ?? 30);
    res.json({ success: true, data: await (0, labService_1.listLabRuns)(limit) });
}));
const testKeySchema = zod_1.z.object({
    testKey: zod_1.z.enum(['sql-injection', 'brute-force', 'xss', 'unauthorized-access', 'mitm', 'csrf', 'webhook-forgery', 'ddos']),
});
exports.labRouter.post('/run/:testKey', (0, auth_1.requirePermission)('lab:run'), rateLimit_1.labLimiter, (0, errors_1.asyncHandler)(async (req, res) => {
    const { testKey } = testKeySchema.parse(req.params);
    const result = await (0, labService_1.runLabTest)(testKey, req);
    res.json({ success: true, data: result });
}));
exports.labRouter.post('/reset-account', (0, auth_1.requirePermission)('lab:run'), (0, errors_1.asyncHandler)(async (req, res) => {
    await (0, labService_1.resetLabAccount)();
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'LAB_ACCOUNT_RESET',
        severity: 'low',
        description: 'Security laboratory target account restored to active status',
    });
    res.json({ success: true, data: { message: 'Laboratory target account restored' } });
}));
/**
 * Dedicated endpoint for the controlled DDoS demonstration. It deliberately has
 * a very small 8-request/10-second bucket. The parent lab runner calls this
 * endpoint 12 times over loopback to observe real 429 responses.
 */
exports.labRouter.get('/probe', (0, auth_1.requirePermission)('lab:run'), rateLimit_1.labProbeLimiter, (0, errors_1.asyncHandler)(async (_req, res) => {
    res.json({
        success: true,
        data: {
            probe: 'ok',
            message: 'Controlled rate-limit probe accepted',
            timestamp: new Date().toISOString(),
        },
    });
}));
exports.labRouter.use((_req, _res, next) => next((0, errors_1.notFound)('Unknown laboratory endpoint')));
//# sourceMappingURL=lab.js.map