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
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
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

    // Use Prisma include for efficient single-query join
    const relationships = await prisma.providerPatient.findMany({
      where: {
        providerId,
        status: { in: ['ACTIVE', 'PENDING'] },
      },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            firstNameEncrypted: true,
            lastNameEncrypted: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to response format
    const result = relationships.map((rel) => ({
      relationshipId: rel.id,
      patientId: rel.patientId,
      patient: {
        id: rel.patient.id,
        email: rel.patient.email,
        // Note: firstName/lastName would need decryption in a real app
        createdAt: rel.patient.createdAt,
      },
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
    }));

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  })
);

/**
 * POST /api/v1/provider/patients/request
 * Request access to a patient (by email)
 */
router.post(
  '/patients/request',
  validate(schemas.providerPatient.request),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prisma = getPrismaClient();
    const providerId = req.user!.id;
    const { patientEmail, relationshipType, message } = req.body;

    // Find patient by email
    const patient = await prisma.user.findUnique({
      where: { email: patientEmail },
      select: { id: true, role: true },
    });

    if (!patient) {
      throw new NotFoundError('Patient not found with this email');
    }

    if (patient.role !== 'PATIENT') {
      throw new ForbiddenError('Can only request access to patient accounts');
    }

    // Check for existing relationship
    const existing = await prisma.providerPatient.findUnique({
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

    // Encrypt the message if provided (using provider's encryption salt)
    let encryptedNotes: string | null = null;
    if (message && message.trim()) {
      const encryptionService = getEncryptionService();
      const providerSalt = await getUserEncryptionSalt(providerId);
      encryptedNotes = encryptionService.encrypt(message, providerSalt);
    }

    // Create or update the relationship
    const relationship = await prisma.providerPatient.upsert({
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

    // Verify access
    const relationship = await prisma.providerPatient.findUnique({
      where: {
        providerId_patientId: {
          providerId,
          patientId,
        },
      },
    });

    if (!relationship || relationship.status !== 'ACTIVE') {
      throw new ForbiddenError('You do not have access to this patient');
    }

    // Get patient data based on permissions
    const patient = await prisma.user.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        email: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!patient) {
      throw new NotFoundError('Patient not found');
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
          canViewDna: relationship.canViewDna,
          canViewHealthNeeds: relationship.canViewHealthNeeds,
          canEditData: relationship.canEditData,
        },
        consentGrantedAt: relationship.consentGrantedAt,
        consentExpiresAt: relationship.consentExpiresAt,
      },
    };

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

    // Verify access to biomarkers
    const relationship = await prisma.providerPatient.findUnique({
      where: {
        providerId_patientId: {
          providerId,
          patientId,
        },
      },
    });

    if (!relationship || relationship.status !== 'ACTIVE') {
      throw new ForbiddenError('You do not have access to this patient');
    }

    if (!relationship.canViewBiomarkers) {
      throw new ForbiddenError('You do not have permission to view this patient\'s biomarkers');
    }

    const biomarkers = await prisma.biomarker.findMany({
      where: { userId: patientId },
      orderBy: { measurementDate: 'desc' },
    });

    const response: ApiResponse<typeof biomarkers> = {
      success: true,
      data: biomarkers,
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

    // Verify access
    const relationship = await prisma.providerPatient.findUnique({
      where: {
        providerId_patientId: {
          providerId,
          patientId,
        },
      },
    });

    if (!relationship || relationship.status !== 'ACTIVE') {
      throw new ForbiddenError('You do not have access to this patient');
    }

    if (!relationship.canViewHealthNeeds) {
      throw new ForbiddenError('You do not have permission to view this patient\'s health needs');
    }

    const healthNeeds = await prisma.healthNeed.findMany({
      where: { userId: patientId },
      orderBy: { createdAt: 'desc' },
    });

    const response: ApiResponse<typeof healthNeeds> = {
      success: true,
      data: healthNeeds,
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

    const relationship = await prisma.providerPatient.findUnique({
      where: {
        providerId_patientId: {
          providerId,
          patientId,
        },
      },
    });

    if (!relationship) {
      throw new NotFoundError('Relationship not found');
    }

    await prisma.providerPatient.delete({
      where: { id: relationship.id },
    });

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Patient relationship removed' },
    };
    res.json(response);
  })
);

export default router;
