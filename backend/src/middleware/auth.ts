/**
 * Authentication Middleware
 *
 * Verifies JWT tokens from:
 * 1. HTTP-only cookies (preferred, more secure)
 * 2. Authorization header (for API clients)
 *
 * Access tokens are short-lived (15 min) and refresh tokens
 * are used to obtain new access tokens.
 */

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { JWT_VERIFY_OPTIONS } from '../config/jwtOptions.js';
import { UnauthorizedError } from './errorHandler.js';
import { isTokenRevoked, isAccessTokenStale } from '../services/authService.js';
import type { AuthenticatedRequest } from '../types/index.js';

interface JwtPayload {
  id: string;
  email: string;
  role: string;
  plan?: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  // M1: per-token id on access tokens, used for cross-instance single-device
  // revocation. Optional — tokens minted before M1 carry none.
  jti?: string;
}

/**
 * Extract token from request (cookie or header)
 * Priority: Cookie > Authorization Header
 */
function extractToken(req: AuthenticatedRequest): string | null {
  // 1. Check HTTP-only cookie first (more secure)
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }

  // 2. Fall back to Authorization header (for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Extract token from Authorization header ONLY — ignores cookies.
 *
 * This exists so that CSRF-exempt routes (today: the SSE chat stream) are
 * genuinely Bearer-only, not cookie-and-Bearer. The original exemption list
 * assumed "Bearer means no CSRF" but the base `authenticate` middleware
 * reads the cookie first — meaning a cookie-carrying cross-site request
 * would pass auth AND bypass CSRF at the same time. Routes that skip CSRF
 * must use this helper so that attack shape is impossible.
 */
function extractBearerToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Main authentication middleware
 * Verifies JWT and attaches user to request
 */
export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    // Reject explicitly-revoked tokens (logout / logout-all / password change).
    // The blacklist is the only thing that stops a still-valid access token
    // before its 15-min natural expiry, so this check MUST run on every
    // protected route — not just in the unused verifyAccessToken helper.
    if (isTokenRevoked(token)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    // Verify token using access secret
    const decoded = jwt.verify(token, config.jwt.accessSecret, JWT_VERIFY_OPTIONS) as JwtPayload;

    // Ensure it's an access token, not a refresh token
    if (decoded.type && decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Cross-instance revocation: reject any token issued before the user's
    // tokensValidAfter cutoff (logout-all / password change+reset / email
    // change / admin deactivation+role change on ANY replica). The in-memory
    // blacklist above only covers this instance. See authService.isAccessTokenStale.
    if (await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      // Tokens issued before plan was added to the payload won't have it;
      // fall back to FREE so the request still flows. New tokens get the
      // real plan.
      plan: decoded.plan || 'FREE',
    } as AuthenticatedRequest['user'];

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token has expired. Please refresh your session.'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

/**
 * Optional authentication middleware
 * Attaches user if valid token is present, but doesn't fail if absent
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token) {
      return next();
    }

    // A revoked token means "no authenticated user" for optional auth.
    if (isTokenRevoked(token)) {
      return next();
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret, JWT_VERIFY_OPTIONS) as JwtPayload;

    // Ensure it's an access token
    if (decoded.type && decoded.type !== 'access') {
      return next();
    }

    // Cross-instance revocation: a stale token means "no authenticated user"
    // for optional auth — drop the identity, don't fail the request.
    if (await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)) {
      return next();
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      // Tokens issued before plan was added to the payload won't have it;
      // fall back to FREE so the request still flows. New tokens get the
      // real plan.
      plan: decoded.plan || 'FREE',
    } as AuthenticatedRequest['user'];

    next();
  } catch {
    // Silently continue without authentication
    next();
  }
}

// Note: requireRole is exported from rbac.ts - use that instead for type-safe role checking

/**
 * Bearer-only authentication middleware.
 *
 * Use on routes that are intentionally CSRF-exempt — because `authenticate`
 * would accept the cookie path and reopen the CSRF hole that the exemption
 * assumed was closed. Today the only such route is `/ai/chat` (SSE streaming
 * can't ergonomically carry a CSRF header through `EventSource`).
 *
 * Semantics are otherwise identical to `authenticate`: verifies an access
 * JWT, rejects refresh tokens, attaches `req.user`.
 */
export async function requireBearerAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      throw new UnauthorizedError('Bearer token required');
    }

    // Reject explicitly-revoked tokens — see authenticate().
    if (isTokenRevoked(token)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret, JWT_VERIFY_OPTIONS) as JwtPayload;

    if (decoded.type && decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Cross-instance revocation — see authenticate(). Bearer routes (e.g. the
    // SSE chat stream) must honor the same tokensValidAfter cutoff.
    if (await isAccessTokenStale(decoded.id, decoded.iat, decoded.jti)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      plan: decoded.plan || 'FREE',
    } as AuthenticatedRequest['user'];

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token has expired. Please refresh your session.'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

// L22: the legacy generateToken()/verifyToken() helpers were removed. They had
// no production or test callers (verified by grep) and were a latent foot-gun:
// verifyToken did a bare jwt.verify with no isTokenRevoked / isAccessTokenStale
// check, so anything that started using it would have accepted revoked/stale
// access tokens that the real authenticate() path rejects. Token mint/verify now
// lives solely in authService (the revocation-aware path).
