"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTotpSecret = generateTotpSecret;
exports.buildOtpAuthUrl = buildOtpAuthUrl;
exports.generateTotpCode = generateTotpCode;
exports.verifyTotp = verifyTotp;
exports.verifyTotpStep = verifyTotpStep;
exports.generateBackupCodes = generateBackupCodes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const crypto_1 = require("./crypto");
const STEP_SECONDS = 30;
const DIGITS = 6;
function generateTotpSecret() {
    return (0, crypto_1.base32Encode)(node_crypto_1.default.randomBytes(20));
}
function buildOtpAuthUrl(secret, email, issuer = 'SSIMS University') {
    const label = encodeURIComponent(`${issuer}:${email}`);
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(STEP_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
function codeForCounter(secret, counter) {
    const key = (0, crypto_1.base32Decode)(secret);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    const digest = node_crypto_1.default.createHmac('sha1', key).update(buffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}
/**
 * Verify a TOTP with a ±1 time-step window for modest clock drift. Comparison
 * is constant-time. Replay prevention is provided by authenticating one login
 * at a time; production systems should additionally persist the last used step.
 */
function generateTotpCode(secret, now = Date.now()) {
    return codeForCounter(secret, Math.floor(now / 1000 / STEP_SECONDS));
}
function verifyTotp(secret, token, now = Date.now()) {
    return verifyTotpStep(secret, token, now) !== null;
}
/**
 * Returns the matched time-step so it can be persisted and the same code cannot
 * be replayed within its validity window.
 */
function verifyTotpStep(secret, token, now = Date.now()) {
    const normalized = token.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized))
        return null;
    const counter = Math.floor(now / 1000 / STEP_SECONDS);
    for (const offset of [-1, 0, 1]) {
        if ((0, crypto_1.safeEqual)(codeForCounter(secret, counter + offset), normalized))
            return counter + offset;
    }
    return null;
}
function generateBackupCodes(count = 10) {
    return Array.from({ length: count }, () => {
        const raw = (0, crypto_1.randomToken)(10).replace(/[-_]/g, '').slice(0, 10).toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}
//# sourceMappingURL=totp.js.map