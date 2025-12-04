/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Implements comprehensive authorization for:
 * - Role-based route protection (PATIENT, PROVIDER, ADMIN)
 * - Resource ownership verification
 * - Provider-patient relationship access control
 */

import { Response, NextFunction } from 'express';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './errorHandler.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { getPrismaClient } from '../services/database.js';

// Role hierarchy - higher roles inherit permissions from lower roles
export const ROLE_HIERARCHY = {
  ADMIN: 3,
  PROVIDER: 2,
  PATIENT: 1,
} as const;

export type UserRole = keyof typeof ROLE_HIERARCHY;

// Resource types that can be protected
export type ResourceType = 'biomarker' | 'insurance' | 'dna' | 'healthNeed' | 'user' | 'providerPatient';

// Permission types
export type Permission = 'read' | 'write' | 'delete' | 'admin';

// Permission mapping for each role and resource
const ROLE_PERMISSIONS: Record<UserRole, Record<ResourceType, Permission[]>> = {
  PATIENT: {
    biomarker: ['read', 'write', 'delete'], // Own data only
    insurance: ['read', 'write', 'delete'], // Own data only
    dna: ['read', 'write', 'delete'], // Own data only
    healthNeed: ['read', 'write', 'delete'], // Own data only
    user: ['read', 'write'], // Own profile only
    providerPatient: ['read', 'write'], // Can manage own provider relationships
  },
  PROVIDER: {
    biomarker: ['read', 'write'], // Patients they have access to
    insurance: ['read'], // Limited access based on relationship
    dna: ['read'], // Limited access based on relationship
    healthNeed: ['read', 'write'], // Patients they have access to
    user: ['read', 'write'], // Own profile + limited patient info
    providerPatient: ['read', 'write', 'delete'], // Manage own patient relationships
  },
  ADMIN: {
    biomarker: ['read', 'write', 'delete', 'admin'],
    insurance: ['read', 'write', 'delete', 'admin'],
    dna: ['read', 'write', 'delete', 'admin'],
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
 * Verify resource ownership or authorized access
 * For patients: must own the resource
 * For providers: must have active relationship with patient who owns the resource
 * For admins: full access
 */
export function requireResourceAccess(resource: ResourceType, permission: Permission = 'read') {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;
    const userId = req.user.id;

    // Check basic permission first
    const permissions = ROLE_PERMISSIONS[userRole]?.[resource] || [];
    if (!permissions.includes(permission)) {
      return next(new ForbiddenError(`Permission denied: ${permission} on ${resource}`));
    }

    // Admins have full access
    if (userRole === 'ADMIN') {
      return next();
    }

    // Get resource owner ID from various sources
    const targetUserId = getTargetUserId(req);

    // If no target user specified, assume own resources
    if (!targetUserId) {
      return next();
    }

    // Patient accessing their own data
    if (userRole === 'PATIENT') {
      if (targetUserId !== userId) {
        return next(new ForbiddenError('You can only access your own data'));
      }
      return next();
    }

    // Provider accessing patient data
    if (userRole === 'PROVIDER') {
      const hasAccess = await checkProviderPatientAccess(userId, targetUserId, resource, permission);
      if (!hasAccess) {
        return next(new ForbiddenError('You do not have access to this patient\'s data'));
      }
      return next();
    }

    next();
  };
}

/**
 * Get target user ID from request (params, query, or body)
 */
function getTargetUserId(req: AuthenticatedRequest): string | null {
  // Check URL params
  if (req.params.userId) return req.params.userId;
  if (req.params.patientId) return req.params.patientId;

  // Check query string
  if (req.query.userId) return req.query.userId as string;
  if (req.query.patientId) return req.query.patientId as string;

  // Check request body
  if (req.body?.userId) return req.body.userId;
  if (req.body?.patientId) return req.body.patientId;

  return null;
}

/**
 * Check if provider has access to patient's data
 */
async function checkProviderPatientAccess(
  providerId: string,
  patientId: string,
  resource: ResourceType,
  permission: Permission
): Promise<boolean> {
  const prisma = getPrismaClient();

  const relationship = await prisma.providerPatient.findUnique({
    where: {
      providerId_patientId: {
        providerId,
        patientId,
      },
    },
  });

  // No relationship exists
  if (!relationship) {
    return false;
  }

  // Relationship must be active
  if (relationship.status !== 'ACTIVE') {
    return false;
  }

  // Check consent expiration
  if (relationship.consentExpiresAt && relationship.consentExpiresAt < new Date()) {
    return false;
  }

  // Check specific resource permissions using if/else to avoid break fallthrough issues
  if (resource === 'biomarker' || resource === 'healthNeed') {
    if (permission === 'read') return relationship.canViewBiomarkers;
    if (permission === 'write') return relationship.canEditData;
    return false;
  }

  if (resource === 'insurance') {
    if (permission === 'read') return relationship.canViewInsurance;
    return false;
  }

  if (resource === 'dna') {
    if (permission === 'read') return relationship.canViewDna;
    return false;
  }

  return false;
}

/**
 * Middleware to verify the authenticated user owns a specific resource
 * Used for specific resource operations (update, delete)
 */
export function requireOwnership(resourceGetter: (req: AuthenticatedRequest) => Promise<{ userId: string } | null>) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;

    // Admins bypass ownership check
    if (userRole === 'ADMIN') {
      return next();
    }

    try {
      const resource = await resourceGetter(req);

      if (!resource) {
        return next(new NotFoundError('Resource not found'));
      }

      const userId = req.user.id;
      const ownerId = resource.userId;

      // Direct ownership
      if (ownerId === userId) {
        return next();
      }

      // Provider access check
      if (userRole === 'PROVIDER') {
        const prisma = getPrismaClient();
        const relationship = await prisma.providerPatient.findUnique({
          where: {
            providerId_patientId: {
              providerId: userId,
              patientId: ownerId,
            },
          },
        });

        if (relationship && relationship.status === 'ACTIVE') {
          // Store relationship info for later use
          req.providerPatientRelationship = relationship;
          return next();
        }
      }

      return next(new ForbiddenError('You do not have access to this resource'));
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to ensure user can only access their own data
 * Adds userId filter to request for use in controllers
 */
export function enforceUserScope() {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as UserRole;

    // Admins can access all data
    if (userRole === 'ADMIN') {
      return next();
    }

    // Patients are scoped to their own data
    if (userRole === 'PATIENT') {
      req.userScope = {
        type: 'self',
        userId: req.user.id,
      };
      return next();
    }

    // Providers can access their own data or their patients' data
    if (userRole === 'PROVIDER') {
      req.userScope = {
        type: 'provider',
        providerId: req.user.id,
      };
      return next();
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

// Extend AuthenticatedRequest type
declare module '../types/index.js' {
  interface AuthenticatedRequest {
    userScope?: {
      type: 'self' | 'provider' | 'admin';
      userId?: string;
      providerId?: string;
    };
    providerPatientRelationship?: {
      id: string;
      providerId: string;
      patientId: string;
      canViewBiomarkers: boolean;
      canViewInsurance: boolean;
      canViewDna: boolean;
      canViewHealthNeeds: boolean;
      canEditData: boolean;
      status: string;
    };
  }
}
