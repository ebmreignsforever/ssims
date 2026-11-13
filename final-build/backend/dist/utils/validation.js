"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginationSchema = exports.idParamSchema = exports.uuidSchema = exports.passwordSchema = exports.emailSchema = void 0;
exports.cleanText = cleanText;
exports.sanitizeRequestValue = sanitizeRequestValue;
exports.clientIp = clientIp;
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const zod_1 = require("zod");
/** Strip tags/control characters from untrusted free text. Passwords are never sanitised. */
function cleanText(value, maxLength = 5000) {
    return (0, sanitize_html_1.default)(value, { allowedTags: [], allowedAttributes: {} })
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxLength);
}
const SENSITIVE_KEYS = new Set([
    'password',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'passwordconfirm',
    'token',
    'refreshtoken',
    'accesstoken',
    'secret',
    'signature',
    'authorization',
    'cookie',
    'mfasecret',
    'backupcode',
    'code',
    'answer',
]);
/**
 * Recursively sanitise incoming JSON. Sensitive credential fields are skipped so
 * legitimate password characters (e.g. "<" or "&") are preserved; those fields
 * are validated for strength and hashed, never rendered as HTML.
 */
function sanitizeRequestValue(value, key = '') {
    if (SENSITIVE_KEYS.has(key.toLowerCase()))
        return value;
    if (typeof value === 'string')
        return cleanText(value);
    if (Array.isArray(value))
        return value.map((item) => sanitizeRequestValue(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
            childKey,
            sanitizeRequestValue(child, childKey),
        ]));
    }
    return value;
}
exports.emailSchema = zod_1.z
    .string()
    .trim()
    .min(5)
    .max(254)
    .email('Enter a valid email address')
    .transform((value) => value.toLowerCase());
exports.passwordSchema = zod_1.z.string().min(12).max(128);
exports.uuidSchema = zod_1.z.string().uuid('Invalid identifier');
exports.idParamSchema = zod_1.z.object({ id: exports.uuidSchema });
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
function clientIp(value) {
    if (!value)
        return null;
    // Express resolves the trusted proxy chain; strip an IPv6-mapped prefix.
    const ip = value.replace(/^::ffff:/, '').split(',')[0].trim();
    return ip.length > 0 && ip.length <= 64 ? ip : null;
}
//# sourceMappingURL=validation.js.map