/**
 * Patient Routes
 *
 * Routes for patients to:
 * - Manage provider access requests
 * - Grant/revoke consent to providers
 * - View their provider relationships
 */

import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPrismaClient } from '../services/database.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

// All routes require authentication
router.use(authenticate);
// Only patients can manage their own provider relationships
router.use(requireRole('PATIENT'));

/**
 * GET /api/v1/patient/providers
 * Get all providers with access to patient's data
 */
router.get(
  '/providers',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;

    const relationships = await prisma.providerPatient.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });

    // Get provider details
    const providerIds = relationships.map((r) => r.providerId);
    const providers = await prisma.user.findMany({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        email: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
      },
    });

    const result = relationships.map((rel) => {
      const provider = providers.find((p) => p.id === rel.providerId);
      return {
        relationshipId: rel.id,
        providerId: rel.providerId,
        provider: provider
          ? {
              id: provider.id,
              email: provider.email,
            }
          : null,
        permissions: {
          canViewBiomarkers: rel.canViewBiomarkers,
          canViewInsurance: rel.canViewInsurance,
          canViewDna: rel.canViewDna,
          canViewHealthNeeds: rel.canViewHealthNeeds,
          canEditData: rel.canEditData,
        },
        relationshipType: rel.relationshipType,
        status: rel.status,
        consentGrantedAt: rel.consentGrantedAt,
        consentExpiresAt: rel.consentExpiresAt,
        createdAt: rel.createdAt,
      };
    });

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  })
);

/**
 * GET /api/v1/patient/providers/pending
 * Get pending access requests from providers
 */
router.get(
  '/providers/pending',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;

    const pendingRequests = await prisma.providerPatient.findMany({
      where: {
        patientId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get provider details
    const providerIds = pendingRequests.map((r) => r.providerId);
    const providers = await prisma.user.findMany({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        email: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
      },
    });

    const result = pendingRequests.map((rel) => {
      const provider = providers.find((p) => p.id === rel.providerId);
      return {
        requestId: rel.id,
        providerId: rel.providerId,
        provider: provider
          ? {
              id: provider.id,
              email: provider.email,
            }
          : null,
        relationshipType: rel.relationshipType,
        requestedAt: rel.createdAt,
      };
    });

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  })
);

/**
 * POST /api/v1/patient/providers/:id/approve
 * Approve a provider's access request
 */
router.post(
  '/providers/:id/approve',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.providerPatient.approve),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;
    const { id } = req.params;
    const {
      canViewBiomarkers = true,
      canViewInsurance = false,
      canViewDna = false,
      canViewHealthNeeds = true,
      canEditData = false,
      consentDurationDays,
    } = req.body;

    const relationship = await prisma.providerPatient.findFirst({
      where: {
        id,
        patientId,
        status: 'PENDING',
      },
    });

    if (!relationship) {
      throw new NotFoundError('Access request not found or already processed');
    }

    // Calculate consent expiration
    const consentExpiresAt = consentDurationDays
      ? new Date(Date.now() + consentDurationDays * 24 * 60 * 60 * 1000)
      : null;

    const updated = await prisma.providerPatient.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        canViewBiomarkers,
        canViewInsurance,
        canViewDna,
        canViewHealthNeeds,
        canEditData,
        consentGrantedAt: new Date(),
        consentExpiresAt,
      },
    });

    const response: ApiResponse<{ message: string; relationship: typeof updated }> = {
      success: true,
      data: {
        message: 'Provider access approved',
        relationship: updated,
      },
    };
    res.json(response);
  })
);

/**
 * POST /api/v1/patient/providers/:id/deny
 * Deny a provider's access request
 */
router.post(
  '/providers/:id/deny',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;
    const { id } = req.params;

    const relationship = await prisma.providerPatient.findFirst({
      where: {
        id,
        patientId,
        status: 'PENDING',
      },
    });

    if (!relationship) {
      throw new NotFoundError('Access request not found or already processed');
    }

    await prisma.providerPatient.delete({ where: { id } });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Provider access denied' },
    };
    res.json(response);
  })
);

/**
 * PATCH /api/v1/patient/providers/:id
 * Update permissions for an active provider relationship
 */
router.patch(
  '/providers/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.providerPatient.updatePermissions),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;
    const { id } = req.params;
    const { canViewBiomarkers, canViewInsurance, canViewDna, canViewHealthNeeds, canEditData } = req.body;

    const relationship = await prisma.providerPatient.findFirst({
      where: {
        id,
        patientId,
        status: 'ACTIVE',
      },
    });

    if (!relationship) {
      throw new NotFoundError('Active provider relationship not found');
    }

    const updated = await prisma.providerPatient.update({
      where: { id },
      data: {
        ...(canViewBiomarkers !== undefined && { canViewBiomarkers }),
        ...(canViewInsurance !== undefined && { canViewInsurance }),
        ...(canViewDna !== undefined && { canViewDna }),
        ...(canViewHealthNeeds !== undefined && { canViewHealthNeeds }),
        ...(canEditData !== undefined && { canEditData }),
      },
    });

    const response: ApiResponse<typeof updated> = {
      success: true,
      data: updated,
    };
    res.json(response);
  })
);

/**
 * POST /api/v1/patient/providers/:id/revoke
 * Revoke a provider's access
 */
router.post(
  '/providers/:id/revoke',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;
    const { id } = req.params;

    const relationship = await prisma.providerPatient.findFirst({
      where: {
        id,
        patientId,
        status: 'ACTIVE',
      },
    });

    if (!relationship) {
      throw new NotFoundError('Active provider relationship not found');
    }

    await prisma.providerPatient.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Provider access revoked' },
    };
    res.json(response);
  })
);

/**
 * DELETE /api/v1/patient/providers/:id
 * Permanently remove a provider relationship
 */
router.delete(
  '/providers/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const patientId = req.user!.id;
    const { id } = req.params;

    const relationship = await prisma.providerPatient.findFirst({
      where: {
        id,
        patientId,
      },
    });

    if (!relationship) {
      throw new NotFoundError('Provider relationship not found');
    }

    await prisma.providerPatient.delete({ where: { id } });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Provider relationship removed' },
    };
    res.json(response);
  })
);

export default router;
