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
import { UnauthorizedError } from './errorHandler.js';
import type { AuthenticatedRequest } from '../types/index.js';

interface JwtPayload {
  id: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
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
 * Main authentication middleware
 * Verifies JWT and attaches user to request
 */
export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    // Verify token using access secret
    const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;

    // Ensure it's an access token, not a refresh token
    if (decoded.type && decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

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
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractToken(req);

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;

    // Ensure it's an access token
    if (decoded.type && decoded.type !== 'access') {
      return next();
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch {
    // Silently continue without authentication
    next();
  }
}

/**
 * Role-based authorization middleware
 * Must be used after authenticate middleware
 */
export function requireRole(...roles: string[]) {
  return (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new UnauthorizedError('Insufficient permissions'));
    }

    next();
  };
}

/**
 * Generate JWT token (legacy support for other parts of the app)
 */
export function generateToken(payload: { id: string; email: string; role?: string }): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
}

/**
 * Verify token without middleware (utility function)
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
  } catch {
    return null;
  }
}
