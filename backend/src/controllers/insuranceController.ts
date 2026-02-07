/**
 * Insurance Controller
 *
 * Handles CRUD operations for insurance plans with PHI encryption.
 * Member ID and Group ID are encrypted at rest.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import type { InsurancePlanCreateInput } from '../middleware/validation.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { logger } from '../utils/logger.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parsePagination, parseBooleanParam, createPaginationMeta } from '../utils/queryHelpers.js';
import { toNumber } from '../utils/numberConversion.js';
import type { InsurancePlan as PrismaInsurancePlan, InsuranceBenefit as PrismaInsuranceBenefit } from '../../generated/prisma/index.js';

const RESOURCE_TYPE = 'InsurancePlan';

// Service limit data structure for JSON arrays
interface ServiceLimitData {
  service: string;
  limit: number;
  limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
  period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
}

// Response types with decrypted values
interface InsurancePlanResponse {
  id: string;
  userId: string;
  planName: string;
  insurerName: string;
  planType: string;
  planIdNumber?: string;
  memberId?: string;
  groupNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  premium?: number;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
  // Tracking fields (how much has been paid toward limits)
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;
  // Core copay amounts
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  copayTelehealth?: number;
  copayLabWork?: number;
  copayXray?: number;
  copayAdvancedImaging?: number;
  coinsuranceRate?: number;
  // Per-service coinsurance (for plans with "X% after deductible" instead of copays)
  coinsurancePrimaryCare?: number;
  coinsuranceSpecialist?: number;
  coinsuranceUrgentCare?: number;
  coinsuranceEmergency?: number;
  coinsuranceTelehealth?: number;
  coinsuranceLabWork?: number;
  coinsuranceXray?: number;
  coinsuranceAdvancedImaging?: number;

  // Inpatient coverage
  inpatientHospitalCopay?: number;
  inpatientHospitalCoinsurance?: number;
  inpatientMentalHealthCopay?: number;
  inpatientMentalCoinsurance?: number;
  maternityCopay?: number;
  maternityCoinsurance?: number;
  skilledNursingCopay?: number;
  skilledNursingCoinsurance?: number;
  skilledNursingDaysLimit?: number;

  // Outpatient coverage
  outpatientSurgeryCopay?: number;
  outpatientSurgeryCoinsurance?: number;
  outpatientMentalHealthCopay?: number;
  outpatientMentalCoinsurance?: number;

  // Therapy/Rehab coverage
  physicalTherapyCopay?: number;
  physicalTherapyVisitsLimit?: number;
  occupationalTherapyCopay?: number;
  occupationalTherapyVisitsLimit?: number;
  speechTherapyCopay?: number;
  speechTherapyVisitsLimit?: number;
  chiropracticCopay?: number;
  chiropracticVisitsLimit?: number;
  acupunctureCopay?: number;
  acupunctureVisitsLimit?: number;
  cardiacRehabCopay?: number;
  cardiacRehabVisitsLimit?: number;
  pulmonaryRehabCopay?: number;
  pulmonaryRehabVisitsLimit?: number;

  // Prescription (Rx) benefits
  rxTier1Copay?: number;
  rxTier2Copay?: number;
  rxTier3Copay?: number;
  rxTier4Copay?: number;
  rxTier1Coinsurance?: number;
  rxTier2Coinsurance?: number;
  rxTier3Coinsurance?: number;
  rxTier4Coinsurance?: number;
  rxRetailDaysSupply?: number;
  rxMailOrderDaysSupply?: number;
  rxDeductibleIndividual?: number;
  rxDeductibleFamily?: number;
  rxOopMaxIndividual?: number;
  rxOopMaxFamily?: number;

  // Emergency/Ambulance coverage
  ambulanceGroundCopay?: number;
  ambulanceGroundCoinsurance?: number;
  ambulanceAirCopay?: number;
  ambulanceAirCoinsurance?: number;

  // Vision coverage
  visionExamCopay?: number;
  visionExamFrequency?: string;
  visionLensesAllowance?: number;
  visionFramesAllowance?: number;
  visionContactsAllowance?: number;

  // Dental coverage
  dentalPreventiveCoinsurance?: number;
  dentalBasicCoinsurance?: number;
  dentalMajorCoinsurance?: number;
  dentalAnnualMax?: number;
  dentalDeductible?: number;
  dentalOrthodontiaCoinsurance?: number;
  dentalOrthodontiaLifetimeMax?: number;

  // DME coverage
  dmeCopay?: number;
  dmeCoinsurance?: number;

  // Home Health coverage
  homeHealthVisitCopay?: number;
  homeHealthVisitCoinsurance?: number;
  homeHealthVisitLimit?: number;

  // Hospice coverage
  hospiceInpatientCopay?: number;
  hospiceInpatientCoinsurance?: number;
  hospiceRespiteCopay?: number;
  hospiceRespiteCoinsurance?: number;
  hospiceRespiteDayLimit?: number;

  // JSON list fields (parsed from strings)
  preventiveServicesList?: string[];
  exclusionsList?: string[];
  priorAuthRequirements?: string[];
  servicesWithLimits?: ServiceLimitData[];

  // Source tracking
  extractedFromSbc: boolean;
  sbcExtractionConfidence?: number;
  isActive: boolean;
  isPrimary: boolean;
  benefits: InsuranceBenefitResponse[];
  createdAt: Date;
  updatedAt: Date;
}

interface InsuranceBenefitResponse {
  id: string;
  serviceName: string;
  serviceCategory: string;
  inNetworkCoverage: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies: boolean;
  };
  outNetworkCoverage: {
    covered: boolean;
    copay?: number;
    coinsurance?: number;
    deductibleApplies: boolean;
  };
  limitations?: string;
  preAuthRequired: boolean;
}

/**
 * Safely parses a JSON string field into an array, returning undefined on failure
 */
function parseJsonArray<T>(jsonStr: string | null | undefined): T[] | undefined {
  if (!jsonStr) return undefined;
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Converts Prisma InsurancePlan to response format with decrypted values
 */
function toResponse(
  plan: PrismaInsurancePlan & { benefits?: PrismaInsuranceBenefit[] },
  userSalt: string
): InsurancePlanResponse {
  const encryptionService = getEncryptionService();

  // Decrypt PHI fields with error handling
  // If decryption fails (e.g., key mismatch), return undefined instead of crashing
  let memberId: string | undefined;
  let groupNumber: string | undefined;

  if (plan.memberIdEncrypted) {
    try {
      memberId = encryptionService.decrypt(plan.memberIdEncrypted, userSalt);
    } catch (error) {
      logger.warn('Failed to decrypt memberId for insurance plan', { data: { planId: plan.id } });
      memberId = undefined;
    }
  }

  if (plan.groupIdEncrypted) {
    try {
      groupNumber = encryptionService.decrypt(plan.groupIdEncrypted, userSalt);
    } catch (error) {
      logger.warn('Failed to decrypt groupId for insurance plan', { data: { planId: plan.id } });
      groupNumber = undefined;
    }
  }

  // Convert benefits
  const benefits: InsuranceBenefitResponse[] = (plan.benefits || []).map((b) => ({
    id: b.id,
    serviceName: b.serviceName,
    serviceCategory: b.serviceCategory,
    inNetworkCoverage: {
      covered: b.inNetworkCovered,
      copay: b.inNetworkCopay ? toNumber(b.inNetworkCopay) : undefined,
      coinsurance: b.inNetworkCoinsurance ? toNumber(b.inNetworkCoinsurance) : undefined,
      deductibleApplies: b.inNetworkDeductible,
    },
    outNetworkCoverage: {
      covered: b.outNetworkCovered,
      copay: b.outNetworkCopay ? toNumber(b.outNetworkCopay) : undefined,
      coinsurance: b.outNetworkCoinsurance ? toNumber(b.outNetworkCoinsurance) : undefined,
      deductibleApplies: b.outNetworkDeductible,
    },
    limitations: b.limitations ?? undefined,
    preAuthRequired: b.preAuthRequired,
  }));

  return {
    id: plan.id,
    userId: plan.userId,
    planName: plan.planName,
    insurerName: plan.insurerName,
    planType: plan.planType,
    planIdNumber: plan.planIdNumber ?? undefined,
    memberId,
    groupNumber,
    effectiveDate: plan.effectiveDate.toISOString().split('T')[0],
    terminationDate: plan.terminationDate
      ? plan.terminationDate.toISOString().split('T')[0]
      : undefined,
    premium: plan.premiumMonthly ? toNumber(plan.premiumMonthly) : undefined,
    deductibleIndividual: toNumber(plan.deductibleIndividual),
    deductibleFamily: toNumber(plan.deductibleFamily),
    oopMaxIndividual: toNumber(plan.oopMaxIndividual),
    oopMaxFamily: toNumber(plan.oopMaxFamily),

    // Tracking fields
    deductibleMetIndividual: plan.deductibleMetIndividual ? toNumber(plan.deductibleMetIndividual) : undefined,
    deductibleMetFamily: plan.deductibleMetFamily ? toNumber(plan.deductibleMetFamily) : undefined,
    oopMetIndividual: plan.oopMetIndividual ? toNumber(plan.oopMetIndividual) : undefined,
    oopMetFamily: plan.oopMetFamily ? toNumber(plan.oopMetFamily) : undefined,

    // Core copay amounts
    copayPrimaryCare: plan.copayPrimaryCare ? toNumber(plan.copayPrimaryCare) : undefined,
    copaySpecialist: plan.copaySpecialist ? toNumber(plan.copaySpecialist) : undefined,
    copayUrgentCare: plan.copayUrgentCare ? toNumber(plan.copayUrgentCare) : undefined,
    copayEmergency: plan.copayEmergency ? toNumber(plan.copayEmergency) : undefined,
    copayTelehealth: plan.copayTelehealth ? toNumber(plan.copayTelehealth) : undefined,
    copayLabWork: plan.copayLabWork ? toNumber(plan.copayLabWork) : undefined,
    copayXray: plan.copayXray ? toNumber(plan.copayXray) : undefined,
    copayAdvancedImaging: plan.copayAdvancedImaging ? toNumber(plan.copayAdvancedImaging) : undefined,
    coinsuranceRate: plan.coinsuranceRate ? toNumber(plan.coinsuranceRate) : undefined,
    // Per-service coinsurance
    coinsurancePrimaryCare: plan.coinsurancePrimaryCare ? toNumber(plan.coinsurancePrimaryCare) : undefined,
    coinsuranceSpecialist: plan.coinsuranceSpecialist ? toNumber(plan.coinsuranceSpecialist) : undefined,
    coinsuranceUrgentCare: plan.coinsuranceUrgentCare ? toNumber(plan.coinsuranceUrgentCare) : undefined,
    coinsuranceEmergency: plan.coinsuranceEmergency ? toNumber(plan.coinsuranceEmergency) : undefined,
    coinsuranceTelehealth: plan.coinsuranceTelehealth ? toNumber(plan.coinsuranceTelehealth) : undefined,
    coinsuranceLabWork: plan.coinsuranceLabWork ? toNumber(plan.coinsuranceLabWork) : undefined,
    coinsuranceXray: plan.coinsuranceXray ? toNumber(plan.coinsuranceXray) : undefined,
    coinsuranceAdvancedImaging: plan.coinsuranceAdvancedImaging ? toNumber(plan.coinsuranceAdvancedImaging) : undefined,

    // Inpatient coverage
    inpatientHospitalCopay: plan.inpatientHospitalCopay ? toNumber(plan.inpatientHospitalCopay) : undefined,
    inpatientHospitalCoinsurance: plan.inpatientHospitalCoinsurance ? toNumber(plan.inpatientHospitalCoinsurance) : undefined,
    inpatientMentalHealthCopay: plan.inpatientMentalHealthCopay ? toNumber(plan.inpatientMentalHealthCopay) : undefined,
    inpatientMentalCoinsurance: plan.inpatientMentalCoinsurance ? toNumber(plan.inpatientMentalCoinsurance) : undefined,
    maternityCopay: plan.maternityCopay ? toNumber(plan.maternityCopay) : undefined,
    maternityCoinsurance: plan.maternityCoinsurance ? toNumber(plan.maternityCoinsurance) : undefined,
    skilledNursingCopay: plan.skilledNursingCopay ? toNumber(plan.skilledNursingCopay) : undefined,
    skilledNursingCoinsurance: plan.skilledNursingCoinsurance ? toNumber(plan.skilledNursingCoinsurance) : undefined,
    skilledNursingDaysLimit: plan.skilledNursingDaysLimit ?? undefined,

    // Outpatient coverage
    outpatientSurgeryCopay: plan.outpatientSurgeryCopay ? toNumber(plan.outpatientSurgeryCopay) : undefined,
    outpatientSurgeryCoinsurance: plan.outpatientSurgeryCoinsurance ? toNumber(plan.outpatientSurgeryCoinsurance) : undefined,
    outpatientMentalHealthCopay: plan.outpatientMentalHealthCopay ? toNumber(plan.outpatientMentalHealthCopay) : undefined,
    outpatientMentalCoinsurance: plan.outpatientMentalCoinsurance ? toNumber(plan.outpatientMentalCoinsurance) : undefined,

    // Therapy/Rehab coverage
    physicalTherapyCopay: plan.physicalTherapyCopay ? toNumber(plan.physicalTherapyCopay) : undefined,
    physicalTherapyVisitsLimit: plan.physicalTherapyVisitsLimit ?? undefined,
    occupationalTherapyCopay: plan.occupationalTherapyCopay ? toNumber(plan.occupationalTherapyCopay) : undefined,
    occupationalTherapyVisitsLimit: plan.occupationalTherapyVisitsLimit ?? undefined,
    speechTherapyCopay: plan.speechTherapyCopay ? toNumber(plan.speechTherapyCopay) : undefined,
    speechTherapyVisitsLimit: plan.speechTherapyVisitsLimit ?? undefined,
    chiropracticCopay: plan.chiropracticCopay ? toNumber(plan.chiropracticCopay) : undefined,
    chiropracticVisitsLimit: plan.chiropracticVisitsLimit ?? undefined,
    acupunctureCopay: plan.acupunctureCopay ? toNumber(plan.acupunctureCopay) : undefined,
    acupunctureVisitsLimit: plan.acupunctureVisitsLimit ?? undefined,
    cardiacRehabCopay: plan.cardiacRehabCopay ? toNumber(plan.cardiacRehabCopay) : undefined,
    cardiacRehabVisitsLimit: plan.cardiacRehabVisitsLimit ?? undefined,
    pulmonaryRehabCopay: plan.pulmonaryRehabCopay ? toNumber(plan.pulmonaryRehabCopay) : undefined,
    pulmonaryRehabVisitsLimit: plan.pulmonaryRehabVisitsLimit ?? undefined,

    // Prescription (Rx) benefits
    rxTier1Copay: plan.rxTier1Copay ? toNumber(plan.rxTier1Copay) : undefined,
    rxTier2Copay: plan.rxTier2Copay ? toNumber(plan.rxTier2Copay) : undefined,
    rxTier3Copay: plan.rxTier3Copay ? toNumber(plan.rxTier3Copay) : undefined,
    rxTier4Copay: plan.rxTier4Copay ? toNumber(plan.rxTier4Copay) : undefined,
    rxTier1Coinsurance: plan.rxTier1Coinsurance ? toNumber(plan.rxTier1Coinsurance) : undefined,
    rxTier2Coinsurance: plan.rxTier2Coinsurance ? toNumber(plan.rxTier2Coinsurance) : undefined,
    rxTier3Coinsurance: plan.rxTier3Coinsurance ? toNumber(plan.rxTier3Coinsurance) : undefined,
    rxTier4Coinsurance: plan.rxTier4Coinsurance ? toNumber(plan.rxTier4Coinsurance) : undefined,
    rxRetailDaysSupply: plan.rxRetailDaysSupply ?? undefined,
    rxMailOrderDaysSupply: plan.rxMailOrderDaysSupply ?? undefined,
    rxDeductibleIndividual: plan.rxDeductibleIndividual ? toNumber(plan.rxDeductibleIndividual) : undefined,
    rxDeductibleFamily: plan.rxDeductibleFamily ? toNumber(plan.rxDeductibleFamily) : undefined,
    rxOopMaxIndividual: plan.rxOopMaxIndividual ? toNumber(plan.rxOopMaxIndividual) : undefined,
    rxOopMaxFamily: plan.rxOopMaxFamily ? toNumber(plan.rxOopMaxFamily) : undefined,

    // Emergency/Ambulance coverage
    ambulanceGroundCopay: plan.ambulanceGroundCopay ? toNumber(plan.ambulanceGroundCopay) : undefined,
    ambulanceGroundCoinsurance: plan.ambulanceGroundCoinsurance ? toNumber(plan.ambulanceGroundCoinsurance) : undefined,
    ambulanceAirCopay: plan.ambulanceAirCopay ? toNumber(plan.ambulanceAirCopay) : undefined,
    ambulanceAirCoinsurance: plan.ambulanceAirCoinsurance ? toNumber(plan.ambulanceAirCoinsurance) : undefined,

    // Vision coverage
    visionExamCopay: plan.visionExamCopay ? toNumber(plan.visionExamCopay) : undefined,
    visionExamFrequency: plan.visionExamFrequency ?? undefined,
    visionLensesAllowance: plan.visionLensesAllowance ? toNumber(plan.visionLensesAllowance) : undefined,
    visionFramesAllowance: plan.visionFramesAllowance ? toNumber(plan.visionFramesAllowance) : undefined,
    visionContactsAllowance: plan.visionContactsAllowance ? toNumber(plan.visionContactsAllowance) : undefined,

    // Dental coverage
    dentalPreventiveCoinsurance: plan.dentalPreventiveCoinsurance ? toNumber(plan.dentalPreventiveCoinsurance) : undefined,
    dentalBasicCoinsurance: plan.dentalBasicCoinsurance ? toNumber(plan.dentalBasicCoinsurance) : undefined,
    dentalMajorCoinsurance: plan.dentalMajorCoinsurance ? toNumber(plan.dentalMajorCoinsurance) : undefined,
    dentalAnnualMax: plan.dentalAnnualMax ? toNumber(plan.dentalAnnualMax) : undefined,
    dentalDeductible: plan.dentalDeductible ? toNumber(plan.dentalDeductible) : undefined,
    dentalOrthodontiaCoinsurance: plan.dentalOrthodontiaCoinsurance ? toNumber(plan.dentalOrthodontiaCoinsurance) : undefined,
    dentalOrthodontiaLifetimeMax: plan.dentalOrthodontiaLifetimeMax ? toNumber(plan.dentalOrthodontiaLifetimeMax) : undefined,

    // DME coverage
    dmeCopay: plan.dmeCopay ? toNumber(plan.dmeCopay) : undefined,
    dmeCoinsurance: plan.dmeCoinsurance ? toNumber(plan.dmeCoinsurance) : undefined,

    // Home Health coverage
    homeHealthVisitCopay: plan.homeHealthVisitCopay ? toNumber(plan.homeHealthVisitCopay) : undefined,
    homeHealthVisitCoinsurance: plan.homeHealthVisitCoinsurance ? toNumber(plan.homeHealthVisitCoinsurance) : undefined,
    homeHealthVisitLimit: plan.homeHealthVisitLimit ?? undefined,

    // Hospice coverage
    hospiceInpatientCopay: plan.hospiceInpatientCopay ? toNumber(plan.hospiceInpatientCopay) : undefined,
    hospiceInpatientCoinsurance: plan.hospiceInpatientCoinsurance ? toNumber(plan.hospiceInpatientCoinsurance) : undefined,
    hospiceRespiteCopay: plan.hospiceRespiteCopay ? toNumber(plan.hospiceRespiteCopay) : undefined,
    hospiceRespiteCoinsurance: plan.hospiceRespiteCoinsurance ? toNumber(plan.hospiceRespiteCoinsurance) : undefined,
    hospiceRespiteDayLimit: plan.hospiceRespiteDayLimit ?? undefined,

    // JSON list fields (parsed from strings)
    preventiveServicesList: parseJsonArray<string>(plan.preventiveServicesList),
    exclusionsList: parseJsonArray<string>(plan.exclusionsList),
    priorAuthRequirements: parseJsonArray<string>(plan.priorAuthRequirements),
    servicesWithLimits: parseJsonArray<ServiceLimitData>(plan.servicesWithLimits),

    // Source tracking
    extractedFromSbc: plan.extractedFromSbc,
    sbcExtractionConfidence: plan.sbcExtractionConfidence ? toNumber(plan.sbcExtractionConfidence) : undefined,
    isActive: plan.isActive,
    isPrimary: plan.isPrimary,
    benefits,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

// Get all insurance plans for user with pagination
// PERFORMANCE: Added pagination to prevent loading unbounded data
export async function getInsurancePlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { page, limit, activeOnly } = req.query;

  const pagination = parsePagination(page, limit, { defaultLimit: 20 });
  const filterActiveOnly = parseBooleanParam(activeOnly, false);

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Build where clause
  const where: { userId: string; isActive?: boolean } = { userId };
  if (filterActiveOnly) {
    where.isActive = true;
  }

  // Get total count and paginated plans in parallel (wrapped in RLS transaction)
  const { total, plans } = await withRLSTransaction(userId, async (tx) => {
    const [total, plans] = await Promise.all([
      tx.insurancePlan.count({ where }),
      tx.insurancePlan.findMany({
        where,
        include: { benefits: true },
        orderBy: [{ isPrimary: 'desc' }, { isActive: 'desc' }, { effectiveDate: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);
    return { total, plans };
  });

  const decryptedPlans = plans.map((p) => toResponse(p, userSalt));

  // Audit log: READ access to insurance plans list
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: plans.length,
    page: pagination.page,
  });

  const response: ApiResponse<InsurancePlanResponse[]> = {
    success: true,
    data: decryptedPlans,
    pagination: createPaginationMeta(total, pagination),
  };

  res.json(response);
}

// Get single insurance plan
export async function getInsurancePlan(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const plan = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.findFirst({
      where: { id, userId },
      include: { benefits: true },
    });
  });

  if (!plan) {
    throw new NotFoundError('Insurance plan not found');
  }

  // Audit log: READ access to single insurance plan
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<InsurancePlanResponse> = {
    success: true,
    data: toResponse(plan, userSalt),
  };

  res.json(response);
}

// Create new insurance plan
export async function createInsurancePlan(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input: InsurancePlanCreateInput = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Encrypt PHI fields
  const memberIdEncrypted = input.memberId
    ? encryptionService.encrypt(input.memberId, userSalt)
    : null;
  const groupIdEncrypted = input.groupNumber
    ? encryptionService.encrypt(input.groupNumber, userSalt)
    : null;

  const plan = await withRLSTransaction(userId, async (tx) => {
    // If this is marked as primary, unset other primary plans
    if (input.isPrimary) {
      await tx.insurancePlan.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return tx.insurancePlan.create({
      data: {
        userId,
        planName: input.planName,
        insurerName: input.insurerName,
        planType: input.planType,
        planIdNumber: input.planIdNumber ?? null,
        memberIdEncrypted,
        groupIdEncrypted,
        effectiveDate: new Date(input.effectiveDate),
        terminationDate: input.terminationDate ? new Date(input.terminationDate) : null,
        premiumMonthly: input.premium,
        deductibleIndividual: input.deductible,
        deductibleFamily: input.deductibleFamily ?? input.deductible * 2,
        oopMaxIndividual: input.outOfPocketMax,
        oopMaxFamily: input.outOfPocketMaxFamily ?? input.outOfPocketMax * 2,
        // Tracking fields
        deductibleMetIndividual: input.deductibleMetIndividual ?? 0,
        deductibleMetFamily: input.deductibleMetFamily ?? 0,
        oopMetIndividual: input.oopMetIndividual ?? 0,
        oopMetFamily: input.oopMetFamily ?? 0,
        // Copay amounts
        copayPrimaryCare: input.copayPrimaryCare ?? null,
        copaySpecialist: input.copaySpecialist ?? null,
        copayUrgentCare: input.copayUrgentCare ?? null,
        copayEmergency: input.copayEmergency ?? null,
        coinsuranceRate: input.coinsuranceRate ?? null,
        // Source tracking (manual entry)
        extractedFromSbc: false,
        sbcExtractionConfidence: null,
        isActive: input.isActive ?? true,
        isPrimary: input.isPrimary ?? false,
        benefits: input.benefits
          ? {
              create: input.benefits.map((b) => ({
                serviceName: b.serviceName,
                serviceCategory: b.serviceCategory,
                inNetworkCovered: b.inNetworkCoverage.covered,
                inNetworkCopay: b.inNetworkCoverage.copay,
                inNetworkCoinsurance: b.inNetworkCoverage.coinsurance,
                inNetworkDeductible: b.inNetworkCoverage.deductibleApplies ?? true,
                outNetworkCovered: b.outNetworkCoverage?.covered ?? false,
                outNetworkCopay: b.outNetworkCoverage?.copay,
                outNetworkCoinsurance: b.outNetworkCoverage?.coinsurance,
                outNetworkDeductible: b.outNetworkCoverage?.deductibleApplies ?? true,
                limitations: b.limitations,
                preAuthRequired: b.preAuthRequired ?? false,
              })),
            }
          : undefined,
      },
      include: { benefits: true },
    });
  });

  // Audit log: CREATE insurance plan
  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE, plan.id, {
    planName: input.planName,
    insurerName: input.insurerName,
    planType: input.planType,
  }, { req, userId });

  const response: ApiResponse<InsurancePlanResponse> = {
    success: true,
    data: toResponse(plan, userSalt),
  };

  res.status(201).json(response);
}

// Update insurance plan
export async function updateInsurancePlan(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const input: Partial<InsurancePlanCreateInput> = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (input.planName !== undefined) updateData.planName = input.planName;
  if (input.insurerName !== undefined) updateData.insurerName = input.insurerName;
  if (input.planType !== undefined) updateData.planType = input.planType;
  if (input.planIdNumber !== undefined) updateData.planIdNumber = input.planIdNumber || null;
  if (input.memberId !== undefined) {
    updateData.memberIdEncrypted = input.memberId
      ? encryptionService.encrypt(input.memberId, userSalt)
      : null;
  }
  if (input.groupNumber !== undefined) {
    updateData.groupIdEncrypted = input.groupNumber
      ? encryptionService.encrypt(input.groupNumber, userSalt)
      : null;
  }
  if (input.effectiveDate !== undefined) updateData.effectiveDate = new Date(input.effectiveDate);
  if (input.terminationDate !== undefined) {
    updateData.terminationDate = input.terminationDate ? new Date(input.terminationDate) : null;
  }
  if (input.premium !== undefined) updateData.premiumMonthly = input.premium;
  if (input.deductible !== undefined) updateData.deductibleIndividual = input.deductible;
  if (input.deductibleFamily !== undefined) updateData.deductibleFamily = input.deductibleFamily;
  if (input.outOfPocketMax !== undefined) updateData.oopMaxIndividual = input.outOfPocketMax;
  if (input.outOfPocketMaxFamily !== undefined) updateData.oopMaxFamily = input.outOfPocketMaxFamily;
  // Tracking fields
  if (input.deductibleMetIndividual !== undefined) updateData.deductibleMetIndividual = input.deductibleMetIndividual;
  if (input.deductibleMetFamily !== undefined) updateData.deductibleMetFamily = input.deductibleMetFamily;
  if (input.oopMetIndividual !== undefined) updateData.oopMetIndividual = input.oopMetIndividual;
  if (input.oopMetFamily !== undefined) updateData.oopMetFamily = input.oopMetFamily;
  // Copay amounts
  if (input.copayPrimaryCare !== undefined) updateData.copayPrimaryCare = input.copayPrimaryCare;
  if (input.copaySpecialist !== undefined) updateData.copaySpecialist = input.copaySpecialist;
  if (input.copayUrgentCare !== undefined) updateData.copayUrgentCare = input.copayUrgentCare;
  if (input.copayEmergency !== undefined) updateData.copayEmergency = input.copayEmergency;
  if (input.coinsuranceRate !== undefined) updateData.coinsuranceRate = input.coinsuranceRate;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  if (input.isPrimary === true) {
    updateData.isPrimary = true;
  } else if (input.isPrimary === false) {
    updateData.isPrimary = false;
  }

  const { existing, updated } = await withRLSTransaction(userId, async (tx) => {
    const existing = await tx.insurancePlan.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError('Insurance plan not found');
    }

    // Handle primary flag
    if (input.isPrimary === true) {
      await tx.insurancePlan.updateMany({
        where: { userId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
    }

    const updated = await tx.insurancePlan.update({
      where: { id },
      data: updateData,
      include: { benefits: true },
    });

    return { existing, updated };
  });

  // Audit log: UPDATE insurance plan
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    planName: existing.planName,
    insurerName: existing.insurerName,
  }, {
    planName: updated.planName,
    insurerName: updated.insurerName,
    fieldsUpdated: Object.keys(updateData),
  }, { req, userId });

  const response: ApiResponse<InsurancePlanResponse> = {
    success: true,
    data: toResponse(updated, userSalt),
  };

  res.json(response);
}

// Delete insurance plan
export async function deleteInsurancePlan(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const plan = await withRLSTransaction(userId, async (tx) => {
    const plan = await tx.insurancePlan.findFirst({
      where: { id, userId },
    });

    if (!plan) {
      throw new NotFoundError('Insurance plan not found');
    }

    // Delete plan (benefits will cascade delete)
    await tx.insurancePlan.delete({
      where: { id },
    });

    return plan;
  });

  // Audit log: DELETE insurance plan (log after deletion, using data captured in transaction)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    planName: plan.planName,
    insurerName: plan.insurerName,
  }, { req, userId });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Compare insurance plans
export async function comparePlans(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { planIds } = req.body as { planIds: string[] };

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const plans = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.findMany({
      where: { id: { in: planIds }, userId },
      include: { benefits: true },
    });
  });

  if (plans.length < 2) {
    throw new NotFoundError('At least 2 valid plans required for comparison');
  }

  const decryptedPlans = plans.map((p) => toResponse(p, userSalt));

  // Audit log: READ access to multiple plans for comparison
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'COMPARE',
    count: plans.length,
    planIds: planIds.slice(0, 10), // Limit logged IDs
  });

  // Create comparison matrix
  const comparison = {
    plans: decryptedPlans.map((p) => ({
      id: p.id,
      name: p.planName,
      type: p.planType,
      premium: p.premium,
      deductibleIndividual: p.deductibleIndividual,
      oopMaxIndividual: p.oopMaxIndividual,
    })),
    benefitComparison: compareBenefits(decryptedPlans),
  };

  const response: ApiResponse<typeof comparison> = {
    success: true,
    data: comparison,
  };

  res.json(response);
}

// Helper function to compare benefits across plans
function compareBenefits(plans: InsurancePlanResponse[]) {
  const allServices = new Set<string>();

  // Pre-build benefit lookup maps for O(1) access instead of O(n) find()
  const planBenefitMaps = plans.map((plan) => {
    const benefitMap = new Map<string, typeof plan.benefits[number]>();
    plan.benefits.forEach((benefit) => {
      allServices.add(benefit.serviceName);
      benefitMap.set(benefit.serviceName, benefit);
    });
    return { plan, benefitMap };
  });

  return Array.from(allServices).map((serviceName) => ({
    serviceName,
    coverage: planBenefitMaps.map(({ plan, benefitMap }) => {
      const benefit = benefitMap.get(serviceName); // O(1) instead of O(n)
      return {
        planId: plan.id,
        planName: plan.planName,
        covered: benefit?.inNetworkCoverage.covered ?? false,
        copay: benefit?.inNetworkCoverage.copay,
        coinsurance: benefit?.inNetworkCoverage.coinsurance,
      };
    }),
  }));
}

// Search insurance benefits
export async function searchBenefits(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    const response: ApiResponse<never[]> = {
      success: true,
      data: [],
    };
    res.json(response);
    return;
  }

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const plans = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.findMany({
      where: { userId },
      include: { benefits: true },
    });
  });

  const searchTerm = query.toLowerCase();
  const decryptedPlans = plans.map((p) => toResponse(p, userSalt));

  const results = decryptedPlans.flatMap((plan) =>
    plan.benefits
      .filter((b) => b.serviceName.toLowerCase().includes(searchTerm))
      .map((benefit) => ({
        planId: plan.id,
        planName: plan.planName,
        benefit,
      }))
  );

  // Audit log: SEARCH access to insurance benefits
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'SEARCH_BENEFITS',
    searchTerm: query.substring(0, 100), // Limit logged search term
    plansSearched: plans.length,
    resultsFound: results.length,
  });

  const response: ApiResponse<typeof results> = {
    success: true,
    data: results,
  };

  res.json(response);
}
