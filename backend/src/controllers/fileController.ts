/**
 * File Controller
 *
 * Handles CRUD operations for user files (uploaded lab reports, documents).
 * Files are stored in Google Cloud Storage with signed URL access.
 * All file access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { getSignedUrl, deleteFile as deleteFromStorage } from '../services/storageService.js';
import { logger } from '../utils/logger.js';

const RESOURCE_TYPE = 'UserFile';

// Response type for user files
interface UserFileResponse {
  id: string;
  filename: string;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  labName: string | null;
  labDate: string | null;
  biomarkersExtracted: number;
  extractionConfidence: number | null;
  categories: string[];
  createdAt: string;
  downloadUrl?: string;
}

/**
 * Get all files for the authenticated user
 */
export async function getFiles(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  // Pagination — uploaded lab files accumulate over time; fetching them all
  // on every dashboard mount means a fresh signed URL pass for each one.
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const skip = (page - 1) * limit;

  // Get a page of files + total count in one tx so the numbers match.
  const { files, total } = await withRLSTransaction(userId, async (tx) => {
    const [rows, count] = await Promise.all([
      tx.userFile.findMany({
        where: { userId },
        include: {
          biomarkers: {
            select: { category: true },
          },
        },
        orderBy: { labDate: 'desc' },
        skip,
        take: limit,
      }),
      tx.userFile.count({ where: { userId } }),
    ]);
    return { files: rows, total: count };
  });

  // Transform to response format with computed categories
  const fileResponses: UserFileResponse[] = files.map((file) => {
    // Get unique categories from linked biomarkers
    const categories = [...new Set(file.biomarkers.map((b) => b.category))];

    return {
      id: file.id,
      filename: file.filename,
      originalFilename: file.originalFilename,
      fileType: file.fileType,
      fileSize: file.fileSize,
      storageKey: file.storageKey,
      labName: file.labName,
      labDate: file.labDate?.toISOString().split('T')[0] || null,
      biomarkersExtracted: file.biomarkersExtracted,
      extractionConfidence: file.extractionConfidence
        ? Number(file.extractionConfidence)
        : null,
      categories,
      createdAt: file.createdAt.toISOString(),
    };
  });

  // Audit log: READ access to file list
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: files.length,
    total,
    page,
    limit,
  });

  const response: ApiResponse<UserFileResponse[]> = {
    success: true,
    data: fileResponses,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };

  res.json(response);
}

/**
 * Get a single file by ID with signed download URL
 */
export async function getFile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const file = await withRLSTransaction(userId, async (tx) => {
    return tx.userFile.findFirst({
      where: { id, userId },
      include: {
        biomarkers: {
          select: { category: true },
        },
      },
    });
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Get unique categories from linked biomarkers
  const categories = [...new Set(file.biomarkers.map((b) => b.category))];

  // Generate signed URL for download
  let downloadUrl: string | undefined;
  try {
    downloadUrl = await getSignedUrl(file.storageKey, 'read');
  } catch (error) {
    logger.error('Failed to generate signed URL for file', {
      data: {
        fileId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    // Don't fail the request, just omit the URL
  }

  const fileResponse: UserFileResponse = {
    id: file.id,
    filename: file.filename,
    originalFilename: file.originalFilename,
    fileType: file.fileType,
    fileSize: file.fileSize,
    storageKey: file.storageKey,
    labName: file.labName,
    labDate: file.labDate?.toISOString().split('T')[0] || null,
    biomarkersExtracted: file.biomarkersExtracted,
    extractionConfidence: file.extractionConfidence
      ? Number(file.extractionConfidence)
      : null,
    categories,
    createdAt: file.createdAt.toISOString(),
    downloadUrl,
  };

  // Audit log: READ access to single file
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<UserFileResponse> = {
    success: true,
    data: fileResponse,
  };

  res.json(response);
}

/**
 * Get a signed download URL for a file
 * Returns a short-lived (15 min) signed URL for downloading the file
 */
export async function getFileDownloadUrl(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const file = await withRLSTransaction(userId, async (tx) => {
    return tx.userFile.findFirst({
      where: { id, userId },
      select: { id: true, storageKey: true, filename: true },
    });
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Generate signed URL for download
  const downloadUrl = await getSignedUrl(file.storageKey, 'read');

  // Audit log: EXPORT access (downloading file)
  const auditService = getAuditLogService(prisma);
  await auditService.logExport(
    RESOURCE_TYPE,
    [id],
    'FILE_DOWNLOAD',
    { req, userId },
    { filename: file.filename }
  );

  const response: ApiResponse<{ url: string; expiresIn: number }> = {
    success: true,
    data: {
      url: downloadUrl,
      expiresIn: 900, // 15 minutes in seconds
    },
  };

  res.json(response);
}

/**
 * Delete a file
 * - Removes from GCS storage
 * - Unlinks biomarkers (sets userFileId to null)
 * - Deletes database record
 */
export async function deleteFile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  // Find the file within RLS context
  const file = await withRLSTransaction(userId, async (tx) => {
    return tx.userFile.findFirst({
      where: { id, userId },
      select: { id: true, storageKey: true, filename: true, biomarkersExtracted: true },
    });
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Audit log: DELETE file (log before deletion)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    filename: file.filename,
    biomarkersExtracted: file.biomarkersExtracted,
  }, { req, userId });

  // Delete from GCS storage
  try {
    await deleteFromStorage(file.storageKey);
  } catch (error) {
    logger.error('Failed to delete file from GCS', {
      data: {
        fileId: id,
        storageKey: file.storageKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    // Continue with database deletion even if GCS fails
    // The file might already be deleted or the storage key might be invalid
  }

  // Unlink biomarkers and delete file record within RLS context
  await withRLSTransaction(userId, async (tx) => {
    // Unlink biomarkers from this file (don't delete them)
    await tx.biomarker.updateMany({
      where: { userFileId: id },
      data: { userFileId: null },
    });

    // Delete the file record
    await tx.userFile.delete({
      where: { id },
    });
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}
