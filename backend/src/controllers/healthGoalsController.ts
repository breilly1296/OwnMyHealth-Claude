/**
 * Health Goals Controller
 *
 * Handles health goal management for the analytics dashboard.
 * Supports goal setting, progress tracking, and milestone management.
 * Descriptions are encrypted at rest for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parseStringParam } from '../utils/queryHelpers.js';
import type { HealthGoal as PrismaHealthGoal, GoalProgressHistory, Prisma } from '../generated/prisma/index.js';

const RESOURCE_TYPE = 'HealthGoal';

// Response types
interface HealthGoalResponse {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  category: string;
  targetValue: number;
  currentValue: number | null;
  startValue: number | null;
  unit: string;
  direction: string;
  relatedBiomarkerId: string | null;
  startDate: string;
  targetDate: string;
  status: string;
  progress: number;
  milestones: Milestone[] | null;
  reminderFrequency: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  progressHistory?: ProgressHistoryResponse[];
}

interface ProgressHistoryResponse {
  id: string;
  value: number;
  progress: number;
  note: string | null;
  recordedAt: Date;
}

interface Milestone {
  value: number;
  label: string;
  achieved: boolean;
  achievedAt?: string;
}

/**
 * Converts Prisma HealthGoal to response format with decrypted description
 */
function toResponse(
  goal: PrismaHealthGoal & { progressHistory?: GoalProgressHistory[] },
  userSalt: string
): HealthGoalResponse {
  const encryptionService = getEncryptionService();

  let description: string | null = null;
  if (goal.descriptionEncrypted) {
    description = encryptionService.decrypt(goal.descriptionEncrypted, userSalt);
  }

  let milestones: Milestone[] | null = null;
  if (goal.milestones) {
    try {
      milestones = JSON.parse(goal.milestones);
    } catch {
      milestones = null;
    }
  }

  const response: HealthGoalResponse = {
    id: goal.id,
    userId: goal.userId,
    name: goal.name,
    description,
    category: goal.category,
    targetValue: Number(goal.targetValue),
    currentValue: goal.currentValue ? Number(goal.currentValue) : null,
    startValue: goal.startValue ? Number(goal.startValue) : null,
    unit: goal.unit,
    direction: goal.direction,
    relatedBiomarkerId: goal.relatedBiomarkerId,
    startDate: goal.startDate.toISOString().split('T')[0],
    targetDate: goal.targetDate.toISOString().split('T')[0],
    status: goal.status,
    progress: Number(goal.progress),
    milestones,
    reminderFrequency: goal.reminderFrequency,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    completedAt: goal.completedAt,
  };

  // Include progress history if available
  if (goal.progressHistory) {
    response.progressHistory = goal.progressHistory.map((h) => ({
      id: h.id,
      value: Number(h.value),
      progress: Number(h.progress),
      note: h.noteEncrypted ? encryptionService.decrypt(h.noteEncrypted, userSalt) : null,
      recordedAt: h.recordedAt,
    }));
  }

  return response;
}

/**
 * Calculate progress percentage based on direction and values
 */
function calculateProgress(
  startValue: number,
  currentValue: number,
  targetValue: number,
  direction: string
): number {
  if (direction === 'DECREASE') {
    // For decrease goals (e.g., weight loss, lower cholesterol)
    const totalChange = startValue - targetValue;
    if (totalChange <= 0) return 100; // Already at or below target
    const actualChange = startValue - currentValue;
    const progress = (actualChange / totalChange) * 100;
    return Math.min(Math.max(progress, 0), 100);
  } else if (direction === 'INCREASE') {
    // For increase goals (e.g., HDL increase)
    const totalChange = targetValue - startValue;
    if (totalChange <= 0) return 100; // Already at or above target
    const actualChange = currentValue - startValue;
    const progress = (actualChange / totalChange) * 100;
    return Math.min(Math.max(progress, 0), 100);
  } else {
    // MAINTAIN - check if still within acceptable range
    const variance = Math.abs(currentValue - targetValue);
    const allowedVariance = targetValue * 0.05; // 5% variance allowed
    if (variance <= allowedVariance) return 100;
    return Math.max(0, 100 - (variance / targetValue) * 100);
  }
}

// Get all health goals for user
export async function getHealthGoals(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { status, category } = req.query;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Build where clause
  const where: Prisma.HealthGoalWhereInput = { userId };

  const statusFilter = parseStringParam(status);
  const categoryFilter = parseStringParam(category);

  if (statusFilter) {
    where.status = statusFilter as 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'FAILED' | 'CANCELLED';
  }
  if (categoryFilter) {
    where.category = categoryFilter;
  }

  const goals = await prisma.healthGoal.findMany({
    where,
    include: {
      progressHistory: {
        orderBy: { recordedAt: 'desc' },
        take: 10, // Last 10 progress entries
      },
    },
    orderBy: [
      { status: 'asc' }, // Active goals first
      { targetDate: 'asc' }, // Nearest target date first
    ],
  });

  const decryptedGoals = goals.map((g) => toResponse(g, userSalt));

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: goals.length,
    status: statusFilter ?? 'all',
    category: categoryFilter ?? 'all',
  });

  const response: ApiResponse<HealthGoalResponse[]> = {
    success: true,
    data: decryptedGoals,
  };

  res.json(response);
}

// Get single health goal
export async function getHealthGoal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const goal = await prisma.healthGoal.findFirst({
    where: { id, userId },
    include: {
      progressHistory: {
        orderBy: { recordedAt: 'desc' },
      },
    },
  });

  if (!goal) {
    throw new NotFoundError('Health goal not found');
  }

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<HealthGoalResponse> = {
    success: true,
    data: toResponse(goal, userSalt),
  };

  res.json(response);
}

// Create health goal
export async function createHealthGoal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const {
    name,
    description,
    category,
    targetValue,
    currentValue,
    unit,
    direction,
    relatedBiomarkerId,
    startDate,
    targetDate,
    milestones,
    reminderFrequency,
  } = req.body;

  // Validate required fields
  if (!name || !unit || !category || !startDate || !targetDate) {
    throw new ValidationError('Missing required fields: name, unit, category, startDate, targetDate');
  }

  // Validate targetValue is a valid number
  if (targetValue === undefined || targetValue === null || typeof targetValue !== 'number' || isNaN(targetValue)) {
    throw new ValidationError('targetValue must be a valid number');
  }

  // Validate currentValue if provided
  if (currentValue !== undefined && currentValue !== null && (typeof currentValue !== 'number' || isNaN(currentValue))) {
    throw new ValidationError('currentValue must be a valid number when provided');
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Encrypt description if provided
  const descriptionEncrypted = description
    ? encryptionService.encrypt(description, userSalt)
    : null;

  // Calculate initial progress
  const startValue = currentValue ?? targetValue;
  const progress = currentValue
    ? calculateProgress(startValue, currentValue, targetValue, direction || 'DECREASE')
    : 0;

  const goal = await prisma.healthGoal.create({
    data: {
      userId,
      name,
      descriptionEncrypted,
      category,
      targetValue,
      currentValue: currentValue ?? null,
      startValue,
      unit,
      direction: direction || 'DECREASE',
      relatedBiomarkerId: relatedBiomarkerId || null,
      startDate: new Date(startDate),
      targetDate: new Date(targetDate),
      status: 'ACTIVE',
      progress,
      milestones: milestones ? JSON.stringify(milestones) : null,
      reminderFrequency: reminderFrequency || null,
    },
  });

  // Create initial progress history entry if currentValue provided
  if (currentValue !== undefined) {
    await prisma.goalProgressHistory.create({
      data: {
        goalId: goal.id,
        value: currentValue,
        progress,
        noteEncrypted: encryptionService.encrypt('Initial value', userSalt),
      },
    });
  }

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE, goal.id, {
    name,
    category,
    targetValue,
    direction,
  }, { req, userId });

  const response: ApiResponse<HealthGoalResponse> = {
    success: true,
    data: toResponse(goal, userSalt),
  };

  res.status(201).json(response);
}

// Update health goal
export async function updateHealthGoal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const {
    name,
    description,
    targetValue,
    targetDate,
    milestones,
    reminderFrequency,
    status,
  } = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  const existing = await prisma.healthGoal.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new NotFoundError('Health goal not found');
  }

  // Build update data
  const updateData: Prisma.HealthGoalUpdateInput = {};

  if (name !== undefined) updateData.name = name;
  if (description !== undefined) {
    updateData.descriptionEncrypted = encryptionService.encrypt(description, userSalt);
  }
  if (targetValue !== undefined) updateData.targetValue = targetValue;
  if (targetDate !== undefined) updateData.targetDate = new Date(targetDate);
  if (milestones !== undefined) updateData.milestones = JSON.stringify(milestones);
  if (reminderFrequency !== undefined) updateData.reminderFrequency = reminderFrequency;
  if (status !== undefined) {
    updateData.status = status;
    if (status === 'ACHIEVED' || status === 'FAILED' || status === 'CANCELLED') {
      updateData.completedAt = new Date();
    }
  }

  const updated = await prisma.healthGoal.update({
    where: { id },
    data: updateData,
  });

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    name: existing.name,
    status: existing.status,
  }, {
    name: updated.name,
    status: updated.status,
    fieldsUpdated: Object.keys(updateData),
  }, { req, userId });

  const response: ApiResponse<HealthGoalResponse> = {
    success: true,
    data: toResponse(updated, userSalt),
  };

  res.json(response);
}

// Update goal progress
export async function updateGoalProgress(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { value, note } = req.body;

  if (value === undefined) {
    throw new ValidationError('Value is required');
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  const goal = await prisma.healthGoal.findFirst({
    where: { id, userId },
  });

  if (!goal) {
    throw new NotFoundError('Health goal not found');
  }

  // Calculate new progress
  const startValue = Number(goal.startValue) || Number(goal.targetValue);
  const progress = calculateProgress(startValue, value, Number(goal.targetValue), goal.direction);

  // Check if goal is achieved
  let status = goal.status;
  let completedAt: Date | null = null;

  if (progress >= 100) {
    status = 'ACHIEVED';
    completedAt = new Date();
  }

  // Update milestones
  let milestones: Milestone[] | null = null;
  if (goal.milestones) {
    try {
      milestones = JSON.parse(goal.milestones);
      if (milestones) {
        milestones = milestones.map((m) => {
          const achieved = goal.direction === 'DECREASE'
            ? value <= m.value
            : value >= m.value;
          return {
            ...m,
            achieved: m.achieved || achieved,
            achievedAt: (m.achieved || achieved) ? (m.achievedAt || new Date().toISOString()) : undefined,
          };
        });
      }
    } catch {
      milestones = null;
    }
  }

  // Update goal
  await prisma.healthGoal.update({
    where: { id },
    data: {
      currentValue: value,
      progress,
      status,
      completedAt,
      milestones: milestones ? JSON.stringify(milestones) : goal.milestones,
    },
  });

  // Create progress history entry
  await prisma.goalProgressHistory.create({
    data: {
      goalId: id,
      value,
      progress,
      noteEncrypted: note ? encryptionService.encrypt(note, userSalt) : null,
    },
  });

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    currentValue: goal.currentValue ? Number(goal.currentValue) : null,
    progress: Number(goal.progress),
  }, {
    currentValue: value,
    progress,
    status,
  }, { req, userId });

  // Fetch with history
  const goalWithHistory = await prisma.healthGoal.findFirst({
    where: { id },
    include: {
      progressHistory: {
        orderBy: { recordedAt: 'desc' },
        take: 10,
      },
    },
  });

  const response: ApiResponse<HealthGoalResponse> = {
    success: true,
    data: toResponse(goalWithHistory!, userSalt),
  };

  res.json(response);
}

// Delete health goal
export async function deleteHealthGoal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const goal = await prisma.healthGoal.findFirst({
    where: { id, userId },
  });

  if (!goal) {
    throw new NotFoundError('Health goal not found');
  }

  // Audit log (before deletion)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    name: goal.name,
    category: goal.category,
    status: goal.status,
  }, { req, userId });

  await prisma.healthGoal.delete({
    where: { id },
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Get goals summary
export async function getGoalsSummary(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Count by status
  const statusCounts = await prisma.healthGoal.groupBy({
    by: ['status'],
    where: { userId },
    _count: { status: true },
  });

  // Count by category
  const categoryCounts = await prisma.healthGoal.groupBy({
    by: ['category'],
    where: { userId },
    _count: { category: true },
  });

  // Get active goals with low progress (need attention)
  const needAttention = await prisma.healthGoal.count({
    where: {
      userId,
      status: 'ACTIVE',
      progress: { lt: 25 },
      targetDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // Within 30 days
    },
  });

  // Get recently achieved
  const recentlyAchieved = await prisma.healthGoal.count({
    where: {
      userId,
      status: 'ACHIEVED',
      completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
    },
  });

  const summary = {
    byStatus: Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count.status])
    ),
    byCategory: Object.fromEntries(
      categoryCounts.map((c) => [c.category, c._count.category])
    ),
    total: statusCounts.reduce((sum, s) => sum + s._count.status, 0),
    active: statusCounts.find((s) => s.status === 'ACTIVE')?._count.status ?? 0,
    achieved: statusCounts.find((s) => s.status === 'ACHIEVED')?._count.status ?? 0,
    needAttention,
    recentlyAchieved,
  };

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'SUMMARY',
    total: summary.total,
  });

  const response: ApiResponse<typeof summary> = {
    success: true,
    data: summary,
  };

  res.json(response);
}

// Suggest goals based on biomarkers
export async function suggestGoals(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Get user's out-of-range biomarkers
  const outOfRangeBiomarkers = await prisma.biomarker.findMany({
    where: { userId, isOutOfRange: true },
    select: {
      id: true,
      name: true,
      category: true,
      valueEncrypted: true,
      unit: true,
      normalRangeMin: true,
      normalRangeMax: true,
    },
  });

  // Generate goal suggestions based on biomarkers
  const suggestions: Array<{
    name: string;
    category: string;
    targetValue: number;
    unit: string;
    direction: string;
    relatedBiomarkerId: string;
    description: string;
  }> = [];

  for (const biomarker of outOfRangeBiomarkers) {
    const min = Number(biomarker.normalRangeMin);
    const max = Number(biomarker.normalRangeMax);

    // We can't decrypt here without the salt, but we can suggest based on normal range
    suggestions.push({
      name: `Optimize ${biomarker.name}`,
      category: biomarker.category,
      targetValue: (min + max) / 2, // Target middle of normal range
      unit: biomarker.unit,
      direction: 'MAINTAIN', // Default to maintain within range
      relatedBiomarkerId: biomarker.id,
      description: `Bring ${biomarker.name} into the normal range (${min}-${max} ${biomarker.unit})`,
    });
  }

  // Add general health goals if no biomarker-based ones
  if (suggestions.length === 0) {
    suggestions.push(
      {
        name: 'Maintain Healthy Blood Pressure',
        category: 'Vital Signs',
        targetValue: 120,
        unit: 'mmHg',
        direction: 'MAINTAIN',
        relatedBiomarkerId: '',
        description: 'Keep systolic blood pressure at or below 120 mmHg',
      },
      {
        name: 'Regular Exercise',
        category: 'Lifestyle',
        targetValue: 150,
        unit: 'min/week',
        direction: 'INCREASE',
        relatedBiomarkerId: '',
        description: 'Achieve 150 minutes of moderate exercise per week',
      }
    );
  }

  // Audit log
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'SUGGESTIONS',
    suggestionsCount: suggestions.length,
    outOfRangeBiomarkersCount: outOfRangeBiomarkers.length,
  });

  const response: ApiResponse<typeof suggestions> = {
    success: true,
    data: suggestions,
  };

  res.json(response);
}
