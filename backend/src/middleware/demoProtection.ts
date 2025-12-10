/**
 * Demo Account Protection Middleware
 *
 * Prevents demo account from performing privileged operations:
 * - Role escalation (changing role to ADMIN)
 * - Modifying other user accounts
 * - Accessing admin-only features
 *
 * SECURITY: This is a critical security control to prevent demo accounts
 * from being used for unauthorized access.
 */

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './errorHandler.js';
import { config } from '../config/index.js';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Check if the current user is the demo account
 */
export function isDemoAccount(req: AuthenticatedRequest): boolean {
  return req.user?.email?.toLowerCase() === config.demo.email.toLowerCase();
}

/**
 * Middleware: Block demo users from role changes
 *
 * Apply to any route that could modify user roles.
 */
export function blockDemoRoleChange(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!isDemoAccount(req)) {
    return next();
  }

  // Check if request body contains role change attempt
  if (req.body?.role && req.body.role !== 'PATIENT') {
    throw new ForbiddenError(
      'Demo account cannot change roles. Please create a real account for full access.'
    );
  }

  next();
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
 * Middleware: Block demo users from modifying other users
 *
 * Apply to user management routes.
 */
export function blockDemoUserModification(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!isDemoAccount(req)) {
    return next();
  }

  // Get target user ID from params or body
  const targetUserId = req.params.userId || req.params.id || req.body?.userId;

  // Demo users can only modify their own data
  if (targetUserId && targetUserId !== req.user?.id) {
    throw new ForbiddenError(
      'Demo account cannot modify other users. Please create a real account.'
    );
  }

  next();
}

/**
 * Middleware: Apply all demo protections
 *
 * Combines all demo account restrictions into a single middleware.
 */
export function demoProtection(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!isDemoAccount(req)) {
    return next();
  }

  // Block role changes
  if (req.body?.role && req.body.role !== 'PATIENT') {
    throw new ForbiddenError(
      'Demo account cannot change roles. Please create a real account for full access.'
    );
  }

  // Block modifying other users
  const targetUserId = req.params.userId || req.params.id || req.body?.userId;
  if (targetUserId && targetUserId !== req.user?.id) {
    throw new ForbiddenError(
      'Demo account cannot modify other users. Please create a real account.'
    );
  }

  next();
}

export default demoProtection;
