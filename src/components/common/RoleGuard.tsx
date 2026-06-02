/**
 * Role Guard Component
 *
 * Conditionally renders children based on user role.
 * Can be used to protect UI elements from unauthorized users.
 *
 * STATUS (audit L-18): These guard components and the `useRBAC` hook are
 * currently UNUSED by any rendered component — UI role gating is done inline in
 * Dashboard (nav filter + the defensive recheck in renderSpecialPage). They are
 * retained, not deleted, only because they are re-exported through the barrels
 * `components/common/index.ts` and `hooks/index.ts`, which are outside this
 * change's edit scope; removing the files would break those re-exports and the
 * build. RECOMMENDED FOLLOW-UP: in a barrel-inclusive change, either delete
 * RoleGuard.tsx + useRBAC.ts and drop their barrel exports, or actually wire
 * these guards into the UI. Note: client-side role gating is cosmetic only —
 * the backend RBAC middleware is the real authorization boundary.
 */

import React from 'react';
import { useRBAC } from '../../hooks/useRBAC';
import type { UserRole } from '../../services/api';

interface RoleGuardProps {
  /** Allow these specific roles */
  roles?: UserRole[];
  /** Require at least this role level (uses hierarchy) */
  minRole?: UserRole;
  /** Component to render if access denied (defaults to null) */
  fallback?: React.ReactNode;
  /** Content to render if access granted */
  children: React.ReactNode;
}

/**
 * Guards children based on user role
 *
 * @example
 * // Only admins can see this
 * <RoleGuard roles={['ADMIN']}>
 *   <AdminPanel />
 * </RoleGuard>
 *
 * @example
 * // Providers and admins can see this
 * <RoleGuard minRole="PROVIDER">
 *   <PatientList />
 * </RoleGuard>
 *
 * @example
 * // Show different content for unauthorized users
 * <RoleGuard roles={['ADMIN']} fallback={<AccessDenied />}>
 *   <AdminPanel />
 * </RoleGuard>
 */
export function RoleGuard({ roles, minRole, fallback = null, children }: RoleGuardProps) {
  const { hasRole, hasMinRole, isAuthenticated } = useRBAC();

  // Must be authenticated
  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  // Check specific roles
  if (roles && roles.length > 0) {
    if (!hasRole(...roles)) {
      return <>{fallback}</>;
    }
  }

  // Check minimum role level
  if (minRole) {
    if (!hasMinRole(minRole)) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}

/**
 * Shows content only for patients
 */
export function PatientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <RoleGuard roles={['PATIENT']} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

/**
 * Shows content only for providers
 */
export function ProviderOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <RoleGuard roles={['PROVIDER']} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

/**
 * Shows content only for admins
 */
export function AdminOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <RoleGuard roles={['ADMIN']} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

/**
 * Shows content for providers and admins
 */
export function ProviderOrAdmin({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <RoleGuard minRole="PROVIDER" fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

/**
 * Role Badge Component
 * Displays the user's role as a styled badge
 */
export function RoleBadge({ className = '' }: { className?: string }) {
  const { role, getRoleLabel, getRoleBadgeClasses } = useRBAC();

  if (!role) return null;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getRoleBadgeClasses()} ${className}`}>
      {getRoleLabel()}
    </span>
  );
}
