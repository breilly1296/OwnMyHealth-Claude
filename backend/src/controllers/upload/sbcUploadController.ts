/**
 * SBC Upload Controller
 *
 * Handles insurance SBC (Summary of Benefits and Coverage) PDF upload and
 * re-analysis. Uses Claude Sonnet extraction with a regex-parser fallback.
 * Persists the SBC PDF to GCS as a UserFile on initial upload (F-21).
 */

import { Response } from 'express';
import type { ApiResponse } from '../../types/index.js';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import { getPrismaClient, withRLSTransaction } from '../../services/database.js';
import { getAuditLogService } from '../../services/auditLog.js';
import { uploadFile as uploadToGCS } from '../../services/storageService.js';
import { validatePdfHeader } from '../../utils/securePdfParsing.js';
import { logger } from '../../utils/logger.js';
import {
  type UploadRequest,
  type SBCUploadResponse,
  validateUploadFile,
  extractSBCData,
  mapExtractedDataToPlanFields,
  mapExtractedBenefits,
  SBC_RESOURCE,
} from './shared.js';

/**
 * Upload and process an insurance SBC PDF.
 * Creates a new InsurancePlan with extracted coverage data and persists the
 * source PDF to GCS as a UserFile (F-21).
 * POST /api/v1/insurance/upload-sbc
 */
export async function uploadSBC(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  validateUploadFile(file, 'pdf');
  validatePdfHeader(file.buffer, file.originalname);

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const extractedData = await extractSBCData(file.buffer, file.originalname, userId);

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

  const planName = extractedData.planName || `Uploaded Plan ${new Date().toLocaleDateString()}`;
  const insurerName = extractedData.insurerName || 'Unknown Insurer';
  const effectiveDate = extractedData.effectiveDate
    ? new Date(extractedData.effectiveDate)
    : new Date();

  // Persist source PDF to GCS (F-21). Non-fatal on failure — the plan is
  // still created; only the file record is skipped.
  const fileId = crypto.randomUUID();
  let storageKey: string | null = null;
  try {
    storageKey = await uploadToGCS(userId, fileId, file.buffer, file.mimetype);
    logger.info('SBC uploaded to GCS', { data: { fileId, storageKey, userId } });
  } catch (error) {
    logger.error('Failed to upload SBC to GCS', {
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        fileId,
        userId,
      },
    });
  }

  const { createdPlan, userFile } = await withRLSTransaction(userId, async (tx) => {
    let fileRecord: { id: string; filename: string; storageKey: string } | null = null;
    if (storageKey) {
      try {
        const createdFile = await tx.userFile.create({
          data: {
            id: fileId,
            userId,
            filename: `${insurerName} SBC - ${effectiveDate.toLocaleDateString()}`,
            originalFilename: file.originalname,
            fileType: file.mimetype,
            fileSize: file.size,
            storageKey,
            labName: insurerName,
            labDate: effectiveDate,
            biomarkersExtracted: 0,
            extractionConfidence: extractedData.extractionConfidence,
          },
        });
        fileRecord = {
          id: createdFile.id,
          filename: createdFile.filename,
          storageKey: createdFile.storageKey,
        };
      } catch (error) {
        logger.error('Failed to create UserFile record for SBC', {
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
            fileId,
            userId,
          },
        });
      }
    }

    const plan = await tx.insurancePlan.create({
      data: {
        userId,
        planName,
        insurerName,
        planType: extractedData.planType || 'PPO',
        planIdNumber: extractedData.planIdNumber || null,
        memberIdEncrypted: null,
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
        isActive: true,
        isPrimary: false,

        ...mapExtractedDataToPlanFields(extractedData),

        benefits: {
          create: mapExtractedBenefits(extractedData.benefits),
        },
      },
      include: { benefits: true },
    });

    return { createdPlan: plan, userFile: fileRecord };
  });

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
      fileId: userFile?.id,
      storageKey: storageKey || undefined,
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
      deductibleMetIndividual: createdPlan.deductibleMetIndividual ? Number(createdPlan.deductibleMetIndividual) : undefined,
      deductibleMetFamily: createdPlan.deductibleMetFamily ? Number(createdPlan.deductibleMetFamily) : undefined,
      oopMetIndividual: createdPlan.oopMetIndividual ? Number(createdPlan.oopMetIndividual) : undefined,
      oopMetFamily: createdPlan.oopMetFamily ? Number(createdPlan.oopMetFamily) : undefined,
      copayPrimaryCare: createdPlan.copayPrimaryCare ? Number(createdPlan.copayPrimaryCare) : undefined,
      copaySpecialist: createdPlan.copaySpecialist ? Number(createdPlan.copaySpecialist) : undefined,
      copayUrgentCare: createdPlan.copayUrgentCare ? Number(createdPlan.copayUrgentCare) : undefined,
      copayEmergency: createdPlan.copayEmergency ? Number(createdPlan.copayEmergency) : undefined,
      coinsuranceRate: createdPlan.coinsuranceRate ? Number(createdPlan.coinsuranceRate) : undefined,
      extractedFromSbc: createdPlan.extractedFromSbc,
      sbcExtractionConfidence: createdPlan.sbcExtractionConfidence ? Number(createdPlan.sbcExtractionConfidence) : undefined,
      usedClaudeExtraction: extractedData.usedClaudeExtraction,
      file: userFile || undefined,
    },
  };

  res.status(201).json(response);
}

/**
 * Re-analyze an existing insurance plan with a new SBC PDF.
 * Preserves user-entered fields (memberId, groupId, tracking fields,
 * isActive, isPrimary) while refreshing all extracted coverage data.
 * PUT /api/v1/insurance/plans/:id/reanalyze
 */
export async function reanalyzePlan(
  req: UploadRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const planId = req.params.id;
  const file = req.file;

  validateUploadFile(file, 'pdf');
  validatePdfHeader(file.buffer, file.originalname);

  const prisma = getPrismaClient();
  const auditService = getAuditLogService(prisma);

  const existingPlan = await withRLSTransaction(userId, async (tx) => {
    return tx.insurancePlan.findFirst({
      where: { id: planId, userId },
      include: { benefits: true },
    });
  });

  if (!existingPlan) {
    throw new NotFoundError('Insurance plan not found');
  }

  const extractedData = await extractSBCData(file.buffer, file.originalname, userId, { planId });

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

  // Update plan; preserve user-entered data (memberId, groupId, tracking, isActive, isPrimary)
  const updatedPlan = await withRLSTransaction(userId, async (tx) => {
    await tx.insuranceBenefit.deleteMany({ where: { planId } });

    return tx.insurancePlan.update({
      where: { id: planId },
      data: {
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
          (extractedData.deductibleIndividual
            ? extractedData.deductibleIndividual * 2
            : Number(existingPlan.deductibleFamily)),
        oopMaxIndividual: extractedData.oopMaxIndividual ?? Number(existingPlan.oopMaxIndividual),
        oopMaxFamily:
          extractedData.oopMaxFamily ??
          (extractedData.oopMaxIndividual
            ? extractedData.oopMaxIndividual * 2
            : Number(existingPlan.oopMaxFamily)),

        ...mapExtractedDataToPlanFields(extractedData),

        benefits: {
          create: mapExtractedBenefits(extractedData.benefits),
        },
      },
      include: { benefits: true },
    });
  });

  await auditService.logUpdate(
    SBC_RESOURCE,
    planId,
    {
      previousBenefitsCount: existingPlan.benefits.length,
      previousConfidence: existingPlan.sbcExtractionConfidence ? Number(existingPlan.sbcExtractionConfidence) : null,
    },
    {
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
