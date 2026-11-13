import crypto from 'node:crypto';
import { CookieOptions, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config, cookieNames } from '../config';
import { hmacSha256, randomToken, safeEqual } from '../utils/crypto';
import { unauthorized } from '../utils/errors';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  role: 'super_admin' | 'administrator' | 'lecturer' | 'student';
  sid: string;
  typ: 'access';
}

const issuer = 'ssims-api';
const audience = 'ssims-web';

export function signAccessToken(input: {
  userId: string;
  email: string;
  role: AccessTokenClaims['role'];
  sessionId: string;
}): { token: string; expiresIn: number } {
  const token = jwt.sign(
    { email: input.email, role: input.role, sid: input.sessionId, typ: 'access' },
    config.jwtAccessSecret,
    {
      subject: input.userId,
      expiresIn: config.accessTokenTtlSeconds,
      issuer,
      audience,
      algorithm: 'HS256',
    },
  );
  return { token, expiresIn: config.accessTokenTtlSeconds };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, config.jwtAccessSecret, {
      issuer,
      audience,
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string' || decoded.typ !== 'access' || !decoded.sub || !decoded.sid) {
      throw unauthorized('Invalid access token');
    }
    return decoded as AccessTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired');
    throw unauthorized('Invalid or expired access token');
  }
}

/** Opaque refresh token: high-entropy, hashed in the database, never a JWT. */
export function createRefreshToken(): { raw: string; hash: string } {
  const raw = randomToken(48);
  return { raw, hash: hmacSha256(config.cookieSecret, raw) };
}

export function hashRefreshToken(raw: string): string {
  return hmacSha256(config.cookieSecret, raw);
}

const refreshCookieBase: CookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, rawToken: string, maxAgeMs: number): void {
  // HttpOnly prevents JavaScript/XSS from reading the refresh credential. The
  // cookie is same-site and only sent to the auth endpoints that need it.
  res.cookie(cookieNames.refresh, rawToken, { ...refreshCookieBase, maxAge: maxAgeMs });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(cookieNames.refresh, refreshCookieBase);
}

/** Double-submit CSRF token: random nonce plus an HMAC that the server verifies. */
export function createCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString('base64url');
  return `${nonce}.${hmacSha256(config.cookieSecret, nonce)}`;
}

export function setCsrfCookie(res: Response, token: string): void {
  // Deliberately readable by the SPA so it can copy the value into a custom
  // header. Cross-origin attackers cannot read it because of the same-origin policy.
  res.cookie(cookieNames.csrf, token, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(cookieNames.csrf, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  });
}

export function isValidCsrfToken(token: string | undefined): boolean {
  if (!token) return false;
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature || nonce.length < 16) return false;
  return safeEqual(hmacSha256(config.cookieSecret, nonce), signature);
}
