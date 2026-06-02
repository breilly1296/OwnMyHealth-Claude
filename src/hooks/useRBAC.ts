/**
 * Role-Based Access Control Hook
 *
 * Provides utilities for checking user roles and permissions
 * in React components.
 */

import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../services/api';

// Role hierarchy - higher includes all lower permissions
const ROLE_HIERARCHY: Record<UserRole, number> = {
  ADMIN: 3,
  PROVIDER: 2,
  PATIENT: 1,
};

export function useRBAC() {
  const { user, isAuthenticated } = useAuth();

  const role = (user?.role as UserRole) || null;

  // NOTE: A `permissions` capability-flags object (canViewPatients,
  // canManageUsers, isAdmin, …) previously lived here but was never consumed by
  // any caller (audit L-28). It was removed as dead code. Client-side
  // capability flags are advisory only regardless — the backend RBAC middleware
  // is the real authorization boundary. If UI gating is needed again, derive it
  // from `role` / `hasRole` / `hasMinRole` at the call site rather than
  // reintroducing a parallel flag set that can drift from the role hierarchy.

  /**
   * Check if user has at least one of the specified roles
   */
  const hasRole = (...roles: UserRole[]): boolean => {
    if (!role) return false;
    return roles.includes(role);
  };

  /**
   * Check if user has at least the minimum role level
   */
  const hasMinRole = (minRole: UserRole): boolean => {
    if (!role) return false;
    const userLevel = ROLE_HIERARCHY[role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole];
    return userLevel >= requiredLevel;
  };

  /**
   * Get role display label
   */
  const getRoleLabel = (): string => {
    switch (role) {
      case 'ADMIN':
        return 'Administrator';
      case 'PROVIDER':
        return 'Healthcare Provider';
      case 'PATIENT':
        return 'Patient';
      default:
        return 'Unknown';
    }
  };

  /**
   * Get role badge color classes
   */
  const getRoleBadgeClasses = (): string => {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'PROVIDER':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'PATIENT':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return {
    role,
    isAuthenticated,
    hasRole,
    hasMinRole,
    getRoleLabel,
    getRoleBadgeClasses,
  };
}

// Type for protected component props
export interface ProtectedProps {
  roles?: UserRole[];
  minRole?: UserRole;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}
