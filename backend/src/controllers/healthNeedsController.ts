/**
 * Health Needs Controller
 *
 * Handles health needs, conditions, and recommendations with PHI encryption.
 * Descriptions are encrypted at rest.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parseStringParam } from '../utils/queryHelpers.js';
import type { HealthNeed as PrismaHealthNeed } from '../../generated/prisma/index.js';

const RESOURCE_TYPE = 'HealthNeed';

// Response type with decrypted values
interface HealthNeedResponse {
  id: string;
  userId: string;
  needType: string;
  name: string;
  description: string;
  urgency: string;
  status: string;
  relatedBiomarkerIds: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

/**
 * Converts Prisma HealthNeed to response format with decrypted description
 */
function toResponse(need: PrismaHealthNeed, userSalt: string): HealthNeedResponse {
  const encryptionService = getEncryptionService();

  return {
    id: need.id,
    userId: need.userId,
    needType: need.needType,
    name: need.name,
    description: encryptionService.decrypt(need.descriptionEncrypted, userSalt),
    urgency: need.urgency,
    status: need.status,
    relatedBiomarkerIds: need.relatedBiomarkerIds,
    createdAt: need.createdAt,
    updatedAt: need.updatedAt,
    resolvedAt: need.resolvedAt ?? undefined,
  };
}

// Get all health needs for user
export async function getHealthNeeds(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { status, urgency, needType } = req.query;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Build where clause
  const where: {
    userId: string;
    status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
    urgency?: 'IMMEDIATE' | 'URGENT' | 'FOLLOW_UP' | 'ROUTINE';
    needType?: 'CONDITION' | 'ACTION' | 'SERVICE' | 'FOLLOW_UP';
  } = { userId };

  const statusFilter = parseStringParam(status);
  const urgencyFilter = parseStringParam(urgency);
  const needTypeFilter = parseStringParam(needType);

  if (statusFilter) {
    where.status = statusFilter as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
  }
  if (urgencyFilter) {
    where.urgency = urgencyFilter as 'IMMEDIATE' | 'URGENT' | 'FOLLOW_UP' | 'ROUTINE';
  }
  if (needTypeFilter) {
    where.needType = needTypeFilter as 'CONDITION' | 'ACTION' | 'SERVICE' | 'FOLLOW_UP';
  }

  // Pagination happens at the DB layer so a long-tail user doesn't pay
  // for decrypting 1000 rows on every dashboard mount.
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;

  const { needs, total } = await withRLSTransaction(userId, async (tx) => {
    const [rows, count] = await Promise.all([
      tx.healthNeed.findMany({
        where,
        orderBy: [
          // Sort by urgency (IMMEDIATE first)
          { urgency: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      tx.healthNeed.count({ where }),
    ]);
    return { needs: rows, total: count };
  });

  // Custom sort to put IMMEDIATE first (Prisma doesn't support custom enum ordering).
  // Applied to the current page only — acceptable because urgency is also
  // the primary sort at the DB layer above.
  const urgencyOrder: Record<string, number> = {
    IMMEDIATE: 0,
    URGENT: 1,
    FOLLOW_UP: 2,
    ROUTINE: 3,
  };

  const sortedNeeds = needs.sort((a, b) => {
    const urgencyDiff = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4);
    if (urgencyDiff !== 0) return urgencyDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const decryptedNeeds = sortedNeeds.map((n) => toResponse(n, userSalt));

  // Audit log: READ access to health needs list
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: needs.length,
    total,
    page,
    limit,
    status: statusFilter ?? 'all',
    urgency: urgencyFilter ?? 'all',
    needType: needTypeFilter ?? 'all',
  });

  const response: ApiResponse<HealthNeedResponse[]> = {
    success: true,
    data: decryptedNeeds,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };

  res.json(response);
}

// Get single health need
export async function getHealthNeed(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const need = await withRLSTransaction(userId, async (tx) => {
    return tx.healthNeed.findFirst({
      where: { id, userId },
    });
  });

  if (!need) {
    throw new NotFoundError('Health need not found');
  }

  // Audit log: READ access to single health need
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<HealthNeedResponse> = {
    success: true,
    data: toResponse(need, userSalt),
  };

  res.json(response);
}

// Create health need
export async function createHealthNeed(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { needType, name, description, urgency, relatedBiomarkerIds } = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Encrypt description
  const descriptionEncrypted = encryptionService.encrypt(description, userSalt);

  const need = await withRLSTransaction(userId, async (tx) => {
    return tx.healthNeed.create({
      data: {
        userId,
        needType,
        name,
        descriptionEncrypted,
        urgency,
        status: 'PENDING',
        relatedBiomarkerIds: relatedBiomarkerIds || [],
      },
    });
  });

  // Audit log: CREATE health need
  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE, need.id, {
    needType,
    name,
    urgency,
  }, { req, userId });

  const response: ApiResponse<HealthNeedResponse> = {
    success: true,
    data: toResponse(need, userSalt),
  };

  res.status(201).json(response);
}

// Update health need
export async function updateHealthNeed(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { needType, name, description, urgency, relatedBiomarkerIds } = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (needType !== undefined) updateData.needType = needType;
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) {
    updateData.descriptionEncrypted = encryptionService.encrypt(description, userSalt);
  }
  if (urgency !== undefined) updateData.urgency = urgency;
  if (relatedBiomarkerIds !== undefined) updateData.relatedBiomarkerIds = relatedBiomarkerIds;

  const { existing, updated } = await withRLSTransaction(userId, async (tx) => {
    const existing = await tx.healthNeed.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError('Health need not found');
    }

    const updated = await tx.healthNeed.update({
      where: { id },
      data: updateData,
    });

    return { existing, updated };
  });

  // Audit log: UPDATE health need
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    name: existing.name,
    needType: existing.needType,
    urgency: existing.urgency,
  }, {
    name: updated.name,
    needType: updated.needType,
    urgency: updated.urgency,
    fieldsUpdated: Object.keys(updateData),
  }, { req, userId });

  const response: ApiResponse<HealthNeedResponse> = {
    success: true,
    data: toResponse(updated, userSalt),
  };

  res.json(response);
}

// Update health need status
export async function updateHealthNeedStatus(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { status } = req.body;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const updateData: { status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED'; resolvedAt?: Date | null } = {
    status: status as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED'
  };

  if (status === 'COMPLETED') {
    updateData.resolvedAt = new Date();
  } else if (status === 'PENDING' || status === 'IN_PROGRESS') {
    // Reopening a need from a closed state clears the stale resolution stamp so
    // it no longer shows as resolved while active. Mirrors the completedAt-clear
    // for ACTIVE/PAUSED in updateHealthGoal. DISMISSED is intentionally left
    // untouched — a dismissed need is not "resolved", and prior behavior
    // neither stamped nor cleared resolvedAt for it.
    updateData.resolvedAt = null;
  }

  const { existing, updated } = await withRLSTransaction(userId, async (tx) => {
    const existing = await tx.healthNeed.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError('Health need not found');
    }

    const updated = await tx.healthNeed.update({
      where: { id },
      data: updateData,
    });

    return { existing, updated };
  });

  // Audit log: UPDATE health need status
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    status: existing.status,
  }, {
    status: updated.status,
  }, { req, userId });

  const response: ApiResponse<HealthNeedResponse> = {
    success: true,
    data: toResponse(updated, userSalt),
  };

  res.json(response);
}

// Delete health need
export async function deleteHealthNeed(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const need = await withRLSTransaction(userId, async (tx) => {
    const need = await tx.healthNeed.findFirst({
      where: { id, userId },
    });

    if (!need) {
      throw new NotFoundError('Health need not found');
    }

    await tx.healthNeed.delete({
      where: { id },
    });

    return need;
  });

  // Audit log: DELETE health need
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    name: need.name,
    needType: need.needType,
  }, { req, userId });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Analyze health needs (based on biomarkers)
export async function analyzeHealthNeeds(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const { outOfRangeBiomarkers, existingConditions } = await withRLSTransaction(userId, async (tx) => {
    // Get user's biomarkers that are out of range
    const outOfRangeBiomarkers = await tx.biomarker.findMany({
      where: { userId, isOutOfRange: true },
      select: { id: true, name: true, category: true },
    });

    // Get existing health needs marked as conditions
    const existingConditions = await tx.healthNeed.findMany({
      where: { userId, needType: 'CONDITION' },
    });

    return { outOfRangeBiomarkers, existingConditions };
  });

  // Generate recommendations based on biomarkers
  const recommendations: string[] = [];

  if (outOfRangeBiomarkers.length > 0) {
    recommendations.push('Schedule appointment with healthcare provider to discuss out-of-range biomarkers');
  }

  const categories = [...new Set(outOfRangeBiomarkers.map((b) => b.category))];

  if (categories.includes('Lipids')) {
    recommendations.push('Consider heart-healthy dietary modifications');
    recommendations.push('Discuss lipid management options with your doctor');
  }

  if (categories.includes('Blood')) {
    recommendations.push('Continue regular blood monitoring');
  }

  if (categories.includes('Metabolic')) {
    recommendations.push('Monitor blood glucose levels regularly');
    recommendations.push('Consider lifestyle modifications for metabolic health');
  }

  // Always include general recommendations
  recommendations.push('Schedule annual physical examination');
  recommendations.push('Maintain regular exercise routine');
  recommendations.push('Ensure adequate sleep and stress management');

  const decryptedConditions = existingConditions.map((c) => toResponse(c, userSalt));

  // Audit log: READ access to health needs analysis
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, 'ANALYSIS', { req, userId }, {
    outOfRangeBiomarkersCount: outOfRangeBiomarkers.length,
    conditionsCount: existingConditions.length,
    recommendationsCount: recommendations.length,
  });

  const response: ApiResponse<{
    detectedConditions: HealthNeedResponse[];
    recommendations: string[];
    outOfRangeBiomarkers: { id: string; name: string; category: string }[];
  }> = {
    success: true,
    data: {
      detectedConditions: decryptedConditions,
      recommendations: [...new Set(recommendations)], // Remove duplicates
      outOfRangeBiomarkers,
    },
  };

  res.json(response);
}

// Get health needs summary
export async function getHealthNeedsSummary(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Run all count queries in parallel inside RLS transaction
  const [statusCounts, urgencyCounts, typeCounts] = await withRLSTransaction(userId, async (tx) => {
    return Promise.all([
      tx.healthNeed.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      }),
      tx.healthNeed.groupBy({
        by: ['urgency'],
        where: { userId },
        _count: { urgency: true },
      }),
      tx.healthNeed.groupBy({
        by: ['needType'],
        where: { userId },
        _count: { needType: true },
      }),
    ]);
  });

  const summary = {
    byStatus: Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count.status])
    ),
    byUrgency: Object.fromEntries(
      urgencyCounts.map((u) => [u.urgency, u._count.urgency])
    ),
    byType: Object.fromEntries(
      typeCounts.map((t) => [t.needType, t._count.needType])
    ),
    total: statusCounts.reduce((sum, s) => sum + s._count.status, 0),
    pending: statusCounts.find((s) => s.status === 'PENDING')?._count.status ?? 0,
    immediate: urgencyCounts.find((u) => u.urgency === 'IMMEDIATE')?._count.urgency ?? 0,
    urgent: urgencyCounts.find((u) => u.urgency === 'URGENT')?._count.urgency ?? 0,
  };

  // Audit log: READ access to health needs summary
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, 'SUMMARY', { req, userId }, {
    total: summary.total,
  });

  const response: ApiResponse<typeof summary> = {
    success: true,
    data: summary,
  };

  res.json(response);
}

// L-? / F-6 — Removed dead `bulkCreateHealthNeeds`. It read `req.body.needs` as
// untyped objects (needType/urgency cast straight to enum unions) and wrote each
// to the DB with no Zod schema, length cap, or array bound, but was not wired to
// any route (healthNeedsRoutes.ts exposes only get/create/update/delete/analyze/
// summary) and had no other reference. Deleted to eliminate the unvalidated-input
// footgun. If bulk creation is needed later, add a route with a validated
// `schemas.healthNeed.bulkCreate` Zod schema (capped array length + per-item
// enum validation) rather than reinstating this.
