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
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parsePagination, parseBooleanParam, createPaginationMeta } from '../utils/queryHelpers.js';
import { toNumber } from '../utils/numberConversion.js';
import type { InsurancePlan as PrismaInsurancePlan, InsuranceBenefit as PrismaInsuranceBenefit } from '../generated/prisma/index.js';

const RESOURCE_TYPE = 'InsurancePlan';

// Response types with decrypted values
interface InsurancePlanResponse {
  id: string;
  userId: string;
  planName: string;
  insurerName: string;
  planType: string;
  memberId?: string;
  groupNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  premium?: number;
  deductible: number;
  deductibleFamily: number;
  outOfPocketMax: number;
  outOfPocketMaxFamily: number;
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
 * Converts Prisma InsurancePlan to response format with decrypted values
 */
function toResponse(
  plan: PrismaInsurancePlan & { benefits?: PrismaInsuranceBenefit[] },
  userSalt: string
): InsurancePlanResponse {
  const encryptionService = getEncryptionService();

  // Decrypt PHI fields
  const memberId = plan.memberIdEncrypted
    ? encryptionService.decrypt(plan.memberIdEncrypted, userSalt)
    : undefined;
  const groupNumber = plan.groupIdEncrypted
    ? encryptionService.decrypt(plan.groupIdEncrypted, userSalt)
    : undefined;

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
    memberId,
    groupNumber,
    effectiveDate: plan.effectiveDate.toISOString().split('T')[0],
    terminationDate: plan.terminationDate
      ? plan.terminationDate.toISOString().split('T')[0]
      : undefined,
    premium: plan.premiumMonthly ? toNumber(plan.premiumMonthly) : undefined,
    deductible: toNumber(plan.deductibleIndividual),
    deductibleFamily: toNumber(plan.deductibleFamily),
    outOfPocketMax: toNumber(plan.oopMaxIndividual),
    outOfPocketMaxFamily: toNumber(plan.oopMaxFamily),
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

  // Get total count and paginated plans in parallel
  const [total, plans] = await Promise.all([
    prisma.insurancePlan.count({ where }),
    prisma.insurancePlan.findMany({
      where,
      include: { benefits: true },
      orderBy: [{ isPrimary: 'desc' }, { isActive: 'desc' }, { effectiveDate: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);

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

  const plan = await prisma.insurancePlan.findFirst({
    where: { id, userId },
    include: { benefits: true },
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

  // If this is marked as primary, unset other primary plans
  if (input.isPrimary) {
    await prisma.insurancePlan.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const plan = await prisma.insurancePlan.create({
    data: {
      userId,
      planName: input.planName,
      insurerName: input.insurerName,
      planType: input.planType,
      memberIdEncrypted,
      groupIdEncrypted,
      effectiveDate: new Date(input.effectiveDate),
      terminationDate: input.terminationDate ? new Date(input.terminationDate) : null,
      premiumMonthly: input.premium,
      deductibleIndividual: input.deductible,
      deductibleFamily: input.deductibleFamily ?? input.deductible * 2,
      oopMaxIndividual: input.outOfPocketMax,
      oopMaxFamily: input.outOfPocketMaxFamily ?? input.outOfPocketMax * 2,
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

  const existing = await prisma.insurancePlan.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new NotFoundError('Insurance plan not found');
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (input.planName !== undefined) updateData.planName = input.planName;
  if (input.insurerName !== undefined) updateData.insurerName = input.insurerName;
  if (input.planType !== undefined) updateData.planType = input.planType;
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
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  // Handle primary flag
  if (input.isPrimary === true) {
    await prisma.insurancePlan.updateMany({
      where: { userId, isPrimary: true, id: { not: id } },
      data: { isPrimary: false },
    });
    updateData.isPrimary = true;
  } else if (input.isPrimary === false) {
    updateData.isPrimary = false;
  }

  const updated = await prisma.insurancePlan.update({
    where: { id },
    data: updateData,
    include: { benefits: true },
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

  const plan = await prisma.insurancePlan.findFirst({
    where: { id, userId },
  });

  if (!plan) {
    throw new NotFoundError('Insurance plan not found');
  }

  // Audit log: DELETE insurance plan (log before deletion)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    planName: plan.planName,
    insurerName: plan.insurerName,
  }, { req, userId });

  // Delete plan (benefits will cascade delete)
  await prisma.insurancePlan.delete({
    where: { id },
  });

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

  const plans = await prisma.insurancePlan.findMany({
    where: { id: { in: planIds }, userId },
    include: { benefits: true },
  });

  if (plans.length < 2) {
    throw new NotFoundError('At least 2 valid plans required for comparison');
  }

  const decryptedPlans = plans.map((p) => toResponse(p, userSalt));

  // Create comparison matrix
  const comparison = {
    plans: decryptedPlans.map((p) => ({
      id: p.id,
      name: p.planName,
      type: p.planType,
      premium: p.premium,
      deductible: p.deductible,
      outOfPocketMax: p.outOfPocketMax,
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

  plans.forEach((plan) => {
    plan.benefits.forEach((benefit) => {
      allServices.add(benefit.serviceName);
    });
  });

  return Array.from(allServices).map((serviceName) => ({
    serviceName,
    coverage: plans.map((plan) => {
      const benefit = plan.benefits.find((b) => b.serviceName === serviceName);
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

  const plans = await prisma.insurancePlan.findMany({
    where: { userId },
    include: { benefits: true },
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

  const response: ApiResponse<typeof results> = {
    success: true,
    data: results,
  };

  res.json(response);
}
