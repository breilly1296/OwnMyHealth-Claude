/**
 * Upload Controllers — Shared Types & Helpers
 *
 * Types, validation, and helper functions shared between lab-report
 * and SBC upload controllers.
 */

import path from 'node:path';
import type { AuthenticatedRequest } from '../../types/index.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import { getPrismaClient } from '../../services/database.js';
import { getEncryptionService } from '../../services/encryption.js';
import { parseSBC } from '../../services/pdfParser.js';
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
} from '../../services/sbcExtraction.js';
import { logger } from '../../utils/logger.js';
import { deleteFile } from '../../services/storageService.js';

// ============================================
// Request type
// ============================================

export interface UploadRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
}

// ============================================
// Shared response types
// ============================================

export interface BiomarkerResult {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  isOutOfRange: boolean;
}

// ============================================
// Validation
// ============================================

export const SUPPORTED_MIME_TYPES = {
  pdf: ['application/pdf'],
  ocr: ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/gif', 'image/webp'],
} as const;

export type UploadType = keyof typeof SUPPORTED_MIME_TYPES;

/**
 * Magic bytes per mimetype. Used to verify that the client-declared mimetype
 * actually matches file content — multer's fileFilter only checks the
 * Content-Type header, which is attacker-controlled.
 *
 * PDF is intentionally listed here too so the base case is covered; the more
 * detailed PDF-version check in `validatePdfHeader` is called separately by
 * upload handlers that invoke pdf-parse / Claude.
 */
const MAGIC_BYTES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],           // %PDF
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],                 // .PNG
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],                      // JPEG SOI
  'image/gif': [Buffer.from('GIF87a', 'ascii'), Buffer.from('GIF89a', 'ascii')],
  'image/tiff': [
    Buffer.from([0x4d, 0x4d, 0x00, 0x2a]),                              // TIFF big-endian
    Buffer.from([0x49, 0x49, 0x2a, 0x00]),                              // TIFF little-endian
  ],
  'image/webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])],                // RIFF (WebP container)
};

function validateMagicBytes(buffer: Buffer, mimetype: string): void {
  const expected = MAGIC_BYTES[mimetype];
  if (!expected) return; // No check for mimetypes not in the map
  const matches = expected.some((magic) =>
    buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)
  );
  if (!matches) {
    throw new ValidationError('File content does not match its declared type');
  }
}

/**
 * Sanitize a client-supplied filename so it's safe to:
 *   - persist as `UserFile.originalFilename` (DB column, never executed)
 *   - quote into log lines (control chars would corrupt the log stream)
 *   - echo back in `Content-Disposition` headers on signed-URL downloads
 *     (where path separators or quote chars would let a malicious filename
 *     escape the header value)
 *
 * Strategy: take the basename only (drops any `..\foo` or `/etc/passwd`
 * prefix the client embedded), replace control + filesystem-unsafe chars
 * with `_`, and cap to 255 bytes (filesystem POSIX max). Idempotent — safe
 * to call repeatedly.
 */
function sanitizeFilename(name: string): string {
  return path.basename(name)
    // C0 controls + DEL + Windows-illegal + path seps + quote chars.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F"<>|:*?\\/]/g, '_')
    .slice(0, 255);
}

/** Validate uploaded file — throws ValidationError if invalid. Mutates
 *  `file.originalname` to a sanitized form so every downstream consumer
 *  (DB write, log line, Content-Disposition header) gets the safe string
 *  by default. */
export function validateUploadFile(
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

  // Verify magic bytes match declared mimetype — defends against clients
  // spoofing Content-Type to smuggle a different file format.
  validateMagicBytes(file.buffer, file.mimetype);

  // F-15 fix: sanitize client-supplied filename before any downstream code
  // reads `file.originalname`. Mutation here means upload controllers,
  // audit logs, and DB writes all see the sanitized form without each
  // having to remember to call sanitizeFilename themselves.
  file.originalname = sanitizeFilename(file.originalname);
}

// ============================================
// Biomarker creation helper
// ============================================

export interface OCRBiomarker {
  name: string;
  value: number;
  unit: string;
  category: string;
  confidence: number;
  normalRange: { min: number; max: number; source?: string };
}

export interface CreateBiomarkersOptions {
  userId: string;
  biomarkers: OCRBiomarker[];
  reportDate: Date;
  labName?: string;
  notesPrefix: string;
  normalRangeSource: string;
  userFileId?: string | null;
}

/**
 * Create biomarkers from OCR/Claude results — encrypts values+notes and persists.
 *
 * `tx` is named to reinforce the RLS contract: callers must pass a Prisma
 * transaction client obtained from `withRLSContext(userId, ...)` / `withRLSTransaction(...)`,
 * NOT the module-level Prisma client. Naming it `tx` (instead of `prisma`)
 * keeps the CI RLS guard honest — a bare `prisma.*` call would slip past the
 * grep if the local parameter was also named `prisma`.
 */
export async function createBiomarkersFromOCRResult(
  tx: { biomarker: ReturnType<typeof getPrismaClient>['biomarker'] },
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

    const created = await tx.biomarker.create({
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
// SBC: extracted-data shape
// ============================================

/** Normalized SBC extraction result — union of Claude and regex-parser outputs */
export interface ExtractedSBCData {
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
  // Per-service coinsurance
  coinsurancePrimaryCare?: number;
  coinsuranceSpecialist?: number;
  coinsuranceUrgentCare?: number;
  coinsuranceEmergency?: number;
  coinsuranceTelehealth?: number;
  coinsuranceLabWork?: number;
  coinsuranceXray?: number;
  coinsuranceAdvancedImaging?: number;
  // Detailed coverage objects
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
}

/**
 * Extract SBC data from a PDF buffer.
 * Prefers Claude Sonnet when configured; falls back to the regex parser on
 * failure or when Claude is disabled. Returns a normalized ExtractedSBCData
 * shape regardless of which path ran.
 *
 * `userId` is plumbed through to Claude cost attribution — callers must pass
 * the authenticated upload user.
 */
export async function extractSBCData(
  fileBuffer: Buffer,
  fileName: string,
  userId: string,
  context: { planId?: string } = {}
): Promise<ExtractedSBCData> {
  if (isSBCExtractionConfigured()) {
    try {
      logger.info(
        context.planId
          ? 'Re-analyzing plan with Claude Sonnet SBC extraction'
          : 'Attempting Claude Sonnet SBC extraction',
        context.planId ? { data: { planId: context.planId } } : undefined
      );
      const claudeResult = await extractInsuranceFromSBC(fileBuffer, userId);

      return {
        planName: claudeResult.planName,
        insurerName: claudeResult.insurerName,
        planType: claudeResult.planType,
        planIdNumber: claudeResult.planIdNumber,
        deductibleIndividual: claudeResult.deductibleIndividual,
        deductibleFamily: claudeResult.deductibleFamily,
        oopMaxIndividual: claudeResult.oopMaxIndividual,
        oopMaxFamily: claudeResult.oopMaxFamily,
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
      logger.warn(
        context.planId
          ? 'Claude SBC extraction failed during re-analysis, falling back to regex parser'
          : 'Claude SBC extraction failed, falling back to regex parser',
        {
          data: {
            ...(context.planId ? { planId: context.planId } : {}),
            error: error instanceof Error ? error.message : 'Unknown',
          },
        }
      );
      // Fall through to regex parser
    }
  } else {
    logger.info(
      context.planId
        ? 'Claude not configured for re-analysis, using regex SBC parser'
        : 'Claude not configured, using regex SBC parser',
      context.planId ? { data: { planId: context.planId } } : undefined
    );
  }

  const parseResult = await parseSBC(fileBuffer, fileName);
  const { plan: parsedPlan } = parseResult;

  return {
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

// ============================================
// SBC: map extracted data → Prisma plan fields
// ============================================

/**
 * Map extracted SBC data to the Prisma plan fields that are IDENTICAL between
 * `insurancePlan.create` (uploadSBC) and `insurancePlan.update` (reanalyzePlan).
 *
 * Fields that differ between create and update (userId, planName default,
 * deductible fallbacks, tracking fields, isActive/isPrimary, effectiveDate
 * fallback, benefits.create) are handled at the call sites.
 */
export function mapExtractedDataToPlanFields(extractedData: ExtractedSBCData) {
  const inpatient = extractedData.inpatientCoverage || {};
  const outpatient = extractedData.outpatientCoverage || {};
  const therapy = extractedData.therapyCoverage || {};
  const rx = extractedData.rxBenefits || {};
  const emergency = extractedData.emergencyCoverage || {};

  return {
    // Out-of-network financial limits
    deductibleIndividualOutOfNetwork: extractedData.deductibleIndividualOutOfNetwork ?? null,
    deductibleFamilyOutOfNetwork: extractedData.deductibleFamilyOutOfNetwork ?? null,
    oopMaxIndividualOutOfNetwork: extractedData.oopMaxIndividualOutOfNetwork ?? null,
    oopMaxFamilyOutOfNetwork: extractedData.oopMaxFamilyOutOfNetwork ?? null,

    // Core copay fields — prefer top-level, fall back to nested coverage objects
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

    // Source tracking
    extractedFromSbc: true,
    sbcExtractionConfidence: extractedData.extractionConfidence,
  };
}

/** Map extracted benefits to Prisma benefits.create payload */
export function mapExtractedBenefits(benefits: ExtractedSBCData['benefits']) {
  return benefits.map((benefit) => ({
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
  }));
}

// ============================================
// Response types (re-exported)
// ============================================

export interface LabReportUploadResponse {
  biomarkersCreated: number;
  biomarkers: BiomarkerResult[];
  labName?: string;
  reportDate?: string;
  extractionConfidence: number;
  file?: {
    id: string;
    filename: string;
    storageKey: string;
  };
}

export interface SBCUploadResponse {
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
  deductibleMetIndividual?: number;
  deductibleMetFamily?: number;
  oopMetIndividual?: number;
  oopMetFamily?: number;
  copayPrimaryCare?: number;
  copaySpecialist?: number;
  copayUrgentCare?: number;
  copayEmergency?: number;
  coinsuranceRate?: number;
  extractedFromSbc?: boolean;
  sbcExtractionConfidence?: number;
  usedClaudeExtraction?: boolean;
  file?: {
    id: string;
    filename: string;
    storageKey: string;
  };
}

export interface LabResultOCRResponse {
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

// ============================================
// GCS-orphan cleanup (M8/M25)
// ============================================

/**
 * Run the post-upload DB transaction and, if it throws, delete the GCS object
 * that was already uploaded before the transaction so a rolled-back DB write
 * can't orphan PHI in the bucket with no DB pointer.
 *
 * Upload handlers PUT the source file to GCS *before* opening the RLS
 * transaction that creates the `UserFile` row. If that transaction rolls back
 * (a poisoned `userFile.create`, a biomarker/plan insert failure, an
 * interactive-tx timeout, etc.), no row references the object — and because the
 * `UserFile` row is the only pointer the app's export / right-to-erasure flows
 * enumerate, the object would survive account deletion indefinitely. This is
 * the inverse of the F-22 delete-first invariant the bulk-delete path enforces.
 *
 * `storageKey` may be null (the GCS upload itself failed or was skipped) — then
 * there is nothing to clean up and `run()` simply propagates. Cleanup is
 * best-effort: a cleanup failure is logged, but the ORIGINAL transaction error
 * is what propagates to the caller.
 */
export async function withGcsOrphanCleanup<T>(
  storageKey: string | null,
  context: { fileId: string; userId: string },
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (storageKey) {
      await deleteFile(storageKey).catch((cleanupError) => {
        logger.error('Failed to delete orphaned GCS object after upload tx rollback', {
          data: {
            storageKey,
            fileId: context.fileId,
            userId: context.userId,
            error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
          },
        });
      });
    }
    throw error;
  }
}

// ============================================
// Audit resource names
// ============================================

export const LAB_REPORT_RESOURCE = 'LabReportUpload';
export const SBC_RESOURCE = 'SBCUpload';
export const LAB_OCR_RESOURCE = 'LabResultOCR';
