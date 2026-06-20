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
import { asyncHandler, NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPrismaClient, withRLSContext } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
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

    // Own ProviderPatient rows — patient's session is the RLS identity.
    const relationships = await withRLSContext(patientId, async (tx) => {
      return tx.providerPatient.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      });
    });

    // Cross-tenant lookup: rendering the provider user's email for display.
    // Admin context because users_select_own restricts SELECT to the row's
    // owner, and patient is not the provider. Disclosure is bounded by the
    // id-set (only providers the patient already has a relationship with).
    const providerIds = relationships.map((r) => r.providerId);
    const providers = await withRLSContext(
      null,
      async (tx) => {
        return tx.user.findMany({
          where: { id: { in: providerIds } },
          select: {
            id: true,
            email: true,
            firstNameEncrypted: true,
            lastNameEncrypted: true,
          },
        });
      },
      { isAdmin: true },
    );

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

    // Audit log: Patient listing their providers
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('patient_providers', undefined, { req, userId: patientId }, {
      operation: 'LIST',
      count: result.length,
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

    // Own ProviderPatient rows — patient's session is the RLS identity.
    const pendingRequests = await withRLSContext(patientId, async (tx) => {
      return tx.providerPatient.findMany({
        where: {
          patientId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    // Cross-tenant lookup for the provider user's display info; same
    // reasoning as GET /providers above.
    const providerIds = pendingRequests.map((r) => r.providerId);
    const providers = await withRLSContext(
      null,
      async (tx) => {
        return tx.user.findMany({
          where: { id: { in: providerIds } },
          select: {
            id: true,
            email: true,
            firstNameEncrypted: true,
            lastNameEncrypted: true,
          },
        });
      },
      { isAdmin: true },
    );

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

    // Audit log: Patient viewing pending access requests
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('patient_pending_requests', undefined, { req, userId: patientId }, {
      operation: 'LIST',
      count: result.length,
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
      canViewHealthNeeds = true,
      consentDurationDays,
    } = req.body;
    // L37: canEditData is intentionally NOT read/persisted — no provider route
    // consumes it, so granting it is an orphaned capability / latent-activation
    // trap. The relationship keeps the schema default (false) until a provider
    // edit route exists. (The Zod schema still accepts the key for request-shape
    // back-compat with existing clients; it is simply ignored here.)

    const auditService = getAuditLogService(prisma);

    // Calculate consent expiration
    const consentExpiresAt = consentDurationDays
      ? new Date(Date.now() + consentDurationDays * 24 * 60 * 60 * 1000)
      : null;

    // C-8 Part 2a — patient's session wraps the read + update.
    const updated = await withRLSContext(patientId, async (tx) => {
      const relationship = await tx.providerPatient.findFirst({
        where: {
          id,
          patientId,
          status: 'PENDING',
        },
      });

      if (!relationship) {
        // Audit log: Failed consent approval — request not found
        await auditService.logAccess('provider_consent', id, { req, userId: patientId }, {
          operation: 'APPROVE',
          success: false,
          reason: 'request_not_found_or_processed',
        });
        throw new NotFoundError('Access request not found or already processed');
      }

      const updatedRel = await tx.providerPatient.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          canViewBiomarkers,
          canViewInsurance,
          canViewHealthNeeds,
          consentGrantedAt: new Date(),
          consentExpiresAt,
        },
      });

      // Audit log: Patient approved provider consent (critical consent event)
      await auditService.logUpdate('provider_consent', id, {
        status: relationship.status,
        providerId: relationship.providerId,
      }, {
        status: 'ACTIVE',
        providerId: relationship.providerId,
        canViewBiomarkers,
        canViewInsurance,
        canViewHealthNeeds,
        consentExpiresAt: consentExpiresAt?.toISOString() ?? 'none',
      }, { req, userId: patientId, tx }, {
        operation: 'CONSENT_GRANTED',
        providerId: relationship.providerId,
      });

      return updatedRel;
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

    const auditService = getAuditLogService(prisma);

    // C-8 Part 2a — patient's session wraps the read + delete.
    await withRLSContext(patientId, async (tx) => {
      const relationship = await tx.providerPatient.findFirst({
        where: {
          id,
          patientId,
          status: 'PENDING',
        },
      });

      if (!relationship) {
        // Audit log: Failed consent denial — request not found
        await auditService.logAccess('provider_consent', id, { req, userId: patientId }, {
          operation: 'DENY',
          success: false,
          reason: 'request_not_found_or_processed',
        });
        throw new NotFoundError('Access request not found or already processed');
      }

      // Audit log: Patient denied provider consent (log before deletion)
      await auditService.logUpdate('provider_consent', id, {
        status: relationship.status,
        providerId: relationship.providerId,
      }, {
        status: 'DENIED',
        providerId: relationship.providerId,
      }, { req, userId: patientId, tx }, {
        operation: 'CONSENT_DENIED',
        providerId: relationship.providerId,
      });

      await tx.providerPatient.delete({ where: { id } });
    });

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
    // L37: canEditData is intentionally not read/persisted (orphaned capability —
    // no provider route consumes it). Schema still accepts the key for back-compat.
    const { canViewBiomarkers, canViewInsurance, canViewHealthNeeds } = req.body;

    const auditService = getAuditLogService(prisma);

    // C-8 Part 2a — patient's session wraps the read + update.
    const updated = await withRLSContext(patientId, async (tx) => {
      const relationship = await tx.providerPatient.findFirst({
        where: {
          id,
          patientId,
          status: 'ACTIVE',
        },
      });

      if (!relationship) {
        // Audit log: Failed permission update — relationship not found
        await auditService.logAccess('provider_consent_permissions', id, { req, userId: patientId }, {
          operation: 'UPDATE_PERMISSIONS',
          success: false,
          reason: 'relationship_not_found_or_inactive',
        });
        throw new NotFoundError('Active provider relationship not found');
      }

      // Block permission edits on expired consent. The `status === 'ACTIVE'`
      // filter above doesn't cover this — `status` is a manual state, while
      // `consentExpiresAt` is a time-based gate. A permission change on an
      // expired relationship would silently grant or remove access without
      // the patient re-consenting.
      if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < new Date()) {
        await auditService.logAccess('provider_consent_permissions', id, { req, userId: patientId }, {
          operation: 'UPDATE_PERMISSIONS',
          success: false,
          reason: 'consent_expired',
          consentExpiresAt: relationship.consentExpiresAt.toISOString(),
        });
        throw new ForbiddenError('Consent has expired. Please renew consent before updating permissions.');
      }

      const previousPermissions = {
        canViewBiomarkers: relationship.canViewBiomarkers,
        canViewInsurance: relationship.canViewInsurance,
        canViewHealthNeeds: relationship.canViewHealthNeeds,
        canEditData: relationship.canEditData,
      };

      const updatedRel = await tx.providerPatient.update({
        where: { id },
        data: {
          ...(canViewBiomarkers !== undefined && { canViewBiomarkers }),
          ...(canViewInsurance !== undefined && { canViewInsurance }),
          ...(canViewHealthNeeds !== undefined && { canViewHealthNeeds }),
          // canEditData deliberately omitted (L37) — never persisted.
        },
      });

      // Audit log: Patient updated provider permissions (consent modification)
      await auditService.logUpdate('provider_consent_permissions', id, previousPermissions, {
        canViewBiomarkers: updatedRel.canViewBiomarkers,
        canViewInsurance: updatedRel.canViewInsurance,
        canViewHealthNeeds: updatedRel.canViewHealthNeeds,
        canEditData: updatedRel.canEditData,
      }, { req, userId: patientId, tx }, {
        operation: 'PERMISSIONS_UPDATED',
        providerId: relationship.providerId,
      });

      return updatedRel;
    });

    // Shape the response to match GET /providers — return the documented
    // PatientProviderRelationship, NOT the raw Prisma row, which would leak the
    // notesEncrypted ciphertext + raw consent columns and breaks the FE type.
    // Provider display info needs a cross-tenant lookup, same as the list endpoint.
    const provider = await withRLSContext(
      null,
      async (tx) =>
        tx.user.findUnique({
          where: { id: updated.providerId },
          select: { id: true, email: true },
        }),
      { isAdmin: true },
    );

    const shaped = {
      relationshipId: updated.id,
      providerId: updated.providerId,
      provider: provider ? { id: provider.id, email: provider.email } : null,
      permissions: {
        canViewBiomarkers: updated.canViewBiomarkers,
        canViewInsurance: updated.canViewInsurance,
        canViewHealthNeeds: updated.canViewHealthNeeds,
        canEditData: updated.canEditData,
      },
      relationshipType: updated.relationshipType,
      status: updated.status,
      consentGrantedAt: updated.consentGrantedAt,
      consentExpiresAt: updated.consentExpiresAt,
      createdAt: updated.createdAt,
    };

    const response: ApiResponse<typeof shaped> = {
      success: true,
      data: shaped,
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

    const auditService = getAuditLogService(prisma);

    // C-8 Part 2a — patient's session wraps the read + update.
    await withRLSContext(patientId, async (tx) => {
      const relationship = await tx.providerPatient.findFirst({
        where: {
          id,
          patientId,
          status: 'ACTIVE',
        },
      });

      if (!relationship) {
        // Audit log: Failed revocation — relationship not found
        await auditService.logAccess('provider_consent', id, { req, userId: patientId }, {
          operation: 'REVOKE',
          success: false,
          reason: 'relationship_not_found_or_inactive',
        });
        throw new NotFoundError('Active provider relationship not found');
      }

      // Audit log: Patient revoked provider consent (critical consent event — log before change)
      await auditService.logUpdate('provider_consent', id, {
        status: relationship.status,
        providerId: relationship.providerId,
        canViewBiomarkers: relationship.canViewBiomarkers,
        canViewInsurance: relationship.canViewInsurance,
        canViewHealthNeeds: relationship.canViewHealthNeeds,
        canEditData: relationship.canEditData,
      }, {
        status: 'REVOKED',
        providerId: relationship.providerId,
      }, { req, userId: patientId, tx }, {
        operation: 'CONSENT_REVOKED',
        providerId: relationship.providerId,
      });

      await tx.providerPatient.update({
        where: { id },
        data: { status: 'REVOKED' },
      });
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

    const auditService = getAuditLogService(prisma);

    // C-8 Part 2a — patient's session wraps the read + delete.
    await withRLSContext(patientId, async (tx) => {
      const relationship = await tx.providerPatient.findFirst({
        where: {
          id,
          patientId,
        },
      });

      if (!relationship) {
        // Audit log: Failed delete — relationship not found
        await auditService.logAccess('provider_consent', id, { req, userId: patientId }, {
          operation: 'DELETE',
          success: false,
          reason: 'relationship_not_found',
        });
        throw new NotFoundError('Provider relationship not found');
      }

      // Audit log: Patient permanently removing provider relationship (log before deletion)
      await auditService.logDelete('provider_consent', id, {
        providerId: relationship.providerId,
        relationshipType: relationship.relationshipType,
        status: relationship.status,
        canViewBiomarkers: relationship.canViewBiomarkers,
        canViewInsurance: relationship.canViewInsurance,
        canViewHealthNeeds: relationship.canViewHealthNeeds,
        canEditData: relationship.canEditData,
      }, { req, userId: patientId, tx }, {
        operation: 'RELATIONSHIP_DELETED',
        providerId: relationship.providerId,
      });

      await tx.providerPatient.delete({ where: { id } });
    });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Provider relationship removed' },
    };
    res.json(response);
  })
);

export default router;
