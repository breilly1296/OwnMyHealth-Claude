/**
 * Settings Controller
 *
 * Handles user settings operations including data export and account deletion.
 * All operations are scoped to the authenticated user.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { getPrismaClient, withRLSContext, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { storageService } from '../services/storageService.js';
import { toNumber } from '../utils/numberConversion.js';
import { processBatch } from '../utils/batchProcessor.js';
import { UnauthorizedError } from '../middleware/errorHandler.js';
import { verifyPassword } from '../services/authService.js';
import {
  getDecryptedHealthProfile,
  saveHealthProfile,
  type UserHealthProfile,
} from '../services/healthProfileService.js';
import { revokeAllUserConnections } from '../services/fhir/labSyncService.js';

const DECRYPT_BATCH_SIZE = 20;

// ============================================
// Profile response types
// ============================================

interface NotificationPreferences {
  emailNotifications: boolean;
  weeklySummary: boolean;
  abnormalAlerts: boolean;
}

interface ProfileResponse {
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  notificationPreferences: NotificationPreferences;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailNotifications: true,
  weeklySummary: false,
  abnormalAlerts: true,
};

function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const base = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const stored = raw as Record<string, unknown>;
    if (typeof stored.emailNotifications === 'boolean') base.emailNotifications = stored.emailNotifications;
    if (typeof stored.weeklySummary === 'boolean') base.weeklySummary = stored.weeklySummary;
    if (typeof stored.abnormalAlerts === 'boolean') base.abnormalAlerts = stored.abnormalAlerts;
  }
  return base;
}

// Export data response types
interface ExportBiomarker {
  name: string;
  standardName: string;
  category: string;
  value: number;
  unit: string;
  date: string;
  isAbnormal: boolean;
  referenceRange: {
    min: number;
    max: number;
    source?: string;
  };
  source: string;
}

interface ExportInsurancePlan {
  planName: string;
  insurerName: string;
  planType: string;
  effectiveDate: string;
  terminationDate?: string;
  isActive: boolean;
  isPrimary: boolean;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
}

interface ExportData {
  exportDate: string;
  user: {
    email: string;
    createdAt: string;
  };
  biomarkers: ExportBiomarker[];
  insurancePlans: ExportInsurancePlan[];
  summary: {
    totalBiomarkers: number;
    byCategory: Record<string, number>;
    abnormalCount: number;
    normalCount: number;
  };
}

/**
 * Export all user data as JSON
 * GET /api/v1/settings/export-data
 */
export async function exportUserData(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Fetch user info and data with RLS context
  const { user, biomarkers, insurancePlans } = await withRLSContext(userId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, createdAt: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Fetch all biomarkers with history
    const biomarkers = await tx.biomarker.findMany({
      where: { userId },
      include: { history: true },
      orderBy: { measurementDate: 'desc' },
    });

    // Fetch insurance plans
    const insurancePlans = await tx.insurancePlan.findMany({
      where: { userId },
      orderBy: [{ isPrimary: 'desc' }, { effectiveDate: 'desc' }],
    });

    return { user, biomarkers, insurancePlans };
  });

  // Decrypt biomarkers with controlled concurrency
  const decryptedBiomarkers = await processBatch(
    biomarkers,
    async (biomarker) => {
      const value = parseFloat(encryptionService.decrypt(biomarker.valueEncrypted, userSalt));

      // Determine source description
      let source = 'Manual Entry';
      if (biomarker.sourceType === 'LAB_UPLOAD') {
        source = biomarker.labName || biomarker.sourceFile || 'Lab Upload';
      } else if (biomarker.sourceType === 'EHR_IMPORT') {
        source = 'EHR Import';
      } else if (biomarker.sourceType === 'DEVICE_SYNC') {
        source = 'Device Sync';
      } else if (biomarker.sourceType === 'API_IMPORT') {
        source = 'API Import';
      }

      return {
        name: biomarker.name,
        standardName: biomarker.name.toLowerCase().replace(/\s+/g, '_'),
        category: biomarker.category,
        value,
        unit: biomarker.unit,
        date: biomarker.measurementDate.toISOString().split('T')[0],
        isAbnormal: biomarker.isOutOfRange,
        referenceRange: {
          min: toNumber(biomarker.normalRangeMin),
          max: toNumber(biomarker.normalRangeMax),
          source: biomarker.normalRangeSource ?? undefined,
        },
        source,
      };
    },
    DECRYPT_BATCH_SIZE
  );

  const exportInsurancePlans: ExportInsurancePlan[] = insurancePlans.map((plan) => ({
    planName: plan.planName,
    insurerName: plan.insurerName,
    planType: plan.planType,
    effectiveDate: plan.effectiveDate.toISOString().split('T')[0],
    terminationDate: plan.terminationDate?.toISOString().split('T')[0],
    isActive: plan.isActive,
    isPrimary: plan.isPrimary,
    deductibleIndividual: toNumber(plan.deductibleIndividual),
    deductibleFamily: toNumber(plan.deductibleFamily),
    oopMaxIndividual: toNumber(plan.oopMaxIndividual),
    oopMaxFamily: toNumber(plan.oopMaxFamily),
  }));

  // Calculate summary statistics
  const byCategory: Record<string, number> = {};
  let abnormalCount = 0;
  let normalCount = 0;

  for (const biomarker of decryptedBiomarkers) {
    byCategory[biomarker.category] = (byCategory[biomarker.category] || 0) + 1;
    if (biomarker.isAbnormal) {
      abnormalCount++;
    } else {
      normalCount++;
    }
  }

  const exportData: ExportData = {
    exportDate: new Date().toISOString(),
    user: {
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
    biomarkers: decryptedBiomarkers,
    insurancePlans: exportInsurancePlans,
    summary: {
      totalBiomarkers: decryptedBiomarkers.length,
      byCategory,
      abnormalCount,
      normalCount,
    },
  };

  // Audit log: EXPORT user data
  await auditService.logAccess('UserData', userId, { req, userId }, {
    operation: 'EXPORT',
    biomarkerCount: decryptedBiomarkers.length,
    insurancePlanCount: exportInsurancePlans.length,
  });

  const response: ApiResponse<ExportData> = {
    success: true,
    data: exportData,
  };

  res.json(response);
}

/**
 * Delete all user health data (biomarkers, insurance, health needs, goals)
 * DELETE /api/v1/settings/delete-data
 */
export async function deleteAllData(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  // Phase 1 — enumerate GCS-backed files before any deletion. RLS-scoped read.
  const filesToDelete = await withRLSTransaction(userId, async (tx) => {
    return tx.userFile.findMany({
      where: { userId },
      select: { id: true, storageKey: true, filename: true },
    });
  });

  // Phase 2 — delete GCS objects first. See C-6 in SECURITY_STATUS:
  // orphaned-DB-rows-pointing-at-missing-GCS-objects is self-healing on
  // retry (signed URL 404s, app surfaces "file unavailable"), but
  // orphaned-GCS-objects-with-no-DB-pointer is unrecoverable PHI leakage —
  // no one will ever find them to clean up. So we delete GCS first and
  // fail hard on any non-404 failure, leaving the DB intact for retry.
  //
  // NOTE: fileController.ts deleteFile() (single-file path) still uses
  // log-and-continue semantics — see F-22 in the domain audit. That
  // inconsistency is deliberate for now (bulk-delete is the HIPAA
  // right-to-delete path; single-file delete is a foreground user
  // action with easier manual recovery). F-22 migrates fileController
  // to the same policy in a later PR.
  const gcsResults = await storageService.deleteFiles(
    filesToDelete.map((f) => f.storageKey)
  );
  const gcsFailures = gcsResults.filter((r) => !r.ok);

  if (gcsFailures.length > 0) {
    await auditService.logSystem('DELETE', 'UserData', {
      action: 'DELETE_DATA_FAILED',
      description: 'GCS deletion failed during deleteAllData; DB rows preserved for retry',
      component: 'settingsController.deleteAllData',
      count: gcsFailures.length,
      error: gcsFailures
        .slice(0, 5)
        .map((f) => `${f.storageKey}: ${f.error}`)
        .join('; '),
    });

    throw new Error(
      `Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. ` +
      `No data was deleted. Please try again.`
    );
  }

  // Phase 3 — delete DB rows in a single transaction. deleteMany returns
  // `.count`, so we avoid a separate pre-count read.
  const counts = await withRLSTransaction(userId, async (tx) => {
    const [biomarkerCount, insurancePlanCount, healthNeedCount, healthGoalCount, userFileCount] =
      await Promise.all([
        tx.biomarker.deleteMany({ where: { userId } }).then((r) => r.count),
        tx.insurancePlan.deleteMany({ where: { userId } }).then((r) => r.count),
        tx.healthNeed.deleteMany({ where: { userId } }).then((r) => r.count),
        tx.healthGoal.deleteMany({ where: { userId } }).then((r) => r.count),
        tx.userFile.deleteMany({ where: { userId } }).then((r) => r.count),
      ]);
    return { biomarkerCount, insurancePlanCount, healthNeedCount, healthGoalCount, userFileCount };
  });

  // Phase 4 — audit the success with the actual deletion counts.
  await auditService.logDelete('UserData', userId, {
    deletedBiomarkers: counts.biomarkerCount,
    deletedInsurancePlans: counts.insurancePlanCount,
    deletedHealthNeeds: counts.healthNeedCount,
    deletedHealthGoals: counts.healthGoalCount,
    deletedUserFiles: counts.userFileCount,
    deletedGcsObjects: gcsResults.length,
  }, { req, userId });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Delete user account and all associated data
 * DELETE /api/v1/settings/delete-account
 */
export async function deleteAccount(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { password } = req.body;

  if (!password) {
    throw new UnauthorizedError('Password is required to delete account');
  }

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  // Fetch user to verify password (with RLS context)
  const user = await withRLSContext(userId, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true },
    });
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    throw new UnauthorizedError('Invalid password');
  }

  // Audit log: DELETE account (log before deletion)
  await auditService.logDelete('User', userId, {
    email: user.email,
    reason: 'user_requested',
  }, { req, userId });

  // Revoke OAuth tokens on any active lab connections BEFORE the
  // cascade delete drops the LabConnection rows — otherwise the tokens
  // stay valid at the provider even though we've lost the ability to
  // call revoke. Best-effort; each disconnect swallows its own errors.
  await revokeAllUserConnections(userId);

  // Enumerate GCS-backed files BEFORE the cascade delete drops the UserFile
  // rows. See C-6 — "GCS first, fail hard" policy. If we let the cascade
  // run first we'd lose the storageKeys and orphan PHI in the bucket.
  const filesToDelete = await withRLSTransaction(userId, async (tx) => {
    return tx.userFile.findMany({
      where: { userId },
      select: { id: true, storageKey: true },
    });
  });

  const gcsResults = await storageService.deleteFiles(
    filesToDelete.map((f) => f.storageKey)
  );
  const gcsFailures = gcsResults.filter((r) => !r.ok);

  if (gcsFailures.length > 0) {
    await auditService.logSystem('DELETE', 'User', {
      action: 'DELETE_ACCOUNT_FAILED',
      description: 'GCS deletion failed during deleteAccount; account preserved for retry',
      component: 'settingsController.deleteAccount',
      count: gcsFailures.length,
      error: gcsFailures
        .slice(0, 5)
        .map((f) => `${f.storageKey}: ${f.error}`)
        .join('; '),
    });

    throw new Error(
      `Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. ` +
      `Your account was not deleted. Please try again.`
    );
  }

  // Only now run the cascade delete. admin context (userId=null).
  await withRLSContext(null, async (tx) => {
    await tx.user.delete({
      where: { id: userId },
    });
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

/**
 * Get the authenticated user's profile
 * GET /api/v1/settings/profile
 */
export async function getProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  const user = await withRLSContext(userId, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        createdAt: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
        notificationPreferences: true,
      },
    });
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const firstName = user.firstNameEncrypted
    ? encryptionService.decrypt(user.firstNameEncrypted, userSalt)
    : null;
  const lastName = user.lastNameEncrypted
    ? encryptionService.decrypt(user.lastNameEncrypted, userSalt)
    : null;

  await auditService.logAccess('User', userId, { req, userId }, {
    operation: 'PHI_ACCESS',
    fields: ['firstName', 'lastName'],
  });

  const response: ApiResponse<ProfileResponse> = {
    success: true,
    data: {
      email: user.email,
      firstName,
      lastName,
      createdAt: user.createdAt.toISOString(),
      notificationPreferences: normalizeNotificationPreferences(user.notificationPreferences),
    },
  };

  res.json(response);
}

/**
 * Update the authenticated user's profile (first/last name)
 * PATCH /api/v1/settings/profile
 */
export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { firstName, lastName } = req.body as { firstName?: string; lastName?: string };

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  const updateData: { firstNameEncrypted?: string | null; lastNameEncrypted?: string | null } = {};
  const fieldsUpdated: string[] = [];

  if (firstName !== undefined) {
    updateData.firstNameEncrypted = firstName ? encryptionService.encrypt(firstName, userSalt) : null;
    fieldsUpdated.push('firstName');
  }
  if (lastName !== undefined) {
    updateData.lastNameEncrypted = lastName ? encryptionService.encrypt(lastName, userSalt) : null;
    fieldsUpdated.push('lastName');
  }

  const updated = await withRLSContext(userId, async (tx) => {
    return tx.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        email: true,
        createdAt: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
        notificationPreferences: true,
      },
    });
  });

  const decryptedFirstName = updated.firstNameEncrypted
    ? encryptionService.decrypt(updated.firstNameEncrypted, userSalt)
    : null;
  const decryptedLastName = updated.lastNameEncrypted
    ? encryptionService.decrypt(updated.lastNameEncrypted, userSalt)
    : null;

  await auditService.logUpdate(
    'User',
    userId,
    null,
    null,
    { req, userId },
    { fieldsUpdated }
  );

  const response: ApiResponse<ProfileResponse> = {
    success: true,
    data: {
      email: updated.email,
      firstName: decryptedFirstName,
      lastName: decryptedLastName,
      createdAt: updated.createdAt.toISOString(),
      notificationPreferences: normalizeNotificationPreferences(updated.notificationPreferences),
    },
  };

  res.json(response);
}

/**
 * Update the authenticated user's notification preferences
 * PATCH /api/v1/settings/notifications
 */
export async function updateNotifications(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input = req.body as Partial<NotificationPreferences>;

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const updated = await withRLSContext(userId, async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });

    if (!current) {
      throw new UnauthorizedError('User not found');
    }

    const merged: NotificationPreferences = {
      ...normalizeNotificationPreferences(current.notificationPreferences),
      ...input,
    };

    return tx.user.update({
      where: { id: userId },
      data: { notificationPreferences: { ...merged } },
      select: { notificationPreferences: true },
    });
  });

  const prefs = normalizeNotificationPreferences(updated.notificationPreferences);

  await auditService.logUpdate(
    'User',
    userId,
    null,
    null,
    { req, userId },
    { fieldsUpdated: Object.keys(input), resource: 'notificationPreferences' }
  );

  const response: ApiResponse<NotificationPreferences> = {
    success: true,
    data: prefs,
  };

  res.json(response);
}

/**
 * GET /api/v1/settings/health-profile
 * Returns the user's decrypted self-reported health profile.
 */
export async function getHealthProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const profile = await getDecryptedHealthProfile(userId);

  await auditService.logAccess('UserHealthProfile', userId, { req, userId }, {
    operation: 'PHI_ACCESS',
    conditionCount: profile.conditions.length,
    medicationCount: profile.medications.length,
  });

  const response: ApiResponse<UserHealthProfile> = {
    success: true,
    data: profile,
  };
  res.json(response);
}

/**
 * PATCH /api/v1/settings/health-profile
 * Partial update. Undefined fields in the body leave the existing value
 * untouched; arrays (conditions/medications/familyHistory) are fully
 * replaced when present in the body, per the usual REST partial-update
 * convention for array fields.
 */
export async function updateHealthProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input = req.body as Partial<UserHealthProfile>;

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const existing = await getDecryptedHealthProfile(userId);

  // Merge: undefined fields inherit from existing, defined fields overwrite.
  const merged: UserHealthProfile = {
    biologicalSex: input.biologicalSex ?? existing.biologicalSex,
    ageRange: input.ageRange ?? existing.ageRange,
    conditions: input.conditions ?? existing.conditions,
    medications: input.medications ?? existing.medications,
    familyHistory: input.familyHistory ?? existing.familyHistory,
    smokingStatus: input.smokingStatus ?? existing.smokingStatus,
    exerciseLevel: input.exerciseLevel ?? existing.exerciseLevel,
    additionalContext: input.additionalContext ?? existing.additionalContext,
  };

  const saved = await saveHealthProfile(userId, merged);

  await auditService.logUpdate(
    'UserHealthProfile',
    userId,
    null,
    null,
    { req, userId },
    {
      fieldsUpdated: Object.keys(input),
      conditionCount: saved.conditions.length,
      medicationCount: saved.medications.length,
    }
  );

  const response: ApiResponse<UserHealthProfile> = {
    success: true,
    data: saved,
  };
  res.json(response);
}
