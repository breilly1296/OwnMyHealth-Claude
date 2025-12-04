/**
 * Biomarker Controller
 *
 * Handles CRUD operations for biomarkers with PHI encryption.
 * All biomarker values and notes are encrypted at rest.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import type { BiomarkerCreateInput, BiomarkerUpdateInput } from '../middleware/validation.js';
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parsePagination, parseStringParam, createPaginationMeta } from '../utils/queryHelpers.js';
import type { Biomarker as PrismaBiomarker, DataSourceType } from '../generated/prisma/index.js';

const RESOURCE_TYPE = 'Biomarker';

// Helper to convert Prisma Decimal to number
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

// Response type for biomarkers (with decrypted values)
interface BiomarkerResponse {
  id: string;
  userId: string;
  category: string;
  name: string;
  unit: string;
  value: number;
  notes?: string;
  normalRange: {
    min: number;
    max: number;
    source?: string;
  };
  date: string;
  sourceType: string;
  sourceFile?: string;
  extractionConfidence?: number;
  labName?: string;
  isOutOfRange: boolean;
  isAcknowledged: boolean;
  history: { date: string; value: number }[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converts a Prisma Biomarker to response format with decrypted values
 */
async function toResponse(
  biomarker: PrismaBiomarker & { history?: { measurementDate: Date; valueEncrypted: string }[] },
  userSalt: string
): Promise<BiomarkerResponse> {
  const encryptionService = getEncryptionService();

  // Decrypt value and notes
  const decryptedValue = encryptionService.decrypt(biomarker.valueEncrypted, userSalt);
  const decryptedNotes = biomarker.notesEncrypted
    ? encryptionService.decrypt(biomarker.notesEncrypted, userSalt)
    : undefined;

  // Decrypt history values
  const history = biomarker.history
    ? await Promise.all(
        biomarker.history.map(async (h) => ({
          date: h.measurementDate.toISOString().split('T')[0],
          value: parseFloat(encryptionService.decrypt(h.valueEncrypted, userSalt)),
        }))
      )
    : [];

  return {
    id: biomarker.id,
    userId: biomarker.userId,
    category: biomarker.category,
    name: biomarker.name,
    unit: biomarker.unit,
    value: parseFloat(decryptedValue),
    notes: decryptedNotes,
    normalRange: {
      min: toNumber(biomarker.normalRangeMin),
      max: toNumber(biomarker.normalRangeMax),
      source: biomarker.normalRangeSource ?? undefined,
    },
    date: biomarker.measurementDate.toISOString().split('T')[0],
    sourceType: biomarker.sourceType,
    sourceFile: biomarker.sourceFile ?? undefined,
    extractionConfidence: biomarker.extractionConfidence
      ? toNumber(biomarker.extractionConfidence)
      : undefined,
    labName: biomarker.labName ?? undefined,
    isOutOfRange: biomarker.isOutOfRange,
    isAcknowledged: biomarker.isAcknowledged,
    history,
    createdAt: biomarker.createdAt,
    updatedAt: biomarker.updatedAt,
  };
}

// Get all biomarkers for authenticated user
export async function getBiomarkers(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { category, page, limit } = req.query;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Parse pagination using query helper
  const pagination = parsePagination(page, limit, { defaultLimit: 20 });
  const categoryFilter = parseStringParam(category);

  // Build where clause
  const where: { userId: string; category?: string } = { userId };
  if (categoryFilter) {
    where.category = categoryFilter;
  }

  // Get total count
  const total = await prisma.biomarker.count({ where });

  // Get paginated biomarkers with history
  const biomarkers = await prisma.biomarker.findMany({
    where,
    include: { history: true },
    skip: pagination.skip,
    take: pagination.take,
    orderBy: { measurementDate: 'desc' },
  });

  // Decrypt all biomarkers
  const decryptedBiomarkers = await Promise.all(
    biomarkers.map((b) => toResponse(b, userSalt))
  );

  // Audit log: READ access to biomarker list
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: biomarkers.length,
    category: categoryFilter || 'all',
  });

  const response: ApiResponse<BiomarkerResponse[]> = {
    success: true,
    data: decryptedBiomarkers,
    pagination: createPaginationMeta(total, pagination),
  };

  res.json(response);
}

// Get single biomarker by ID
export async function getBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  const biomarker = await prisma.biomarker.findFirst({
    where: { id, userId },
    include: { history: true },
  });

  if (!biomarker) {
    throw new NotFoundError('Biomarker not found');
  }

  // Audit log: READ access to single biomarker
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(biomarker, userSalt),
  };

  res.json(response);
}

// Create new biomarker
export async function createBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const input: BiomarkerCreateInput = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Encrypt PHI fields
  const valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
  const notesEncrypted = input.notes
    ? encryptionService.encrypt(input.notes, userSalt)
    : null;

  // Determine if out of range
  const isOutOfRange =
    input.value < input.normalRange.min || input.value > input.normalRange.max;

  const biomarker = await prisma.biomarker.create({
    data: {
      userId,
      category: input.category,
      name: input.name,
      unit: input.unit,
      valueEncrypted,
      notesEncrypted,
      normalRangeMin: input.normalRange.min,
      normalRangeMax: input.normalRange.max,
      normalRangeSource: input.normalRange.source,
      measurementDate: new Date(input.date),
      sourceType: input.sourceType || 'MANUAL',
      sourceFile: input.sourceFile,
      extractionConfidence: input.extractionConfidence,
      labName: input.labName,
      isOutOfRange,
      isAcknowledged: false,
    },
    include: { history: true },
  });

  // Audit log: CREATE biomarker
  const auditService = getAuditLogService(prisma);
  await auditService.logCreate(RESOURCE_TYPE, biomarker.id, {
    name: input.name,
    category: input.category,
    value: input.value,
  }, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(biomarker, userSalt),
  };

  res.status(201).json(response);
}

// Update biomarker
export async function updateBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const input: BiomarkerUpdateInput = req.body;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Find existing biomarker
  const existing = await prisma.biomarker.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new NotFoundError('Biomarker not found');
  }

  // If value is changing, save current value to history
  if (input.value !== undefined) {
    const currentValue = encryptionService.decrypt(existing.valueEncrypted, userSalt);
    if (String(input.value) !== currentValue) {
      await prisma.biomarkerHistory.create({
        data: {
          biomarkerId: id,
          valueEncrypted: existing.valueEncrypted,
          measurementDate: existing.measurementDate,
        },
      });
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (input.value !== undefined) {
    updateData.valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
  }
  if (input.notes !== undefined) {
    updateData.notesEncrypted = input.notes
      ? encryptionService.encrypt(input.notes, userSalt)
      : null;
  }
  if (input.category !== undefined) updateData.category = input.category;
  if (input.name !== undefined) updateData.name = input.name;
  if (input.unit !== undefined) updateData.unit = input.unit;
  if (input.date !== undefined) updateData.measurementDate = new Date(input.date);
  if (input.normalRange?.min !== undefined) updateData.normalRangeMin = input.normalRange.min;
  if (input.normalRange?.max !== undefined) updateData.normalRangeMax = input.normalRange.max;
  if (input.normalRange?.source !== undefined) updateData.normalRangeSource = input.normalRange.source;
  if (input.labName !== undefined) updateData.labName = input.labName;

  // Recalculate isOutOfRange if value or range changed
  if (input.value !== undefined || input.normalRange?.min !== undefined || input.normalRange?.max !== undefined) {
    const newValue = input.value ?? parseFloat(encryptionService.decrypt(existing.valueEncrypted, userSalt));
    const newMin = input.normalRange?.min ?? toNumber(existing.normalRangeMin);
    const newMax = input.normalRange?.max ?? toNumber(existing.normalRangeMax);
    updateData.isOutOfRange = newValue < newMin || newValue > newMax;
  }

  const updated = await prisma.biomarker.update({
    where: { id },
    data: updateData,
    include: { history: true },
  });

  // Audit log: UPDATE biomarker
  const auditService = getAuditLogService(prisma);
  await auditService.logUpdate(RESOURCE_TYPE, id, {
    name: existing.name,
    category: existing.category,
  }, {
    name: updated.name,
    category: updated.category,
    fieldsUpdated: Object.keys(updateData),
  }, { req, userId });

  const response: ApiResponse<BiomarkerResponse> = {
    success: true,
    data: await toResponse(updated, userSalt),
  };

  res.json(response);
}

// Delete biomarker
export async function deleteBiomarker(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const biomarker = await prisma.biomarker.findFirst({
    where: { id, userId },
  });

  if (!biomarker) {
    throw new NotFoundError('Biomarker not found');
  }

  // Audit log: DELETE biomarker (log before deletion)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    name: biomarker.name,
    category: biomarker.category,
  }, { req, userId });

  // Delete biomarker (history will cascade delete)
  await prisma.biomarker.delete({
    where: { id },
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Get biomarker categories for user
export async function getCategories(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  const biomarkers = await prisma.biomarker.findMany({
    where: { userId },
    select: { category: true },
    distinct: ['category'],
  });

  const categories = biomarkers.map((b) => b.category);

  const response: ApiResponse<string[]> = {
    success: true,
    data: categories,
  };

  res.json(response);
}

// Bulk create biomarkers (for file upload)
// PERFORMANCE: Uses createMany for O(1) database operations instead of O(n)
// ERROR HANDLING: Reports succeeded and failed items
export async function bulkCreateBiomarkers(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const inputs: BiomarkerCreateInput[] = req.body.biomarkers;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Track succeeded and failed items
  interface FailedItem {
    index: number;
    name: string;
    error: string;
  }
  const failedItems: FailedItem[] = [];
  const validBiomarkerData: Array<{
    userId: string;
    category: string;
    name: string;
    unit: string;
    valueEncrypted: string;
    notesEncrypted: string | null;
    normalRangeMin: number;
    normalRangeMax: number;
    normalRangeSource?: string;
    measurementDate: Date;
    sourceType: DataSourceType;
    sourceFile?: string;
    extractionConfidence?: number;
    labName?: string;
    isOutOfRange: boolean;
    isAcknowledged: boolean;
  }> = [];

  // Prepare and validate each biomarker
  inputs.forEach((input, index) => {
    try {
      // Validate required fields
      if (!input.name || !input.category || !input.unit) {
        throw new Error('Missing required fields: name, category, or unit');
      }
      if (typeof input.value !== 'number' || isNaN(input.value)) {
        throw new Error(`Invalid value: ${input.value}`);
      }
      if (!input.normalRange?.min || !input.normalRange?.max) {
        throw new Error('Missing normal range min/max');
      }

      const valueEncrypted = encryptionService.encrypt(String(input.value), userSalt);
      const notesEncrypted = input.notes
        ? encryptionService.encrypt(input.notes, userSalt)
        : null;
      const isOutOfRange =
        input.value < input.normalRange.min || input.value > input.normalRange.max;

      // Validate sourceType against allowed enum values
      const validSourceTypes: DataSourceType[] = ['MANUAL', 'LAB_UPLOAD', 'EHR_IMPORT', 'DEVICE_SYNC', 'API_IMPORT'];
      const sourceType: DataSourceType = validSourceTypes.includes(input.sourceType as DataSourceType)
        ? (input.sourceType as DataSourceType)
        : 'MANUAL';

      validBiomarkerData.push({
        userId,
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted,
        notesEncrypted,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: input.normalRange.source,
        measurementDate: new Date(input.date),
        sourceType,
        sourceFile: input.sourceFile,
        extractionConfidence: input.extractionConfidence,
        labName: input.labName,
        isOutOfRange,
        isAcknowledged: false,
      });
    } catch (error) {
      failedItems.push({
        index,
        name: input.name || `Item ${index}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // If no valid items, return error
  if (validBiomarkerData.length === 0) {
    res.status(400).json({
      success: false,
      error: 'All biomarkers failed validation',
      meta: {
        total: inputs.length,
        succeeded: 0,
        failed: failedItems.length,
        failedItems,
      },
    });
    return;
  }

  // Use createMany for efficient batch insert
  try {
    await prisma.biomarker.createMany({
      data: validBiomarkerData,
    });
  } catch (dbError) {
    // Database error - all valid items failed
    const errorMessage = dbError instanceof Error ? dbError.message : 'Database error';
    res.status(500).json({
      success: false,
      error: `Failed to create biomarkers: ${errorMessage}`,
      meta: {
        total: inputs.length,
        succeeded: 0,
        failed: inputs.length,
        failedItems: validBiomarkerData.map((_, i) => ({
          index: i,
          name: validBiomarkerData[i].name,
          error: errorMessage,
        })),
      },
    });
    return;
  }

  // Fetch the created biomarkers to return with IDs
  const recentDate = new Date(Date.now() - 60000); // Last minute
  const createdRecords = await prisma.biomarker.findMany({
    where: {
      userId,
      createdAt: { gte: recentDate },
      name: { in: validBiomarkerData.map(i => i.name) },
    },
    include: { history: true },
    orderBy: { createdAt: 'desc' },
    take: validBiomarkerData.length,
  });

  const createdBiomarkers = await Promise.all(
    createdRecords.map(b => toResponse(b, userSalt))
  );

  // Batch audit log: CREATE for bulk biomarkers
  await auditService.logCreate(RESOURCE_TYPE, 'BULK', {
    count: createdBiomarkers.length,
    categories: [...new Set(validBiomarkerData.map(i => i.category))],
    names: validBiomarkerData.map(i => i.name),
    failedCount: failedItems.length,
  }, { req, userId });

  // Determine response status - partial success returns 207
  const statusCode = failedItems.length > 0 ? 207 : 201;

  const response: ApiResponse<BiomarkerResponse[]> = {
    success: failedItems.length === 0,
    data: createdBiomarkers,
    meta: {
      total: inputs.length,
      succeeded: createdBiomarkers.length,
      failed: failedItems.length,
      ...(failedItems.length > 0 && { failedItems }),
    },
  };

  res.status(statusCode).json(response);
}

// Response type for summary endpoint
interface BiomarkerSummaryResponse {
  totalBiomarkers: number;
  inRangeCount: number;
  outOfRangeCount: number;
  acknowledgedCount: number;
  byCategory: {
    category: string;
    total: number;
    inRange: number;
    outOfRange: number;
  }[];
  recentlyUpdated: number;
  lastUpdatedAt?: string;
}

// Response type for history endpoint
interface BiomarkerHistoryEntry {
  date: string;
  value: number;
  isOutOfRange: boolean;
}

interface BiomarkerHistoryResponse {
  biomarkerId: string;
  name: string;
  category: string;
  unit: string;
  normalRange: {
    min: number;
    max: number;
  };
  currentValue: number;
  history: BiomarkerHistoryEntry[];
}

/**
 * Get biomarker summary statistics for the user
 * Returns counts by category, in-range vs out-of-range stats
 */
export async function getSummary(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Get all biomarkers for the user (we don't need decryption for summary stats)
  const biomarkers = await prisma.biomarker.findMany({
    where: { userId },
    select: {
      id: true,
      category: true,
      isOutOfRange: true,
      isAcknowledged: true,
      updatedAt: true,
    },
  });

  // Calculate totals
  const totalBiomarkers = biomarkers.length;
  const outOfRangeCount = biomarkers.filter((b) => b.isOutOfRange).length;
  const inRangeCount = totalBiomarkers - outOfRangeCount;
  const acknowledgedCount = biomarkers.filter((b) => b.isAcknowledged).length;

  // Count by category
  const categoryMap = new Map<string, { total: number; inRange: number; outOfRange: number }>();
  for (const biomarker of biomarkers) {
    const existing = categoryMap.get(biomarker.category) || { total: 0, inRange: 0, outOfRange: 0 };
    existing.total++;
    if (biomarker.isOutOfRange) {
      existing.outOfRange++;
    } else {
      existing.inRange++;
    }
    categoryMap.set(biomarker.category, existing);
  }

  const byCategory = Array.from(categoryMap.entries()).map(([category, stats]) => ({
    category,
    ...stats,
  })).sort((a, b) => b.total - a.total);

  // Count recently updated (within last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentlyUpdated = biomarkers.filter((b) => b.updatedAt >= thirtyDaysAgo).length;

  // Find most recent update
  const lastUpdatedAt = biomarkers.length > 0
    ? biomarkers.reduce((latest, b) => (b.updatedAt > latest ? b.updatedAt : latest), biomarkers[0].updatedAt).toISOString()
    : undefined;

  // Audit log: READ access to summary
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'SUMMARY',
  });

  const summary: BiomarkerSummaryResponse = {
    totalBiomarkers,
    inRangeCount,
    outOfRangeCount,
    acknowledgedCount,
    byCategory,
    recentlyUpdated,
    lastUpdatedAt,
  };

  const response: ApiResponse<BiomarkerSummaryResponse> = {
    success: true,
    data: summary,
  };

  res.json(response);
}

/**
 * Get historical values for a specific biomarker
 * Returns the current value and historical values over time
 * PERFORMANCE: Added date range filter with default of 90 days to limit data
 *
 * Query params:
 * - startDate: ISO date string (default: 90 days ago)
 * - endDate: ISO date string (default: today)
 * - limit: max entries (default: 100, max: 1000)
 */
export async function getHistory(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { startDate, endDate, limit = '100' } = req.query;

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  // Parse date range (default: last 90 days)
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 90);

  const dateStart = startDate ? new Date(startDate as string) : defaultStart;
  const dateEnd = endDate ? new Date(endDate as string) : now;
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string, 10) || 100));

  // Get the biomarker with filtered history
  const biomarker = await prisma.biomarker.findFirst({
    where: { id, userId },
    include: {
      history: {
        where: {
          measurementDate: {
            gte: dateStart,
            lte: dateEnd,
          },
        },
        orderBy: { measurementDate: 'asc' },
        take: limitNum,
      },
    },
  });

  if (!biomarker) {
    throw new NotFoundError('Biomarker not found');
  }

  const normalRangeMin = toNumber(biomarker.normalRangeMin);
  const normalRangeMax = toNumber(biomarker.normalRangeMax);

  // Decrypt current value
  const currentValue = parseFloat(encryptionService.decrypt(biomarker.valueEncrypted, userSalt));

  // Build history entries from historical records
  const historyEntries: BiomarkerHistoryEntry[] = biomarker.history.map((h) => {
    const value = parseFloat(encryptionService.decrypt(h.valueEncrypted, userSalt));
    return {
      date: h.measurementDate.toISOString().split('T')[0],
      value,
      isOutOfRange: value < normalRangeMin || value > normalRangeMax,
    };
  });

  // Add the current value as the latest entry (if within date range)
  const currentMeasurementDate = biomarker.measurementDate;
  if (currentMeasurementDate >= dateStart && currentMeasurementDate <= dateEnd) {
    historyEntries.push({
      date: currentMeasurementDate.toISOString().split('T')[0],
      value: currentValue,
      isOutOfRange: biomarker.isOutOfRange,
    });
  }

  // Audit log: READ access to biomarker history
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId }, {
    operation: 'HISTORY',
    count: historyEntries.length,
    dateRangeStart: dateStart.toISOString(),
    dateRangeEnd: dateEnd.toISOString(),
  });

  const historyResponse: BiomarkerHistoryResponse = {
    biomarkerId: biomarker.id,
    name: biomarker.name,
    category: biomarker.category,
    unit: biomarker.unit,
    normalRange: {
      min: normalRangeMin,
      max: normalRangeMax,
    },
    currentValue,
    history: historyEntries,
  };

  const response: ApiResponse<BiomarkerHistoryResponse> = {
    success: true,
    data: historyResponse,
  };

  res.json(response);
}

/**
 * Gets biomarkers with decrypted values for internal use (e.g., health analysis)
 * This is used by healthController for analysis
 * PERFORMANCE: Limits history to last 90 days, max 100 entries per biomarker
 */
export async function getDecryptedBiomarkersForUser(userId: string): Promise<BiomarkerResponse[]> {
  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Calculate date 90 days ago
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const biomarkers = await prisma.biomarker.findMany({
    where: { userId },
    include: {
      history: {
        where: {
          measurementDate: { gte: ninetyDaysAgo },
        },
        orderBy: { measurementDate: 'desc' },
        take: 100,
      },
    },
  });

  return Promise.all(biomarkers.map((b) => toResponse(b, userSalt)));
}
