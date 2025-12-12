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

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // Must be readable by JavaScript
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

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

  const isPublicAuthRoute = publicAuthRoutes.some(route =>
    req.path.endsWith(route)
  );

  if (isPublicAuthRoute) {
    return next();
  }

  // Skip in development if explicitly disabled
  if (config.isDevelopment && process.env.DISABLE_CSRF === 'true') {
    return next();
  }

  // Get token from cookie and header
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  // Validate tokens exist and match
  if (!cookieToken || !headerToken) {
    throw new ForbiddenError('CSRF token missing');
  }

  // Use timing-safe comparison to prevent timing attacks
  if (cookieToken.length !== headerToken.length) {
    throw new ForbiddenError('Invalid CSRF token');
  }

  const tokensMatch = crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  );

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
