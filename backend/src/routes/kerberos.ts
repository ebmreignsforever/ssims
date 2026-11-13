import { Router } from 'express';
import { requirePermission } from '../middleware/auth';
import { asyncHandler } from '../utils/errors';
import { recordRequestEvent } from '../services/auditService';
import { runKerberosSimulation } from '../services/kerberosSimulation';

export const kerberosRouter = Router();

kerberosRouter.post(
  '/simulate',
  requirePermission('kerberos:demo'),
  asyncHandler(async (req, res) => {
    const result = runKerberosSimulation();
    await recordRequestEvent(req, {
      eventType: 'KERBEROS_SIMULATION_RUN',
      severity: 'info',
      description: 'Educational Kerberos authentication simulation executed',
      metadata: { result: result.result, simulation: true },
    });
    res.json({ success: true, data: result });
  }),
);
