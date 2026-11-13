"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kerberosRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const auditService_1 = require("../services/auditService");
const kerberosSimulation_1 = require("../services/kerberosSimulation");
exports.kerberosRouter = (0, express_1.Router)();
exports.kerberosRouter.post('/simulate', (0, auth_1.requirePermission)('kerberos:demo'), (0, errors_1.asyncHandler)(async (req, res) => {
    const result = (0, kerberosSimulation_1.runKerberosSimulation)();
    await (0, auditService_1.recordRequestEvent)(req, {
        eventType: 'KERBEROS_SIMULATION_RUN',
        severity: 'info',
        description: 'Educational Kerberos authentication simulation executed',
        metadata: { result: result.result, simulation: true },
    });
    res.json({ success: true, data: result });
}));
//# sourceMappingURL=kerberos.js.map