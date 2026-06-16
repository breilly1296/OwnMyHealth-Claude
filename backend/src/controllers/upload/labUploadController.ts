/**
 * Lab Upload Controller
 *
 * Handles lab-report PDF upload (Claude-based extraction) and the OCR upload
 * path (Google Document AI). Both persist the source file to GCS and create
 * a `UserFile` record alongside the extracted biomarkers.
 */

import { Response } from 'express';
import type { ApiResponse } from '../../types/index.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import { getPrismaClient, withRLSTransaction } from '../../services/database.js';
import { getAuditLogService } from '../../services/auditLog.js';
import { getEncryptionService } from '../../services/encryption.js';
import { getUserEncryptionSalt } from '../../services/userEncryption.js';
import { processDocument, extractDateFromText, extractLabNameFromText } from '../../services/ocrService.js';
import { uploadFile as uploadToGCS } from '../../services/storageService.js';
import { validatePdfHeader } from '../../utils/securePdfParsing.js';
import { notifyNewResults, notifyOutOfRange } from '../../services/notificationService.js';
import { logger } from '../../utils/logger.js';
import {
  type UploadRequest,
  type LabReportUploadResponse,
  type LabResultOCRResponse,
  validateUploadFile,
  createBiomarkersFromOCRResult,
  withGcsOrphanCleanup,
  LAB_REPORT_RESOURCE,
  LAB_OCR_RESOURCE,
} from './shared.js';

/**
 * Upload and process a lab report PDF using Claude-based extraction.
 * Persists the PDF to GCS and creates a UserFile record (F-21).
 * POST /api/v1/upload/lab-report
 */
export async function uploadLabReport(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  validateUploadFile(file, 'pdf');
  validatePdfHeader(file.buffer, file.originalname);

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Process the PDF using Claude API for intelligent extraction
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname, userId);

  if (ocrResult.biomarkers.length === 0) {
    await auditService.logAccess(LAB_REPORT_RESOURCE, undefined, { req, userId }, {
      operation: 'PARSE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      reason: 'No biomarkers extracted',
    });
    throw new ValidationError('Could not extract any biomarkers from the PDF. Please ensure it is a valid lab report.');
  }

  const labName = ocrResult.metadata.labName || extractLabNameFromText(ocrResult.text);
  const reportDateStr = ocrResult.metadata.labDate || extractDateFromText(ocrResult.text);
  const reportDate = reportDateStr ? new Date(reportDateStr) : new Date();

  // Persist source PDF to GCS (F-21). Failure is non-fatal — biomarker
  // extraction is still recorded; only the file record is skipped.
  const fileId = crypto.randomUUID();
  let storageKey: string | null = null;
  try {
    storageKey = await uploadToGCS(userId, fileId, file.buffer, file.mimetype);
    logger.info('Lab report uploaded to GCS', { data: { fileId, storageKey, userId } });
  } catch (error) {
    logger.error('Failed to upload lab report to GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        fileId,
        userId,
      },
    });
  }

  // Create UserFile + biomarkers inside one RLS transaction. If the tx rolls
  // back, withGcsOrphanCleanup deletes the object we uploaded above so PHI can't
  // be orphaned in the bucket with no DB pointer (M8/M25).
  const { createdBiomarkers, userFile } = await withGcsOrphanCleanup(
    storageKey,
    { fileId, userId },
    () =>
      withRLSTransaction(userId, async (tx) => {
        let fileRecord: { id: string; filename: string; storageKey: string } | null = null;
        if (storageKey) {
          // A userFile.create failure poisons the interactive tx (so the
          // biomarker inserts below would abort anyway). Let it propagate: the
          // whole upload fails and the GCS object is cleaned up, rather than
          // pretending the file record is optional after a doomed tx.
          const createdFile = await tx.userFile.create({
            data: {
              id: fileId,
              userId,
              filename: labName
                ? `${labName} - ${reportDate.toLocaleDateString()}`
                : `Lab report - ${reportDate.toLocaleDateString()}`,
              // L24: the raw client filename can embed PHI — store it encrypted
              // (per-user key) and keep the plaintext column null. `filename`
              // above stays a non-PHI label.
              originalFilename: null,
              originalFilenameEncrypted: encryptionService.encrypt(file.originalname, userSalt),
              fileType: file.mimetype,
              fileSize: file.size,
              storageKey,
              labName: labName || null,
              labDate: reportDate,
              biomarkersExtracted: ocrResult.biomarkers.length,
              extractionConfidence: ocrResult.confidence,
            },
          });
          fileRecord = {
            id: createdFile.id,
            filename: createdFile.filename,
            storageKey: createdFile.storageKey,
          };
        }

        const createdBiomarkers = await createBiomarkersFromOCRResult(
          tx,
          encryptionService,
          userSalt,
          {
            userId,
            biomarkers: ocrResult.biomarkers,
            reportDate,
            labName: labName || undefined,
            notesPrefix: 'Extracted from lab report',
            normalRangeSource: 'Lab Report',
            userFileId: fileRecord?.id,
          }
        );

        return { createdBiomarkers, userFile: fileRecord };
      })
  );

  await auditService.logCreate(LAB_REPORT_RESOURCE, 'BATCH', {
    filename: file.originalname,
    fileSize: file.size,
    biomarkersExtracted: createdBiomarkers.length,
    labName: labName || undefined,
    extractionConfidence: ocrResult.confidence,
    processorType: ocrResult.metadata.processorType,
    fileId: userFile?.id,
    storageKey: storageKey || undefined,
  }, { req, userId });

  // Fire-and-forget engagement emails. Use ocrResult.biomarkers (not
  // createdBiomarkers) because it carries the normal-range min/max needed
  // to classify high-vs-low direction.
  const outOfRangeSummary = ocrResult.biomarkers
    .filter((b) => b.value < b.normalRange.min || b.value > b.normalRange.max)
    .map((b) => ({
      name: b.name,
      status: (b.value > b.normalRange.max ? 'high' : 'low') as 'high' | 'low',
    }));

  void notifyNewResults(userId, {
    biomarkerCount: createdBiomarkers.length,
    outOfRangeCount: outOfRangeSummary.length,
    labName: labName || undefined,
  });
  if (outOfRangeSummary.length > 0) {
    void notifyOutOfRange(userId, { biomarkers: outOfRangeSummary });
  }

  const response: ApiResponse<LabReportUploadResponse> = {
    success: true,
    data: {
      biomarkersCreated: createdBiomarkers.length,
      biomarkers: createdBiomarkers,
      labName: labName || undefined,
      reportDate: reportDate.toISOString(),
      extractionConfidence: ocrResult.confidence,
      file: userFile || undefined,
    },
  };

  res.status(201).json(response);
}

/**
 * Upload and process a lab result using Google Document AI OCR.
 * Supports PDF and image files (PNG, JPG, TIFF).
 * POST /api/v1/upload/lab-results-ocr
 */
export async function uploadLabResultOCR(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  validateUploadFile(file, 'ocr');
  // PDF path in the OCR uploader must also be header-checked (PDF-bomb guard);
  // images are magic-byte-validated inside validateUploadFile.
  if (file.mimetype === 'application/pdf') {
    validatePdfHeader(file.buffer, file.originalname);
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname, userId);

  if (ocrResult.biomarkers.length === 0) {
    await auditService.logAccess(LAB_OCR_RESOURCE, undefined, { req, userId }, {
      operation: 'OCR_PARSE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      reason: 'No biomarkers extracted from OCR text',
      ocrConfidence: ocrResult.confidence,
    });
    throw new ValidationError(
      'Could not extract any biomarkers from the document. Please ensure it is a valid lab report with readable text.'
    );
  }

  const labName = ocrResult.metadata.labName || extractLabNameFromText(ocrResult.text);
  const reportDateStr = ocrResult.metadata.labDate || extractDateFromText(ocrResult.text);
  const reportDate = reportDateStr ? new Date(reportDateStr) : new Date();

  const avgConfidence =
    ocrResult.biomarkers.reduce((sum, b) => sum + b.confidence, 0) /
    ocrResult.biomarkers.length;

  const fileId = crypto.randomUUID();
  let storageKey: string | null = null;
  try {
    storageKey = await uploadToGCS(userId, fileId, file.buffer, file.mimetype);
    logger.info('File uploaded to GCS', { data: { fileId, storageKey, userId } });
  } catch (error) {
    logger.error('Failed to upload file to GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        fileId,
        userId,
      },
    });
  }

  const { createdBiomarkers, userFile } = await withGcsOrphanCleanup(
    storageKey,
    { fileId, userId },
    () =>
      withRLSTransaction(userId, async (tx) => {
        let fileRecord: { id: string; filename: string; storageKey: string } | null = null;
        if (storageKey) {
          // See uploadLabReport: a failed userFile.create dooms the tx, so let
          // it propagate and clean up the GCS object rather than swallow it.
          const createdFile = await tx.userFile.create({
            data: {
              id: fileId,
              userId,
              filename: labName
                ? `${labName} - ${reportDate.toLocaleDateString()}`
                : `Lab report - ${reportDate.toLocaleDateString()}`,
              // L24: the raw client filename can embed PHI — store it encrypted
              // (per-user key) and keep the plaintext column null. `filename`
              // above stays a non-PHI label.
              originalFilename: null,
              originalFilenameEncrypted: encryptionService.encrypt(file.originalname, userSalt),
              fileType: file.mimetype,
              fileSize: file.size,
              storageKey,
              labName: labName || null,
              labDate: reportDate,
              biomarkersExtracted: ocrResult.biomarkers.length,
              extractionConfidence: avgConfidence,
            },
          });
          fileRecord = {
            id: createdFile.id,
            filename: createdFile.filename,
            storageKey: createdFile.storageKey,
          };
          logger.info('UserFile record created', { data: { fileId: createdFile.id, userId } });
        }

        const createdBiomarkers = await createBiomarkersFromOCRResult(
          tx,
          encryptionService,
          userSalt,
          {
            userId,
            biomarkers: ocrResult.biomarkers,
            reportDate,
            labName: labName || undefined,
            notesPrefix: 'OCR extracted from',
            normalRangeSource: 'OCR Extraction',
            userFileId: fileRecord?.id,
          }
        );

        return { createdBiomarkers, userFile: fileRecord };
      })
  );

  await auditService.logCreate(
    LAB_OCR_RESOURCE,
    'BATCH',
    {
      filename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      biomarkersExtracted: createdBiomarkers.length,
      labName: labName || undefined,
      extractionConfidence: avgConfidence,
      ocrConfidence: ocrResult.confidence,
      processingTimeMs: ocrResult.metadata.processingTimeMs,
      fileId: userFile?.id,
      storageKey: storageKey || undefined,
    },
    { req, userId }
  );

  // Same fire-and-forget pattern as the Claude upload path above.
  const outOfRangeSummary = ocrResult.biomarkers
    .filter((b) => b.value < b.normalRange.min || b.value > b.normalRange.max)
    .map((b) => ({
      name: b.name,
      status: (b.value > b.normalRange.max ? 'high' : 'low') as 'high' | 'low',
    }));

  void notifyNewResults(userId, {
    biomarkerCount: createdBiomarkers.length,
    outOfRangeCount: outOfRangeSummary.length,
    labName: labName || undefined,
  });
  if (outOfRangeSummary.length > 0) {
    void notifyOutOfRange(userId, { biomarkers: outOfRangeSummary });
  }

  const response: ApiResponse<LabResultOCRResponse> = {
    success: true,
    data: {
      biomarkersCreated: createdBiomarkers.length,
      biomarkers: createdBiomarkers,
      labName: labName || undefined,
      reportDate: reportDate.toISOString(),
      extractionConfidence: avgConfidence,
      ocrMetadata: {
        processingTimeMs: ocrResult.metadata.processingTimeMs,
        pageCount: ocrResult.pageCount,
        documentType: ocrResult.metadata.documentType || file.mimetype,
      },
      file: userFile || undefined,
    },
  };

  res.status(201).json(response);
}
