/**
 * CSRF Protection Middleware
 *
 * Implements Cross-Site Request Forgery protection for state-changing routes.
 * Uses the double-submit cookie pattern which is stateless and works with SPAs.
 *
 * SECURITY: CSRF attacks trick authenticated users into performing unwanted actions.
 * This middleware requires a CSRF token in headers that matches the cookie value.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ForbiddenError } from './errorHandler.js';
import { config } from '../config/index.js';

// CSRF token configuration
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;

/**
 * Generate a cryptographically secure CSRF token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Set CSRF cookie if not present
 * This should be called on GET requests to give the client a token
 */
export function setCsrfCookie(res: Response, token?: string): string {
  const csrfToken = token || generateCsrfToken();

  const cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    maxAge: number;
    domain?: string;
  } = {
    httpOnly: false, // Must be readable by JavaScript
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    // L26: tie the double-submit token lifetime to the session (refresh-token)
    // lifetime instead of an arbitrary fixed 24h. A new csrf_token is re-issued
    // on every successful /refresh, and the cookie is now cleared on logout
    // (clearAuthCookies), so it never outlives the session it protects.
    maxAge: config.cookie.maxAge.refreshToken,
  };

  // Add domain for cross-domain cookie sharing
  if (config.cookie.domain) {
    cookieOptions.domain = config.cookie.domain;
  }

  res.cookie(CSRF_COOKIE_NAME, csrfToken, cookieOptions);

  return csrfToken;
}

/**
 * Middleware: Ensure CSRF token cookie exists
 *
 * Apply to all routes - sets a CSRF token cookie if one doesn't exist.
 * The client should read this cookie and send it back in the X-CSRF-Token header.
 */
export function ensureCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only set token on GET requests (or if no token exists)
  if (req.method === 'GET' || !req.cookies[CSRF_COOKIE_NAME]) {
    setCsrfCookie(res);
  }
  next();
}

/**
 * Middleware: Validate CSRF token on state-changing requests
 *
 * Apply to POST, PUT, PATCH, DELETE routes.
 * Skips validation for:
 * - API routes that use bearer tokens (already protected by token auth)
 * - Public endpoints that don't change state
 */
export function validateCsrfToken(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Skip CSRF for non-state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // M-2: exemption checks now compare the NORMALIZED, fully-qualified request
  // path with strict `===` equality against a fixed allowlist. The previous
  // `req.path.endsWith(route)` was a suffix match — an attacker-controlled path
  // like `/api/v1/evil/auth/login` (or any route ending in an exempt suffix)
  // would have slipped past CSRF validation. `csrfProtection` is mounted at the
  // app root (app.use(csrfProtection), before the /api/v1 router), so req.path
  // here is the full path INCLUDING the /api/v1 prefix — the allowlist entries
  // are spelled out in that fully-qualified form.
  //
  // Normalize a trailing slash so `/api/v1/auth/login/` matches `/api/v1/auth/login`
  // (Express keeps the trailing slash in req.path). Empty string falls back to '/'.
  const normalizedPath = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;

  // Public auth routes (login, register, etc.) — no session to protect yet.
  // RT (Low): /api/v1/auth/refresh is intentionally NOT exempt. It is a
  // cookie-authenticated, state-changing endpoint (rotates the refresh session
  // and re-issues cookies), so exempting it from CSRF was a real CSRF hole.
  // The SPA double-submits X-CSRF-Token on /refresh and the refresh handler
  // re-issues a fresh csrf_token cookie via setCsrfCookie(res) on every
  // successful refresh, so the double-submit invariant holds across rotations.
  // The very first refresh is also safe: the client already obtained a
  // csrf_token cookie at login (login calls setCsrfCookie) — or from GET
  // /csrf-token — before any /refresh can occur, so removal does not break the
  // first refresh.
  const EXEMPT_PATHS = new Set<string>([
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/demo',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password',
    '/api/v1/auth/verify-email',
    '/api/v1/auth/resend-verification',
    // Bearer-only streaming route. Intentionally CSRF-exempt because SSE
    // (`EventSource`) can't attach a custom header, so CSRF tokens can't ride
    // along. SAFETY: this route MUST be mounted with `requireBearerAuth`
    // instead of `authenticate`, so the cookie-auth path is rejected at the
    // route layer. If you add a streaming route here without switching to
    // `requireBearerAuth`, you reopen a CSRF hole.
    '/api/v1/ai/chat',
    // Cloud Scheduler maintenance trigger (audit #38). Authenticated by a
    // shared-secret X-Cleanup-Token header (constant-time compared in the route
    // handler), not a session — so the double-submit CSRF cookie can't ride
    // along. Safe to exempt: it 404s unless the secret is configured.
    '/api/v1/internal/audit-cleanup',
  ]);

  // NOTE on upload routes: previously CSRF-exempt with a TODO. The
  // frontend's `services/uploadUtils.ts` reads csrf_token from the cookie
  // and attaches it as `X-CSRF-Token` on every upload (verified). The
  // exemption is now removed so any new upload path that forgets to pipe
  // through uploadUtils will fail closed instead of silently bypassing
  // CSRF protection.

  if (EXEMPT_PATHS.has(normalizedPath)) {
    return next();
  }

  // Skip in development if explicitly disabled
  if (config.isDevelopment && process.env.DISABLE_CSRF === 'true') {
    return next();
  }

  // Get token from cookie and header
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  // Validate tokens exist
  if (!cookieToken || !headerToken) {
    throw new ForbiddenError('CSRF token missing');
  }

  // Constant-time compare without leaking length via an early throw.
  // `timingSafeEqual` requires equal-length buffers; hashing both inputs
  // through SHA-256 first normalizes them to a fixed 32-byte length so the
  // comparison itself runs in constant time even when the two inputs are
  // different lengths. Pre-hash length is no longer observable via timing.
  const cookieDigest = crypto.createHash('sha256').update(cookieToken).digest();
  const headerDigest = crypto.createHash('sha256').update(headerToken).digest();
  const tokensMatch = crypto.timingSafeEqual(cookieDigest, headerDigest);

  if (!tokensMatch) {
    throw new ForbiddenError('Invalid CSRF token');
  }

  next();
}

/**
 * Combined CSRF middleware
 *
 * Ensures token exists and validates it on state-changing requests.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Ensure token cookie exists
  if (!req.cookies[CSRF_COOKIE_NAME]) {
    setCsrfCookie(res);
  }

  // Validate on state-changing requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return validateCsrfToken(req, res, next);
  }

  next();
}

/**
 * Endpoint: Get CSRF token
 *
 * Provides an endpoint for SPAs to fetch a new CSRF token.
 * Usage: GET /api/v1/csrf-token
 */
export function csrfTokenHandler(
  _req: Request,
  res: Response
): void {
  const token = setCsrfCookie(res);
  res.json({
    success: true,
    data: { csrfToken: token },
  });
}

export default csrfProtection;
