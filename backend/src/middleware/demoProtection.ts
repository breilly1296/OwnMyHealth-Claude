/**
 * Demo Account Protection Middleware
 *
 * Prevents the demo account from performing privileged operations: admin
 * access, profile/notification mutations, and AI features. Applied per-route
 * via blockDemoAdminAccess / blockDemoProfileUpdate / blockDemoAI. (Demo
 * role-change and cross-user modification are already covered by those guards
 * plus the PATIENT-only role gate, so no standalone middleware is needed.)
 *
 * SECURITY: a critical control preventing demo accounts from unauthorized use.
 */

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './errorHandler.js';
import { config } from '../config/index.js';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    plan: string;
  };
}

/**
 * Check if the current user is the demo account.
 *
 * SECURITY: If DEMO_EMAIL is unset (config.demo.email === ''), no one is a
 * demo user. Without this guard an unset DEMO_EMAIL in production could match
 * any user with an empty req.user.email.
 */
export function isDemoAccount(req: AuthenticatedRequest): boolean {
  if (!config.demo.email || config.demo.email.trim() === '') return false;
  return req.user?.email?.toLowerCase() === config.demo.email.toLowerCase();
}

/**
 * Middleware: Block demo users from admin actions
 *
 * Apply to admin-only routes.
 */
export function blockDemoAdminAccess(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (isDemoAccount(req)) {
    throw new ForbiddenError(
      'Demo account does not have admin access. Please create a real account.'
    );
  }
  next();
}

/**
 * Middleware: Block demo users from modifying their own profile
 *
 * Apply to profile-mutation routes (e.g., PATCH /settings/profile,
 * PATCH /settings/notifications) so demo state stays consistent across sessions.
 */
export function blockDemoProfileUpdate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (isDemoAccount(req)) {
    throw new ForbiddenError(
      'Demo account cannot modify profile. Please create a real account.'
    );
  }
  next();
}

/**
 * Middleware: Block demo users from AI features
 *
 * Prevents anonymous API cost generation via demo accounts.
 * Apply to all AI-powered endpoints (guidance, extraction, analysis).
 */
export function blockDemoAI(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (isDemoAccount(req)) {
    throw new ForbiddenError(
      'AI features are not available in demo mode. Please create a real account.'
    );
  }
  next();
}
