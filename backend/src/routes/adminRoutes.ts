/**
 * Admin Routes
 *
 * Routes for system administrators to:
 * - Manage users (CRUD operations)
 * - View system statistics
 * - Manage roles and permissions
 * - View audit logs
 */

import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { blockDemoAdminAccess } from '../middleware/demoProtection.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import { sensitiveLimiter } from '../middleware/rateLimiter.js';
import { getPrismaClient, withRLSContext } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

// All routes require authentication and ADMIN role.
// blockDemoAdminAccess runs between auth and RBAC so demo accounts are rejected
// before any role check, even if a demo user's role were ever elevated (F-5).
router.use(authenticate);
router.use(blockDemoAdminAccess);
router.use(requireRole('ADMIN'));

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * GET /api/v1/admin/users
 * List all users with pagination and filtering
 */
router.get(
  '/users',
  validate(schemas.admin.listUsersQuery, 'query'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const role = req.query.role as string;
    const search = req.query.search as string;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.email = { contains: search, mode: 'insensitive' };
    }

    // C-8 Part 2b-ii — admin context belt-and-suspenders on top of the
    // requireRole('ADMIN') RBAC gate at router.use().
    const { users, total } = await withRLSContext(
      null,
      async (tx) => {
        const [users, total] = await Promise.all([
          tx.user.findMany({
            where,
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
              emailVerified: true,
              createdAt: true,
              lastLoginAt: true,
              _count: {
                select: {
                  biomarkers: true,
                  insurancePlans: true,
                  healthNeeds: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          tx.user.count({ where }),
        ]);
        return { users, total };
      },
      { isAdmin: true }
    );

    // Audit log: Admin listing users
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('admin_user_list', undefined, { req, userId: req.user!.id }, {
      operation: 'LIST',
      actorType: 'ADMIN',
      count: users.length,
      filterRole: role,
      filterSearch: search,
      filterIsActive: isActive,
      page,
      limit,
    });

    const response: ApiResponse<{
      users: typeof users;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }> = {
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
    res.json(response);
  })
);

/**
 * GET /api/v1/admin/users/:id
 * Get detailed user information
 */
router.get(
  '/users/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;

    const user = await withRLSContext(
      null,
      async (tx) => {
        return tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            lastLoginAt: true,
            _count: {
              select: {
                biomarkers: true,
                insurancePlans: true,
                healthNeeds: true,
                sessions: true,
                auditLogs: true,
              },
            },
          },
        });
      },
      { isAdmin: true }
    );

    const auditService = getAuditLogService(prisma);

    if (!user) {
      // Audit log: Failed user detail access — user not found
      await auditService.logAccess('admin_user_detail', id, { req, userId: req.user!.id }, {
        operation: 'VIEW',
        actorType: 'ADMIN',
        success: false,
        reason: 'user_not_found',
      });
      throw new NotFoundError('User not found');
    }

    // Audit log: Admin viewed user detail
    await auditService.logAccess('admin_user_detail', id, { req, userId: req.user!.id }, {
      operation: 'VIEW',
      actorType: 'ADMIN',
      targetUserId: id,
      targetEmail: user.email,
      targetRole: user.role,
    });

    const response: ApiResponse<typeof user> = {
      success: true,
      data: user,
    };
    res.json(response);
  })
);

/**
 * POST /api/v1/admin/users
 * Create a new user (admin can create any role)
 */
router.post(
  '/users',
  validate(schemas.admin.createUser),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { email, password, role, isActive = true, emailVerified = false } = req.body;

    // Hash password (CPU-only, outside transaction)
    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    const user = await withRLSContext(
      null,
      async (tx) => {
        // Check if email already exists — throws roll back the transaction.
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          throw new BadRequestError('Email already registered');
        }

        return tx.user.create({
          data: {
            email,
            passwordHash,
            role: role || 'PATIENT',
            isActive,
            emailVerified,
          },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
          },
        });
      },
      { isAdmin: true }
    );

    // Audit log: Admin created a new user
    const auditService = getAuditLogService(prisma);
    await auditService.logCreate('admin_user', user.id, {
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    }, { req, userId: req.user!.id }, {
      operation: 'CREATE',
      actorType: 'ADMIN',
      targetUserId: user.id,
      targetRole: user.role,
    });

    const response: ApiResponse<typeof user> = {
      success: true,
      data: user,
    };
    res.status(201).json(response);
  })
);

/**
 * PATCH /api/v1/admin/users/:id
 * Update user information
 */
router.patch(
  '/users/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.admin.updateUser),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;
    const { role, isActive, emailVerified, password } = req.body;

    // Prevent admin from modifying their own role
    if (id === adminId && role) {
      throw new ForbiddenError('Cannot modify your own role');
    }

    const auditService = getAuditLogService(prisma);

    // Pre-hash password (CPU-only, outside tx)
    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (emailVerified !== undefined) updateData.emailVerified = emailVerified;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
    }

    // Existence check inside wrapper — throw rolls back; we return the not-found
    // shape via a discriminated union so the audit-not-found log stays outside.
    const result = await withRLSContext(
      null,
      async (tx) => {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing) {
          return { found: false as const };
        }

        const user = await tx.user.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            updatedAt: true,
          },
        });

        // F-41 fix: when an admin resets a user's password, every existing
        // session for that user must be invalidated so the affected account
        // is forced to re-authenticate with the new credential. Without
        // this, an attacker with a compromised password (the very reason
        // an admin reset would happen) keeps a valid refresh token and
        // can outrun the password change. Same transaction so the rotation
        // is atomic with the hash update.
        let revokedSessionCount = 0;
        if (password) {
          const result = await tx.session.deleteMany({ where: { userId: id } });
          revokedSessionCount = result.count;
        }

        return { found: true as const, existing, user, revokedSessionCount };
      },
      { isAdmin: true }
    );

    if (!result.found) {
      // Audit log: Failed user update — user not found
      await auditService.logAccess('admin_user', id, { req, userId: adminId }, {
        operation: 'UPDATE',
        actorType: 'ADMIN',
        success: false,
        reason: 'user_not_found',
      });
      throw new NotFoundError('User not found');
    }
    const { existing, user, revokedSessionCount } = result;

    // Determine if this is a role/permission change (elevated audit significance)
    const isRoleChange = role !== undefined && role !== existing.role;
    const operation = isRoleChange ? 'PERMISSION_CHANGE' : 'UPDATE';

    // Audit log: Admin updated user (captures previous and new state)
    await auditService.logUpdate('admin_user', id, {
      role: existing.role,
      isActive: existing.isActive,
      emailVerified: existing.emailVerified,
    }, {
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      passwordChanged: !!password,
    }, { req, userId: adminId }, {
      operation,
      actorType: 'ADMIN',
      targetUserId: id,
      targetEmail: existing.email,
      // Surface the count of sessions wiped on password reset so an admin
      // reviewing audit history can see the cascading invalidation actually
      // ran (and notice if a future regression silently drops it to 0).
      ...(password && { revokedSessionCount }),
      ...(isRoleChange && { previousRole: existing.role, newRole: role }),
    });

    const response: ApiResponse<typeof user> = {
      success: true,
      data: user,
    };
    res.json(response);
  })
);

/**
 * DELETE /api/v1/admin/users/:id
 * Delete a user (soft delete by deactivating)
 */
router.delete(
  '/users/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;

    const auditService = getAuditLogService(prisma);

    // Prevent self-deletion
    if (id === adminId) {
      // Audit log: Admin attempted self-deactivation
      await auditService.logAccess('admin_user_status', id, { req, userId: adminId }, {
        operation: 'DEACTIVATE',
        actorType: 'ADMIN',
        success: false,
        reason: 'self_deletion_blocked',
      });
      throw new ForbiddenError('Cannot delete your own account');
    }

    // Lookup first; audit log the found case outside the tx, then do the
    // mutations atomically.
    const existing = await withRLSContext(
      null,
      async (tx) => tx.user.findUnique({ where: { id } }),
      { isAdmin: true }
    );

    if (!existing) {
      // Audit log: Failed deactivation — user not found
      await auditService.logAccess('admin_user_status', id, { req, userId: adminId }, {
        operation: 'DEACTIVATE',
        actorType: 'ADMIN',
        success: false,
        reason: 'user_not_found',
      });
      throw new NotFoundError('User not found');
    }

    // Audit log: Admin deactivating user (log before change)
    await auditService.logUpdate('admin_user_status', id, {
      isActive: existing.isActive,
      email: existing.email,
      role: existing.role,
    }, {
      isActive: false,
      sessionsInvalidated: true,
    }, { req, userId: adminId }, {
      operation: 'DEACTIVATE',
      actorType: 'ADMIN',
      targetUserId: id,
      targetEmail: existing.email,
      targetRole: existing.role,
    });

    // Soft delete + session invalidation share a transaction for atomicity.
    await withRLSContext(
      null,
      async (tx) => {
        await tx.user.update({
          where: { id },
          data: { isActive: false },
        });
        await tx.session.deleteMany({ where: { userId: id } });
      },
      { isAdmin: true }
    );

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'User deactivated successfully' },
    };
    res.json(response);
  })
);

/**
 * DELETE /api/v1/admin/users/:id/permanent
 * Permanently delete a user and all their data
 * Rate limited to 10/hour due to destructive nature
 */
router.delete(
  '/users/:id/permanent',
  sensitiveLimiter,
  validate(schemas.uuidParam, 'params'),
  validate(schemas.admin.permanentDelete),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;
    const { confirmEmail } = req.body as { confirmEmail: string };

    const auditService = getAuditLogService(prisma);

    // Prevent self-deletion
    if (id === adminId) {
      // Audit log: Admin attempted self-permanent-deletion
      await auditService.logAccess('admin_user_permanent', id, { req, userId: adminId }, {
        operation: 'PERMANENT_DELETE',
        actorType: 'ADMIN',
        success: false,
        reason: 'self_deletion_blocked',
      });
      throw new ForbiddenError('Cannot delete your own account');
    }

    const existing = await withRLSContext(
      null,
      async (tx) => tx.user.findUnique({ where: { id } }),
      { isAdmin: true }
    );
    if (!existing) {
      // Audit log: Failed permanent delete — user not found
      await auditService.logAccess('admin_user_permanent', id, { req, userId: adminId }, {
        operation: 'PERMANENT_DELETE',
        actorType: 'ADMIN',
        success: false,
        reason: 'user_not_found',
      });
      throw new NotFoundError('User not found');
    }

    // Require confirmation email
    if (confirmEmail !== existing.email) {
      // Audit log: Failed permanent delete — email confirmation mismatch
      await auditService.logAccess('admin_user_permanent', id, { req, userId: adminId }, {
        operation: 'PERMANENT_DELETE',
        actorType: 'ADMIN',
        success: false,
        reason: 'email_confirmation_mismatch',
      });
      throw new BadRequestError('Email confirmation does not match');
    }

    // Audit log: Admin permanently deleting user (CRITICAL — log before deletion)
    await auditService.logDelete('admin_user_permanent', id, {
      email: existing.email,
      role: existing.role,
      isActive: existing.isActive,
      emailVerified: existing.emailVerified,
      createdAt: existing.createdAt,
    }, { req, userId: adminId }, {
      operation: 'PERMANENT_DELETE',
      actorType: 'ADMIN',
      targetUserId: id,
      targetEmail: existing.email,
      targetRole: existing.role,
    });

    // Permanently delete user (cascades to related data)
    await withRLSContext(
      null,
      async (tx) => {
        await tx.user.delete({ where: { id } });
      },
      { isAdmin: true }
    );

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'User permanently deleted' },
    };
    res.json(response);
  })
);

/**
 * PATCH /api/v1/admin/users/:id/plan
 * Manually change a user's subscription plan. Used for beta upgrades and
 * comped accounts before the Stripe webhook path exists.
 *
 * Body:
 *   { "plan": "PRO", "expiresAt": "2026-12-31T00:00:00Z" | null | undefined }
 *
 * expiresAt semantics:
 *   - omitted/undefined → clear any existing expiry (plan is permanent)
 *   - null              → same as omitted (explicit clear)
 *   - ISO string        → auto-downgrade target timestamp
 */
router.patch(
  '/users/:id/plan',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.admin.updateUserPlan),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;
    const { plan, expiresAt } = req.body as { plan: 'FREE' | 'PRO' | 'TEAM'; expiresAt?: string | null };

    const auditService = getAuditLogService(prisma);

    const result = await withRLSContext(
      null,
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { id },
          select: { id: true, email: true, plan: true, planExpiresAt: true },
        });
        if (!existing) {
          return { found: false as const };
        }

        const user = await tx.user.update({
          where: { id },
          data: {
            plan,
            planExpiresAt: expiresAt ? new Date(expiresAt) : null,
            planUpdatedAt: new Date(),
          },
          select: {
            id: true,
            email: true,
            plan: true,
            planExpiresAt: true,
            planUpdatedAt: true,
          },
        });

        return { found: true as const, existing, user };
      },
      { isAdmin: true }
    );

    if (!result.found) {
      await auditService.logAccess('admin_user_plan', id, { req, userId: adminId }, {
        operation: 'PLAN_CHANGE',
        actorType: 'ADMIN',
        success: false,
        reason: 'user_not_found',
      });
      throw new NotFoundError('User not found');
    }
    const { existing, user } = result;

    // Plan changes are permission-adjacent (they gate features/spend), so
    // log them as SETTINGS_CHANGE-level events with before/after state.
    await auditService.logUpdate(
      'admin_user_plan',
      id,
      { plan: existing.plan, planExpiresAt: existing.planExpiresAt },
      { plan: user.plan, planExpiresAt: user.planExpiresAt },
      { req, userId: adminId },
      {
        operation: 'PLAN_CHANGE',
        actorType: 'ADMIN',
        targetUserId: id,
        targetEmail: existing.email,
        previousPlan: existing.plan,
        newPlan: user.plan,
      }
    );

    const response: ApiResponse<typeof user> = {
      success: true,
      data: user,
    };
    res.json(response);
  })
);

// ============================================
// PROVIDER RELATIONSHIP MANAGEMENT
// ============================================

/**
 * GET /api/v1/admin/provider-relationships
 * List all provider-patient relationships
 */
router.get(
  '/provider-relationships',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const status = req.query.status as string;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const relationships = await withRLSContext(
      null,
      async (tx) => tx.providerPatient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      { isAdmin: true }
    );

    // Audit log: Admin listing provider-patient relationships
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('admin_provider_relationship', undefined, { req, userId: req.user!.id }, {
      operation: 'LIST',
      actorType: 'ADMIN',
      count: relationships.length,
      filterStatus: status,
    });

    const response: ApiResponse<typeof relationships> = {
      success: true,
      data: relationships,
    };
    res.json(response);
  })
);

/**
 * PATCH /api/v1/admin/provider-relationships/:id
 * Update a provider-patient relationship
 */
router.patch(
  '/provider-relationships/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;
    const { status, canViewBiomarkers, canViewInsurance, canViewHealthNeeds, canEditData } = req.body;

    const auditService = getAuditLogService(prisma);

    // Fetch + update inside a single admin transaction.
    const result = await withRLSContext(
      null,
      async (tx) => {
        const existing = await tx.providerPatient.findUnique({ where: { id } });
        if (!existing) {
          return { found: false as const };
        }
        const relationship = await tx.providerPatient.update({
          where: { id },
          data: {
            ...(status && { status }),
            ...(canViewBiomarkers !== undefined && { canViewBiomarkers }),
            ...(canViewInsurance !== undefined && { canViewInsurance }),
            ...(canViewHealthNeeds !== undefined && { canViewHealthNeeds }),
            ...(canEditData !== undefined && { canEditData }),
          },
        });
        return { found: true as const, existing, relationship };
      },
      { isAdmin: true }
    );

    if (!result.found) {
      // Audit log: Failed relationship update — not found
      await auditService.logAccess('admin_provider_relationship', id, { req, userId: adminId }, {
        operation: 'UPDATE',
        actorType: 'ADMIN',
        success: false,
        reason: 'relationship_not_found',
      });
      throw new NotFoundError('Provider-patient relationship not found');
    }
    const { existing, relationship } = result;

    // Audit log: Admin updated provider-patient relationship
    await auditService.logUpdate('admin_provider_relationship', id, {
      status: existing.status,
      canViewBiomarkers: existing.canViewBiomarkers,
      canViewInsurance: existing.canViewInsurance,
      canViewHealthNeeds: existing.canViewHealthNeeds,
      canEditData: existing.canEditData,
    }, {
      status: relationship.status,
      canViewBiomarkers: relationship.canViewBiomarkers,
      canViewInsurance: relationship.canViewInsurance,
      canViewHealthNeeds: relationship.canViewHealthNeeds,
      canEditData: relationship.canEditData,
    }, { req, userId: adminId }, {
      operation: 'UPDATE',
      actorType: 'ADMIN',
      providerId: existing.providerId,
      patientId: existing.patientId,
    });

    const response: ApiResponse<typeof relationship> = {
      success: true,
      data: relationship,
    };
    res.json(response);
  })
);

// ============================================
// SYSTEM STATISTICS
// ============================================

/**
 * GET /api/v1/admin/stats
 * Get system-wide statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();

    // All 7 count/groupBy queries share one admin transaction for consistency.
    const {
      totalUsers,
      usersByRole,
      activeUsers,
      totalBiomarkers,
      totalInsurancePlans,
      totalHealthNeeds,
      recentLogins,
    } = await withRLSContext(
      null,
      async (tx) => {
        const [
          totalUsers,
          usersByRole,
          activeUsers,
          totalBiomarkers,
          totalInsurancePlans,
          totalHealthNeeds,
          recentLogins,
        ] = await Promise.all([
          tx.user.count(),
          tx.user.groupBy({ by: ['role'], _count: true }),
          tx.user.count({ where: { isActive: true } }),
          tx.biomarker.count(),
          tx.insurancePlan.count(),
          tx.healthNeed.count(),
          tx.user.count({
            where: {
              lastLoginAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
              },
            },
          }),
        ]);
        return {
          totalUsers,
          usersByRole,
          activeUsers,
          totalBiomarkers,
          totalInsurancePlans,
          totalHealthNeeds,
          recentLogins,
        };
      },
      { isAdmin: true }
    );

    const stats = {
      users: {
        total: totalUsers,
        active: activeUsers,
        byRole: usersByRole.reduce(
          (acc, { role, _count }) => ({ ...acc, [role]: _count }),
          {} as Record<string, number>
        ),
        recentLogins,
      },
      data: {
        biomarkers: totalBiomarkers,
        insurancePlans: totalInsurancePlans,
        healthNeeds: totalHealthNeeds,
      },
    };

    // Audit log: Admin viewed system statistics
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('admin_system_stats', undefined, { req, userId: req.user!.id }, {
      operation: 'VIEW',
      actorType: 'ADMIN',
    });

    const response: ApiResponse<typeof stats> = {
      success: true,
      data: stats,
    };
    res.json(response);
  })
);

// ============================================
// AUDIT LOGS
// ============================================

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs with filtering
 */
router.get(
  '/audit-logs',
  validate(schemas.admin.auditLogQuery, 'query'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const userId = req.query.userId as string;
    const action = req.query.action as string;
    const resourceType = req.query.resourceType as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }

    const { logs, total } = await withRLSContext(
      null,
      async (tx) => {
        const [logs, total] = await Promise.all([
          tx.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              user: {
                select: { id: true, email: true, role: true },
              },
            },
          }),
          tx.auditLog.count({ where }),
        ]);
        return { logs, total };
      },
      { isAdmin: true }
    );

    // Audit log: Admin viewed audit logs (meta-audit: who is watching the watchers)
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('admin_audit_logs', undefined, { req, userId: req.user!.id }, {
      operation: 'VIEW',
      actorType: 'ADMIN',
      count: logs.length,
      filterUserId: userId,
      filterAction: action,
      filterResourceType: resourceType,
      filterStartDate: startDate,
      filterEndDate: endDate,
      page,
      limit,
    });

    const response: ApiResponse<{
      logs: typeof logs;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }> = {
      success: true,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
    res.json(response);
  })
);

export default router;
