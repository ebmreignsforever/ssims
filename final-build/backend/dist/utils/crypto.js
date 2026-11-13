"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.randomToken = randomToken;
exports.sha256 = sha256;
exports.pepperedHash = pepperedHash;
exports.hmacSha256 = hmacSha256;
exports.safeEqual = safeEqual;
exports.base32Encode = base32Encode;
exports.base32Decode = base32Decode;
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../config");
/**
 * AES-256-GCM authenticated encryption for secrets that must be recoverable by
 * the server (currently TOTP shared secrets). A unique random IV is generated
 * for every value; the authentication tag detects tampering. Output format:
 *   v1.<iv base64url>.<authTag base64url>.<ciphertext base64url>
 */
function encryptSecret(plaintext) {
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv('aes-256-gcm', config_1.config.mfaEncryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}
function decryptSecret(value) {
    const [version, ivPart, tagPart, cipherPart] = value.split('.');
    if (version !== 'v1' || !ivPart || !tagPart || !cipherPart) {
        throw new Error('Unsupported encrypted secret format');
    }
    const decipher = node_crypto_1.default.createDecipheriv('aes-256-gcm', config_1.config.mfaEncryptionKey, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(cipherPart, 'base64url')), decipher.final()]).toString('utf8');
}
function randomToken(bytes = 32) {
    return node_crypto_1.default.randomBytes(bytes).toString('base64url');
}
function sha256(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
/** Keyed hash for high-entropy tokens, reset tokens and backup codes. */
function pepperedHash(value, purpose) {
    return node_crypto_1.default.createHmac('sha256', config_1.config.challengeSecret).update(`${purpose}:${value}`, 'utf8').digest('hex');
}
function hmacSha256(secret, payload) {
    return node_crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
}
function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(left, right);
}
/** RFC 4648 base32 without padding, used by authenticator applications. */
function base32Encode(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        output += alphabet[(value << (5 - bits)) & 31];
    return output;
}
function base32Decode(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = input.replace(/=+$/g, '').toUpperCase();
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const character of clean) {
        const index = alphabet.indexOf(character);
        if (index === -1)
            throw new Error('Invalid base32 character');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}
//# sourceMappingURL=crypto.js.map