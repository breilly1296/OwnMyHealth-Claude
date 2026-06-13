/**
 * expenseController.ts - Expense Tracking & Cost Optimization
 *
 * Handles projected expenses, actual expenses, and AI-powered cost analysis
 * for insurance plan optimization.
 *
 * Features:
 * - CRUD operations for expense projections (planned medical expenses)
 * - CRUD operations for expense actuals (real claims/EOBs)
 * - AI cost optimization analysis using Claude
 * - Current spending updates for deductible/OOP tracking
 *
 * Security:
 * - All cost data encrypted before storage (PHI)
 * - RLS context for user data isolation
 * - Audit logging for all operations
 */

import { Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sanitizeForPrompt } from '../middleware/validation.js';
import { trackAIUsage } from '../services/aiCostTracker.js';
import { getAnthropicClient } from '../services/anthropicClient.js';
import { config } from '../config/index.js';
import { stripPHIFromText } from '../utils/phiRedaction.js';

const RESOURCE_TYPE_PROJECTION = 'expense_projection';
const RESOURCE_TYPE_ACTUAL = 'expense_actual';
const RESOURCE_TYPE_ANALYSIS = 'cost_analysis';

/**
 * RT (Low): maximum number of expense projections a single analyzeCosts call
 * will load, decrypt, and interpolate into the Claude prompt. Bounds the
 * per-request decrypt + prompt cost so one analyze cannot be forced to process
 * an unbounded row set. Projections are fetched newest-first, so the most
 * recent (most relevant) entries are kept when a plan exceeds this cap.
 */
const MAX_ANALYZE_PROJECTIONS = 200;

/**
 * Encrypt-if-present helpers. Distinguish undefined (field absent in
 * update payload → leave alone) from null (explicit clear).
 * - `encIfProvided`: undefined → undefined, null/empty → null, else encrypt.
 * - `encNumIfProvided`: same, but for numeric inputs (toString before enc).
 */
function encIfProvided(
  v: string | undefined | null,
  encrypt: (plaintext: string, salt: string) => string,
  salt: string
): string | null | undefined {
  if (v === undefined) return undefined;
  return v ? encrypt(v, salt) : null;
}

function encNumIfProvided(
  v: number | undefined | null,
  encrypt: (plaintext: string, salt: string) => string,
  salt: string
): string | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : encrypt(v.toString(), salt);
}

/**
 * DECRYPT SAFETY (M-7): wrap an inline decrypt so a single corrupt or
 * key-mismatched field returns null and logs at warn instead of throwing and
 * rejecting the whole list/analysis/export. Used in the per-row hot paths
 * (list decryption, analyzeCosts projection decryption) where one bad row must
 * not 500 the entire request. Returns null on any failure.
 */
function tryDecrypt(
  encryption: ReturnType<typeof getEncryptionService>,
  value: string | null | undefined,
  userSalt: string,
  field: string
): string | null {
  if (!value) return null;
  try {
    return encryption.decrypt(value, userSalt);
  } catch (err) {
    logger.warn(`Failed to decrypt expense field: ${field}`, {
      data: { error: err instanceof Error ? err.message : 'Unknown' },
    });
    return null;
  }
}

// ============================================
// EXPENSE PROJECTIONS (Planned Expenses)
// ============================================

/**
 * POST /api/expenses/projections
 * Create a new expense projection
 */
export async function createProjection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId, serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes } = req.body;

  // Validate required fields. Throw a typed error so the centralized
  // errorHandler maps it to a 400 with the standard envelope shape; routes
  // are wrapped in `asyncHandler` (`routes/expenseRoutes.ts`), which
  // forwards thrown errors to that handler.
  if (!planId || !serviceType || estimatedCost === undefined || !frequencyPerYear) {
    throw new BadRequestError('Missing required fields');
  }

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const projection = await withRLSTransaction(userId, async (tx) => {
    // L-4: ensure the referenced plan belongs to the caller before linking a
    // projection to it. The FK constraint to insurance_plans is validated as the
    // table owner and bypasses RLS, so without this an insert referencing
    // another user's plan UUID would succeed and create an orphan reference.
    const plan = await tx.insurancePlan.findFirst({ where: { id: planId, userId }, select: { id: true } });
    if (!plan) {
      throw new NotFoundError('Insurance plan not found');
    }
    return tx.expenseProjection.create({
      data: {
        userId,
        planId,
        serviceTypeEncrypted: encryption.encrypt(serviceType, userSalt),
        estimatedCostEncrypted: encryption.encrypt(estimatedCost.toString(), userSalt),
        frequencyPerYear,
        isInNetwork: isInNetwork ?? true,
        notesEncrypted: notes ? encryption.encrypt(notes, userSalt) : null,
      },
    });
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE_PROJECTION, projection.id, {
    serviceType,
    estimatedCost,
  }, { req, userId });

  // Decrypt for response
  const decrypted = {
    ...projection,
    serviceType: encryption.decrypt(projection.serviceTypeEncrypted, userSalt),
    estimatedCost: parseFloat(encryption.decrypt(projection.estimatedCostEncrypted, userSalt)),
    notes: projection.notesEncrypted ? encryption.decrypt(projection.notesEncrypted, userSalt) : null,
  };

  res.status(201).json({ success: true, data: decrypted });
}

/**
 * GET /api/expenses/projections?planId=xxx
 * Get all expense projections for a plan
 */
export async function getProjections(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId } = req.query;

  // Pagination — projections accumulate across plan-years; fetching all
  // every request means decrypting every row on every request.
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const where = {
    userId,
    ...(planId && { planId: planId as string }),
  };

  const { projections, total } = await withRLSTransaction(userId, async (tx) => {
    const [rows, count] = await Promise.all([
      tx.expenseProjection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      tx.expenseProjection.count({ where }),
    ]);
    return { projections: rows, total: count };
  });

  // Decrypt PHI fields. tryDecrypt returns null (and logs at warn) on a
  // corrupt/key-mismatched field so one bad row can't throw the whole list.
  const decrypted = projections.map((p) => ({
    ...p,
    serviceType: tryDecrypt(encryption, p.serviceTypeEncrypted, userSalt, 'serviceTypeEncrypted'),
    estimatedCost: parseFloat(tryDecrypt(encryption, p.estimatedCostEncrypted, userSalt, 'estimatedCostEncrypted') ?? ''),
    notes: tryDecrypt(encryption, p.notesEncrypted, userSalt, 'notesEncrypted'),
  }));

  // Audit log: READ access to expense projections
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE_PROJECTION, undefined, { req, userId }, {
    operation: 'LIST',
    count: decrypted.length,
    total,
    page,
    limit,
    planId: (planId as string) || 'all',
  });

  // Wrap in the standard ApiResponse envelope now that we're paginating.
  // Existing frontend callers that expect an array body are covered by
  // the array + the rest of the response being additive metadata.
  res.json({
    success: true,
    data: decrypted,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

/**
 * PUT /api/expenses/projections/:id
 * Update an expense projection
 */
export async function updateProjection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes } = req.body;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const updateData: Record<string, unknown> = {};
  if (serviceType !== undefined) {
    updateData.serviceTypeEncrypted = encryption.encrypt(serviceType, userSalt);
  }
  if (estimatedCost !== undefined) {
    updateData.estimatedCostEncrypted = encryption.encrypt(estimatedCost.toString(), userSalt);
  }
  if (frequencyPerYear !== undefined) updateData.frequencyPerYear = frequencyPerYear;
  if (isInNetwork !== undefined) updateData.isInNetwork = isInNetwork;
  if (notes !== undefined) {
    updateData.notesEncrypted = notes ? encryption.encrypt(notes, userSalt) : null;
  }

  const updated = await withRLSTransaction(userId, async (tx) => {
    return tx.expenseProjection.update({
      where: { id, userId },
      data: updateData,
    });
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE_PROJECTION, id, {}, updateData, { req, userId });

  // Decrypt for response
  const decrypted = {
    ...updated,
    serviceType: encryption.decrypt(updated.serviceTypeEncrypted, userSalt),
    estimatedCost: parseFloat(encryption.decrypt(updated.estimatedCostEncrypted, userSalt)),
    notes: updated.notesEncrypted ? encryption.decrypt(updated.notesEncrypted, userSalt) : null,
  };

  res.json({ success: true, data: decrypted });
}

/**
 * DELETE /api/expenses/projections/:id
 * Delete an expense projection
 */
export async function deleteProjection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  await withRLSTransaction(userId, async (tx) => {
    await tx.expenseProjection.delete({
      where: { id, userId },
    });
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE_PROJECTION, id, {}, { req, userId });

  res.status(204).send();
}

// ============================================
// EXPENSE ACTUALS (Real Claims / EOBs)
// ============================================

/**
 * Decrypt an ExpenseActual record's PHI fields into a client-facing shape.
 * Keeps the {dateOfService → serviceDate} rename consistent with the
 * existing ExpenseActualData type in src/services/api/expenses.ts.
 */
function decryptActual(
  a: {
    id: string;
    userId: string;
    planId: string;
    projectionId: string | null;
    serviceTypeEncrypted: string;
    providerNameEncrypted: string | null;
    dateOfService: Date | null;
    billedAmountEncrypted: string | null;
    insurancePaidEncrypted: string | null;
    patientPaidEncrypted: string | null;
    appliedToDeductibleEncrypted: string | null;
    appliedToOopEncrypted: string | null;
    claimStatus: string;
    isInNetwork: boolean | null;
    notesEncrypted: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  encryption: ReturnType<typeof getEncryptionService>,
  userSalt: string
) {
  // M-7: route every field through tryDecrypt so a single corrupt/key-mismatched
  // row returns null (logged at warn) instead of throwing the whole list/export.
  const decryptNumber = (v: string | null, field: string) => {
    const dec = tryDecrypt(encryption, v, userSalt, field);
    return dec === null ? null : parseFloat(dec);
  };
  return {
    id: a.id,
    userId: a.userId,
    planId: a.planId,
    projectionId: a.projectionId,
    serviceType: tryDecrypt(encryption, a.serviceTypeEncrypted, userSalt, 'serviceTypeEncrypted'),
    serviceDate: a.dateOfService ? a.dateOfService.toISOString().split('T')[0] : null,
    providerName: tryDecrypt(encryption, a.providerNameEncrypted, userSalt, 'providerNameEncrypted'),
    billedAmount: decryptNumber(a.billedAmountEncrypted, 'billedAmountEncrypted'),
    insurancePaid: decryptNumber(a.insurancePaidEncrypted, 'insurancePaidEncrypted'),
    patientPaid: decryptNumber(a.patientPaidEncrypted, 'patientPaidEncrypted'),
    appliedToDeductible: decryptNumber(a.appliedToDeductibleEncrypted, 'appliedToDeductibleEncrypted'),
    appliedToOop: decryptNumber(a.appliedToOopEncrypted, 'appliedToOopEncrypted'),
    isInNetwork: a.isInNetwork ?? true,
    claimStatus: a.claimStatus,
    notes: tryDecrypt(encryption, a.notesEncrypted, userSalt, 'notesEncrypted'),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * Recompute a plan's running deductible/OOP "met" amounts from the sum of its
 * logged claims (ExpenseActual.appliedTo*). Logged claims are the source of
 * truth for spending progress, so this runs after any actual is created,
 * updated, or deleted. Runs inside the caller's RLS transaction so the plan
 * update is atomic with the claim mutation. The plan's met columns are plaintext
 * Decimal; the claim amounts are encrypted, hence the per-row decrypt.
 */
async function recomputePlanSpending(
  tx: Prisma.TransactionClient,
  userId: string,
  planId: string,
  encryption: ReturnType<typeof getEncryptionService>,
  userSalt: string
): Promise<void> {
  const actuals = await tx.expenseActual.findMany({
    where: { userId, planId },
    select: { appliedToDeductibleEncrypted: true, appliedToOopEncrypted: true },
  });
  const dec = (v: string | null) => {
    if (!v) return 0;
    const n = parseFloat(encryption.decrypt(v, userSalt));
    return Number.isFinite(n) ? n : 0;
  };
  let deductibleMet = 0;
  let oopMet = 0;
  for (const a of actuals) {
    deductibleMet += dec(a.appliedToDeductibleEncrypted);
    oopMet += dec(a.appliedToOopEncrypted);
  }
  await tx.insurancePlan.updateMany({
    where: { id: planId, userId },
    data: {
      deductibleMetIndividual: deductibleMet,
      oopMetIndividual: oopMet,
    },
  });
}

/**
 * POST /api/expenses/actuals
 * Create a new expense actual (real claim/EOB entry)
 */
export async function createActual(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const {
    planId,
    projectionId,
    serviceType,
    serviceDate,
    providerName,
    billedAmount,
    insurancePaid,
    patientPaid,
    appliedToDeductible,
    appliedToOop,
    isInNetwork,
    claimStatus,
    notes,
  } = req.body;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  // Create path: undefined/null both collapse to null (no prior value to preserve).
  const encNum = (v: number | undefined | null) =>
    v === undefined || v === null ? null : encryption.encrypt(v.toString(), userSalt);

  const actual = await withRLSTransaction(userId, async (tx) => {
    // L-4: ensure the referenced plan belongs to the caller (see createProjection).
    // recomputePlanSpending below already no-ops on a foreign plan, but the
    // expenseActual row would still be inserted with a non-owned planId.
    const plan = await tx.insurancePlan.findFirst({ where: { id: planId, userId }, select: { id: true } });
    if (!plan) {
      throw new NotFoundError('Insurance plan not found');
    }
    const created = await tx.expenseActual.create({
      data: {
        userId,
        planId,
        projectionId: projectionId ?? null,
        serviceTypeEncrypted: encryption.encrypt(serviceType, userSalt),
        dateOfService: serviceDate ? new Date(serviceDate) : null,
        providerNameEncrypted: providerName ? encryption.encrypt(providerName, userSalt) : null,
        billedAmountEncrypted: encNum(billedAmount),
        insurancePaidEncrypted: encNum(insurancePaid),
        patientPaidEncrypted: encNum(patientPaid),
        appliedToDeductibleEncrypted: encNum(appliedToDeductible),
        appliedToOopEncrypted: encNum(appliedToOop),
        isInNetwork: isInNetwork ?? true,
        claimStatus: claimStatus ?? 'processed',
        notesEncrypted: notes ? encryption.encrypt(notes, userSalt) : null,
      },
    });
    // Keep the plan's met-amounts in sync with logged claims.
    await recomputePlanSpending(tx, userId, planId, encryption, userSalt);
    return created;
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE_ACTUAL, actual.id, {
    planId,
    serviceType,
    claimStatus: claimStatus ?? 'processed',
  }, { req, userId });

  res.status(201).json({ success: true, data: decryptActual(actual, encryption, userSalt) });
}

/**
 * GET /api/expenses/actuals?planId=xxx
 * List expense actuals for a plan, sorted by service date descending.
 */
export async function getActuals(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId } = req.query;

  // Pagination — actuals grow unboundedly across plan-years.
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const where = {
    userId,
    ...(planId && { planId: planId as string }),
  };

  const { actuals, total } = await withRLSTransaction(userId, async (tx) => {
    const [rows, count] = await Promise.all([
      tx.expenseActual.findMany({
        where,
        orderBy: [{ dateOfService: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      tx.expenseActual.count({ where }),
    ]);
    return { actuals: rows, total: count };
  });

  const decrypted = actuals.map((a) => decryptActual(a, encryption, userSalt));

  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE_ACTUAL, undefined, { req, userId }, {
    operation: 'LIST',
    count: decrypted.length,
    total,
    page,
    limit,
    planId: (planId as string) || 'all',
  });

  res.json({
    success: true,
    data: decrypted,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

/**
 * PUT /api/expenses/actuals/:id
 * Update an existing expense actual. Accepts partial updates.
 */
export async function updateActual(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const {
    projectionId,
    serviceType,
    serviceDate,
    providerName,
    billedAmount,
    insurancePaid,
    patientPaid,
    appliedToDeductible,
    appliedToOop,
    isInNetwork,
    claimStatus,
    notes,
  } = req.body;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const encNum = (v: number | undefined | null) =>
    encNumIfProvided(v, encryption.encrypt.bind(encryption), userSalt);
  const encStr = (v: string | undefined | null) =>
    encIfProvided(v, encryption.encrypt.bind(encryption), userSalt);

  const updateData: Record<string, unknown> = {};
  if (projectionId !== undefined) updateData.projectionId = projectionId;
  if (serviceType !== undefined) updateData.serviceTypeEncrypted = encryption.encrypt(serviceType, userSalt);
  if (serviceDate !== undefined) {
    updateData.dateOfService = serviceDate ? new Date(serviceDate) : null;
  }
  if (providerName !== undefined) updateData.providerNameEncrypted = encStr(providerName);
  if (billedAmount !== undefined) updateData.billedAmountEncrypted = encNum(billedAmount);
  if (insurancePaid !== undefined) updateData.insurancePaidEncrypted = encNum(insurancePaid);
  if (patientPaid !== undefined) updateData.patientPaidEncrypted = encNum(patientPaid);
  if (appliedToDeductible !== undefined) updateData.appliedToDeductibleEncrypted = encNum(appliedToDeductible);
  if (appliedToOop !== undefined) updateData.appliedToOopEncrypted = encNum(appliedToOop);
  if (isInNetwork !== undefined) updateData.isInNetwork = isInNetwork;
  if (claimStatus !== undefined) updateData.claimStatus = claimStatus;
  if (notes !== undefined) updateData.notesEncrypted = encStr(notes);

  const updated = await withRLSTransaction(userId, async (tx) => {
    const row = await tx.expenseActual.update({
      where: { id, userId },
      data: updateData,
    });
    // appliedTo* may have changed — resync the plan's met-amounts.
    await recomputePlanSpending(tx, userId, row.planId, encryption, userSalt);
    return row;
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE_ACTUAL, id, {}, {
    fieldsUpdated: Object.keys(updateData),
  }, { req, userId });

  res.json({ success: true, data: decryptActual(updated, encryption, userSalt) });
}

/**
 * DELETE /api/expenses/actuals/:id
 */
export async function deleteActual(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  await withRLSTransaction(userId, async (tx) => {
    const deleted = await tx.expenseActual.delete({
      where: { id, userId },
    });
    // Removing a claim lowers the plan's met-amounts — resync.
    await recomputePlanSpending(tx, userId, deleted.planId, encryption, userSalt);
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE_ACTUAL, id, {}, { req, userId });

  res.status(204).send();
}

// ============================================
// CURRENT SPENDING TRACKING
// ============================================

/**
 * PUT /api/insurance/plans/:id/spending
 * Update current deductible/OOP spending for a plan
 */
export async function updateCurrentSpending(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { deductibleMet, oopMet } = req.body;

  if (deductibleMet === undefined || oopMet === undefined) {
    throw new BadRequestError('Missing deductibleMet or oopMet');
  }

  const prisma = getPrismaClient();

  const updated = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.update({
      where: { id, userId },
      data: {
        deductibleMetIndividual: deductibleMet,
        oopMetIndividual: oopMet,
        updatedAt: new Date(),
      },
    });
  });

  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate('insurance_plan', id, {}, {
    deductibleMet,
    oopMet,
  }, { req, userId });

  res.json(updated);
}

// ============================================
// AI COST ANALYSIS
// ============================================

/**
 * POST /api/expenses/analyze
 * Generate AI-powered cost optimization analysis using Claude
 */
export async function analyzeCosts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId } = req.body;

  if (!planId) {
    throw new BadRequestError('Plan ID required');
  }

  const prisma = getPrismaClient();

  // C-7 runtime gate — refuse to send anything to Claude unless the BAA flag
  // is explicitly set. Matches claudeExtraction/sbcExtraction; surfaces as
  // a 503 so the UI shows a "feature unavailable" message instead of a 500.
  if (!config.anthropic.baaActive) {
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess(RESOURCE_TYPE_ANALYSIS, planId, { req, userId }, {
      operation: 'ANALYZE_BLOCKED_NO_BAA',
    });
    throw new ServiceUnavailableError(
      'Cost analysis is disabled: ANTHROPIC_BAA_ACTIVE must be "true". See SECURITY_STATUS.md C-7.'
    );
  }

  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  // Fetch plan details and expense projections within RLS transaction
  const { plan, projections } = await withRLSTransaction(userId, async (tx) => {
    const plan = await tx.insurancePlan.findUnique({
      where: { id: planId, userId },
    });

    // RT (Low): cap the projection set this single analyze call will decrypt
    // and interpolate into the Claude prompt. Without a bound, a user with an
    // unbounded number of projections on one plan could force one request to
    // decrypt and prompt-embed an arbitrarily large row set (cost/DoS + prompt
    // bloat). Newest-first so the most relevant projections are kept.
    const projections = await tx.expenseProjection.findMany({
      where: { userId, planId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ANALYZE_PROJECTIONS,
    });

    return { plan, projections };
  });

  if (!plan) {
    throw new NotFoundError('Insurance plan not found');
  }

    // Decrypt projections (sanitize serviceType for prompt safety). M-7: route
    // through tryDecrypt so one corrupt/key-mismatched row yields null/'' and
    // logs at warn rather than throwing and failing the whole analysis.
    const decryptedProjections = projections.map((p) => {
      const notes = tryDecrypt(encryption, p.notesEncrypted, userSalt, 'notesEncrypted');
      return {
      id: p.id,
      serviceType: sanitizeForPrompt(tryDecrypt(encryption, p.serviceTypeEncrypted, userSalt, 'serviceTypeEncrypted') ?? ''),
      estimatedCost: parseFloat(tryDecrypt(encryption, p.estimatedCostEncrypted, userSalt, 'estimatedCostEncrypted') ?? ''),
      frequencyPerYear: p.frequencyPerYear,
      isInNetwork: p.isInNetwork,
      notes: notes !== null ? sanitizeForPrompt(notes) : null,
      };
    });

  // Build Claude prompt
  const rawPrompt = buildCostAnalysisPrompt(plan, decryptedProjections);

  // F-17 floor: serviceType + notes already pass through `sanitizeForPrompt`
  // (lines above) which strips control chars and prompt-control tokens.
  // Run the assembled prompt through `stripPHIFromText` as a final scrub
  // before it leaves the box — catches stray PHI patterns (emails, phone
  // numbers, dates, SSN-shaped values, etc.) that a user might have typed
  // into a free-form note on an expense projection. Service-type
  // anonymization (mapping "HIV PrEP consultation" → "Specialist Visit")
  // remains a follow-up; doing it well needs a curated medical taxonomy.
  const prompt = stripPHIFromText(rawPrompt);

  // Call Claude API. Wrap only the network call so a timeout / network
  // error surfaces as a typed ServiceUnavailableError; everything else
  // falls through to the centralized handler.
  const anthropic = getAnthropicClient();

  let message;
  try {
    message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || error.message.includes('timed out'))) {
      logger.error('Cost analysis timed out', { data: { error: error.message } });
      throw new ServiceUnavailableError('Cost analysis timed out. Please try again.');
    }
    // Anything else (auth error, 5xx from Claude, parse error) — re-throw and
    // let the centralized handler render a generic 500 with logging.
    throw error;
  }

    // Defense-in-depth: strip any PHI Claude may have reflected back into
    // its cost-analysis narrative (e.g., a quoted service-type note or a
    // provider name). The response is both persisted to DB (encrypted) and
    // returned to the client — scrub before both sinks.
    const rawClaudeResponse = message.content[0].type === 'text' ? message.content[0].text : '';
    const claudeResponse = stripPHIFromText(rawClaudeResponse);

    trackAIUsage({
      endpoint: 'cost-analysis',
      model: message.model,
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      userId,
    });

    // Extract projected OOP from response (simple parsing)
    const totalProjectedOop = extractProjectedOOP(claudeResponse, decryptedProjections, plan);
    const deductibleMetMonth = extractDeductibleMonth(claudeResponse);

    // Save analysis to database within RLS transaction
    const analysis = await withRLSTransaction(userId, async (tx) => {
      return tx.costAnalysis.create({
        data: {
          userId,
          planId,
          // Column was renamed `claude_response` → `claude_response_encrypted`
          // in migration `20260424_align_uuid_defaults_and_rename_claude_response`.
          // The local `claudeResponse` variable is the post-stripPHIFromText
          // plaintext narrative; the column stores its AES-256-GCM ciphertext.
          claudeResponseEncrypted: encryption.encrypt(claudeResponse, userSalt),
          totalProjectedOopEncrypted: totalProjectedOop
            ? encryption.encrypt(totalProjectedOop.toString(), userSalt)
            : null,
          deductibleMetMonth,
          projectedExpensesSnapshotEncrypted: encryption.encrypt(JSON.stringify(decryptedProjections), userSalt),
        },
      });
    });

    const auditService = getAuditLogService(prisma);
    await auditService.logCreate(RESOURCE_TYPE_ANALYSIS, analysis.id, {
      planId,
      projectionsCount: decryptedProjections.length,
    }, { req, userId });

  // Return decrypted analysis
  res.json({
    success: true,
    data: {
      id: analysis.id,
      planId: analysis.planId,
      // Frontend CostAnalysisData reads `createdAt`; the column is named
      // `analysisDate`. Expose it as createdAt so the UI doesn't render
      // "Invalid Date".
      createdAt: analysis.analysisDate,
      claudeResponse,
      totalProjectedOop,
      deductibleMetMonth,
    },
  });
}

/**
 * GET /api/expenses/analyses?planId=xxx
 * Get cost analysis history
 */
export async function getAnalyses(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId } = req.query;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  const analyses = await withRLSTransaction(userId, async (tx) => {
    return tx.costAnalysis.findMany({
      where: {
        userId,
        ...(planId && { planId: planId as string }),
      },
      orderBy: { analysisDate: 'desc' },
      take: 10, // Limit to last 10 analyses
    });
  });

  // Decrypt PHI fields. tryDecrypt returns null (and logs at warn) on a
  // corrupt/key-mismatched field so one bad row can't throw the whole list.
  const decrypted = analyses.map((a) => {
    const oop = tryDecrypt(encryption, a.totalProjectedOopEncrypted, userSalt, 'totalProjectedOopEncrypted');
    return {
      id: a.id,
      planId: a.planId,
      // Exposed as createdAt to match the frontend CostAnalysisData contract.
      createdAt: a.analysisDate,
      claudeResponse: tryDecrypt(encryption, a.claudeResponseEncrypted, userSalt, 'claudeResponseEncrypted'),
      totalProjectedOop: oop === null ? null : parseFloat(oop),
      deductibleMetMonth: a.deductibleMetMonth,
    };
  });

  // Audit log: READ access to cost analyses
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE_ANALYSIS, undefined, { req, userId }, {
    operation: 'LIST',
    count: decrypted.length,
    planId: (planId as string) || 'all',
  });

  res.json({ success: true, data: decrypted });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

interface DecryptedProjection {
  id: string;
  serviceType: string;
  estimatedCost: number;
  frequencyPerYear: number;
  isInNetwork: boolean;
  notes: string | null;
}

interface PlanForAnalysis {
  deductibleIndividual: unknown;
  deductibleMetIndividual: unknown;
  deductibleFamily: unknown;
  oopMaxIndividual: unknown;
  oopMaxFamily: unknown;
  oopMetIndividual: unknown;
  coinsuranceRate: unknown;
  // C-7 minimum-necessary: planName and insurerName are HIPAA insurance
  // information and aren't needed to compute OOP projections. They are
  // intentionally omitted from this type so the prompt builder cannot
  // regress and interpolate them.
  planType: unknown;
  copayPrimaryCare: unknown;
  copaySpecialist: unknown;
  copayEmergency: unknown;
}

function buildCostAnalysisPrompt(plan: PlanForAnalysis, projections: DecryptedProjection[]): string {
  const today = new Date();
  const currentMonth = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthsRemaining = 12 - today.getMonth();

  const deductibleRemaining = Math.max(0, Number(plan.deductibleIndividual) - Number(plan.deductibleMetIndividual));
  const oopRemaining = Math.max(0, Number(plan.oopMaxIndividual) - Number(plan.oopMetIndividual));

  const totalProjectedCost = projections.reduce((sum, p) => sum + p.estimatedCost * p.frequencyPerYear, 0);

  return `You are a health insurance cost optimization advisor. Today is ${currentMonth}. Analyze this insurance plan and expected medical expenses to provide strategic recommendations.

**CRITICAL**: This is informational guidance only, NOT medical or financial advice. Do NOT recommend delaying necessary medical care for cost reasons.

<insurance_plan_data>
Plan Type: ${plan.planType}${plan.planType === 'HDHP' ? ' (High-Deductible Health Plan - HSA eligible)' : ''}
Individual Deductible: $${Number(plan.deductibleIndividual).toLocaleString()}
Family Deductible: $${Number(plan.deductibleFamily).toLocaleString()}
OOP Max Individual: $${Number(plan.oopMaxIndividual).toLocaleString()}
OOP Max Family: $${Number(plan.oopMaxFamily).toLocaleString()}
Coinsurance Rate: ${plan.coinsuranceRate}% (patient pays after deductible met)
Primary Care Copay: ${plan.copayPrimaryCare ? `$${plan.copayPrimaryCare}` : '--'}
Specialist Copay: ${plan.copaySpecialist ? `$${plan.copaySpecialist}` : '--'}
Emergency Room Copay: ${plan.copayEmergency ? `$${plan.copayEmergency}` : '--'}
</insurance_plan_data>

<spending_data>
Months Remaining in Plan Year: ${monthsRemaining}
Spent Toward Deductible: $${Number(plan.deductibleMetIndividual).toLocaleString()}
Spent Toward OOP Max: $${Number(plan.oopMetIndividual).toLocaleString()}
Deductible Remaining: $${deductibleRemaining.toLocaleString()}
OOP Max Remaining: $${oopRemaining.toLocaleString()}
</spending_data>

<expense_projections>
${
  projections.length === 0
    ? 'No planned expenses entered yet.'
    : projections
        .map((p) => {
          const annualCost = p.estimatedCost * p.frequencyPerYear;
          return `- ${p.serviceType}: $${p.estimatedCost.toLocaleString()} × ${p.frequencyPerYear}/year = $${annualCost.toLocaleString()} total (${p.isInNetwork ? 'In-Network' : 'Out-of-Network'})`;
        })
        .join('\n')
}
Total Projected Annual Cost: $${totalProjectedCost.toLocaleString()} (before insurance)
</expense_projections>

## Analysis Required

Provide a clear, actionable cost analysis:

### 1. Out-of-Pocket Cost Projection
Calculate total patient responsibility including:
- Amount toward deductible
- Coinsurance after deductible is met
- Copays (do not count toward deductible)
- Best-case and worst-case scenarios

### 2. Timeline & Milestones
- **Deductible Met**: Which month will the deductible be fully met?
- **OOP Max Risk**: Is there a scenario where OOP max could be reached?

### 3. Strategic Timing Recommendations
${monthsRemaining > 6 ? '- Should elective procedures be done this year or next?' : '- End of year approaching - any procedures to prioritize before deductible resets?'}
- Cost implications of bunching vs spreading expenses
${plan.planType === 'HDHP' ? '- HSA contribution strategies ($4,300 individual limit for 2025)' : ''}
- Preventive care opportunities (covered 100% before deductible)

### 4. Cost Optimization Tips (max 5)
Specific, actionable ways to reduce out-of-pocket costs.

### 5. Action Items
Prioritized list of 3-5 next steps the patient should take.

Format as clean markdown with headers, bullet points, and tables where helpful.`;
}

function extractProjectedOOP(_claudeResponse: string, projections: DecryptedProjection[], plan: PlanForAnalysis): number | null {
  // Simple calculation fallback
  try {
    const deductibleRemaining = Math.max(0, Number(plan.deductibleIndividual) - Number(plan.deductibleMetIndividual));
    let totalOOP = Number(plan.oopMetIndividual);
    let remainingDeductible = deductibleRemaining;

    for (const proj of projections) {
      if (!proj.isInNetwork) continue; // Skip out-of-network for simple calc
      const annualCost = proj.estimatedCost * proj.frequencyPerYear;

      if (remainingDeductible > 0) {
        const toDeductible = Math.min(annualCost, remainingDeductible);
        totalOOP += toDeductible;
        remainingDeductible -= toDeductible;
        const afterDeductible = annualCost - toDeductible;
        totalOOP += afterDeductible * (Number(plan.coinsuranceRate) / 100);
      } else {
        totalOOP += annualCost * (Number(plan.coinsuranceRate) / 100);
      }
    }

    return Math.min(totalOOP, Number(plan.oopMaxIndividual));
  } catch {
    return null;
  }
}

function extractDeductibleMonth(claudeResponse: string): number | null {
  // Try to extract month from response
  const monthMatch = claudeResponse.match(/deductible.*(?:met|reached).*(?:in\s+)?(\w+)/i);
  if (monthMatch) {
    const monthNames = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const monthIndex = monthNames.indexOf(monthMatch[1].toLowerCase());
    if (monthIndex !== -1) {
      return monthIndex + 1;
    }
  }
  return null;
}
