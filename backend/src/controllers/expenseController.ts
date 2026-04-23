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
import Anthropic from '@anthropic-ai/sdk';
import type { AuthenticatedRequest } from '../types/index.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';
import { sanitizeForPrompt } from '../middleware/validation.js';
import { trackAIUsage } from '../services/aiCostTracker.js';
import { config } from '../config/index.js';

/**
 * Anthropic client singleton — reuse across requests
 */
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    anthropicClient = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }
  return anthropicClient;
}

const RESOURCE_TYPE_PROJECTION = 'expense_projection';
const RESOURCE_TYPE_ACTUAL = 'expense_actual';
const RESOURCE_TYPE_ANALYSIS = 'cost_analysis';

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

  try {
    // Validate required fields
    if (!planId || !serviceType || estimatedCost === undefined || !frequencyPerYear) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const prisma = getPrismaClient();
    const userSalt = await getUserEncryptionSalt(userId);
    const encryption = getEncryptionService();

    const projection = await withRLSTransaction(userId, async (tx) => {
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

    res.status(201).json(decrypted);
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to create expense projection' });
  }
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

  try {
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

    // Decrypt PHI fields
    const decrypted = projections.map((p) => ({
      ...p,
      serviceType: encryption.decrypt(p.serviceTypeEncrypted, userSalt),
      estimatedCost: parseFloat(encryption.decrypt(p.estimatedCostEncrypted, userSalt)),
      notes: p.notesEncrypted ? encryption.decrypt(p.notesEncrypted, userSalt) : null,
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
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to fetch expense projections' });
  }
}

/**
 * PUT /api/expenses/projections/:id
 * Update an expense projection
 */
export async function updateProjection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { serviceType, estimatedCost, frequencyPerYear, isInNetwork, notes } = req.body;

  try {
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

    res.json(decrypted);
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to update expense projection' });
  }
}

/**
 * DELETE /api/expenses/projections/:id
 * Delete an expense projection
 */
export async function deleteProjection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const prisma = getPrismaClient();

    await withRLSTransaction(userId, async (tx) => {
      await tx.expenseProjection.delete({
        where: { id, userId },
      });
    });

    const auditService = getAuditLogService(prisma);
    await auditService.logDelete(RESOURCE_TYPE_PROJECTION, id, {}, { req, userId });

    res.status(204).send();
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to delete expense projection' });
  }
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
  const decryptNumber = (v: string | null) =>
    v ? parseFloat(encryption.decrypt(v, userSalt)) : null;
  return {
    id: a.id,
    userId: a.userId,
    planId: a.planId,
    projectionId: a.projectionId,
    serviceType: encryption.decrypt(a.serviceTypeEncrypted, userSalt),
    serviceDate: a.dateOfService ? a.dateOfService.toISOString().split('T')[0] : null,
    providerName: a.providerNameEncrypted ? encryption.decrypt(a.providerNameEncrypted, userSalt) : null,
    billedAmount: decryptNumber(a.billedAmountEncrypted),
    insurancePaid: decryptNumber(a.insurancePaidEncrypted),
    patientPaid: decryptNumber(a.patientPaidEncrypted),
    appliedToDeductible: decryptNumber(a.appliedToDeductibleEncrypted),
    appliedToOop: decryptNumber(a.appliedToOopEncrypted),
    isInNetwork: a.isInNetwork ?? true,
    claimStatus: a.claimStatus,
    notes: a.notesEncrypted ? encryption.decrypt(a.notesEncrypted, userSalt) : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
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

  try {
    const prisma = getPrismaClient();
    const userSalt = await getUserEncryptionSalt(userId);
    const encryption = getEncryptionService();

    // Create path: undefined/null both collapse to null (no prior value to preserve).
    const encNum = (v: number | undefined | null) =>
      v === undefined || v === null ? null : encryption.encrypt(v.toString(), userSalt);

    const actual = await withRLSTransaction(userId, async (tx) => {
      return tx.expenseActual.create({
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
    });

    const auditService = getAuditLogService(prisma);
    await auditService.logCreate(RESOURCE_TYPE_ACTUAL, actual.id, {
      planId,
      serviceType,
      claimStatus: claimStatus ?? 'processed',
    }, { req, userId });

    res.status(201).json(decryptActual(actual, encryption, userSalt));
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to create expense actual' });
  }
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

  try {
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
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to fetch expense actuals' });
  }
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

  try {
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
      return tx.expenseActual.update({
        where: { id, userId },
        data: updateData,
      });
    });

    const auditService = getAuditLogService(prisma);
    await auditService.logUpdate(RESOURCE_TYPE_ACTUAL, id, {}, {
      fieldsUpdated: Object.keys(updateData),
    }, { req, userId });

    res.json(decryptActual(updated, encryption, userSalt));
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to update expense actual' });
  }
}

/**
 * DELETE /api/expenses/actuals/:id
 */
export async function deleteActual(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const prisma = getPrismaClient();

    await withRLSTransaction(userId, async (tx) => {
      await tx.expenseActual.delete({
        where: { id, userId },
      });
    });

    const auditService = getAuditLogService(prisma);
    await auditService.logDelete(RESOURCE_TYPE_ACTUAL, id, {}, { req, userId });

    res.status(204).send();
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to delete expense actual' });
  }
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

  try {
    if (deductibleMet === undefined || oopMet === undefined) {
      res.status(400).json({ error: 'Missing deductibleMet or oopMet' });
      return;
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
  } catch (error) {
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to update spending' });
  }
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

  try {
    if (!planId) {
      res.status(400).json({ error: 'Plan ID required' });
      return;
    }

    const prisma = getPrismaClient();

    // C-7 runtime gate — refuse to send anything to Claude unless the BAA flag
    // is explicitly set. Matches claudeExtraction/sbcExtraction; graceful 503
    // so the UI can show a user-facing message instead of a 500.
    if (!config.anthropic.baaActive) {
      const auditService = getAuditLogService(prisma);
      await auditService.logAccess(RESOURCE_TYPE_ANALYSIS, planId, { req, userId }, {
        operation: 'ANALYZE_BLOCKED_NO_BAA',
      });
      res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Cost analysis is disabled: ANTHROPIC_BAA_ACTIVE must be "true". See SECURITY_STATUS.md C-7.',
        },
      });
      return;
    }

    const userSalt = await getUserEncryptionSalt(userId);
    const encryption = getEncryptionService();

    // Fetch plan details and expense projections within RLS transaction
    const { plan, projections } = await withRLSTransaction(userId, async (tx) => {
      const plan = await tx.insurancePlan.findUnique({
        where: { id: planId, userId },
      });

      const projections = await tx.expenseProjection.findMany({
        where: { userId, planId },
        orderBy: { createdAt: 'desc' },
      });

      return { plan, projections };
    });

    if (!plan) {
      res.status(404).json({ error: 'Insurance plan not found' });
      return;
    }

    // Decrypt projections (sanitize serviceType for prompt safety)
    const decryptedProjections = projections.map((p) => ({
      id: p.id,
      serviceType: sanitizeForPrompt(encryption.decrypt(p.serviceTypeEncrypted, userSalt)),
      estimatedCost: parseFloat(encryption.decrypt(p.estimatedCostEncrypted, userSalt)),
      frequencyPerYear: p.frequencyPerYear,
      isInNetwork: p.isInNetwork,
      notes: p.notesEncrypted ? sanitizeForPrompt(encryption.decrypt(p.notesEncrypted, userSalt)) : null,
    }));

    // Build Claude prompt
    const prompt = buildCostAnalysisPrompt(plan, decryptedProjections);

    // Call Claude API
    const anthropic = getAnthropicClient();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const claudeResponse = message.content[0].type === 'text' ? message.content[0].text : '';

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
          claudeResponse: encryption.encrypt(claudeResponse, userSalt),
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
      id: analysis.id,
      analysisDate: analysis.analysisDate,
      claudeResponse,
      totalProjectedOop,
      deductibleMetMonth,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || error.message.includes('timed out'))) {
      logger.error('Cost analysis timed out', { data: { error: error.message } });
      res.status(504).json({ error: 'Cost analysis timed out. Please try again.' });
      return;
    }
    logger.error('Operation failed:', { data: { error } });
    res.status(500).json({ error: 'Failed to generate cost analysis' });
  }
}

/**
 * GET /api/expenses/analyses?planId=xxx
 * Get cost analysis history
 */
export async function getAnalyses(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { planId } = req.query;

  try {
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

    // Decrypt PHI fields
    const decrypted = analyses.map((a) => ({
      id: a.id,
      planId: a.planId,
      analysisDate: a.analysisDate,
      claudeResponse: encryption.decrypt(a.claudeResponse, userSalt),
      totalProjectedOop: a.totalProjectedOopEncrypted
        ? parseFloat(encryption.decrypt(a.totalProjectedOopEncrypted, userSalt))
        : null,
      deductibleMetMonth: a.deductibleMetMonth,
    }));

    // Audit log: READ access to cost analyses
    const auditService = getAuditLogService(prisma);
    await auditService.logAccess(RESOURCE_TYPE_ANALYSIS, undefined, { req, userId }, {
      operation: 'LIST',
      count: decrypted.length,
      planId: (planId as string) || 'all',
    });

    res.json(decrypted);
  } catch (error) {
    logger.error('Failed to fetch analyses:', { data: { error } });
    res.status(500).json({ error: 'Failed to fetch cost analyses' });
  }
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
