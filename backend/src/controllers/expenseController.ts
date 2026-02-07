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
const RESOURCE_TYPE_ANALYSIS = 'cost_analysis';

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

  try {
    const prisma = getPrismaClient();
    const userSalt = await getUserEncryptionSalt(userId);
    const encryption = getEncryptionService();

    const projections = await withRLSTransaction(userId, async (tx) => {
      return tx.expenseProjection.findMany({
        where: {
          userId,
          ...(planId && { planId: planId as string }),
        },
        orderBy: { createdAt: 'desc' },
      });
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
      planId: (planId as string) || 'all',
    });

    res.json(decrypted);
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
  planName: unknown;
  insurerName: unknown;
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
