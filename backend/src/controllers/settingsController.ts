/**
 * Settings Controller
 *
 * Handles user settings operations including data export and account deletion.
 * All operations are scoped to the authenticated user.
 */

import { Response } from 'express';
import { Prisma } from '../../generated/prisma/index.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { getPrismaClient, withRLSContext, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { decryptOriginalFilename } from '../utils/userFileNames.js';
import { getAuditLogService } from '../services/auditLog.js';
import { storageService } from '../services/storageService.js';
import { toNumber } from '../utils/numberConversion.js';
import { processBatch } from '../utils/batchProcessor.js';
import { UnauthorizedError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
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

/**
 * Email notification preferences — the canonical new shape.
 *
 * Defaults are all-on so new users get the retention emails without opting
 * in. Anyone who explicitly toggles something to false keeps that choice.
 */
export interface EmailNotificationPreferences {
  enabled: boolean;          // master switch
  newResults: boolean;       // lab extraction completed
  outOfRangeAlerts: boolean; // one or more biomarkers flagged abnormal
  goalReminders: boolean;    // weekly nudge on active goals
  weeklySummary: boolean;    // weekly digest
  planExpiring: boolean;     // 7 days before plan expiry
}

/**
 * Full preferences response shape. The top-level `emailNotifications` /
 * `weeklySummary` / `abnormalAlerts` keys are back-compat aliases so the
 * existing Account Settings toggles keep working unchanged. New UIs read
 * `email.*` directly; dispatchers (notificationService) also read `email.*`.
 */
export interface NotificationPreferences {
  emailNotifications: boolean;
  weeklySummary: boolean;
  abnormalAlerts: boolean;
  email: EmailNotificationPreferences;
}

interface ProfileResponse {
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  notificationPreferences: NotificationPreferences;
}

export const DEFAULT_EMAIL_PREFERENCES: EmailNotificationPreferences = {
  enabled: true,
  newResults: true,
  outOfRangeAlerts: true,
  goalReminders: true,
  weeklySummary: true,
  planExpiring: true,
};

/**
 * Normalize whatever shape is in the DB into the canonical response.
 *
 * Handles three shapes the column might hold:
 *   1. New nested: `{ email: { enabled, newResults, ... } }`
 *   2. Legacy flat: `{ emailNotifications, weeklySummary, abnormalAlerts }`
 *   3. Empty/unknown: defaults
 *
 * The back-compat mapping: legacy `emailNotifications` = new `email.enabled`;
 * legacy `abnormalAlerts` = new `email.outOfRangeAlerts`; legacy
 * `weeklySummary` = new `email.weeklySummary`. Nested keys win over legacy
 * when both are present (new UI is authoritative).
 */
export function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const email: EmailNotificationPreferences = { ...DEFAULT_EMAIL_PREFERENCES };

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const stored = raw as Record<string, unknown>;

    // 1. Legacy flat-key back-compat. Apply first so nested keys can override.
    if (typeof stored.emailNotifications === 'boolean') email.enabled = stored.emailNotifications;
    if (typeof stored.weeklySummary === 'boolean') email.weeklySummary = stored.weeklySummary;
    if (typeof stored.abnormalAlerts === 'boolean') email.outOfRangeAlerts = stored.abnormalAlerts;

    // 2. New nested shape — overlays on top of the legacy values.
    const nested = stored.email;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const e = nested as Record<string, unknown>;
      if (typeof e.enabled === 'boolean') email.enabled = e.enabled;
      if (typeof e.newResults === 'boolean') email.newResults = e.newResults;
      if (typeof e.outOfRangeAlerts === 'boolean') email.outOfRangeAlerts = e.outOfRangeAlerts;
      if (typeof e.goalReminders === 'boolean') email.goalReminders = e.goalReminders;
      if (typeof e.weeklySummary === 'boolean') email.weeklySummary = e.weeklySummary;
      if (typeof e.planExpiring === 'boolean') email.planExpiring = e.planExpiring;
    }
  }

  return {
    // Canonical new shape:
    email,
    // Back-compat aliases so the existing settings UI keeps working:
    emailNotifications: email.enabled,
    weeklySummary: email.weeklySummary,
    abnormalAlerts: email.outOfRangeAlerts,
  };
}

// Export data response types
interface ExportBiomarkerHistoryEntry {
  value: number;
  date: string;
}

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
  notes?: string;
  history: ExportBiomarkerHistoryEntry[];
}

interface ExportInsuranceBenefit {
  serviceName: string;
  serviceCategory: string;
  inNetworkCovered: boolean;
  inNetworkCopay: number | null;
  inNetworkCoinsurance: number | null;
  inNetworkDeductibleApplies: boolean;
  outNetworkCovered: boolean;
  outNetworkCopay: number | null;
  outNetworkCoinsurance: number | null;
  outNetworkDeductibleApplies: boolean;
  preAuthRequired: boolean;
  limitations?: string;
}

interface ExportInsurancePlan {
  // Plan-level identity exposed so per-plan benefits + per-plan expense rows
  // can be cross-referenced inside the export. Not PHI on its own.
  id: string;
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
  memberId?: string;
  groupId?: string;
  benefits: ExportInsuranceBenefit[];
}

interface ExportHealthGoal {
  name: string;
  description?: string;
  category: string;
  targetValue: number;
  currentValue?: number;
  startValue?: number;
  unit: string;
  direction: string;
  startDate: string;
  targetDate: string;
  status: string;
  progress: number;
  milestones?: string;
  reminderFrequency?: string;
  progressHistory: Array<{
    value: number;
    progress: number;
    note?: string;
    recordedAt: string;
  }>;
}

interface ExportHealthNeed {
  name: string;
  needType: string;
  description: string;
  urgency: string;
  status: string;
  relatedBiomarkerIds: string[];
  createdAt: string;
  resolvedAt?: string;
}

interface ExportExpenseProjection {
  serviceType: string;
  estimatedCost: number | null;
  frequencyPerYear: number;
  isInNetwork: boolean;
  notes?: string;
  planId: string;
}

interface ExportExpenseActual {
  serviceType: string;
  providerName?: string;
  billedAmount: number | null;
  insurancePaid: number | null;
  patientPaid: number | null;
  appliedToDeductible: number | null;
  appliedToOop: number | null;
  dateOfService?: string;
  isInNetwork: boolean | null;
  claimStatus: string;
  notes?: string;
}

interface ExportCostAnalysis {
  claudeResponse: string;
  totalProjectedOop: number | null;
  analysisDate: string;
}

interface ExportUserFile {
  // id + storageKey let the user reconcile metadata against the file
  // download endpoint. The actual bytes aren't included in the JSON
  // export — see filesNote in ExportData.
  id: string;
  storageKey: string;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  labName?: string;
  labDate?: string;
  biomarkersExtracted: number;
  createdAt: string;
}

interface ExportProviderRelationship {
  relationshipType: string;
  status: string;
  role: 'patient' | 'provider';
  canViewBiomarkers: boolean;
  canViewInsurance: boolean;
  canViewHealthNeeds: boolean;
  canEditData: boolean;
  consentGrantedAt?: string;
  consentExpiresAt?: string;
  notes?: string;
}

interface ExportUserProfile {
  email: string;
  role: string;
  createdAt: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phone?: string;
  address?: string;
}

interface ExportData {
  exportDate: string;
  user: ExportUserProfile;
  healthProfile: UserHealthProfile;
  biomarkers: ExportBiomarker[];
  insurancePlans: ExportInsurancePlan[];
  healthGoals: ExportHealthGoal[];
  healthNeeds: ExportHealthNeed[];
  expenseProjections: ExportExpenseProjection[];
  expenseActuals: ExportExpenseActual[];
  costAnalyses: ExportCostAnalysis[];
  files: ExportUserFile[];
  providerRelationships: ExportProviderRelationship[];
  filesNote: string;
  summary: {
    totalBiomarkers: number;
    byCategory: Record<string, number>;
    abnormalCount: number;
    normalCount: number;
    totalInsurancePlans: number;
    totalHealthGoals: number;
    totalHealthNeeds: number;
    totalExpenseProjections: number;
    totalExpenseActuals: number;
    totalCostAnalyses: number;
    totalFiles: number;
    totalProviderRelationships: number;
  };
}

function tryDecryptNumber(
  encrypted: string | null | undefined,
  salt: string,
  decrypt: (cipher: string, salt: string) => string | null
): number | null {
  if (!encrypted) return null;
  const plain = decrypt(encrypted, salt);
  if (plain === null) return null;
  const parsed = parseFloat(plain);
  return Number.isFinite(parsed) ? parsed : null;
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

  // Fetch user info and every PHI category under RLS
  const {
    user,
    biomarkers,
    insurancePlans,
    healthGoals,
    healthNeeds,
    expenseProjections,
    expenseActuals,
    costAnalyses,
    userFiles,
    providerRelationships,
  } = await withRLSContext(userId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        createdAt: true,
        role: true,
        firstNameEncrypted: true,
        lastNameEncrypted: true,
        dateOfBirthEncrypted: true,
        phoneEncrypted: true,
        addressEncrypted: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const [
      biomarkers,
      insurancePlans,
      healthGoals,
      healthNeeds,
      expenseProjections,
      expenseActuals,
      costAnalyses,
      userFiles,
      providerRelationships,
    ] = await Promise.all([
      tx.biomarker.findMany({
        where: { userId },
        include: { history: { orderBy: { measurementDate: 'desc' } } },
        orderBy: { measurementDate: 'desc' },
      }),
      tx.insurancePlan.findMany({
        where: { userId },
        // Benefits are per-plan child rows; include them so the export is a
        // complete snapshot the user can take elsewhere.
        include: { benefits: true },
        orderBy: [{ isPrimary: 'desc' }, { effectiveDate: 'desc' }],
      }),
      tx.healthGoal.findMany({
        where: { userId },
        include: { progressHistory: { orderBy: { recordedAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      tx.healthNeed.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      tx.expenseProjection.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      tx.expenseActual.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      tx.costAnalysis.findMany({
        where: { userId },
        orderBy: { analysisDate: 'desc' },
      }),
      tx.userFile.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      tx.providerPatient.findMany({
        where: { OR: [{ patientId: userId }, { providerId: userId }] },
      }),
    ]);

    return {
      user,
      biomarkers,
      insurancePlans,
      healthGoals,
      healthNeeds,
      expenseProjections,
      expenseActuals,
      costAnalyses,
      userFiles,
      providerRelationships,
    };
  });

  // M-7 / DECRYPT SAFETY: one corrupt or key-mismatched PHI row must not 500
  // the entire §164.524 right-of-access export. Wrap each inline decrypt so a
  // single bad field yields null (logged at warn) instead of throwing — the
  // user still gets every other row of their record. The encrypted ciphertext
  // is never logged.
  const tryDecrypt = (cipher: string, salt: string): string | null => {
    try {
      return encryptionService.decrypt(cipher, salt);
    } catch (err) {
      logger.warn('Failed to decrypt PHI field during data export; emitting null', {
        prefix: 'settings.exportUserData',
        data: { userId, error: err instanceof Error ? err.message : 'unknown' },
      });
      return null;
    }
  };
  // Number-typed exports route through tryDecryptNumber, which already maps a
  // null/non-finite decrypt to null. Pass the safe wrapper so a bad numeric
  // field degrades to null instead of NaN-or-throw.
  const decrypt = tryDecrypt;

  // Self-reported health profile (conditions, medications, family history,
  // etc.) is PHI the user explicitly entered and feeds the AI — it must be in
  // a §164.524 right-of-access export. getDecryptedHealthProfile returns the
  // empty shape when none is set, so the export is always well-formed.
  const healthProfile = await getDecryptedHealthProfile(userId);

  const userProfile: ExportUserProfile = {
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    firstName: user.firstNameEncrypted ? decrypt(user.firstNameEncrypted, userSalt) ?? undefined : undefined,
    lastName: user.lastNameEncrypted ? decrypt(user.lastNameEncrypted, userSalt) ?? undefined : undefined,
    dateOfBirth: user.dateOfBirthEncrypted ? decrypt(user.dateOfBirthEncrypted, userSalt) ?? undefined : undefined,
    phone: user.phoneEncrypted ? decrypt(user.phoneEncrypted, userSalt) ?? undefined : undefined,
    address: user.addressEncrypted ? decrypt(user.addressEncrypted, userSalt) ?? undefined : undefined,
  };

  // Decrypt biomarkers (and each biomarker's history) with controlled concurrency
  const decryptedBiomarkers = await processBatch(
    biomarkers,
    async (biomarker) => {
      const decryptedValue = decrypt(biomarker.valueEncrypted, userSalt);
      const value = decryptedValue !== null ? parseFloat(decryptedValue) : NaN;

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

      const history: ExportBiomarkerHistoryEntry[] = biomarker.history.map((h) => {
        const decryptedHistoryValue = decrypt(h.valueEncrypted, userSalt);
        return {
          value: decryptedHistoryValue !== null ? parseFloat(decryptedHistoryValue) : NaN,
          date: h.measurementDate.toISOString().split('T')[0],
        };
      });

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
        notes: biomarker.notesEncrypted ? decrypt(biomarker.notesEncrypted, userSalt) ?? undefined : undefined,
        history,
      };
    },
    DECRYPT_BATCH_SIZE
  );

  const exportInsurancePlans: ExportInsurancePlan[] = insurancePlans.map((plan) => ({
    id: plan.id,
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
    memberId: plan.memberIdEncrypted ? decrypt(plan.memberIdEncrypted, userSalt) ?? undefined : undefined,
    groupId: plan.groupIdEncrypted ? decrypt(plan.groupIdEncrypted, userSalt) ?? undefined : undefined,
    benefits: plan.benefits.map((benefit) => ({
      serviceName: benefit.serviceName,
      serviceCategory: benefit.serviceCategory,
      inNetworkCovered: benefit.inNetworkCovered,
      inNetworkCopay: benefit.inNetworkCopay !== null ? toNumber(benefit.inNetworkCopay) : null,
      inNetworkCoinsurance:
        benefit.inNetworkCoinsurance !== null ? toNumber(benefit.inNetworkCoinsurance) : null,
      inNetworkDeductibleApplies: benefit.inNetworkDeductible,
      outNetworkCovered: benefit.outNetworkCovered,
      outNetworkCopay: benefit.outNetworkCopay !== null ? toNumber(benefit.outNetworkCopay) : null,
      outNetworkCoinsurance:
        benefit.outNetworkCoinsurance !== null ? toNumber(benefit.outNetworkCoinsurance) : null,
      outNetworkDeductibleApplies: benefit.outNetworkDeductible,
      preAuthRequired: benefit.preAuthRequired,
      limitations: benefit.limitations ?? undefined,
    })),
  }));

  const exportHealthGoals: ExportHealthGoal[] = await processBatch(
    healthGoals,
    async (goal) => ({
      name: goal.name,
      description: goal.descriptionEncrypted ? decrypt(goal.descriptionEncrypted, userSalt) ?? undefined : undefined,
      category: goal.category,
      targetValue: toNumber(goal.targetValue),
      currentValue: goal.currentValue !== null && goal.currentValue !== undefined ? toNumber(goal.currentValue) : undefined,
      startValue: goal.startValue !== null && goal.startValue !== undefined ? toNumber(goal.startValue) : undefined,
      unit: goal.unit,
      direction: goal.direction,
      startDate: goal.startDate.toISOString().split('T')[0],
      targetDate: goal.targetDate.toISOString().split('T')[0],
      status: goal.status,
      progress: toNumber(goal.progress),
      milestones: goal.milestones ?? undefined,
      reminderFrequency: goal.reminderFrequency ?? undefined,
      progressHistory: goal.progressHistory.map((entry) => ({
        value: toNumber(entry.value),
        progress: toNumber(entry.progress),
        note: entry.noteEncrypted ? decrypt(entry.noteEncrypted, userSalt) ?? undefined : undefined,
        recordedAt: entry.recordedAt.toISOString(),
      })),
    }),
    DECRYPT_BATCH_SIZE
  );

  const exportHealthNeeds: ExportHealthNeed[] = await processBatch(
    healthNeeds,
    async (need) => ({
      name: need.name,
      needType: need.needType,
      description: decrypt(need.descriptionEncrypted, userSalt) ?? '',
      urgency: need.urgency,
      status: need.status,
      relatedBiomarkerIds: need.relatedBiomarkerIds,
      createdAt: need.createdAt.toISOString(),
      resolvedAt: need.resolvedAt?.toISOString(),
    }),
    DECRYPT_BATCH_SIZE
  );

  const exportExpenseProjections: ExportExpenseProjection[] = await processBatch(
    expenseProjections,
    async (projection) => ({
      serviceType: decrypt(projection.serviceTypeEncrypted, userSalt) ?? '',
      estimatedCost: tryDecryptNumber(projection.estimatedCostEncrypted, userSalt, decrypt),
      frequencyPerYear: projection.frequencyPerYear,
      isInNetwork: projection.isInNetwork,
      notes: projection.notesEncrypted ? decrypt(projection.notesEncrypted, userSalt) ?? undefined : undefined,
      planId: projection.planId,
    }),
    DECRYPT_BATCH_SIZE
  );

  const exportExpenseActuals: ExportExpenseActual[] = await processBatch(
    expenseActuals,
    async (actual) => ({
      serviceType: decrypt(actual.serviceTypeEncrypted, userSalt) ?? '',
      providerName: actual.providerNameEncrypted ? decrypt(actual.providerNameEncrypted, userSalt) ?? undefined : undefined,
      billedAmount: tryDecryptNumber(actual.billedAmountEncrypted, userSalt, decrypt),
      insurancePaid: tryDecryptNumber(actual.insurancePaidEncrypted, userSalt, decrypt),
      patientPaid: tryDecryptNumber(actual.patientPaidEncrypted, userSalt, decrypt),
      appliedToDeductible: tryDecryptNumber(actual.appliedToDeductibleEncrypted, userSalt, decrypt),
      appliedToOop: tryDecryptNumber(actual.appliedToOopEncrypted, userSalt, decrypt),
      dateOfService: actual.dateOfService?.toISOString().split('T')[0],
      isInNetwork: actual.isInNetwork,
      claimStatus: actual.claimStatus,
      notes: actual.notesEncrypted ? decrypt(actual.notesEncrypted, userSalt) ?? undefined : undefined,
    }),
    DECRYPT_BATCH_SIZE
  );

  const exportCostAnalyses: ExportCostAnalysis[] = await processBatch(
    costAnalyses,
    async (analysis) => ({
      // Column renamed in migration 20260424; export shape keeps the
       // legacy `claudeResponse` name so the JSON export contract for users
       // who already downloaded their data stays stable.
      claudeResponse: decrypt(analysis.claudeResponseEncrypted, userSalt) ?? '',
      totalProjectedOop: tryDecryptNumber(analysis.totalProjectedOopEncrypted, userSalt, decrypt),
      analysisDate: analysis.analysisDate.toISOString(),
    }),
    DECRYPT_BATCH_SIZE
  );

  const exportUserFiles: ExportUserFile[] = userFiles.map((file) => ({
    id: file.id,
    storageKey: file.storageKey,
    // L24: original filename is encrypted at rest; decrypt for the owner's export.
    originalFilename: decryptOriginalFilename(file, encryptionService, userSalt),
    fileType: file.fileType,
    fileSize: file.fileSize,
    labName: file.labName ?? undefined,
    labDate: file.labDate?.toISOString().split('T')[0],
    biomarkersExtracted: file.biomarkersExtracted,
    createdAt: file.createdAt.toISOString(),
  }));

  const exportProviderRelationships: ExportProviderRelationship[] = await processBatch(
    providerRelationships,
    async (rel) => ({
      relationshipType: rel.relationshipType,
      status: rel.status,
      role: rel.patientId === userId ? 'patient' : 'provider',
      canViewBiomarkers: rel.canViewBiomarkers,
      canViewInsurance: rel.canViewInsurance,
      canViewHealthNeeds: rel.canViewHealthNeeds,
      canEditData: rel.canEditData,
      consentGrantedAt: rel.consentGrantedAt?.toISOString(),
      consentExpiresAt: rel.consentExpiresAt?.toISOString(),
      notes: rel.notesEncrypted ? decrypt(rel.notesEncrypted, userSalt) ?? undefined : undefined,
    }),
    DECRYPT_BATCH_SIZE
  );

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
    user: userProfile,
    healthProfile,
    biomarkers: decryptedBiomarkers,
    insurancePlans: exportInsurancePlans,
    healthGoals: exportHealthGoals,
    healthNeeds: exportHealthNeeds,
    expenseProjections: exportExpenseProjections,
    expenseActuals: exportExpenseActuals,
    costAnalyses: exportCostAnalyses,
    files: exportUserFiles,
    providerRelationships: exportProviderRelationships,
    filesNote: 'File metadata only — original file bytes can be downloaded individually from the Files section.',
    summary: {
      totalBiomarkers: decryptedBiomarkers.length,
      byCategory,
      abnormalCount,
      normalCount,
      totalInsurancePlans: exportInsurancePlans.length,
      totalHealthGoals: exportHealthGoals.length,
      totalHealthNeeds: exportHealthNeeds.length,
      totalExpenseProjections: exportExpenseProjections.length,
      totalExpenseActuals: exportExpenseActuals.length,
      totalCostAnalyses: exportCostAnalyses.length,
      totalFiles: exportUserFiles.length,
      totalProviderRelationships: exportProviderRelationships.length,
    },
  };

  // Audit log: EXPORT user data with per-category counts (§164.524 right-of-access).
  // M18: use logExport (action=EXPORT, failClosed) rather than logAccess (action=READ,
  // best-effort) — the largest PHI egress in the app must be recorded as an export
  // a breach query can find, and must fail closed if the audit can't be written.
  await auditService.logExport('UserData', [userId], 'json', { req, userId }, {
    biomarkerCount: decryptedBiomarkers.length,
    insurancePlanCount: exportInsurancePlans.length,
    healthGoalCount: exportHealthGoals.length,
    healthNeedCount: exportHealthNeeds.length,
    expenseProjectionCount: exportExpenseProjections.length,
    expenseActualCount: exportExpenseActuals.length,
    costAnalysisCount: exportCostAnalyses.length,
    fileCount: exportUserFiles.length,
    providerRelationshipCount: exportProviderRelationships.length,
    healthProfileConditionCount: healthProfile.conditions.length,
    healthProfileMedicationCount: healthProfile.medications.length,
  });

  const response: ApiResponse<ExportData> = {
    success: true,
    data: exportData,
  };

  // Prevent browsers and proxies from caching PHI. Export responses contain
  // the entire decrypted health record — a cached copy on a shared terminal
  // or corporate proxy would be a HIPAA incident.
  res.set({
    'Cache-Control': 'no-store, no-cache, private, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  res.json(response);
}

/**
 * Delete all user health data (biomarkers, insurance, health needs, goals,
 * expenses, cost analyses, files, provider relationships).
 * Requires password confirmation — this is an equally destructive operation
 * as deleteAccount and must not rely solely on session auth.
 * DELETE /api/v1/settings/delete-data
 */
export async function deleteAllData(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { password } = req.body as { password: string };

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  // Verify password before touching any data.
  const user = await withRLSContext(userId, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    throw new UnauthorizedError('Invalid password');
  }

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

    // Record the BLOCKED data wipe as an explicit failure on the UserData
    // resource so the success-counts logDelete (Phase 4) can't be confused
    // with this aborted attempt (mirrors the deleteAccount M-13 fix).
    await auditService.logDelete(
      'UserData',
      userId,
      { reason: 'user_requested' },
      { req, userId },
      { action: 'DELETE_DATA_BLOCKED' },
      {
        success: false,
        errorMessage: `GCS deletion failed for ${gcsFailures.length} of ${filesToDelete.length} files; no data deleted.`,
      }
    );

    throw new Error(
      `Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. ` +
      `No data was deleted. Please try again.`
    );
  }

  // Revoke OAuth tokens at the upstream lab provider BEFORE the LabConnection
  // rows are wiped below — otherwise the access/refresh tokens stay valid at
  // the provider with no local record left to revoke them. Best-effort: each
  // disconnect swallows its own errors. Mirrors deleteAccount. Done only after
  // the GCS step succeeds so an aborted run doesn't sever provider access for
  // data that was never deleted.
  await revokeAllUserConnections(userId);

  // Phase 3 — delete DB rows in FK dependency order within a single RLS
  // transaction. deleteMany returns `.count`, so we avoid a separate
  // pre-count read.
  //
  // Order: cost analyses → expense actuals → expense projections →
  // provider relationships → user files → biomarkers/insurance/goals/needs/
  // DNA/lab connections. Cost analyses and expense actuals reference
  // expense projections and insurance plans, so they must be removed first.
  // BiomarkerHistory + GoalProgressHistory cascade from their parent rows
  // (verified in schema.prisma) — no explicit deleteMany needed.
  //
  // LabConnection is a user-owned table that cascades from User on
  // account-delete (deleteAccount path), but deleteAllData preserves
  // the User row, so it needs an explicit wipe here. Provider-side OAuth
  // tokens are revoked just above via revokeAllUserConnections (best-effort,
  // mirrors deleteAccount) before these local rows are severed, so a
  // data-wipe no longer leaves valid tokens dangling at the upstream provider.
  await withRLSTransaction(userId, async (tx) => {
    const costAnalysisCount = (await tx.costAnalysis.deleteMany({ where: { userId } })).count;
    const expenseActualCount = (await tx.expenseActual.deleteMany({ where: { userId } })).count;
    const expenseProjectionCount = (await tx.expenseProjection.deleteMany({ where: { userId } })).count;
    const providerRelationshipCount = (
      await tx.providerPatient.deleteMany({
        where: { OR: [{ patientId: userId }, { providerId: userId }] },
      })
    ).count;

    const [
      biomarkerCount,
      insurancePlanCount,
      healthNeedCount,
      healthGoalCount,
      userFileCount,
      labConnectionCount,
    ] = await Promise.all([
      tx.biomarker.deleteMany({ where: { userId } }).then((r) => r.count),
      tx.insurancePlan.deleteMany({ where: { userId } }).then((r) => r.count),
      tx.healthNeed.deleteMany({ where: { userId } }).then((r) => r.count),
      tx.healthGoal.deleteMany({ where: { userId } }).then((r) => r.count),
      tx.userFile.deleteMany({ where: { userId } }).then((r) => r.count),
      tx.labConnection.deleteMany({ where: { userId } }).then((r) => r.count),
    ]);

    // Audit the success INSIDE the deletion transaction (tx-threaded) so the
    // durable HIPAA 164.312(b) delete record commits atomically with the wipe.
    // If this audit insert fails, the deletes roll back rather than leaving PHI
    // permanently gone with no record — mirrors deleteAccount (the audit row and
    // the user.delete commit together there too).
    await auditService.logDelete('UserData', userId, {
      deletedBiomarkers: biomarkerCount,
      deletedInsurancePlans: insurancePlanCount,
      deletedHealthNeeds: healthNeedCount,
      deletedHealthGoals: healthGoalCount,
      deletedUserFiles: userFileCount,
      deletedCostAnalyses: costAnalysisCount,
      deletedExpenseActuals: expenseActualCount,
      deletedExpenseProjections: expenseProjectionCount,
      deletedProviderRelationships: providerRelationshipCount,
      deletedLabConnections: labConnectionCount,
      deletedGcsObjects: gcsResults.length,
    }, { req, userId, tx });
  });

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

    // M-13: record the BLOCKED account deletion as an explicit failure on the
    // User resource so the audit trail can't be mistaken for a completed
    // delete. The success row is only written inside the delete transaction
    // below, immediately BEFORE tx.user.delete (#19).
    await auditService.logDelete(
      'User',
      userId,
      { email: user.email, reason: 'user_requested' },
      { req, userId },
      { action: 'DELETE_ACCOUNT_BLOCKED' },
      {
        success: false,
        errorMessage: `GCS deletion failed for ${gcsFailures.length} of ${filesToDelete.length} files; account preserved.`,
      }
    );

    throw new Error(
      `Failed to delete ${gcsFailures.length} of ${filesToDelete.length} files from storage. ` +
      `Your account was not deleted. Please try again.`
    );
  }

  // Only now run the cascade delete, with the User-deleted success row written
  // on the SAME admin transaction (M-13 + #19). The audit insert must come
  // BEFORE tx.user.delete: audit_logs.user_id is FK → users(id) ON DELETE SET
  // NULL, so inserting it after the delete raises 23503 — account gone, client
  // told 500, mandated HIPAA deletion record never written. Inserting first
  // satisfies the FK; the delete then SET NULLs user_id on the fresh row, and
  // attribution survives in resourceId + metadata.deletedUserId. Atomicity
  // keeps the M-13 invariant (success row persists iff the delete commits — a
  // GCS-failure abort throws above, before this tx), and logDelete's
  // failClosed re-throw rolls the delete back rather than completing it with
  // no durable audit trail.
  await withRLSContext(null, async (tx) => {
    await auditService.logDelete(
      'User',
      userId,
      { email: user.email, reason: 'user_requested' },
      { req, userId, tx },
      { deletedUserId: userId }
    );
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
 * Fetch the authenticated user's notification preferences.
 * GET /api/v1/settings/notifications
 */
export async function getNotifications(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const user = await withRLSContext(userId, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const response: ApiResponse<NotificationPreferences> = {
    success: true,
    data: normalizeNotificationPreferences(user.notificationPreferences),
  };
  res.json(response);
}

/**
 * Update the authenticated user's notification preferences.
 * PATCH /api/v1/settings/notifications
 *
 * Accepts both the legacy flat shape (emailNotifications/weeklySummary/
 * abnormalAlerts) and the new nested shape ({ email: { enabled, newResults,
 * ... } }). Stores the canonical new shape so future reads are simple.
 */
export async function updateNotifications(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input = req.body as Partial<{
    emailNotifications: boolean;
    weeklySummary: boolean;
    abnormalAlerts: boolean;
    email: Partial<EmailNotificationPreferences>;
  }>;

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

    const normalized = normalizeNotificationPreferences(current.notificationPreferences);

    // Merge patch into the canonical `email.*` shape. Legacy flat keys from
    // the request body get mapped to their nested equivalents so both the
    // new UI and existing toggles feed the same state.
    const nextEmail: EmailNotificationPreferences = { ...normalized.email };
    if (typeof input.emailNotifications === 'boolean') nextEmail.enabled = input.emailNotifications;
    if (typeof input.weeklySummary === 'boolean') nextEmail.weeklySummary = input.weeklySummary;
    if (typeof input.abnormalAlerts === 'boolean') nextEmail.outOfRangeAlerts = input.abnormalAlerts;
    if (input.email && typeof input.email === 'object') {
      for (const key of Object.keys(input.email) as (keyof EmailNotificationPreferences)[]) {
        const v = input.email[key];
        if (typeof v === 'boolean') nextEmail[key] = v;
      }
    }

    // Persist the canonical nested shape. Legacy flat aliases aren't stored
    // (they're derived on read) to avoid divergence between the two shapes.
    // Prisma's InputJsonValue requires an index signature; build the payload
    // as a JsonObject so booleans pass through cleanly.
    const nextPrefs: Prisma.InputJsonValue = { email: { ...nextEmail } };
    return tx.user.update({
      where: { id: userId },
      data: { notificationPreferences: nextPrefs },
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
