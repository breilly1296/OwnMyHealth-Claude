/**
 * Role-Based Access Control Hook
 *
 * Provides utilities for checking user roles and permissions
 * in React components.
 */

import { useMemo } from 'react';
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

  const permissions = useMemo(() => {
    if (!role) {
      return {
        isPatient: false,
        isProvider: false,
        isAdmin: false,
        canViewPatients: false,
        canManageUsers: false,
        canViewAuditLogs: false,
        canAccessAdminPanel: false,
        canManageProviderAccess: false,
      };
    }

    const roleLevel = ROLE_HIERARCHY[role] || 0;

    return {
      isPatient: role === 'PATIENT',
      isProvider: role === 'PROVIDER',
      isAdmin: role === 'ADMIN',
      canViewPatients: roleLevel >= ROLE_HIERARCHY.PROVIDER, // Providers and admins
      canManageUsers: roleLevel >= ROLE_HIERARCHY.ADMIN, // Admins only
      canViewAuditLogs: roleLevel >= ROLE_HIERARCHY.ADMIN, // Admins only
      canAccessAdminPanel: roleLevel >= ROLE_HIERARCHY.ADMIN, // Admins only
      canManageProviderAccess: role === 'PATIENT', // Only patients manage their provider access
    };
  }, [role]);

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
    permissions,
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
