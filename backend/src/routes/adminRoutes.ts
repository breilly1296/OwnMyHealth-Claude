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
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, NotFoundError, ForbiddenError, BadRequestError } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPrismaClient } from '../services/database.js';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

// All routes require authentication and ADMIN role
router.use(authenticate);
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

    const [users, total] = await Promise.all([
      prisma.user.findMany({
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
      prisma.user.count({ where }),
    ]);

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

    const user = await prisma.user.findUnique({
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
            dnaData: true,
            sessions: true,
            auditLogs: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

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

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestError('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    const user = await prisma.user.create({
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

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('User not found');
    }

    const updateData: Record<string, unknown> = {};
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (emailVerified !== undefined) updateData.emailVerified = emailVerified;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
    }

    const user = await prisma.user.update({
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

    // Prevent self-deletion
    if (id === adminId) {
      throw new ForbiddenError('Cannot delete your own account');
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('User not found');
    }

    // Soft delete by deactivating
    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    // Also invalidate all sessions
    await prisma.session.deleteMany({ where: { userId: id } });

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
 */
router.delete(
  '/users/:id/permanent',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const { id } = req.params;
    const adminId = req.user!.id;
    const { confirmEmail } = req.body;

    // Prevent self-deletion
    if (id === adminId) {
      throw new ForbiddenError('Cannot delete your own account');
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('User not found');
    }

    // Require confirmation email
    if (confirmEmail !== existing.email) {
      throw new BadRequestError('Email confirmation does not match');
    }

    // Permanently delete user (cascades to related data)
    await prisma.user.delete({ where: { id } });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'User permanently deleted' },
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

    const relationships = await prisma.providerPatient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
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
    const { status, canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData } = req.body;

    const relationship = await prisma.providerPatient.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(canViewBiomarkers !== undefined && { canViewBiomarkers }),
        ...(canViewInsurance !== undefined && { canViewInsurance }),
        ...(canViewDna !== undefined && { canViewDna }),
        ...(canViewHealthNeeds !== undefined && { canViewHealthNeeds }),
        ...(canEditData !== undefined && { canEditData }),
      },
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
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();

    const [
      totalUsers,
      usersByRole,
      activeUsers,
      totalBiomarkers,
      totalInsurancePlans,
      totalHealthNeeds,
      recentLogins,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: true }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.biomarker.count(),
      prisma.insurancePlan.count(),
      prisma.healthNeed.count(),
      prisma.user.count({
        where: {
          lastLoginAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

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

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
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
      prisma.auditLog.count({ where }),
    ]);

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
