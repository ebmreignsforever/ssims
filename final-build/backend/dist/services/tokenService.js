"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
exports.createRefreshToken = createRefreshToken;
exports.hashRefreshToken = hashRefreshToken;
exports.setRefreshCookie = setRefreshCookie;
exports.clearRefreshCookie = clearRefreshCookie;
exports.createCsrfToken = createCsrfToken;
exports.setCsrfCookie = setCsrfCookie;
exports.clearCsrfCookie = clearCsrfCookie;
exports.isValidCsrfToken = isValidCsrfToken;
const node_crypto_1 = __importDefault(require("node:crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const crypto_1 = require("../utils/crypto");
const errors_1 = require("../utils/errors");
const issuer = 'ssims-api';
const audience = 'ssims-web';
function signAccessToken(input) {
    const token = jsonwebtoken_1.default.sign({ email: input.email, role: input.role, sid: input.sessionId, typ: 'access' }, config_1.config.jwtAccessSecret, {
        subject: input.userId,
        expiresIn: config_1.config.accessTokenTtlSeconds,
        issuer,
        audience,
        algorithm: 'HS256',
    });
    return { token, expiresIn: config_1.config.accessTokenTtlSeconds };
}
function verifyAccessToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwtAccessSecret, {
            issuer,
            audience,
            algorithms: ['HS256'],
        });
        if (typeof decoded === 'string' || decoded.typ !== 'access' || !decoded.sub || !decoded.sid) {
            throw (0, errors_1.unauthorized)('Invalid access token');
        }
        return decoded;
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError)
            throw (0, errors_1.unauthorized)('Access token expired');
        throw (0, errors_1.unauthorized)('Invalid or expired access token');
    }
}
/** Opaque refresh token: high-entropy, hashed in the database, never a JWT. */
function createRefreshToken() {
    const raw = (0, crypto_1.randomToken)(48);
    return { raw, hash: (0, crypto_1.hmacSha256)(config_1.config.cookieSecret, raw) };
}
function hashRefreshToken(raw) {
    return (0, crypto_1.hmacSha256)(config_1.config.cookieSecret, raw);
}
const refreshCookieBase = {
    httpOnly: true,
    secure: config_1.config.cookieSecure,
    sameSite: 'strict',
    path: '/api/auth',
};
function setRefreshCookie(res, rawToken, maxAgeMs) {
    // HttpOnly prevents JavaScript/XSS from reading the refresh credential. The
    // cookie is same-site and only sent to the auth endpoints that need it.
    res.cookie(config_1.cookieNames.refresh, rawToken, { ...refreshCookieBase, maxAge: maxAgeMs });
}
function clearRefreshCookie(res) {
    res.clearCookie(config_1.cookieNames.refresh, refreshCookieBase);
}
/** Double-submit CSRF token: random nonce plus an HMAC that the server verifies. */
function createCsrfToken() {
    const nonce = node_crypto_1.default.randomBytes(24).toString('base64url');
    return `${nonce}.${(0, crypto_1.hmacSha256)(config_1.config.cookieSecret, nonce)}`;
}
function setCsrfCookie(res, token) {
    // Deliberately readable by the SPA so it can copy the value into a custom
    // header. Cross-origin attackers cannot read it because of the same-origin policy.
    res.cookie(config_1.cookieNames.csrf, token, {
        httpOnly: false,
        secure: config_1.config.cookieSecure,
        sameSite: 'strict',
        path: '/',
        maxAge: config_1.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    });
}
function clearCsrfCookie(res) {
    res.clearCookie(config_1.cookieNames.csrf, {
        httpOnly: false,
        secure: config_1.config.cookieSecure,
        sameSite: 'strict',
        path: '/',
    });
}
function isValidCsrfToken(token) {
    if (!token)
        return false;
    const [nonce, signature] = token.split('.');
    if (!nonce || !signature || nonce.length < 16)
        return false;
    return (0, crypto_1.safeEqual)((0, crypto_1.hmacSha256)(config_1.config.cookieSecret, nonce), signature);
}
//# sourceMappingURL=tokenService.js.map