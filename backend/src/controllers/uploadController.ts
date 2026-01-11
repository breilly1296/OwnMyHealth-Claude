/**
 * Upload Controller
 *
 * Handles file uploads for lab reports and insurance SBC documents.
 * Parses PDFs, extracts data, encrypts PHI, and saves to database.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parseSBC } from '../services/pdfParser.js';
import {
  extractInsuranceFromSBC,
  isSBCExtractionConfigured,
  type ExtractedInpatientCoverage,
  type ExtractedOutpatientCoverage,
  type ExtractedTherapyCoverage,
  type ExtractedRxBenefits,
  type ExtractedEmergencyCoverage,
  type ExtractedVisionCoverage,
  type ExtractedDentalCoverage,
  type ExtractedDMECoverage,
  type ExtractedHomeHealthCoverage,
  type ExtractedHospiceCoverage,
} from '../services/sbcExtraction.js';
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
  usedClaudeExtraction?: boolean;
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

  // Type for extracted data - combines Claude extraction with legacy regex parser format
  let extractedData: {
    planName?: string;
    insurerName?: string;
    planType?: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
    planIdNumber?: string;
    deductibleIndividual?: number;
    deductibleFamily?: number;
    oopMaxIndividual?: number;
    oopMaxFamily?: number;
    // Out-of-network financial limits
    deductibleIndividualOutOfNetwork?: number;
    deductibleFamilyOutOfNetwork?: number;
    oopMaxIndividualOutOfNetwork?: number;
    oopMaxFamilyOutOfNetwork?: number;
    premiumMonthly?: number;
    // Core copays
    copayPrimaryCare?: number;
    copaySpecialist?: number;
    copayPreventive?: number;
    copayUrgentCare?: number;
    copayEmergency?: number;
    copayTelehealth?: number;
    copayLabWork?: number;
    copayXray?: number;
    copayAdvancedImaging?: number;
    coinsuranceRate?: number;
    // Per-service coinsurance (for plans with "X% after deductible" instead of copays)
    coinsurancePrimaryCare?: number;
    coinsuranceSpecialist?: number;
    coinsuranceUrgentCare?: number;
    coinsuranceEmergency?: number;
    coinsuranceTelehealth?: number;
    coinsuranceLabWork?: number;
    coinsuranceXray?: number;
    coinsuranceAdvancedImaging?: number;
    // Detailed coverage objects from Claude extraction
    inpatientCoverage?: ExtractedInpatientCoverage;
    outpatientCoverage?: ExtractedOutpatientCoverage;
    therapyCoverage?: ExtractedTherapyCoverage;
    emergencyCoverage?: ExtractedEmergencyCoverage;
    rxBenefits?: ExtractedRxBenefits;
    visionCoverage?: ExtractedVisionCoverage;
    dentalCoverage?: ExtractedDentalCoverage;
    dmeCoverage?: ExtractedDMECoverage;
    homeHealthCoverage?: ExtractedHomeHealthCoverage;
    hospiceCoverage?: ExtractedHospiceCoverage;
    // Lists
    preventiveServices?: string[];
    exclusions?: string[];
    priorAuthRequirements?: string[];
    // Services with limits
    servicesWithLimits?: Array<{
      service: string;
      limit: number;
      limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
      period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
    }>;
    effectiveDate?: string;
    pagesProcessed?: number;
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
      visitLimit?: number;
      dayLimit?: number;
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

      // Map all Claude extraction fields including the new comprehensive coverage
      extractedData = {
        // Plan identification
        planName: claudeResult.planName,
        insurerName: claudeResult.insurerName,
        planType: claudeResult.planType,
        planIdNumber: claudeResult.planIdNumber,
        // Core financial - In-network
        deductibleIndividual: claudeResult.deductibleIndividual,
        deductibleFamily: claudeResult.deductibleFamily,
        oopMaxIndividual: claudeResult.oopMaxIndividual,
        oopMaxFamily: claudeResult.oopMaxFamily,
        // Out-of-network financial limits
        deductibleIndividualOutOfNetwork: claudeResult.deductibleIndividualOutOfNetwork,
        deductibleFamilyOutOfNetwork: claudeResult.deductibleFamilyOutOfNetwork,
        oopMaxIndividualOutOfNetwork: claudeResult.oopMaxIndividualOutOfNetwork,
        oopMaxFamilyOutOfNetwork: claudeResult.oopMaxFamilyOutOfNetwork,
        premiumMonthly: claudeResult.premiumMonthly,
        coinsuranceRate: claudeResult.coinsuranceRate,
        // Copays
        copayPrimaryCare: claudeResult.copayPrimaryCare,
        copaySpecialist: claudeResult.copaySpecialist,
        copayPreventive: claudeResult.copayPreventive,
        copayUrgentCare: claudeResult.copayUrgentCare,
        copayEmergency: claudeResult.copayEmergency,
        copayTelehealth: claudeResult.copayTelehealth,
        copayLabWork: claudeResult.copayLabWork,
        copayXray: claudeResult.copayXray,
        copayAdvancedImaging: claudeResult.copayAdvancedImaging,
        // Per-service coinsurance
        coinsurancePrimaryCare: claudeResult.coinsurancePrimaryCare,
        coinsuranceSpecialist: claudeResult.coinsuranceSpecialist,
        coinsuranceUrgentCare: claudeResult.coinsuranceUrgentCare,
        coinsuranceEmergency: claudeResult.coinsuranceEmergency,
        coinsuranceTelehealth: claudeResult.coinsuranceTelehealth,
        coinsuranceLabWork: claudeResult.coinsuranceLabWork,
        coinsuranceXray: claudeResult.coinsuranceXray,
        coinsuranceAdvancedImaging: claudeResult.coinsuranceAdvancedImaging,
        // Detailed coverage objects
        inpatientCoverage: claudeResult.inpatientCoverage,
        outpatientCoverage: claudeResult.outpatientCoverage,
        therapyCoverage: claudeResult.therapyCoverage,
        emergencyCoverage: claudeResult.emergencyCoverage,
        rxBenefits: claudeResult.rxBenefits,
        visionCoverage: claudeResult.visionCoverage,
        dentalCoverage: claudeResult.dentalCoverage,
        dmeCoverage: claudeResult.dmeCoverage,
        homeHealthCoverage: claudeResult.homeHealthCoverage,
        hospiceCoverage: claudeResult.hospiceCoverage,
        // Lists
        preventiveServices: claudeResult.preventiveServices,
        exclusions: claudeResult.exclusions,
        priorAuthRequirements: claudeResult.priorAuthRequirements,
        servicesWithLimits: claudeResult.servicesWithLimits,
        // Dates
        effectiveDate: claudeResult.effectiveDate,
        // Metadata
        pagesProcessed: claudeResult.pagesProcessed,
        extractionConfidence: claudeResult.extractionConfidence,
        // Benefits array
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
          visitLimit: b.visitLimit,
          dayLimit: b.dayLimit,
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

  // Extract nested coverage objects with defaults
  const inpatient = extractedData.inpatientCoverage || {};
  const outpatient = extractedData.outpatientCoverage || {};
  const therapy = extractedData.therapyCoverage || {};
  const rx = extractedData.rxBenefits || {};
  const emergency = extractedData.emergencyCoverage || {};

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
      // Out-of-network financial limits
      deductibleIndividualOutOfNetwork: extractedData.deductibleIndividualOutOfNetwork ?? null,
      deductibleFamilyOutOfNetwork: extractedData.deductibleFamilyOutOfNetwork ?? null,
      oopMaxIndividualOutOfNetwork: extractedData.oopMaxIndividualOutOfNetwork ?? null,
      oopMaxFamilyOutOfNetwork: extractedData.oopMaxFamilyOutOfNetwork ?? null,
      // Tracking fields start at 0
      deductibleMetIndividual: 0,
      deductibleMetFamily: 0,
      oopMetIndividual: 0,
      oopMetFamily: 0,

      // Core copay fields - use top-level values, fall back to nested coverage objects
      copayPrimaryCare: extractedData.copayPrimaryCare ?? null,
      copaySpecialist: extractedData.copaySpecialist ?? null,
      copayUrgentCare: extractedData.copayUrgentCare ?? emergency.urgentCareCopay ?? null,
      copayEmergency: extractedData.copayEmergency ?? emergency.emergencyRoomCopay ?? null,
      copayTelehealth: extractedData.copayTelehealth ?? null,
      copayLabWork: extractedData.copayLabWork ?? outpatient.labWorkCopay ?? null,
      copayXray: extractedData.copayXray ?? outpatient.xrayCopay ?? null,
      copayAdvancedImaging: extractedData.copayAdvancedImaging ?? outpatient.advancedImagingCopay ?? null,
      coinsuranceRate: extractedData.coinsuranceRate ?? null,

      // Per-service coinsurance (for plans with "X% after deductible" instead of copays)
      coinsurancePrimaryCare: extractedData.coinsurancePrimaryCare ?? null,
      coinsuranceSpecialist: extractedData.coinsuranceSpecialist ?? null,
      coinsuranceUrgentCare: extractedData.coinsuranceUrgentCare ?? emergency.urgentCareCoinsurance ?? null,
      coinsuranceEmergency: extractedData.coinsuranceEmergency ?? emergency.emergencyRoomCoinsurance ?? null,
      coinsuranceTelehealth: extractedData.coinsuranceTelehealth ?? null,
      coinsuranceLabWork: extractedData.coinsuranceLabWork ?? outpatient.labWorkCoinsurance ?? null,
      coinsuranceXray: extractedData.coinsuranceXray ?? outpatient.xrayCoinsurance ?? null,
      coinsuranceAdvancedImaging: extractedData.coinsuranceAdvancedImaging ?? outpatient.advancedImagingCoinsurance ?? null,

      // Inpatient coverage
      // Prefer per-day copay, fall back to per-admission
      inpatientHospitalCopay: inpatient.hospitalCopayPerDay ?? inpatient.hospitalCopayPerAdmission ?? null,
      inpatientHospitalCoinsurance: inpatient.hospitalCoinsurance ?? null,
      inpatientMentalHealthCopay: inpatient.mentalHealthCopay ?? null,
      inpatientMentalCoinsurance: inpatient.mentalHealthCoinsurance ?? null,
      maternityCopay: inpatient.maternityCopay ?? null,
      maternityCoinsurance: inpatient.maternityCoinsurance ?? null,
      skilledNursingCopay: inpatient.skilledNursingCopay ?? null,
      skilledNursingCoinsurance: inpatient.skilledNursingCoinsurance ?? null,
      skilledNursingDaysLimit: inpatient.skilledNursingDaysLimit ?? null,

      // Outpatient coverage
      outpatientSurgeryCopay: outpatient.surgeryCopay ?? null,
      outpatientSurgeryCoinsurance: outpatient.surgeryCoinsurance ?? null,
      // Prefer individual therapy copay, fall back to group
      outpatientMentalHealthCopay: outpatient.mentalHealthIndividualCopay ?? outpatient.mentalHealthGroupCopay ?? null,
      outpatientMentalCoinsurance: outpatient.mentalHealthCoinsurance ?? null,

      // Therapy/Rehab coverage
      physicalTherapyCopay: therapy.physicalTherapyCopay ?? null,
      physicalTherapyVisitsLimit: therapy.physicalTherapyVisitsLimit ?? null,
      occupationalTherapyCopay: therapy.occupationalTherapyCopay ?? null,
      occupationalTherapyVisitsLimit: therapy.occupationalTherapyVisitsLimit ?? null,
      speechTherapyCopay: therapy.speechTherapyCopay ?? null,
      speechTherapyVisitsLimit: therapy.speechTherapyVisitsLimit ?? null,

      // Prescription (Rx) benefits
      rxTier1Copay: rx.tier1Copay ?? null,
      rxTier2Copay: rx.tier2Copay ?? null,
      rxTier3Copay: rx.tier3Copay ?? null,
      rxTier4Copay: rx.tier4Copay ?? null,
      rxTier1Coinsurance: rx.tier1CoinsurancePercent ?? null,
      rxTier2Coinsurance: rx.tier2CoinsurancePercent ?? null,
      rxTier3Coinsurance: rx.tier3CoinsurancePercent ?? null,
      rxTier4Coinsurance: rx.tier4CoinsurancePercent ?? null,
      rxRetailDaysSupply: rx.retailDaysSupply ?? null,
      rxMailOrderDaysSupply: rx.mailOrderDaysSupply ?? null,
      rxDeductibleIndividual: rx.deductibleIndividual ?? null,
      rxDeductibleFamily: rx.deductibleFamily ?? null,
      rxOopMaxIndividual: rx.oopMaxIndividual ?? null,
      rxOopMaxFamily: rx.oopMaxFamily ?? null,

      // Emergency/Ambulance coverage
      ambulanceGroundCopay: emergency.ambulanceGroundCopay ?? null,
      ambulanceGroundCoinsurance: emergency.ambulanceGroundCoinsurance ?? null,
      ambulanceAirCopay: emergency.ambulanceAirCopay ?? null,
      ambulanceAirCoinsurance: emergency.ambulanceAirCoinsurance ?? null,

      // Vision coverage
      visionExamCopay: extractedData.visionCoverage?.examCopay ?? null,
      visionExamFrequency: extractedData.visionCoverage?.examFrequency ?? null,
      visionLensesAllowance: extractedData.visionCoverage?.lensesAllowance ?? null,
      visionFramesAllowance: extractedData.visionCoverage?.framesAllowance ?? null,
      visionContactsAllowance: extractedData.visionCoverage?.contactsAllowance ?? null,

      // Dental coverage
      dentalPreventiveCoinsurance: extractedData.dentalCoverage?.preventiveCoinsurance ?? null,
      dentalBasicCoinsurance: extractedData.dentalCoverage?.basicCoinsurance ?? null,
      dentalMajorCoinsurance: extractedData.dentalCoverage?.majorCoinsurance ?? null,
      dentalAnnualMax: extractedData.dentalCoverage?.annualMaximum ?? null,
      dentalDeductible: extractedData.dentalCoverage?.deductible ?? null,
      dentalOrthodontiaCoinsurance: extractedData.dentalCoverage?.orthodontiaCoinsurance ?? null,
      dentalOrthodontiaLifetimeMax: extractedData.dentalCoverage?.orthodontiaLifetimeMax ?? null,

      // DME coverage
      dmeCopay: extractedData.dmeCoverage?.copay ?? null,
      dmeCoinsurance: extractedData.dmeCoverage?.coinsurance ?? null,

      // Home Health coverage
      homeHealthVisitCopay: extractedData.homeHealthCoverage?.visitCopay ?? null,
      homeHealthVisitCoinsurance: extractedData.homeHealthCoverage?.visitCoinsurance ?? null,
      homeHealthVisitLimit: extractedData.homeHealthCoverage?.visitLimit ?? null,

      // Hospice coverage
      hospiceInpatientCopay: extractedData.hospiceCoverage?.inpatientCopay ?? null,
      hospiceInpatientCoinsurance: extractedData.hospiceCoverage?.inpatientCoinsurance ?? null,
      hospiceRespiteCopay: extractedData.hospiceCoverage?.respiteCopay ?? null,
      hospiceRespiteCoinsurance: extractedData.hospiceCoverage?.respiteCoinsurance ?? null,
      hospiceRespiteDayLimit: extractedData.hospiceCoverage?.respiteDayLimit ?? null,

      // Additional therapy types
      chiropracticCopay: therapy.chiropracticCopay ?? null,
      chiropracticVisitsLimit: therapy.chiropracticVisitsLimit ?? null,
      acupunctureCopay: therapy.acupunctureCopay ?? null,
      acupunctureVisitsLimit: therapy.acupunctureVisitsLimit ?? null,
      cardiacRehabCopay: therapy.cardiacRehabCopay ?? null,
      cardiacRehabVisitsLimit: therapy.cardiacRehabVisitsLimit ?? null,
      pulmonaryRehabCopay: therapy.pulmonaryRehabCopay ?? null,
      pulmonaryRehabVisitsLimit: therapy.pulmonaryRehabVisitsLimit ?? null,

      // JSON lists (stored as stringified JSON)
      preventiveServicesList: extractedData.preventiveServices?.length
        ? JSON.stringify(extractedData.preventiveServices)
        : null,
      exclusionsList: extractedData.exclusions?.length
        ? JSON.stringify(extractedData.exclusions)
        : null,
      priorAuthRequirements: extractedData.priorAuthRequirements?.length
        ? JSON.stringify(extractedData.priorAuthRequirements)
        : null,
      servicesWithLimits: extractedData.servicesWithLimits?.length
        ? JSON.stringify(extractedData.servicesWithLimits)
        : null,

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
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    },
  };

  res.status(201).json(response);
}

/**
 * Re-analyze an existing insurance plan by re-processing an uploaded SBC PDF
 * Uses Claude Sonnet for intelligent extraction with fallback to regex parser
 * PUT /api/v1/insurance/plans/:id/reanalyze
 *
 * Preserves user-entered data (memberId, groupId, tracking fields) while updating
 * all extracted coverage data with the latest extraction results.
 */
export async function reanalyzePlan(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const planId = req.params.id;
  const file = req.file;

  validateUploadFile(file, 'pdf');

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  // Verify the plan exists and belongs to this user
  const existingPlan = await prisma.insurancePlan.findFirst({
    where: { id: planId, userId },
    include: { benefits: true },
  });

  if (!existingPlan) {
    throw new NotFoundError('Insurance plan not found');
  }

  // Type for extracted data - same as uploadSBC
  let extractedData: {
    planName?: string;
    insurerName?: string;
    planType?: 'HMO' | 'PPO' | 'EPO' | 'POS' | 'HDHP';
    planIdNumber?: string;
    deductibleIndividual?: number;
    deductibleFamily?: number;
    oopMaxIndividual?: number;
    oopMaxFamily?: number;
    // Out-of-network financial limits
    deductibleIndividualOutOfNetwork?: number;
    deductibleFamilyOutOfNetwork?: number;
    oopMaxIndividualOutOfNetwork?: number;
    oopMaxFamilyOutOfNetwork?: number;
    premiumMonthly?: number;
    copayPrimaryCare?: number;
    copaySpecialist?: number;
    copayPreventive?: number;
    copayUrgentCare?: number;
    copayEmergency?: number;
    copayTelehealth?: number;
    copayLabWork?: number;
    copayXray?: number;
    copayAdvancedImaging?: number;
    coinsuranceRate?: number;
    coinsurancePrimaryCare?: number;
    coinsuranceSpecialist?: number;
    coinsuranceUrgentCare?: number;
    coinsuranceEmergency?: number;
    coinsuranceTelehealth?: number;
    coinsuranceLabWork?: number;
    coinsuranceXray?: number;
    coinsuranceAdvancedImaging?: number;
    inpatientCoverage?: ExtractedInpatientCoverage;
    outpatientCoverage?: ExtractedOutpatientCoverage;
    therapyCoverage?: ExtractedTherapyCoverage;
    emergencyCoverage?: ExtractedEmergencyCoverage;
    rxBenefits?: ExtractedRxBenefits;
    visionCoverage?: ExtractedVisionCoverage;
    dentalCoverage?: ExtractedDentalCoverage;
    dmeCoverage?: ExtractedDMECoverage;
    homeHealthCoverage?: ExtractedHomeHealthCoverage;
    hospiceCoverage?: ExtractedHospiceCoverage;
    preventiveServices?: string[];
    exclusions?: string[];
    priorAuthRequirements?: string[];
    servicesWithLimits?: Array<{
      service: string;
      limit: number;
      limitType: 'visits' | 'days' | 'dollars' | 'lifetime';
      period: 'per year' | 'per admission' | 'lifetime' | 'per occurrence';
    }>;
    effectiveDate?: string;
    pagesProcessed?: number;
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
      visitLimit?: number;
      dayLimit?: number;
      limitations?: string;
    }>;
    extractionConfidence: number;
    usedClaudeExtraction: boolean;
  };

  // Try Claude Sonnet extraction first, fall back to regex parser
  if (isSBCExtractionConfigured()) {
    try {
      logger.info('Re-analyzing plan with Claude Sonnet SBC extraction', { data: { planId } });
      const claudeResult = await extractInsuranceFromSBC(file.buffer);

      extractedData = {
        planName: claudeResult.planName,
        insurerName: claudeResult.insurerName,
        planType: claudeResult.planType,
        planIdNumber: claudeResult.planIdNumber,
        deductibleIndividual: claudeResult.deductibleIndividual,
        deductibleFamily: claudeResult.deductibleFamily,
        oopMaxIndividual: claudeResult.oopMaxIndividual,
        oopMaxFamily: claudeResult.oopMaxFamily,
        // Out-of-network financial limits
        deductibleIndividualOutOfNetwork: claudeResult.deductibleIndividualOutOfNetwork,
        deductibleFamilyOutOfNetwork: claudeResult.deductibleFamilyOutOfNetwork,
        oopMaxIndividualOutOfNetwork: claudeResult.oopMaxIndividualOutOfNetwork,
        oopMaxFamilyOutOfNetwork: claudeResult.oopMaxFamilyOutOfNetwork,
        premiumMonthly: claudeResult.premiumMonthly,
        coinsuranceRate: claudeResult.coinsuranceRate,
        copayPrimaryCare: claudeResult.copayPrimaryCare,
        copaySpecialist: claudeResult.copaySpecialist,
        copayPreventive: claudeResult.copayPreventive,
        copayUrgentCare: claudeResult.copayUrgentCare,
        copayEmergency: claudeResult.copayEmergency,
        copayTelehealth: claudeResult.copayTelehealth,
        copayLabWork: claudeResult.copayLabWork,
        copayXray: claudeResult.copayXray,
        copayAdvancedImaging: claudeResult.copayAdvancedImaging,
        coinsurancePrimaryCare: claudeResult.coinsurancePrimaryCare,
        coinsuranceSpecialist: claudeResult.coinsuranceSpecialist,
        coinsuranceUrgentCare: claudeResult.coinsuranceUrgentCare,
        coinsuranceEmergency: claudeResult.coinsuranceEmergency,
        coinsuranceTelehealth: claudeResult.coinsuranceTelehealth,
        coinsuranceLabWork: claudeResult.coinsuranceLabWork,
        coinsuranceXray: claudeResult.coinsuranceXray,
        coinsuranceAdvancedImaging: claudeResult.coinsuranceAdvancedImaging,
        inpatientCoverage: claudeResult.inpatientCoverage,
        outpatientCoverage: claudeResult.outpatientCoverage,
        therapyCoverage: claudeResult.therapyCoverage,
        emergencyCoverage: claudeResult.emergencyCoverage,
        rxBenefits: claudeResult.rxBenefits,
        visionCoverage: claudeResult.visionCoverage,
        dentalCoverage: claudeResult.dentalCoverage,
        dmeCoverage: claudeResult.dmeCoverage,
        homeHealthCoverage: claudeResult.homeHealthCoverage,
        hospiceCoverage: claudeResult.hospiceCoverage,
        preventiveServices: claudeResult.preventiveServices,
        exclusions: claudeResult.exclusions,
        priorAuthRequirements: claudeResult.priorAuthRequirements,
        servicesWithLimits: claudeResult.servicesWithLimits,
        effectiveDate: claudeResult.effectiveDate,
        pagesProcessed: claudeResult.pagesProcessed,
        extractionConfidence: claudeResult.extractionConfidence,
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
          visitLimit: b.visitLimit,
          dayLimit: b.dayLimit,
          limitations: b.limitations,
        })),
        usedClaudeExtraction: true,
      };
    } catch (error) {
      logger.warn('Claude SBC extraction failed during re-analysis, falling back to regex parser', {
        data: { planId, error: error instanceof Error ? error.message : 'Unknown' },
      });
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
    logger.info('Claude not configured for re-analysis, using regex SBC parser', { data: { planId } });
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
    await auditService.logAccess(SBC_RESOURCE, planId, { req, userId }, {
      operation: 'REANALYZE_FAILED',
      filename: file.originalname,
      fileSize: file.size,
      reason: 'Could not extract plan information',
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    });

    throw new ValidationError(
      'Could not extract insurance plan information from the PDF. Please ensure it is a valid SBC document.'
    );
  }

  // Extract nested coverage objects with defaults
  const inpatient = extractedData.inpatientCoverage || {};
  const outpatient = extractedData.outpatientCoverage || {};
  const therapy = extractedData.therapyCoverage || {};
  const rx = extractedData.rxBenefits || {};
  const emergency = extractedData.emergencyCoverage || {};

  // Update the plan with new extracted data
  // Preserve user-entered data: memberId, groupId, tracking fields (deductibleMet, oopMet)
  // Preserve user preferences: isActive, isPrimary
  const updatedPlan = await prisma.$transaction(async (tx) => {
    // Delete existing benefits
    await tx.insuranceBenefit.deleteMany({
      where: { planId },
    });

    // Update plan with new extraction data
    return tx.insurancePlan.update({
      where: { id: planId },
      data: {
        // Update extracted fields
        planName: extractedData.planName || existingPlan.planName,
        insurerName: extractedData.insurerName || existingPlan.insurerName,
        planType: extractedData.planType || existingPlan.planType,
        planIdNumber: extractedData.planIdNumber ?? existingPlan.planIdNumber,
        effectiveDate: extractedData.effectiveDate
          ? new Date(extractedData.effectiveDate)
          : existingPlan.effectiveDate,
        premiumMonthly: extractedData.premiumMonthly ?? existingPlan.premiumMonthly,
        deductibleIndividual: extractedData.deductibleIndividual ?? Number(existingPlan.deductibleIndividual),
        deductibleFamily:
          extractedData.deductibleFamily ??
          (extractedData.deductibleIndividual ? extractedData.deductibleIndividual * 2 : Number(existingPlan.deductibleFamily)),
        oopMaxIndividual: extractedData.oopMaxIndividual ?? Number(existingPlan.oopMaxIndividual),
        oopMaxFamily:
          extractedData.oopMaxFamily ??
          (extractedData.oopMaxIndividual ? extractedData.oopMaxIndividual * 2 : Number(existingPlan.oopMaxFamily)),

        // Out-of-network financial limits
        deductibleIndividualOutOfNetwork: extractedData.deductibleIndividualOutOfNetwork ?? null,
        deductibleFamilyOutOfNetwork: extractedData.deductibleFamilyOutOfNetwork ?? null,
        oopMaxIndividualOutOfNetwork: extractedData.oopMaxIndividualOutOfNetwork ?? null,
        oopMaxFamilyOutOfNetwork: extractedData.oopMaxFamilyOutOfNetwork ?? null,

        // Core copay fields
        copayPrimaryCare: extractedData.copayPrimaryCare ?? null,
        copaySpecialist: extractedData.copaySpecialist ?? null,
        copayUrgentCare: extractedData.copayUrgentCare ?? emergency.urgentCareCopay ?? null,
        copayEmergency: extractedData.copayEmergency ?? emergency.emergencyRoomCopay ?? null,
        copayTelehealth: extractedData.copayTelehealth ?? null,
        copayLabWork: extractedData.copayLabWork ?? outpatient.labWorkCopay ?? null,
        copayXray: extractedData.copayXray ?? outpatient.xrayCopay ?? null,
        copayAdvancedImaging: extractedData.copayAdvancedImaging ?? outpatient.advancedImagingCopay ?? null,
        coinsuranceRate: extractedData.coinsuranceRate ?? null,

        // Per-service coinsurance
        coinsurancePrimaryCare: extractedData.coinsurancePrimaryCare ?? null,
        coinsuranceSpecialist: extractedData.coinsuranceSpecialist ?? null,
        coinsuranceUrgentCare: extractedData.coinsuranceUrgentCare ?? emergency.urgentCareCoinsurance ?? null,
        coinsuranceEmergency: extractedData.coinsuranceEmergency ?? emergency.emergencyRoomCoinsurance ?? null,
        coinsuranceTelehealth: extractedData.coinsuranceTelehealth ?? null,
        coinsuranceLabWork: extractedData.coinsuranceLabWork ?? outpatient.labWorkCoinsurance ?? null,
        coinsuranceXray: extractedData.coinsuranceXray ?? outpatient.xrayCoinsurance ?? null,
        coinsuranceAdvancedImaging: extractedData.coinsuranceAdvancedImaging ?? outpatient.advancedImagingCoinsurance ?? null,

        // Inpatient coverage
        inpatientHospitalCopay: inpatient.hospitalCopayPerDay ?? inpatient.hospitalCopayPerAdmission ?? null,
        inpatientHospitalCoinsurance: inpatient.hospitalCoinsurance ?? null,
        inpatientMentalHealthCopay: inpatient.mentalHealthCopay ?? null,
        inpatientMentalCoinsurance: inpatient.mentalHealthCoinsurance ?? null,
        maternityCopay: inpatient.maternityCopay ?? null,
        maternityCoinsurance: inpatient.maternityCoinsurance ?? null,
        skilledNursingCopay: inpatient.skilledNursingCopay ?? null,
        skilledNursingCoinsurance: inpatient.skilledNursingCoinsurance ?? null,
        skilledNursingDaysLimit: inpatient.skilledNursingDaysLimit ?? null,

        // Outpatient coverage
        outpatientSurgeryCopay: outpatient.surgeryCopay ?? null,
        outpatientSurgeryCoinsurance: outpatient.surgeryCoinsurance ?? null,
        outpatientMentalHealthCopay: outpatient.mentalHealthIndividualCopay ?? outpatient.mentalHealthGroupCopay ?? null,
        outpatientMentalCoinsurance: outpatient.mentalHealthCoinsurance ?? null,

        // Therapy/Rehab coverage
        physicalTherapyCopay: therapy.physicalTherapyCopay ?? null,
        physicalTherapyVisitsLimit: therapy.physicalTherapyVisitsLimit ?? null,
        occupationalTherapyCopay: therapy.occupationalTherapyCopay ?? null,
        occupationalTherapyVisitsLimit: therapy.occupationalTherapyVisitsLimit ?? null,
        speechTherapyCopay: therapy.speechTherapyCopay ?? null,
        speechTherapyVisitsLimit: therapy.speechTherapyVisitsLimit ?? null,

        // Prescription (Rx) benefits
        rxTier1Copay: rx.tier1Copay ?? null,
        rxTier2Copay: rx.tier2Copay ?? null,
        rxTier3Copay: rx.tier3Copay ?? null,
        rxTier4Copay: rx.tier4Copay ?? null,
        rxTier1Coinsurance: rx.tier1CoinsurancePercent ?? null,
        rxTier2Coinsurance: rx.tier2CoinsurancePercent ?? null,
        rxTier3Coinsurance: rx.tier3CoinsurancePercent ?? null,
        rxTier4Coinsurance: rx.tier4CoinsurancePercent ?? null,
        rxRetailDaysSupply: rx.retailDaysSupply ?? null,
        rxMailOrderDaysSupply: rx.mailOrderDaysSupply ?? null,
        rxDeductibleIndividual: rx.deductibleIndividual ?? null,
        rxDeductibleFamily: rx.deductibleFamily ?? null,
        rxOopMaxIndividual: rx.oopMaxIndividual ?? null,
        rxOopMaxFamily: rx.oopMaxFamily ?? null,

        // Emergency/Ambulance coverage
        ambulanceGroundCopay: emergency.ambulanceGroundCopay ?? null,
        ambulanceGroundCoinsurance: emergency.ambulanceGroundCoinsurance ?? null,
        ambulanceAirCopay: emergency.ambulanceAirCopay ?? null,
        ambulanceAirCoinsurance: emergency.ambulanceAirCoinsurance ?? null,

        // Vision coverage
        visionExamCopay: extractedData.visionCoverage?.examCopay ?? null,
        visionExamFrequency: extractedData.visionCoverage?.examFrequency ?? null,
        visionLensesAllowance: extractedData.visionCoverage?.lensesAllowance ?? null,
        visionFramesAllowance: extractedData.visionCoverage?.framesAllowance ?? null,
        visionContactsAllowance: extractedData.visionCoverage?.contactsAllowance ?? null,

        // Dental coverage
        dentalPreventiveCoinsurance: extractedData.dentalCoverage?.preventiveCoinsurance ?? null,
        dentalBasicCoinsurance: extractedData.dentalCoverage?.basicCoinsurance ?? null,
        dentalMajorCoinsurance: extractedData.dentalCoverage?.majorCoinsurance ?? null,
        dentalAnnualMax: extractedData.dentalCoverage?.annualMaximum ?? null,
        dentalDeductible: extractedData.dentalCoverage?.deductible ?? null,
        dentalOrthodontiaCoinsurance: extractedData.dentalCoverage?.orthodontiaCoinsurance ?? null,
        dentalOrthodontiaLifetimeMax: extractedData.dentalCoverage?.orthodontiaLifetimeMax ?? null,

        // DME coverage
        dmeCopay: extractedData.dmeCoverage?.copay ?? null,
        dmeCoinsurance: extractedData.dmeCoverage?.coinsurance ?? null,

        // Home Health coverage
        homeHealthVisitCopay: extractedData.homeHealthCoverage?.visitCopay ?? null,
        homeHealthVisitCoinsurance: extractedData.homeHealthCoverage?.visitCoinsurance ?? null,
        homeHealthVisitLimit: extractedData.homeHealthCoverage?.visitLimit ?? null,

        // Hospice coverage
        hospiceInpatientCopay: extractedData.hospiceCoverage?.inpatientCopay ?? null,
        hospiceInpatientCoinsurance: extractedData.hospiceCoverage?.inpatientCoinsurance ?? null,
        hospiceRespiteCopay: extractedData.hospiceCoverage?.respiteCopay ?? null,
        hospiceRespiteCoinsurance: extractedData.hospiceCoverage?.respiteCoinsurance ?? null,
        hospiceRespiteDayLimit: extractedData.hospiceCoverage?.respiteDayLimit ?? null,

        // Additional therapy types
        chiropracticCopay: therapy.chiropracticCopay ?? null,
        chiropracticVisitsLimit: therapy.chiropracticVisitsLimit ?? null,
        acupunctureCopay: therapy.acupunctureCopay ?? null,
        acupunctureVisitsLimit: therapy.acupunctureVisitsLimit ?? null,
        cardiacRehabCopay: therapy.cardiacRehabCopay ?? null,
        cardiacRehabVisitsLimit: therapy.cardiacRehabVisitsLimit ?? null,
        pulmonaryRehabCopay: therapy.pulmonaryRehabCopay ?? null,
        pulmonaryRehabVisitsLimit: therapy.pulmonaryRehabVisitsLimit ?? null,

        // JSON lists
        preventiveServicesList: extractedData.preventiveServices?.length
          ? JSON.stringify(extractedData.preventiveServices)
          : null,
        exclusionsList: extractedData.exclusions?.length
          ? JSON.stringify(extractedData.exclusions)
          : null,
        priorAuthRequirements: extractedData.priorAuthRequirements?.length
          ? JSON.stringify(extractedData.priorAuthRequirements)
          : null,
        servicesWithLimits: extractedData.servicesWithLimits?.length
          ? JSON.stringify(extractedData.servicesWithLimits)
          : null,

        // Source tracking - update confidence
        extractedFromSbc: true,
        sbcExtractionConfidence: extractedData.extractionConfidence,

        // Create new benefits
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
  });

  // Audit log: successful re-analysis
  await auditService.logUpdate(
    SBC_RESOURCE,
    planId,
    {
      // Previous state
      previousBenefitsCount: existingPlan.benefits.length,
      previousConfidence: existingPlan.sbcExtractionConfidence ? Number(existingPlan.sbcExtractionConfidence) : null,
    },
    {
      // New state
      benefitsExtracted: updatedPlan.benefits.length,
      extractionConfidence: extractedData.extractionConfidence,
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    },
    { req, userId },
    {
      operation: 'REANALYZE',
      filename: file.originalname,
      fileSize: file.size,
      planName: updatedPlan.planName,
      insurerName: updatedPlan.insurerName,
    }
  );

  const response: ApiResponse<SBCUploadResponse> = {
    success: true,
    data: {
      id: updatedPlan.id,
      planName: updatedPlan.planName,
      insurerName: updatedPlan.insurerName,
      planType: updatedPlan.planType,
      planIdNumber: updatedPlan.planIdNumber || undefined,
      effectiveDate: updatedPlan.effectiveDate.toISOString(),
      terminationDate: updatedPlan.terminationDate?.toISOString() || undefined,
      isActive: updatedPlan.isActive,
      isPrimary: updatedPlan.isPrimary,
      deductibleIndividual: Number(updatedPlan.deductibleIndividual),
      deductibleFamily: Number(updatedPlan.deductibleFamily),
      oopMaxIndividual: Number(updatedPlan.oopMaxIndividual),
      oopMaxFamily: Number(updatedPlan.oopMaxFamily),
      premiumMonthly: updatedPlan.premiumMonthly ? Number(updatedPlan.premiumMonthly) : undefined,
      deductibleMetIndividual: updatedPlan.deductibleMetIndividual ? Number(updatedPlan.deductibleMetIndividual) : undefined,
      deductibleMetFamily: updatedPlan.deductibleMetFamily ? Number(updatedPlan.deductibleMetFamily) : undefined,
      oopMetIndividual: updatedPlan.oopMetIndividual ? Number(updatedPlan.oopMetIndividual) : undefined,
      oopMetFamily: updatedPlan.oopMetFamily ? Number(updatedPlan.oopMetFamily) : undefined,
      copayPrimaryCare: updatedPlan.copayPrimaryCare ? Number(updatedPlan.copayPrimaryCare) : undefined,
      copaySpecialist: updatedPlan.copaySpecialist ? Number(updatedPlan.copaySpecialist) : undefined,
      copayUrgentCare: updatedPlan.copayUrgentCare ? Number(updatedPlan.copayUrgentCare) : undefined,
      copayEmergency: updatedPlan.copayEmergency ? Number(updatedPlan.copayEmergency) : undefined,
      coinsuranceRate: updatedPlan.coinsuranceRate ? Number(updatedPlan.coinsuranceRate) : undefined,
      extractedFromSbc: updatedPlan.extractedFromSbc,
      sbcExtractionConfidence: updatedPlan.sbcExtractionConfidence ? Number(updatedPlan.sbcExtractionConfidence) : undefined,
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
    },
  };

  res.status(200).json(response);
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
