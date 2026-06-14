/**
 * authRoutes POST /logout — teardown finding #5 (HIPAA idle auto-logoff)
 * regression tests.
 *
 * Invariants under test:
 *   1. Logout with an EXPIRED access token but a valid refresh cookie still
 *      revokes the refresh session, clears cookies, and audits the logout
 *      attributed via the refresh-session lookup. (The old `authenticate`
 *      gate 401'd before the controller ran, leaving the 7-day refresh
 *      session alive — the idle logoff was silently undone on reload.)
 *   2. Logout with no cookies at all is idempotent: 200 + cleared cookies,
 *      no revocation calls.
 *   3. Logout with a live access token keeps today's behavior: access token
 *      revoked, refresh session revoked, audit attributed via req.user
 *      without a session-row lookup.
 *
 * Uses supertest against a minimal Express app mounting the REAL router and
 * REAL optionalAuth middleware (that tolerance is the fix under test), with
 * services mocked at the boundary. A second suite mounts the REAL global
 * csrfProtection middleware (app.ts parity) to prove the idle-fire logout
 * passes the double-submit check and that a missing CSRF header 403s.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks -------------------------------------------------------
const mocks = vi.hoisted(() => ({
  logAuth: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => true),
  revokeAccessToken: vi.fn(),
  revokeAccessTokenCrossInstance: vi.fn(async () => undefined),
  verifyRefreshToken: vi.fn(async () => null as unknown),
  isTokenRevoked: vi.fn(() => false),
  isAccessTokenStale: vi.fn(async () => false),
}));

vi.mock('../config/index.js', () => ({
  config: {
    isProduction: false,
    isDevelopment: true,
    jwt: {
      accessSecret: 'test-access-secret',
      refreshSecret: 'test-refresh-secret',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
    },
    cookie: {
      secure: false,
      sameSite: 'strict',
      domain: undefined,
      maxAge: { accessToken: 15 * 60 * 1000, refreshToken: 7 * 24 * 60 * 60 * 1000 },
    },
  },
}));

vi.mock('../services/authService.js', () => ({
  createUser: vi.fn(),
  hashPassword: vi.fn(),
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
  emailExists: vi.fn(),
  attemptLogin: vi.fn(),
  generateTokens: vi.fn(),
  validatePasswordStrength: vi.fn(),
  revokeRefreshToken: mocks.revokeRefreshToken,
  revokeAllUserTokens: vi.fn(),
  revokeAccessToken: mocks.revokeAccessToken,
  revokeAccessTokenCrossInstance: mocks.revokeAccessTokenCrossInstance,
  refreshTokens: vi.fn(),
  verifyRefreshToken: mocks.verifyRefreshToken,
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  isDemoUser: vi.fn(() => false),
  DEMO_SESSION_DURATION_MS: 30 * 24 * 60 * 60 * 1000,
  // Real optionalAuth (under test) reads these:
  isTokenRevoked: mocks.isTokenRevoked,
  isAccessTokenStale: mocks.isAccessTokenStale,
}));

vi.mock('../services/emailService.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendAccountExistsEmail: vi.fn(),
  sendEmailChangeConfirmation: vi.fn(),
  sendEmailChangeNotice: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAuth: mocks.logAuth,
  })),
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictAuthLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Keep the REAL csrfProtection (exercised by the app.ts-parity suite below);
// only setCsrfCookie is stubbed so controllers don't mint real cookies.
vi.mock('../middleware/csrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/csrf.js')>();
  return {
    ...actual,
    setCsrfCookie: vi.fn(),
  };
});

vi.mock('../utils/logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger, default: logger };
});

// -- Imports AFTER mocks -------------------------------------------------
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import authRouter from './authRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { csrfProtection } from '../middleware/csrf.js';
import { JWT_SIGN_OPTIONS } from '../config/jwtOptions.js';

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.use(errorHandler);
  return app;
}

function signAccessToken(expiresIn: string): string {
  return jwt.sign(
    { id: 'user-1', email: 'user1@example.com', role: 'PATIENT', plan: 'FREE', type: 'access' },
    'test-access-secret',
    { ...JWT_SIGN_OPTIONS, expiresIn }
  );
}

const REFRESH_COOKIE_VALUE = 'refresh-token-value';

function refreshSessionPayload() {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    role: 'PATIENT',
    plan: 'FREE',
    type: 'refresh' as const,
    jti: 'jti-1',
  };
}

function clearedCookieNames(res: request.Response): string[] {
  const setCookie = res.headers['set-cookie'] ?? [];
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  return headers
    .filter((h) => /Expires=Thu, 01 Jan 1970/i.test(h))
    .map((h) => h.split('=')[0]);
}

describe('POST /auth/logout (teardown #5 — idle logoff must end the session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTokenRevoked.mockReturnValue(false);
    mocks.isAccessTokenStale.mockResolvedValue(false);
    mocks.revokeRefreshToken.mockResolvedValue(true);
    mocks.verifyRefreshToken.mockResolvedValue(null);
  });

  it('revokes the refresh session with an EXPIRED access token (idle-fire path)', async () => {
    // At idle-fire the access token is ALWAYS expired (15-min idle timeout ==
    // access-token maxAge). The route must not 401 before revocation.
    const expiredAccessToken = signAccessToken('-1s');
    mocks.verifyRefreshToken.mockResolvedValue(refreshSessionPayload());

    const res = await request(buildApp())
      .post('/api/v1/auth/logout')
      .set('Cookie', [
        `access_token=${expiredAccessToken}`,
        `refresh_token=${REFRESH_COOKIE_VALUE}`,
      ])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    // Server-side session revoked — the 7-day refresh cookie can't resurrect it.
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(REFRESH_COOKIE_VALUE);
    // Expired access token still pushed onto the blacklist (harmless, kept).
    expect(mocks.revokeAccessToken).toHaveBeenCalledWith(expiredAccessToken);
    // M1: cross-instance revocation invoked with the verified identity from the
    // refresh-session lookup (req.user is absent on the expired-token path).
    // The helper itself no-ops for an already-expired token; the controller's
    // job is just to attempt it with the right user id.
    expect(mocks.revokeAccessTokenCrossInstance).toHaveBeenCalledWith(expiredAccessToken, 'user-1');

    // Both auth cookies cleared.
    expect(clearedCookieNames(res)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token'])
    );

    // Audit attributed via the refresh-session lookup (req.user is absent).
    expect(mocks.verifyRefreshToken).toHaveBeenCalledWith(REFRESH_COOKIE_VALUE);
    expect(mocks.logAuth).toHaveBeenCalledWith(
      'LOGOUT',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ email: 'user1@example.com' })
    );
  });

  it('succeeds idempotently with no cookies at all', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/logout').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
    expect(mocks.verifyRefreshToken).not.toHaveBeenCalled();
    // No access token present → nothing to revoke cross-instance.
    expect(mocks.revokeAccessTokenCrossInstance).not.toHaveBeenCalled();
    // Cookies still cleared so a stale/unknown cookie set never survives.
    expect(clearedCookieNames(res)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token'])
    );
    // Unattributed audit entry per existing pattern.
    expect(mocks.logAuth).toHaveBeenCalledWith(
      'LOGOUT',
      expect.objectContaining({ userId: undefined }),
      expect.objectContaining({ email: undefined })
    );
  });

  it('still succeeds when the refresh cookie is unknown to the server', async () => {
    mocks.verifyRefreshToken.mockResolvedValue(null);
    mocks.revokeRefreshToken.mockResolvedValue(false);

    const res = await request(buildApp())
      .post('/api/v1/auth/logout')
      .set('Cookie', [`refresh_token=garbage`])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith('garbage');
    expect(clearedCookieNames(res)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token'])
    );
  });

  it('keeps the live-access-token path: attributes via req.user without a session lookup', async () => {
    const liveAccessToken = signAccessToken('15m');

    const res = await request(buildApp())
      .post('/api/v1/auth/logout')
      .set('Cookie', [
        `access_token=${liveAccessToken}`,
        `refresh_token=${REFRESH_COOKIE_VALUE}`,
      ])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mocks.revokeAccessToken).toHaveBeenCalledWith(liveAccessToken);
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(REFRESH_COOKIE_VALUE);
    // M1: cross-instance revocation invoked with the verified req.user identity.
    expect(mocks.revokeAccessTokenCrossInstance).toHaveBeenCalledWith(liveAccessToken, 'user-1');
    // req.user resolved by optionalAuth — no DB session lookup needed.
    expect(mocks.verifyRefreshToken).not.toHaveBeenCalled();
    expect(mocks.logAuth).toHaveBeenCalledWith(
      'LOGOUT',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ email: 'user1@example.com' })
    );
  });
});

describe('POST /auth/logout behind the REAL global csrfProtection (app.ts parity)', () => {
  // The suite above mounts only the router; the real app mounts csrfProtection
  // at the app root BEFORE the /api/v1 router (app.ts), and /api/v1/auth/logout
  // is NOT in the CSRF exempt list. These tests prove the idle-fire logout
  // survives the double-submit check end-to-end — and that the check still
  // fails closed when the header is absent.
  function buildAppWithCsrf() {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(csrfProtection); // REAL middleware, mirrors app.ts mounting order
    app.use('/api/v1/auth', authRouter);
    app.use(errorHandler);
    return app;
  }

  const CSRF_TOKEN = 'csrf-double-submit-token-value';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTokenRevoked.mockReturnValue(false);
    mocks.isAccessTokenStale.mockResolvedValue(false);
    mocks.revokeRefreshToken.mockResolvedValue(true);
    mocks.verifyRefreshToken.mockResolvedValue(null);
    // The real validateCsrfToken short-circuits when isDevelopment &&
    // DISABLE_CSRF=true; pin it off so a local .env can't skip the check.
    vi.stubEnv('DISABLE_CSRF', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('idle-fire logout (expired access token + refresh cookie + double-submit CSRF) passes', async () => {
    const expiredAccessToken = signAccessToken('-1s');
    mocks.verifyRefreshToken.mockResolvedValue(refreshSessionPayload());

    const res = await request(buildAppWithCsrf())
      .post('/api/v1/auth/logout')
      .set('Cookie', [
        `access_token=${expiredAccessToken}`,
        `refresh_token=${REFRESH_COOKIE_VALUE}`,
        `csrf_token=${CSRF_TOKEN}`,
      ])
      .set('x-csrf-token', CSRF_TOKEN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(REFRESH_COOKIE_VALUE);
    expect(clearedCookieNames(res)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token'])
    );
  });

  it('403s when the x-csrf-token header is missing (logout is NOT CSRF-exempt)', async () => {
    const expiredAccessToken = signAccessToken('-1s');

    const res = await request(buildAppWithCsrf())
      .post('/api/v1/auth/logout')
      .set('Cookie', [
        `access_token=${expiredAccessToken}`,
        `refresh_token=${REFRESH_COOKIE_VALUE}`,
        `csrf_token=${CSRF_TOKEN}`,
      ])
      .send({});

    expect(res.status).toBe(403);
    // Fails closed BEFORE the controller — nothing revoked.
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
    expect(mocks.revokeAccessToken).not.toHaveBeenCalled();
  });
});
