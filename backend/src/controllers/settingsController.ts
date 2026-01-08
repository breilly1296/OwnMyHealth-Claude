/**
 * Settings Controller
 *
 * Handles user settings operations including data export and account deletion.
 * All operations are scoped to the authenticated user.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { toNumber } from '../utils/numberConversion.js';
import { processBatch } from '../utils/batchProcessor.js';
import { UnauthorizedError } from '../middleware/errorHandler.js';
import { verifyPassword } from '../services/authService.js';

const DECRYPT_BATCH_SIZE = 20;

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

  // Fetch user info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, createdAt: true },
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Fetch all biomarkers with history
  const biomarkers = await prisma.biomarker.findMany({
    where: { userId },
    include: { history: true },
    orderBy: { measurementDate: 'desc' },
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

  // Fetch insurance plans
  const insurancePlans = await prisma.insurancePlan.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { effectiveDate: 'desc' }],
  });

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

  // Get counts before deletion for audit log
  const [biomarkerCount, insuranceCount, healthNeedCount, healthGoalCount] = await Promise.all([
    prisma.biomarker.count({ where: { userId } }),
    prisma.insurancePlan.count({ where: { userId } }),
    prisma.healthNeed.count({ where: { userId } }),
    prisma.healthGoal.count({ where: { userId } }),
  ]);

  // Delete all user data in a transaction
  await prisma.$transaction([
    prisma.biomarker.deleteMany({ where: { userId } }),
    prisma.insurancePlan.deleteMany({ where: { userId } }),
    prisma.healthNeed.deleteMany({ where: { userId } }),
    prisma.healthGoal.deleteMany({ where: { userId } }),
  ]);

  // Audit log: DELETE all user data
  await auditService.logDelete('UserData', userId, {
    deletedBiomarkers: biomarkerCount,
    deletedInsurancePlans: insuranceCount,
    deletedHealthNeeds: healthNeedCount,
    deletedHealthGoals: healthGoalCount,
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

  // Fetch user to verify password
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
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

  // Delete user (cascade will delete all related data)
  await prisma.user.delete({
    where: { id: userId },
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}
