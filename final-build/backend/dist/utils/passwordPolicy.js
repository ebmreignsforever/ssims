"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordProblems = passwordProblems;
exports.assertStrongPassword = assertStrongPassword;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.needsRehash = needsRehash;
const argon2_1 = __importDefault(require("argon2"));
const commonPasswords_1 = require("./commonPasswords");
const errors_1 = require("./errors");
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;
// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1).
const ARGON_OPTIONS = {
    type: argon2_1.default.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
};
function passwordProblems(password, context = {}) {
    const problems = [];
    if (password.length < MIN_LENGTH)
        problems.push(`Password must be at least ${MIN_LENGTH} characters`);
    if (password.length > MAX_LENGTH)
        problems.push(`Password must not exceed ${MAX_LENGTH} characters`);
    if (!/[A-Z]/.test(password))
        problems.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password))
        problems.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password))
        problems.push('Password must contain a number');
    if (!/[^A-Za-z0-9]/.test(password))
        problems.push('Password must contain a special character');
    const normalized = password.toLowerCase();
    if (commonPasswords_1.COMMON_PASSWORDS.has(normalized)) {
        problems.push('This password appears on a list of commonly compromised passwords');
    }
    // Block obvious keyboard patterns and repeated characters.
    if (/(.)\1{4,}/.test(password))
        problems.push('Password must not contain a long repeated character sequence');
    if (/12345|qwerty|password|letmein|welcome|admin/i.test(password)) {
        problems.push('Password contains a commonly abused word or sequence');
    }
    if (context.email) {
        const localPart = context.email.split('@')[0].toLowerCase();
        if (localPart.length >= 3 && normalized.includes(localPart)) {
            problems.push('Password must not contain your email address');
        }
    }
    if (context.fullName) {
        for (const part of context.fullName.toLowerCase().split(/\s+/)) {
            if (part.length >= 3 && normalized.includes(part)) {
                problems.push('Password must not contain your name');
                break;
            }
        }
    }
    return [...new Set(problems)];
}
function assertStrongPassword(password, context = {}) {
    const problems = passwordProblems(password, context);
    if (problems.length > 0) {
        throw (0, errors_1.badRequest)('Password does not meet the security policy', { password: problems });
    }
}
async function hashPassword(password) {
    // Argon2id creates a unique salt automatically and embeds parameters in the hash.
    return argon2_1.default.hash(password, ARGON_OPTIONS);
}
async function verifyPassword(hash, password) {
    try {
        return await argon2_1.default.verify(hash, password);
    }
    catch {
        return false;
    }
}
async function needsRehash(hash) {
    try {
        return argon2_1.default.needsRehash(hash, ARGON_OPTIONS);
    }
    catch {
        return true;
    }
}
//# sourceMappingURL=passwordPolicy.js.map