"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeBody = sanitizeBody;
const validation_1 = require("../utils/validation");
/**
 * Defensive input sanitisation for free text. The API still validates every
 * field with Zod, uses parameterised SQL, and the React client escapes output.
 * Password/token fields are intentionally untouched so strong passwords with
 * punctuation are not silently altered.
 */
function sanitizeBody(req, _res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = (0, validation_1.sanitizeRequestValue)(req.body);
    }
    if (req.params && typeof req.params === 'object') {
        req.params = (0, validation_1.sanitizeRequestValue)(req.params);
    }
    next();
}
//# sourceMappingURL=sanitize.js.map