/**
 * Provider Routes
 *
 * Routes for healthcare providers to:
 * - View and manage their patient relationships
 * - Access authorized patient data
 * - Manage provider settings
 */

import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import { providerAccessRequestLimiter } from '../middleware/rateLimiter.js';
import { getPrismaClient, withRLSContext } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router = Router();

// All routes require authentication and PROVIDER or ADMIN role
router.use(authenticate);
router.use(requireRole('PROVIDER', 'ADMIN'));

/**
 * GET /api/v1/provider/patients
 * Get all patients the provider has relationships with
 */
router.get(
  '/patients',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;

    // Provider RLS context (P7). Two reads, intentionally NOT a join:
    //  1. The provider's own provider_patients rows (provider_patients_select).
    //  2. Patient identity {id,email} ONLY for ACTIVE, unexpired relationships,
    //     in a separate query with a minimal column select.
    //
    // We deliberately avoid `include: { patient }` here: `patient` is a REQUIRED
    // relation in the schema, but under provider RLS the patient User row is
    // hidden for PENDING/expired relationships — and Prisma throws on a required
    // relation whose target row is RLS-filtered out, which would 500 the whole
    // list for any provider with a pending request. The expiry filter below also
    // keeps the app-layer gate in parity with has_active_consent so a BYPASSRLS
    // (dev/staging) role can't surface an expired-consent patient's email.
    const now = new Date();
    const { relationships, patientsById } = await withRLSContext(
      providerId,
      async (tx) => {
        const rels = await tx.providerPatient.findMany({
          where: {
            providerId,
            status: { in: ['ACTIVE', 'PENDING'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        const activeUnexpiredIds = rels
          .filter(
            (r) =>
              r.status === 'ACTIVE' &&
              !(r.consentExpiresAt && new Date(r.consentExpiresAt) < now),
          )
          .map((r) => r.patientId);

        const patients = activeUnexpiredIds.length
          ? await tx.user.findMany({
              where: { id: { in: activeUnexpiredIds } },
              // Minimal, non-secret select. users_select_provider authorizes the
              // whole row at the DB layer (RLS is row-level, not column-level),
              // so the column allowlist here is the field-minimization gate —
              // never select password_hash / *_token in provider context.
              select: { id: true, email: true, createdAt: true },
            })
          : [];

        return {
          relationships: rels,
          patientsById: new Map(patients.map((p) => [p.id, p])),
        };
      },
    );

    // Transform to response format. Email + createdAt are present only for
    // ACTIVE, unexpired relationships (the keys present in patientsById);
    // PENDING and expired relationships disclose neither.
    const result = relationships.map((rel) => {
      const pt = patientsById.get(rel.patientId);
      return {
        relationshipId: rel.id,
        patientId: rel.patientId,
        patient: {
          id: rel.patientId,
          email: pt?.email,
          createdAt: pt?.createdAt,
        },
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

    // Audit log: Provider listing their patients
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess('provider_patients', undefined, { req, userId: providerId }, {
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
 * POST /api/v1/provider/patients/request
 * Request access to a patient (by email).
 *
 * Response is intentionally uniform whether the email exists, doesn't
 * exist, or belongs to a non-PATIENT account. Distinct 404/403 responses
 * (the prior shape) leaked role + existence — a provider could probe
 * the user table by trying every email on a list and noting which got
 * "not found" vs "not a patient". Both cases now return the same generic
 * "if it belongs to a patient, they'll receive your request" success.
 *
 * Audit logs retain the actual reason (patient_not_found vs not_patient_role)
 * so admins can detect enumeration patterns; only the API response is
 * collapsed.
 *
 * Rate-limited per authenticated user via providerAccessRequestLimiter
 * (10/hour). The limit is applied user-keyed rather than IP-keyed so a
 * single provider account can't escape the cap by changing IPs and one
 * provider can't DoS another by sharing a NAT.
 */
router.post(
  '/patients/request',
  providerAccessRequestLimiter,
  validate(schemas.providerPatient.request),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientEmail, relationshipType, message } = req.body;

    // C-8 Part 2b-ii — admin context for the email→patient lookup. The
    // users_select_own policy only permits `id = current_user_id() OR
    // is_admin_session()`, which would deny a provider trying to resolve
    // a patient's id by email. Admin wrap is the pragmatic fix; a
    // narrower policy that permits PROVIDER role to SELECT {id, role}
    // would be more correct long-term.
    const patient = await withRLSContext(
      null,
      async (tx) => {
        return tx.user.findUnique({
          where: { email: patientEmail },
          select: { id: true, role: true },
        });
      },
      { isAdmin: true }
    );

    const auditService = getAuditLogService(prisma);

    // Generic body returned for every "we won't be sending the request" path.
    // Phrased so it's true regardless of which gate tripped:
    //   - email doesn't exist → no notification ever happens; statement holds vacuously
    //   - exists but role != PATIENT → no notification (we never send to non-patients)
    //   - exists, is a patient → request lands and the patient sees it
    const genericResponse: ApiResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'If this email belongs to a patient account, they will receive your request.',
      },
    };

    if (!patient) {
      // Audit log retains the real reason for enumeration detection.
      await auditService.logAccess('provider_patient_request', undefined, { req, userId: providerId }, {
        operation: 'REQUEST_ACCESS',
        success: false,
        reason: 'patient_not_found',
      });
      res.json(genericResponse);
      return;
    }

    if (patient.role !== 'PATIENT') {
      await auditService.logAccess('provider_patient_request', patient.id, { req, userId: providerId }, {
        operation: 'REQUEST_ACCESS',
        success: false,
        reason: 'not_patient_role',
      });
      res.json(genericResponse);
      return;
    }

    // Encrypt the message if provided (using provider's encryption salt).
    // NOTE: `getUserEncryptionSalt` is one of the Part 2b bare-prisma call
    // sites (userEncryption.ts) and is not yet RLS-wrapped. Under the
    // current superuser DATABASE_URL this is a no-op; under a
    // NOBYPASSRLS role it will work because the salt belongs to the
    // provider themselves. Flagged for Part 2b.
    let encryptedNotes: string | null = null;
    if (message && message.trim()) {
      const encryptionService = getEncryptionService();
      const providerSalt = await getUserEncryptionSalt(providerId);
      encryptedNotes = encryptionService.encrypt(message, providerSalt);
    }

    // C-8 Part 2a — provider_patient writes go through withRLSContext.
    // The policy permits providerId = current_user_id(), so the provider's
    // own session is the correct RLS identity.
    const relationship = await withRLSContext(providerId, async (tx) => {
      const existing = await tx.providerPatient.findUnique({
        where: {
          providerId_patientId: {
            providerId,
            patientId: patient.id,
          },
        },
      });

      if (existing) {
        if (existing.status === 'ACTIVE') {
          throw new ForbiddenError('You already have access to this patient');
        }
        if (existing.status === 'PENDING') {
          throw new ForbiddenError('Access request already pending');
        }
      }

      return tx.providerPatient.upsert({
        where: {
          providerId_patientId: {
            providerId,
            patientId: patient.id,
          },
        },
        create: {
          providerId,
          patientId: patient.id,
          relationshipType: relationshipType || 'PRIMARY_CARE',
          status: 'PENDING',
          notesEncrypted: encryptedNotes,
        },
        update: {
          status: 'PENDING',
          relationshipType: relationshipType || 'PRIMARY_CARE',
          notesEncrypted: encryptedNotes,
        },
      });
    });

    // Audit log: Provider requested access to patient. Kept outside the
    // RLS transaction because auditService internally uses the outer
    // prisma singleton — Part 2b territory.
    await auditService.logCreate('provider_patient_request', relationship.id, {
      patientId: patient.id,
      relationshipType: relationship.relationshipType,
      status: relationship.status,
    }, { req, userId: providerId });

    const response: ApiResponse<{ relationshipId: string; status: string }> = {
      success: true,
      data: {
        relationshipId: relationship.id,
        status: relationship.status,
      },
    };
    res.status(201).json(response);
  })
);

/**
 * GET /api/v1/provider/patients/:patientId
 * Get details for a specific patient (if authorized)
 */
router.get(
  '/patients/:patientId',
  validate(schemas.patientIdParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientId } = req.params;

    // Provider RLS context (P7): the patient's User row is now read through the
    // users_select_provider policy (visible only for an ACTIVE, unexpired
    // consent relationship). The app-layer checks below stay the primary gate +
    // audit driver; RLS is the backstop that turns a missed check into a
    // no-disclosure instead of a silent cross-tenant leak.
    const { relationship, patient } = await withRLSContext(
      providerId,
      async (tx) => {
        const rel = await tx.providerPatient.findUnique({
          where: {
            providerId_patientId: {
              providerId,
              patientId,
            },
          },
        });

        // Filter on isActive + lockedUntil so providers lose access the
        // moment a patient's account is deactivated or locked — consent
        // doesn't survive account state changes. Only hit the User table
        // if the relationship itself looks viable; skip on fail-fast.
        const pt =
          rel && rel.status === 'ACTIVE'
            ? await tx.user.findFirst({
                where: {
                  id: patientId,
                  isActive: true,
                  OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
                },
                select: {
                  id: true,
                  email: true,
                  firstNameEncrypted: true,
                  lastNameEncrypted: true,
                  createdAt: true,
                  lastLoginAt: true,
                },
              })
            : null;
        return { relationship: rel, patient: pt };
      },
    );

    const auditService = getAuditLogService(prisma);

    if (!relationship || relationship.status !== 'ACTIVE') {
      // Audit log: Failed patient detail access
      await auditService.logAccess('patient_detail', patientId, { req, userId: providerId }, {
        operation: 'VIEW_PATIENT',
        success: false,
        reason: !relationship ? 'no_relationship' : 'relationship_not_active',
      });
      throw new ForbiddenError('You do not have access to this patient');
    }

    // Check consent expiration
    if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < new Date()) {
      await auditService.logAccess('patient_detail', patientId, { req, userId: providerId }, {
        operation: 'VIEW_PATIENT',
        success: false,
        reason: 'consent_expired',
        consentExpiresAt: relationship.consentExpiresAt.toISOString(),
      });
      throw new ForbiddenError('Provider consent has expired');
    }

    if (!patient) {
      await auditService.logAccess('patient_detail', patientId, { req, userId: providerId }, {
        operation: 'VIEW_PATIENT',
        success: false,
        reason: 'patient_inactive_or_locked',
      });
      throw new NotFoundError('Patient not found or account is inactive');
    }

    const result = {
      patient: {
        id: patient.id,
        email: patient.email,
        createdAt: patient.createdAt,
        lastLoginAt: patient.lastLoginAt,
      },
      relationship: {
        id: relationship.id,
        relationshipType: relationship.relationshipType,
        permissions: {
          canViewBiomarkers: relationship.canViewBiomarkers,
          canViewInsurance: relationship.canViewInsurance,
          canViewHealthNeeds: relationship.canViewHealthNeeds,
          canEditData: relationship.canEditData,
        },
        consentGrantedAt: relationship.consentGrantedAt,
        consentExpiresAt: relationship.consentExpiresAt,
      },
    };

    // Audit log: Provider viewed patient detail (cross-user PHI access)
    await auditService.logAccess('patient_detail', patientId, { req, userId: providerId }, {
      operation: 'VIEW_PATIENT',
      patientId,
      accessedFields: ['email', 'createdAt', 'lastLoginAt'],
    });

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  })
);

/**
 * GET /api/v1/provider/patients/:patientId/biomarkers
 * Get patient's biomarkers (if authorized)
 */
router.get(
  '/patients/:patientId/biomarkers',
  validate(schemas.patientIdParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientId } = req.params;

    // Provider RLS context (P7): biomarkers_select already carries an
    // `OR has_provider_access(user_id, 'view_biomarkers')` branch, so under the
    // provider's session the DB returns biomarker rows ONLY for an ACTIVE,
    // unexpired, can_view_biomarkers relationship — a true backstop matching the
    // app-layer checks below (which remain the primary gate + audit driver).
    const { relationship, patient, biomarkers } = await withRLSContext(
      providerId,
      async (tx) => {
        const rel = await tx.providerPatient.findUnique({
          where: {
            providerId_patientId: {
              providerId,
              patientId,
            },
          },
        });

        // Only reach through to PHI if the relationship row itself qualifies.
        // The explicit ForbiddenError branches below still render the right
        // audit reason, so early-return-null is safe.
        const viable =
          rel &&
          rel.status === 'ACTIVE' &&
          rel.canViewBiomarkers &&
          !(rel.consentExpiresAt && new Date(rel.consentExpiresAt) < new Date());

        if (!viable) return { relationship: rel, patient: null, biomarkers: [] };

        const pt = await tx.user.findFirst({
          where: {
            id: patientId,
            isActive: true,
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
          },
          select: { id: true },
        });

        if (!pt) return { relationship: rel, patient: null, biomarkers: [] };

        const rows = await tx.biomarker.findMany({
          where: { userId: patientId },
          orderBy: { measurementDate: 'desc' },
        });
        return { relationship: rel, patient: pt, biomarkers: rows };
      },
    );

    const auditService = getAuditLogService(prisma);

    if (!relationship || relationship.status !== 'ACTIVE') {
      // Audit log: Failed biomarker access attempt
      await auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: !relationship ? 'no_relationship' : 'relationship_not_active',
      });
      throw new ForbiddenError('You do not have access to this patient');
    }

    // Check consent expiration
    if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < new Date()) {
      await auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'consent_expired',
        consentExpiresAt: relationship.consentExpiresAt.toISOString(),
      });
      throw new ForbiddenError('Provider consent has expired');
    }

    if (!relationship.canViewBiomarkers) {
      // Audit log: Failed biomarker access — insufficient permissions
      await auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'permission_denied',
      });
      throw new ForbiddenError('You do not have permission to view this patient\'s biomarkers');
    }

    if (!patient) {
      await auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'patient_inactive_or_locked',
      });
      throw new NotFoundError('Patient not found or account is inactive');
    }

    // Decrypt biomarker PHI using patient's encryption key
    const patientSalt = await getUserEncryptionSalt(patientId);
    const encryptionService = getEncryptionService();

    const decryptedBiomarkers = biomarkers.map((b) => ({
      id: b.id,
      userId: b.userId,
      category: b.category,
      name: b.name,
      unit: b.unit,
      value: parseFloat(encryptionService.decrypt(b.valueEncrypted, patientSalt)),
      notes: b.notesEncrypted ? encryptionService.decrypt(b.notesEncrypted, patientSalt) : undefined,
      normalRange: {
        min: Number(b.normalRangeMin),
        max: Number(b.normalRangeMax),
        source: b.normalRangeSource ?? undefined,
      },
      date: b.measurementDate.toISOString().split('T')[0],
      sourceType: b.sourceType,
      sourceFile: b.sourceFile ?? undefined,
      labName: b.labName ?? undefined,
      isOutOfRange: b.isOutOfRange,
      isAcknowledged: b.isAcknowledged,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));

    // Audit log: Provider accessed patient biomarkers (cross-user PHI access)
    await auditService.logAccess('patient_biomarkers', patientId, { req, userId: providerId }, {
      operation: 'PHI_ACCESS',
      patientId,
      count: decryptedBiomarkers.length,
      accessedFields: ['biomarkers'],
    });

    const response: ApiResponse<typeof decryptedBiomarkers> = {
      success: true,
      data: decryptedBiomarkers,
    };
    res.json(response);
  })
);

/**
 * GET /api/v1/provider/patients/:patientId/health-needs
 * Get patient's health needs (if authorized)
 */
router.get(
  '/patients/:patientId/health-needs',
  validate(schemas.patientIdParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientId } = req.params;

    // Provider RLS context (P7): health_needs_select carries an
    // `OR has_provider_access(user_id, 'view_health_needs')` branch, so the DB
    // returns rows only for an ACTIVE, unexpired, can_view_health_needs
    // relationship. App-layer checks below stay the primary gate + audit driver.
    const { relationship, patient, healthNeeds } = await withRLSContext(
      providerId,
      async (tx) => {
        const rel = await tx.providerPatient.findUnique({
          where: {
            providerId_patientId: {
              providerId,
              patientId,
            },
          },
        });

        const viable =
          rel &&
          rel.status === 'ACTIVE' &&
          rel.canViewHealthNeeds &&
          !(rel.consentExpiresAt && new Date(rel.consentExpiresAt) < new Date());

        if (!viable) return { relationship: rel, patient: null, healthNeeds: [] };

        const pt = await tx.user.findFirst({
          where: {
            id: patientId,
            isActive: true,
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
          },
          select: { id: true },
        });

        if (!pt) return { relationship: rel, patient: null, healthNeeds: [] };

        const rows = await tx.healthNeed.findMany({
          where: { userId: patientId },
          orderBy: { createdAt: 'desc' },
        });
        return { relationship: rel, patient: pt, healthNeeds: rows };
      },
    );

    const auditService = getAuditLogService(prisma);

    if (!relationship || relationship.status !== 'ACTIVE') {
      // Audit log: Failed health needs access attempt
      await auditService.logAccess('patient_health_needs', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: !relationship ? 'no_relationship' : 'relationship_not_active',
      });
      throw new ForbiddenError('You do not have access to this patient');
    }

    // Check consent expiration
    if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < new Date()) {
      await auditService.logAccess('patient_health_needs', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'consent_expired',
        consentExpiresAt: relationship.consentExpiresAt.toISOString(),
      });
      throw new ForbiddenError('Provider consent has expired');
    }

    if (!relationship.canViewHealthNeeds) {
      // Audit log: Failed health needs access — insufficient permissions
      await auditService.logAccess('patient_health_needs', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'permission_denied',
      });
      throw new ForbiddenError('You do not have permission to view this patient\'s health needs');
    }

    if (!patient) {
      await auditService.logAccess('patient_health_needs', patientId, { req, userId: providerId }, {
        operation: 'PHI_ACCESS',
        success: false,
        reason: 'patient_inactive_or_locked',
      });
      throw new NotFoundError('Patient not found or account is inactive');
    }

    // Decrypt health need PHI using patient's encryption key
    const patientSalt = await getUserEncryptionSalt(patientId);
    const encryptionService = getEncryptionService();

    const decryptedHealthNeeds = healthNeeds.map((n) => ({
      id: n.id,
      userId: n.userId,
      needType: n.needType,
      name: n.name,
      description: encryptionService.decrypt(n.descriptionEncrypted, patientSalt),
      urgency: n.urgency,
      status: n.status,
      relatedBiomarkerIds: n.relatedBiomarkerIds,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      resolvedAt: n.resolvedAt ?? undefined,
    }));

    // Audit log: Provider accessed patient health needs (cross-user PHI access)
    await auditService.logAccess('patient_health_needs', patientId, { req, userId: providerId }, {
      operation: 'PHI_ACCESS',
      patientId,
      count: decryptedHealthNeeds.length,
      accessedFields: ['healthNeeds'],
    });

    const response: ApiResponse<typeof decryptedHealthNeeds> = {
      success: true,
      data: decryptedHealthNeeds,
    };
    res.json(response);
  })
);

/**
 * DELETE /api/v1/provider/patients/:patientId
 * Remove relationship with a patient
 */
router.delete(
  '/patients/:patientId',
  validate(schemas.patientIdParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientId } = req.params;

    const auditService = getAuditLogService(prisma);

    // C-8 Part 2a — wrap the read + delete in the provider's RLS context.
    // The provider_patients_delete policy permits both providerId and
    // patientId matches, so the provider's session is a valid RLS identity.
    //
    // F-23 note: this is a hard delete, inconsistent with patientRoutes.ts's
    // soft-revoke pattern for the revoke endpoint. F-23 in the domain audit
    // calls for migrating this to a soft-revoke to preserve audit joinability.
    // Deliberately deferred — changing the semantics of "delete relationship"
    // is a behavior change that deserves its own PR.
    await withRLSContext(providerId, async (tx) => {
      const relationship = await tx.providerPatient.findUnique({
        where: {
          providerId_patientId: {
            providerId,
            patientId,
          },
        },
      });

      if (!relationship) {
        // Audit log: Failed delete — relationship not found
        await auditService.logAccess('provider_patient_relationship', patientId, { req, userId: providerId }, {
          operation: 'DELETE',
          success: false,
          reason: 'relationship_not_found',
        });
        throw new NotFoundError('Relationship not found');
      }

      if (relationship.status !== 'ACTIVE') {
        await auditService.logAccess('provider_patient_relationship', patientId, { req, userId: providerId }, {
          operation: 'DELETE',
          success: false,
          reason: 'relationship_not_active',
        });
        throw new ForbiddenError('You do not have active access to this patient');
      }

      // Check consent expiration
      if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < new Date()) {
        await auditService.logAccess('provider_patient_relationship', patientId, { req, userId: providerId }, {
          operation: 'DELETE',
          success: false,
          reason: 'consent_expired',
          consentExpiresAt: relationship.consentExpiresAt.toISOString(),
        });
        throw new ForbiddenError('Provider consent has expired');
      }

      // Audit log: Provider removing patient relationship (log before deletion)
      await auditService.logDelete('provider_patient_relationship', relationship.id, {
        patientId,
        relationshipType: relationship.relationshipType,
        status: relationship.status,
      }, { req, userId: providerId });

      await tx.providerPatient.delete({
        where: { id: relationship.id },
      });
    });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Patient relationship removed' },
    };
    res.json(response);
  })
);

export default router;
