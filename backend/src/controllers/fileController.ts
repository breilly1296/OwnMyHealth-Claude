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
import {
  getFileStream,
  deleteFile as deleteFromStorage,
} from '../services/storageService.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { decryptOriginalFilename } from '../utils/userFileNames.js';
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

  // L24: original filenames are encrypted at rest; decrypt for this owner view.
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  // Transform to response format with computed categories
  const fileResponses: UserFileResponse[] = files.map((file) => {
    // Get unique categories from linked biomarkers
    const categories = [...new Set(file.biomarkers.map((b) => b.category))];

    return {
      id: file.id,
      filename: file.filename,
      originalFilename: decryptOriginalFilename(file, encryption, userSalt),
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
 * Get a single file's metadata by ID.
 *
 * Returns metadata ONLY. This endpoint used to mint a 15-minute GCS signed
 * URL (`downloadUrl`), which was an unbound capture-replay vector — anyone
 * who obtained the link (browser history, referrer, a paste into a ticket)
 * could pull the raw PHI with no authentication for 15 minutes. The single
 * PHI-egress path is now the audited, no-store proxy stream in
 * `getFileDownloadUrl` (GET /files/:id/download).
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

  // L24: original filename is encrypted at rest; decrypt for this owner view.
  const userSalt = await getUserEncryptionSalt(userId);
  const encryption = getEncryptionService();

  // Get unique categories from linked biomarkers
  const categories = [...new Set(file.biomarkers.map((b) => b.category))];

  const fileResponse: UserFileResponse = {
    id: file.id,
    filename: file.filename,
    originalFilename: decryptOriginalFilename(file, encryption, userSalt),
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
 * Stream a file's bytes through the backend.
 *
 * Previously this endpoint returned a 15-minute GCS signed URL to the
 * frontend, which the browser then downloaded directly. The signed URL
 * was unbound — anyone who obtained the link (browser history, referrer
 * header, a copy-paste into Slack) could pull the PHI with no further
 * authentication. Proxying the bytes forces every download to pass
 * authenticate + RLS + ownership checks on the way in.
 *
 * Response body is the raw file. Set `Content-Disposition` so the browser
 * saves it under the original filename; set `Cache-Control: no-store` so
 * intermediaries and browser caches can't retain PHI.
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
      select: {
        id: true,
        storageKey: true,
        filename: true,
        originalFilename: true,
        originalFilenameEncrypted: true,
        fileType: true,
        fileSize: true,
      },
    });
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Audit log: EXPORT access (downloading file). Log BEFORE streaming so
  // the trail is preserved even if the client aborts the transfer
  // mid-stream — we still disclosed the file to that session.
  const auditService = getAuditLogService(prisma);
  await auditService.logExport(
    RESOURCE_TYPE,
    [id],
    'FILE_DOWNLOAD',
    { req, userId },
    { filename: file.filename }
  );

  // Sanitize filename for Content-Disposition — strip anything that would
  // let an attacker inject header delimiters or make the browser render
  // HTML. The value is wrapped in quotes; strip embedded quotes + CRLF.
  // L24: the original filename is encrypted at rest; decrypt for the owner's
  // own download (falls back to the non-PHI `filename` label).
  const userSalt = await getUserEncryptionSalt(userId);
  const decryptedOriginal = decryptOriginalFilename(file, getEncryptionService(), userSalt);
  const rawFilename = decryptedOriginal || file.filename || 'download';
  const safeFilename = rawFilename.replace(/["\r\n\\]/g, '_');
  // RFC 5987/6266: the ASCII `filename` token can only carry ISO-8859-1, so a
  // non-ASCII name (accents, CJK, etc.) gets mangled. Emit `filename*` with a
  // UTF-8 percent-encoding alongside the ASCII fallback so modern browsers keep
  // the original name and older ones fall back gracefully. Header injection is
  // already blocked above; encodeURIComponent additionally percent-escapes any
  // CR/LF/quote, so the starred value cannot break out of the header.
  const encodedFilename = encodeURIComponent(rawFilename);

  res.set({
    'Content-Type': file.fileType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'no-store, no-cache, private, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (file.fileSize) {
    res.set('Content-Length', String(file.fileSize));
  }

  const stream = getFileStream(file.storageKey);
  stream.on('error', (error: Error) => {
    logger.error('GCS stream error during file download', {
      data: {
        fileId: id,
        storageKey: file.storageKey,
        error: error.message,
      },
    });
    // If headers are already sent we can't send a structured error; the
    // client will see a truncated response and the error handler
    // (express) will close the connection. If not yet sent, emit 502.
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: { code: 'STORAGE_READ_FAILED', message: 'Unable to read file from storage' },
      });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
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

  // Delete the GCS object FIRST and fail hard on any non-404 error (F-22).
  // storageService.deleteFile() already treats a 404 (object already gone) as
  // success and rethrows everything else, so this catch only fires on real
  // failures. We deliberately do NOT swallow them: the DB row is the only
  // pointer to storageKey, so deleting it after a failed GCS delete would
  // orphan PHI in the bucket with no way to ever find it. Aborting here keeps
  // the object AND its DB pointer intact for a clean retry — mirroring the
  // bulk-delete policy in settingsController.deleteAllData / deleteAccount (C-6).
  try {
    await deleteFromStorage(file.storageKey);
  } catch (error) {
    logger.error('Failed to delete file from GCS; aborting DB deletion to avoid orphaned PHI', {
      data: {
        fileId: id,
        storageKey: file.storageKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    throw error;
  }

  // Audit log: DELETE file (GCS object is gone; record the actual deletion).
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    filename: file.filename,
    biomarkersExtracted: file.biomarkersExtracted,
  }, { req, userId });

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
