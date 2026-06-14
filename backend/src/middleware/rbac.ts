/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Role-based route protection (PATIENT, PROVIDER, ADMIN): requireRole and the
 * requireMinRole / requirePermission / adminOnly / providerOrAdmin helpers.
 *
 * Provider-patient *resource* access is NOT enforced here. It lives in
 * services/providerAccess.ts (resolveProviderAccess), which the provider routes
 * call directly. An earlier parallel implementation in this file
 * (requireResourceAccess / requireOwnership / checkProviderPatientAccess /
 * enforceUserScope) was unmounted on every route and gave false assurance via
 * green-but-unexercised tests — removed in the L-26 cleanup (2026-06-14).
 */

import { Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from './errorHandler.js';
import type { AuthenticatedRequest } from '../types/index.js';

// Role hierarchy - higher roles inherit permissions from lower roles
export const ROLE_HIERARCHY = {
  ADMIN: 3,
  PROVIDER: 2,
  PATIENT: 1,
} as const;

export type UserRole = keyof typeof ROLE_HIERARCHY;

// Resource types that can be protected
export type ResourceType = 'biomarker' | 'insurance' | 'healthNeed' | 'user' | 'providerPatient';

// Permission types
export type Permission = 'read' | 'write' | 'delete' | 'admin';

// Permission mapping for each role and resource
const ROLE_PERMISSIONS: Record<UserRole, Record<ResourceType, Permission[]>> = {
  PATIENT: {
    biomarker: ['read', 'write', 'delete'], // Own data only
    insurance: ['read', 'write', 'delete'], // Own data only
    healthNeed: ['read', 'write', 'delete'], // Own data only
    user: ['read', 'write'], // Own profile only
    providerPatient: ['read', 'write'], // Can manage own provider relationships
  },
  PROVIDER: {
    biomarker: ['read', 'write'], // Patients they have access to
    insurance: ['read'], // Limited access based on relationship
    healthNeed: ['read', 'write'], // Patients they have access to
    user: ['read', 'write'], // Own profile + limited patient info
    providerPatient: ['read', 'write', 'delete'], // Manage own patient relationships
  },
  ADMIN: {
    biomarker: ['read', 'write', 'delete', 'admin'],
    insurance: ['read', 'write', 'delete', 'admin'],
    healthNeed: ['read', 'write', 'delete', 'admin'],
    user: ['read', 'write', 'delete', 'admin'],
    providerPatient: ['read', 'write', 'delete', 'admin'],
  },
};

/**
 * Check if user has required role(s)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;

    if (!allowedRoles.includes(userRole)) {
      return next(new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`));
    }

    next();
  };
}

/**
 * Check if user has minimum role level (uses hierarchy)
 */
export function requireMinRole(minRole: UserRole) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole];

    if (userLevel < requiredLevel) {
      return next(new ForbiddenError(`Access denied. Minimum role required: ${minRole}`));
    }

    next();
  };
}

/**
 * Check if user has permission for a resource type
 */
export function requirePermission(resource: ResourceType, permission: Permission) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;
    const permissions = ROLE_PERMISSIONS[userRole]?.[resource] || [];

    if (!permissions.includes(permission)) {
      return next(new ForbiddenError(`Permission denied: ${permission} on ${resource}`));
    }

    next();
  };
}

/**
 * Admin-only middleware
 */
export function adminOnly() {
  return requireRole('ADMIN');
}

/**
 * Provider or Admin middleware
 */
export function providerOrAdmin() {
  return requireRole('PROVIDER', 'ADMIN');
}
