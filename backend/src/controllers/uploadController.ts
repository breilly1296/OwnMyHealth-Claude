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
import { extractInsuranceFromSBC, isSBCExtractionConfigured } from '../services/sbcExtraction.js';
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

// ============================================
// Shared Types
// ============================================

/** Shared biomarker response structure */
interface BiomarkerResult {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  isOutOfRange: boolean;
}

// ============================================
// Validation Utilities
// ============================================

/** Supported MIME types for different upload types */
const SUPPORTED_MIME_TYPES = {
  pdf: ['application/pdf'],
  ocr: ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/gif', 'image/webp'],
} as const;

type UploadType = keyof typeof SUPPORTED_MIME_TYPES;

/** Validate uploaded file - throws ValidationError if invalid */
function validateUploadFile(
  file: Express.Multer.File | undefined,
  uploadType: UploadType,
  maxSizeMB: number = 10
): asserts file is Express.Multer.File {
  if (!file) {
    throw new ValidationError('No file uploaded');
  }

  const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES[uploadType];
  if (!supportedTypes.includes(file.mimetype)) {
    const typeNames = uploadType === 'pdf'
      ? 'PDF files'
      : 'PDF and image files (PNG, JPG, TIFF)';
    throw new ValidationError(`Only ${typeNames} are accepted`);
  }

  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    throw new ValidationError(`File size must be less than ${maxSizeMB}MB`);
  }
}

// ============================================
// Biomarker Creation Helper
// ============================================

interface OCRBiomarker {
  name: string;
  value: number;
  unit: string;
  category: string;
  confidence: number;
  normalRange: { min: number; max: number; source?: string };
}

interface CreateBiomarkersOptions {
  userId: string;
  biomarkers: OCRBiomarker[];
  reportDate: Date;
  labName?: string;
  notesPrefix: string;
  normalRangeSource: string;
  userFileId?: string | null;
}

/** Create biomarkers from OCR results - handles encryption and database creation */
async function createBiomarkersFromOCRResult(
  prisma: ReturnType<typeof getPrismaClient>,
  encryptionService: ReturnType<typeof getEncryptionService>,
  userSalt: string,
  options: CreateBiomarkersOptions
): Promise<BiomarkerResult[]> {
  const { userId, biomarkers, reportDate, labName, notesPrefix, normalRangeSource, userFileId } = options;
  const results: BiomarkerResult[] = [];

  for (const biomarker of biomarkers) {
    const valueEncrypted = encryptionService.encrypt(biomarker.value.toString(), userSalt);

    const notes = labName ? `${notesPrefix}: ${labName}` : notesPrefix;
    const notesEncrypted = encryptionService.encrypt(notes, userSalt);

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
        normalRangeSource: biomarker.normalRange.source || normalRangeSource,
        measurementDate: reportDate,
        isOutOfRange,
        userFileId: userFileId ?? null,
      },
    });

    results.push({
      id: created.id,
      name: biomarker.name,
      value: biomarker.value,
      unit: biomarker.unit,
      category: biomarker.category,
      isOutOfRange,
    });
  }

  return results;
}

// ============================================
// Response Types
// ============================================

interface LabReportUploadResponse {
  biomarkersCreated: number;
  biomarkers: BiomarkerResult[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
}

interface SBCUploadResponse {
  id: string;
  planName: string;
  insurerName: string;
  planType: string;
  planIdNumber?: string;
  effectiveDate: string;
  terminationDate?: string;
  isActive: boolean;
  isPrimary: boolean;
  deductibleIndividual: number;
  deductibleFamily: number;
  oopMaxIndividual: number;
  oopMaxFamily: number;
  premiumMonthly?: number;
  // Tracking fields
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;
  // Copay amounts
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  coinsuranceRate?: number;
  // Source tracking
  extractedFromSbc?: boolean;
  sbcExtractionConfidence?: number;
}

interface LabResultOCRResponse {
  biomarkersCreated: number;
  biomarkers: BiomarkerResult[];
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

  validateUploadFile(file, 'pdf');

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Process the PDF using Claude API for intelligent extraction
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname);

  if (ocrResult.biomarkers.length === 0) {
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

  // Create biomarkers in database using shared helper
  const createdBiomarkers = await createBiomarkersFromOCRResult(
    prisma,
    encryptionService,
    userSalt,
    {
      userId,
      biomarkers: ocrResult.biomarkers,
      reportDate,
      labName: labName || undefined,
      notesPrefix: 'Extracted from lab report',
      normalRangeSource: 'Lab Report',
    }
  );

  // Audit log: successful upload and extraction
  await auditService.logCreate(LAB_REPORT_RESOURCE, 'BATCH', {
    filename: file.originalname,
    fileSize: file.size,
    biomarkersExtracted: createdBiomarkers.length,
    labName: labName || undefined,
    extractionConfidence: ocrResult.confidence,
    processorType: ocrResult.metadata.processorType,
  }, { req, userId });

  const response: ApiResponse<LabReportUploadResponse> = {
    success: true,
    data: {
      biomarkersCreated: createdBiomarkers.length,
      biomarkers: createdBiomarkers,
      labName: labName || undefined,
      reportDate: reportDate.toISOString(),
      extractionConfidence: ocrResult.confidence,
    },
  };

  res.status(201).json(response);
}

/**
 * Upload and process an insurance SBC (Summary of Benefits and Coverage) PDF
 * Uses Claude Sonnet for intelligent extraction with fallback to regex parser
 * POST /api/v1/insurance/upload-sbc
 */
export async function uploadSBC(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  validateUploadFile(file, 'pdf');

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  let extractedData: {
    planName?: string;
    insurerName?: string;
    planType?: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
    planIdNumber?: string;
    deductibleIndividual?: number;
    deductibleFamily?: number;
    oopMaxIndividual?: number;
    oopMaxFamily?: number;
    premiumMonthly?: number;
    copayPrimaryCare?: number;
    copaySpecialist?: number;
    copayUrgentCare?: number;
    copayEmergency?: number;
    coinsuranceRate?: number;
    effectiveDate?: string;
    benefits: Array<{
      serviceName: string;
      serviceCategory: string;
      inNetworkCovered: boolean;
      inNetworkCopay?: number;
      inNetworkCoinsurance?: number;
      inNetworkDeductibleApplies: boolean;
      outNetworkCovered: boolean;
      outNetworkCopay?: number;
      outNetworkCoinsurance?: number;
      outNetworkDeductibleApplies: boolean;
      preAuthRequired: boolean;
      limitations?: string;
    }>;
    extractionConfidence: number;
    usedClaudeExtraction: boolean;
  };

  // Try Claude Sonnet extraction first, fall back to regex parser
  if (isSBCExtractionConfigured()) {
    try {
      logger.info('Attempting Claude Sonnet SBC extraction');
      const claudeResult = await extractInsuranceFromSBC(file.buffer);

      extractedData = {
        ...claudeResult,
        benefits: claudeResult.benefits.map((b) => ({
          serviceName: b.serviceName,
          serviceCategory: b.serviceCategory,
          inNetworkCovered: b.inNetworkCovered,
          inNetworkCopay: b.inNetworkCopay,
          inNetworkCoinsurance: b.inNetworkCoinsurance,
          inNetworkDeductibleApplies: b.inNetworkDeductibleApplies,
          outNetworkCovered: b.outNetworkCovered,
          outNetworkCopay: b.outNetworkCopay,
          outNetworkCoinsurance: b.outNetworkCoinsurance,
          outNetworkDeductibleApplies: b.outNetworkDeductibleApplies,
          preAuthRequired: b.preAuthRequired,
          limitations: b.limitations,
        })),
        usedClaudeExtraction: true,
      };
    } catch (error) {
      logger.warn('Claude SBC extraction failed, falling back to regex parser', {
        data: { error: error instanceof Error ? error.message : 'Unknown' },
      });
      // Fall through to regex parser
      const parseResult = await parseSBC(file.buffer, file.originalname);
      const { plan: parsedPlan } = parseResult;

      extractedData = {
        planName: parsedPlan.planName,
        insurerName: parsedPlan.insurerName,
        planType: parsedPlan.planType,
        deductibleIndividual: parsedPlan.deductible,
        deductibleFamily: parsedPlan.deductibleFamily,
        oopMaxIndividual: parsedPlan.outOfPocketMax,
        oopMaxFamily: parsedPlan.outOfPocketMaxFamily,
        benefits: parsedPlan.benefits.map((b) => ({
          serviceName: b.serviceName,
          serviceCategory: b.serviceCategory,
          inNetworkCovered: b.inNetworkCoverage.covered,
          inNetworkCopay: b.inNetworkCoverage.copay,
          inNetworkCoinsurance: b.inNetworkCoverage.coinsurance,
          inNetworkDeductibleApplies: b.inNetworkCoverage.deductibleApplies ?? true,
          outNetworkCovered: b.outNetworkCoverage?.covered ?? false,
          outNetworkCopay: b.outNetworkCoverage?.copay,
          outNetworkCoinsurance: b.outNetworkCoverage?.coinsurance,
          outNetworkDeductibleApplies: b.outNetworkCoverage?.deductibleApplies ?? true,
          preAuthRequired: b.preAuthRequired ?? false,
          limitations: undefined,
        })),
        extractionConfidence: parsedPlan.extractionConfidence,
        usedClaudeExtraction: false,
      };
    }
  } else {
    // Claude not configured, use regex parser
    logger.info('Claude not configured, using regex SBC parser');
    const parseResult = await parseSBC(file.buffer, file.originalname);
    const { plan: parsedPlan } = parseResult;

    extractedData = {
      planName: parsedPlan.planName,
      insurerName: parsedPlan.insurerName,
      planType: parsedPlan.planType,
      deductibleIndividual: parsedPlan.deductible,
      deductibleFamily: parsedPlan.deductibleFamily,
      oopMaxIndividual: parsedPlan.outOfPocketMax,
      oopMaxFamily: parsedPlan.outOfPocketMaxFamily,
      benefits: parsedPlan.benefits.map((b) => ({
        serviceName: b.serviceName,
        serviceCategory: b.serviceCategory,
        inNetworkCovered: b.inNetworkCoverage.covered,
        inNetworkCopay: b.inNetworkCoverage.copay,
        inNetworkCoinsurance: b.inNetworkCoverage.coinsurance,
        inNetworkDeductibleApplies: b.inNetworkCoverage.deductibleApplies ?? true,
        outNetworkCovered: b.outNetworkCoverage?.covered ?? false,
        outNetworkCopay: b.outNetworkCoverage?.copay,
        outNetworkCoinsurance: b.outNetworkCoverage?.coinsurance,
        outNetworkDeductibleApplies: b.outNetworkCoverage?.deductibleApplies ?? true,
        preAuthRequired: b.preAuthRequired ?? false,
        limitations: undefined,
      })),
      extractionConfidence: parsedPlan.extractionConfidence,
      usedClaudeExtraction: false,
    };
  }

  // Check if we got any useful data
  if (
    !extractedData.planName &&
    !extractedData.insurerName &&
    extractedData.benefits.length === 0
  ) {
    await auditService.logAccess(SBC_RESOURCE, undefined, { req, userId }, {
      operation: 'PARSE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      reason: 'Could not extract plan information',
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    });

    throw new ValidationError(
      'Could not extract insurance plan information from the PDF. Please ensure it is a valid SBC document.'
    );
  }

  // Create insurance plan in database with all extracted fields
  const planName = extractedData.planName || `Uploaded Plan ${new Date().toLocaleDateString()}`;
  const insurerName = extractedData.insurerName || 'Unknown Insurer';
  const effectiveDate = extractedData.effectiveDate
    ? new Date(extractedData.effectiveDate)
    : new Date();

  const createdPlan = await prisma.insurancePlan.create({
    data: {
      userId,
      planName,
      insurerName,
      planType: extractedData.planType || 'PPO',
      planIdNumber: extractedData.planIdNumber || null,
      memberIdEncrypted: null, // User can add this later
      groupIdEncrypted: null,
      effectiveDate,
      terminationDate: null,
      premiumMonthly: extractedData.premiumMonthly ?? null,
      deductibleIndividual: extractedData.deductibleIndividual ?? 0,
      deductibleFamily:
        extractedData.deductibleFamily ??
        (extractedData.deductibleIndividual ? extractedData.deductibleIndividual * 2 : 0),
      oopMaxIndividual: extractedData.oopMaxIndividual ?? 0,
      oopMaxFamily:
        extractedData.oopMaxFamily ??
        (extractedData.oopMaxIndividual ? extractedData.oopMaxIndividual * 2 : 0),
      // Tracking fields start at 0
      deductibleMetIndividual: 0,
      deductibleMetFamily: 0,
      oopMetIndividual: 0,
      oopMetFamily: 0,
      // Copay fields from extraction
      copayPrimaryCare: extractedData.copayPrimaryCare ?? null,
      copaySpecialist: extractedData.copaySpecialist ?? null,
      copayUrgentCare: extractedData.copayUrgentCare ?? null,
      copayEmergency: extractedData.copayEmergency ?? null,
      coinsuranceRate: extractedData.coinsuranceRate ?? null,
      // Source tracking
      extractedFromSbc: true,
      sbcExtractionConfidence: extractedData.extractionConfidence,
      isActive: true,
      isPrimary: false,
      benefits: {
        create: extractedData.benefits.map((benefit) => ({
          serviceName: benefit.serviceName,
          serviceCategory: benefit.serviceCategory,
          inNetworkCovered: benefit.inNetworkCovered,
          inNetworkCopay: benefit.inNetworkCopay ?? null,
          inNetworkCoinsurance: benefit.inNetworkCoinsurance ?? null,
          inNetworkDeductible: benefit.inNetworkDeductibleApplies,
          outNetworkCovered: benefit.outNetworkCovered,
          outNetworkCopay: benefit.outNetworkCopay ?? null,
          outNetworkCoinsurance: benefit.outNetworkCoinsurance ?? null,
          outNetworkDeductible: benefit.outNetworkDeductibleApplies,
          limitations: benefit.limitations ?? null,
          preAuthRequired: benefit.preAuthRequired,
        })),
      },
    },
    include: { benefits: true },
  });

  // Audit log: successful upload and extraction
  await auditService.logCreate(
    SBC_RESOURCE,
    createdPlan.id,
    {
      filename: file.originalname,
      fileSize: file.size,
      planName: createdPlan.planName,
      insurerName: createdPlan.insurerName,
      benefitsExtracted: createdPlan.benefits.length,
      extractionConfidence: extractedData.extractionConfidence,
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    },
    { req, userId }
  );

  const response: ApiResponse<SBCUploadResponse> = {
    success: true,
    data: {
      id: createdPlan.id,
      planName: createdPlan.planName,
      insurerName: createdPlan.insurerName,
      planType: createdPlan.planType,
      planIdNumber: createdPlan.planIdNumber || undefined,
      effectiveDate: createdPlan.effectiveDate.toISOString(),
      terminationDate: createdPlan.terminationDate?.toISOString() || undefined,
      isActive: createdPlan.isActive,
      isPrimary: createdPlan.isPrimary,
      deductibleIndividual: Number(createdPlan.deductibleIndividual),
      deductibleFamily: Number(createdPlan.deductibleFamily),
      oopMaxIndividual: Number(createdPlan.oopMaxIndividual),
      oopMaxFamily: Number(createdPlan.oopMaxFamily),
      premiumMonthly: createdPlan.premiumMonthly ? Number(createdPlan.premiumMonthly) : undefined,
      // Tracking fields
      deductibleMetIndividual: createdPlan.deductibleMetIndividual ? Number(createdPlan.deductibleMetIndividual) : undefined,
      deductibleMetFamily: createdPlan.deductibleMetFamily ? Number(createdPlan.deductibleMetFamily) : undefined,
      oopMetIndividual: createdPlan.oopMetIndividual ? Number(createdPlan.oopMetIndividual) : undefined,
      oopMetFamily: createdPlan.oopMetFamily ? Number(createdPlan.oopMetFamily) : undefined,
      // Copay amounts
      copayPrimaryCare: createdPlan.copayPrimaryCare ? Number(createdPlan.copayPrimaryCare) : undefined,
      copaySpecialist: createdPlan.copaySpecialist ? Number(createdPlan.copaySpecialist) : undefined,
      copayUrgentCare: createdPlan.copayUrgentCare ? Number(createdPlan.copayUrgentCare) : undefined,
      copayEmergency: createdPlan.copayEmergency ? Number(createdPlan.copayEmergency) : undefined,
      coinsuranceRate: createdPlan.coinsuranceRate ? Number(createdPlan.coinsuranceRate) : undefined,
      // Source tracking
      extractedFromSbc: createdPlan.extractedFromSbc,
      sbcExtractionConfidence: createdPlan.sbcExtractionConfidence ? Number(createdPlan.sbcExtractionConfidence) : undefined,
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

  validateUploadFile(file, 'ocr');

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);
  const auditService = getAuditLogService(prisma);

  // Process document using Document AI OCR
  const ocrResult = await processDocument(file.buffer, file.mimetype, file.originalname);

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

  // Use metadata from Claude/OCR if available, otherwise extract from text
  const labName = ocrResult.metadata.labName || extractLabNameFromText(ocrResult.text);
  const reportDateStr = ocrResult.metadata.labDate || extractDateFromText(ocrResult.text);
  const reportDate = reportDateStr ? new Date(reportDateStr) : new Date();

  // Calculate average extraction confidence
  const avgConfidence =
    ocrResult.biomarkers.reduce((sum, b) => sum + b.confidence, 0) /
    ocrResult.biomarkers.length;

  // Generate a unique file ID and upload to GCS
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
    }
  }

  // Create biomarkers in database using shared helper
  const createdBiomarkers = await createBiomarkersFromOCRResult(
    prisma,
    encryptionService,
    userSalt,
    {
      userId,
      biomarkers: ocrResult.biomarkers,
      reportDate,
      labName: labName || undefined,
      notesPrefix: 'OCR extracted from',
      normalRangeSource: 'OCR Extraction',
      userFileId: userFile?.id,
    }
  );

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
