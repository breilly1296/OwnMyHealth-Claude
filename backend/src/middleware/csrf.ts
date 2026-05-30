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
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
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

  // Skip CSRF for auth routes that are public (login, register, etc.)
  // These don't have a session to protect yet
  const publicAuthRoutes = [
    '/auth/login',
    '/auth/register',
    '/auth/demo',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/resend-verification',
    '/marketplace/plans/search',
  ];

  // Bearer-only streaming routes. These are intentionally CSRF-exempt
  // because SSE (`EventSource`) can't attach a custom header, so CSRF
  // tokens can't ride along. SAFETY: every route in this list MUST be
  // mounted with `requireBearerAuth` instead of `authenticate`, so the
  // cookie-auth path is rejected at the route layer. If you add to this
  // list without switching to `requireBearerAuth`, you reopen a CSRF hole.
  const bearerOnlyStreamingRoutes = [
    '/ai/chat',
  ];

  // NOTE on upload routes: previously CSRF-exempt with a TODO. The
  // frontend's `services/uploadUtils.ts` reads csrf_token from the cookie
  // and attaches it as `X-CSRF-Token` on every upload (verified). The
  // exemption is now removed so any new upload path that forgets to pipe
  // through uploadUtils will fail closed instead of silently bypassing
  // CSRF protection.

  const isPublicAuthRoute = publicAuthRoutes.some(route =>
    req.path.endsWith(route)
  );

  const isBearerOnlyStreamingRoute = bearerOnlyStreamingRoutes.some(route =>
    req.path.endsWith(route)
  );

  // Cloud Scheduler maintenance trigger (audit #38). Authenticated by a
  // shared-secret X-Cleanup-Token header (constant-time compared in the route
  // handler), not a session — so the double-submit CSRF cookie can't ride
  // along. Safe to exempt: it 404s unless the secret is configured.
  const isSchedulerRoute = req.path.endsWith('/internal/audit-cleanup');

  if (isPublicAuthRoute || isBearerOnlyStreamingRoute || isSchedulerRoute) {
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
