"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestContext = requestContext;
const node_crypto_1 = __importDefault(require("node:crypto"));
function requestContext(req, res, next) {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[a-zA-Z0-9-]{8,80}$/.test(incoming) ? incoming : node_crypto_1.default.randomUUID();
    req.requestId = requestId;
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}
//# sourceMappingURL=requestContext.js.map