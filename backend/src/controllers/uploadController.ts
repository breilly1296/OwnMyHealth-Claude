/**
 * Upload Controller
 *
 * Handles file uploads for lab reports and insurance SBC documents.
 * Parses PDFs, extracts data, encrypts PHI, and saves to database.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parseSBC } from '../services/pdfParser.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { processDocument, extractDateFromText, extractLabNameFromText } from '../services/ocrService.js';
import { uploadFile as uploadToGCS } from '../services/storageService.js';
import { logger } from '../utils/logger.js';

const LAB_REPORT_RESOURCE = 'LabReportUpload';
const SBC_RESOURCE = 'SBCUpload';
const LAB_OCR_RESOURCE = 'LabResultOCR';

// Extend request to include multer file
interface UploadRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
}

// Response types
interface LabReportUploadResponse {
  biomarkersCreated: number;
  biomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
}

interface SBCUploadResponse {
  planCreated: boolean;
  plan: {
    id: string;
    planName: string;
    insurerName: string;
    planType: string;
    deductible: number;
    outOfPocketMax: number;
    benefitsCount: number;
  };
  extractionConfidence: number;
}

interface LabResultOCRResponse {
  biomarkersCreated: number;
  biomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
  ocrMetadata: {
    processingTimeMs: number;
    pageCount: number;
    documentType: string;
  };
  file?: {
    id: string;
    filename: string;
    storageKey: string;
  };
}

/**
 * Upload and process a lab report PDF
 * POST /api/v1/upload/lab-report
 */
export async function uploadLabReport(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  if (!file) {
    throw new ValidationError('No file uploaded');
  }

  if (file.mimetype !== 'application/pdf') {
    throw new ValidationError('Only PDF files are accepted');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new ValidationError('File size must be less than 10MB');
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Process the PDF using Claude API for intelligent extraction
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname);

  if (ocrResult.biomarkers.length === 0) {
    // Audit log: failed extraction
    await auditService.logAccess(LAB_REPORT_RESOURCE, undefined, { req, userId }, {
      operation: 'PARSE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      reason: 'No biomarkers extracted',
    });

    throw new ValidationError('Could not extract any biomarkers from the PDF. Please ensure it is a valid lab report.');
  }

  // Use metadata from Claude if available, otherwise extract from text
  const labName = ocrResult.metadata.labName || extractLabNameFromText(ocrResult.text);
  const reportDateStr = ocrResult.metadata.labDate || extractDateFromText(ocrResult.text);
  const reportDate = reportDateStr ? new Date(reportDateStr) : new Date();

  // Create biomarkers in database
  const createdBiomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[] = [];

  for (const biomarker of ocrResult.biomarkers) {
    // Encrypt the value
    const valueEncrypted = encryptionService.encrypt(biomarker.value.toString(), userSalt);

    // Encrypt notes if present
    const notesEncrypted = labName
      ? encryptionService.encrypt(`Extracted from lab report: ${labName}`, userSalt)
      : null;

    // Check if out of range
    const isOutOfRange = biomarker.value < biomarker.normalRange.min ||
                         biomarker.value > biomarker.normalRange.max;

    const created = await prisma.biomarker.create({
      data: {
        userId,
        category: biomarker.category,
        name: biomarker.name,
        unit: biomarker.unit,
        valueEncrypted,
        notesEncrypted,
        normalRangeMin: biomarker.normalRange.min,
        normalRangeMax: biomarker.normalRange.max,
        normalRangeSource: biomarker.normalRange.source || 'Lab Report',
        measurementDate: reportDate,
        isOutOfRange,
      },
    });

    createdBiomarkers.push({
      id: created.id,
      name: biomarker.name,
      value: biomarker.value,
      unit: biomarker.unit,
      category: biomarker.category,
      isOutOfRange,
    });
  }

  // Use confidence from OCR result
  const avgConfidence = ocrResult.confidence;

  // Audit log: successful upload and extraction
  await auditService.logCreate(LAB_REPORT_RESOURCE, 'BATCH', {
    filename: file.originalname,
    fileSize: file.size,
    biomarkersExtracted: createdBiomarkers.length,
    labName: labName || undefined,
    extractionConfidence: avgConfidence,
    processorType: ocrResult.metadata.processorType,
  }, { req, userId });

  const response: ApiResponse<LabReportUploadResponse> = {
    success: true,
    data: {
      biomarkersCreated: createdBiomarkers.length,
      biomarkers: createdBiomarkers,
      labName: labName || undefined,
      reportDate: reportDate.toISOString(),
      extractionConfidence: avgConfidence,
    },
  };

  res.status(201).json(response);
}

/**
 * Upload and process an insurance SBC (Summary of Benefits and Coverage) PDF
 * POST /api/v1/insurance/upload-sbc
 */
export async function uploadSBC(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  if (!file) {
    throw new ValidationError('No file uploaded');
  }

  if (file.mimetype !== 'application/pdf') {
    throw new ValidationError('Only PDF files are accepted');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new ValidationError('File size must be less than 10MB');
  }

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  // Parse the PDF
  const parseResult = await parseSBC(file.buffer, file.originalname);
  const { plan: parsedPlan } = parseResult;

  if (!parsedPlan.planName && !parsedPlan.insurerName && parsedPlan.benefits.length === 0) {
    // Audit log: failed extraction
    await auditService.logAccess(SBC_RESOURCE, undefined, { req, userId }, {
      operation: 'PARSE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      reason: 'Could not extract plan information',
    });

    throw new ValidationError('Could not extract insurance plan information from the PDF. Please ensure it is a valid SBC document.');
  }

  // Create insurance plan in database
  const planName = parsedPlan.planName || `Uploaded Plan ${new Date().toLocaleDateString()}`;
  const insurerName = parsedPlan.insurerName || 'Unknown Insurer';

  const createdPlan = await prisma.insurancePlan.create({
    data: {
      userId,
      planName,
      insurerName,
      planType: parsedPlan.planType || 'PPO',
      memberIdEncrypted: null, // User can add this later
      groupIdEncrypted: null,
      effectiveDate: new Date(),
      terminationDate: null,
      premiumMonthly: null,
      deductibleIndividual: parsedPlan.deductible || 0,
      deductibleFamily: parsedPlan.deductibleFamily || (parsedPlan.deductible ? parsedPlan.deductible * 2 : 0),
      oopMaxIndividual: parsedPlan.outOfPocketMax || 0,
      oopMaxFamily: parsedPlan.outOfPocketMaxFamily || (parsedPlan.outOfPocketMax ? parsedPlan.outOfPocketMax * 2 : 0),
      isActive: true,
      isPrimary: false,
      benefits: {
        create: parsedPlan.benefits.map((benefit) => ({
          serviceName: benefit.serviceName,
          serviceCategory: benefit.serviceCategory,
          inNetworkCovered: benefit.inNetworkCoverage.covered,
          inNetworkCopay: benefit.inNetworkCoverage.copay,
          inNetworkCoinsurance: benefit.inNetworkCoverage.coinsurance,
          inNetworkDeductible: benefit.inNetworkCoverage.deductibleApplies ?? true,
          outNetworkCovered: benefit.outNetworkCoverage?.covered ?? false,
          outNetworkCopay: benefit.outNetworkCoverage?.copay,
          outNetworkCoinsurance: benefit.outNetworkCoverage?.coinsurance,
          outNetworkDeductible: benefit.outNetworkCoverage?.deductibleApplies ?? true,
          limitations: null,
          preAuthRequired: benefit.preAuthRequired ?? false,
        })),
      },
    },
    include: { benefits: true },
  });

  // Audit log: successful upload and extraction
  await auditService.logCreate(SBC_RESOURCE, createdPlan.id, {
    filename: file.originalname,
    fileSize: file.size,
    planName: createdPlan.planName,
    insurerName: createdPlan.insurerName,
    benefitsExtracted: createdPlan.benefits.length,
    extractionConfidence: parsedPlan.extractionConfidence,
  }, { req, userId });

  const response: ApiResponse<SBCUploadResponse> = {
    success: true,
    data: {
      planCreated: true,
      plan: {
        id: createdPlan.id,
        planName: createdPlan.planName,
        insurerName: createdPlan.insurerName,
        planType: createdPlan.planType,
        deductible: Number(createdPlan.deductibleIndividual),
        outOfPocketMax: Number(createdPlan.oopMaxIndividual),
        benefitsCount: createdPlan.benefits.length,
      },
      extractionConfidence: parsedPlan.extractionConfidence,
    },
  };

  res.status(201).json(response);
}

/**
 * Upload and process a lab result using OCR (Google Document AI)
 * Supports PDF and image files (PNG, JPG, TIFF)
 * Files are stored in Google Cloud Storage for later viewing/downloading.
 * POST /api/v1/upload/lab-results-ocr
 */
export async function uploadLabResultOCR(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  if (!file) {
    throw new ValidationError('No file uploaded');
  }

  // Supported MIME types for OCR
  const supportedTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'image/gif',
    'image/webp',
  ];

  if (!supportedTypes.includes(file.mimetype)) {
    throw new ValidationError(
      'Only PDF and image files (PNG, JPG, TIFF) are accepted for OCR processing'
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new ValidationError('File size must be less than 10MB');
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Process document using Document AI OCR
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname);

  if (ocrResult.biomarkers.length === 0) {
    // Audit log: failed extraction
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

  // Use metadata from Claude/OCR if available, otherwise extract from text
  const labName = ocrResult.metadata.labName || extractLabNameFromText(ocrResult.text);
  const reportDateStr = ocrResult.metadata.labDate || extractDateFromText(ocrResult.text);
  const reportDate = reportDateStr ? new Date(reportDateStr) : new Date();

  // Calculate average extraction confidence
  const avgConfidence =
    ocrResult.biomarkers.reduce((sum, b) => sum + b.confidence, 0) /
    ocrResult.biomarkers.length;

  // Generate a unique file ID
  const fileId = crypto.randomUUID();

  // Upload file to GCS
  let storageKey: string | null = null;
  try {
    storageKey = await uploadToGCS(userId, fileId, file.buffer, file.mimetype);
    logger.info('File uploaded to GCS', { data: { fileId, storageKey, userId } });
  } catch (error) {
    // Log error but continue - we can still create biomarkers without file storage
    logger.error('Failed to upload file to GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        fileId,
        userId,
      },
    });
  }

  // Create UserFile record if GCS upload succeeded
  let userFile: { id: string; filename: string; storageKey: string } | null = null;
  if (storageKey) {
    try {
      const createdFile = await prisma.userFile.create({
        data: {
          id: fileId,
          userId,
          filename: labName
            ? `${labName} - ${reportDate.toLocaleDateString()}`
            : file.originalname,
          originalFilename: file.originalname,
          fileType: file.mimetype,
          fileSize: file.size,
          storageKey,
          labName: labName || null,
          labDate: reportDate,
          biomarkersExtracted: ocrResult.biomarkers.length,
          extractionConfidence: avgConfidence,
        },
      });
      userFile = {
        id: createdFile.id,
        filename: createdFile.filename,
        storageKey: createdFile.storageKey,
      };
      logger.info('UserFile record created', { data: { fileId: createdFile.id, userId } });
    } catch (error) {
      logger.error('Failed to create UserFile record', {
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          fileId,
          userId,
        },
      });
      // Continue without file record - biomarkers can still be created
    }
  }

  // Create biomarkers in database
  const createdBiomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[] = [];

  for (const biomarker of ocrResult.biomarkers) {
    // Encrypt the value
    const valueEncrypted = encryptionService.encrypt(biomarker.value.toString(), userSalt);

    // Encrypt notes if present
    const notes = labName
      ? `OCR extracted from: ${labName}`
      : 'OCR extracted from uploaded document';
    const notesEncrypted = encryptionService.encrypt(notes, userSalt);

    // Check if out of range
    const isOutOfRange =
      biomarker.value < biomarker.normalRange.min ||
      biomarker.value > biomarker.normalRange.max;

    const created = await prisma.biomarker.create({
      data: {
        userId,
        category: biomarker.category,
        name: biomarker.name,
        unit: biomarker.unit,
        valueEncrypted,
        notesEncrypted,
        normalRangeMin: biomarker.normalRange.min,
        normalRangeMax: biomarker.normalRange.max,
        normalRangeSource: biomarker.normalRange.source || 'OCR Extraction',
        measurementDate: reportDate,
        isOutOfRange,
        // Link to UserFile if created
        userFileId: userFile?.id || null,
      },
    });

    createdBiomarkers.push({
      id: created.id,
      name: biomarker.name,
      value: biomarker.value,
      unit: biomarker.unit,
      category: biomarker.category,
      isOutOfRange,
    });
  }

  // Audit log: successful upload and extraction
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
