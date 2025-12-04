/**
 * DNA Controller
 *
 * Handles DNA data uploads, variants, and genetic traits with PHI encryption.
 * Genotype data, descriptions, and recommendations are encrypted at rest.
 * All PHI access is logged for HIPAA compliance.
 */

import { Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { NotFoundError, BadRequestError } from '../middleware/errorHandler.js';
import { getPrismaClient } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { parseDNAFile, analyzeTraits, getTraitSummary } from '../services/dnaParser.js';
import { getFile, type MulterFile } from '../types/multer.js';
import { parsePagination, parseStringParam, createPaginationMeta } from '../utils/queryHelpers.js';
import { dnaControllerLogger } from '../utils/logger.js';
import type {
  DNAData as PrismaDNAData,
  DNAVariant as PrismaDNAVariant,
  GeneticTrait as PrismaGeneticTrait,
} from '../generated/prisma/index.js';

const RESOURCE_TYPE = 'DNAData';

// Helper to convert Prisma Decimal to number
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

// Response types with decrypted values
interface DNAUploadResponse {
  id: string;
  userId: string;
  filename: string;
  source: string;
  uploadDate: string;
  totalVariants: number;
  validVariants: number;
  processingStatus: string;
  processedAt?: string;
  createdAt: Date;
}

interface DNAVariantResponse {
  id: string;
  dnaDataId: string;
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
}

interface GeneticTraitResponse {
  id: string;
  dnaDataId: string;
  traitName: string;
  category: string;
  rsid: string;
  riskLevel: string;
  description: string;
  recommendations?: string;
  confidence: number;
  citationCount: number;
}

/**
 * Converts Prisma DNAData to response format
 */
function toDNAUploadResponse(data: PrismaDNAData): DNAUploadResponse {
  return {
    id: data.id,
    userId: data.userId,
    filename: data.filename,
    source: data.source,
    uploadDate: data.uploadDate.toISOString(),
    totalVariants: data.totalVariants,
    validVariants: data.validVariants,
    processingStatus: data.processingStatus,
    processedAt: data.processedAt?.toISOString(),
    createdAt: data.createdAt,
  };
}

/**
 * Converts Prisma DNAVariant to response format with decrypted genotype
 */
function toVariantResponse(variant: PrismaDNAVariant, userSalt: string): DNAVariantResponse {
  const encryptionService = getEncryptionService();

  return {
    id: variant.id,
    dnaDataId: variant.dnaDataId,
    rsid: variant.rsid,
    chromosome: variant.chromosome,
    position: variant.position,
    genotype: encryptionService.decrypt(variant.genotypeEncrypted, userSalt),
  };
}

/**
 * Converts Prisma GeneticTrait to response format with decrypted fields
 */
function toTraitResponse(trait: PrismaGeneticTrait, userSalt: string): GeneticTraitResponse {
  const encryptionService = getEncryptionService();

  return {
    id: trait.id,
    dnaDataId: trait.dnaDataId,
    traitName: trait.traitName,
    category: trait.category,
    rsid: trait.rsid,
    riskLevel: trait.riskLevel,
    description: encryptionService.decrypt(trait.descriptionEncrypted, userSalt),
    recommendations: trait.recommendationsEncrypted
      ? encryptionService.decrypt(trait.recommendationsEncrypted, userSalt)
      : undefined,
    confidence: toNumber(trait.confidence),
    citationCount: trait.citationCount,
  };
}

// Get all DNA uploads for user
export async function getDNAUploads(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();

  const uploads = await prisma.dNAData.findMany({
    where: { userId },
    orderBy: { uploadDate: 'desc' },
  });

  // Audit log: READ access to DNA uploads list
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, undefined, { req, userId }, {
    operation: 'LIST',
    count: uploads.length,
  });

  const response: ApiResponse<DNAUploadResponse[]> = {
    success: true,
    data: uploads.map(toDNAUploadResponse),
  };

  res.json(response);
}

// Get single DNA upload
export async function getDNAUpload(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const upload = await prisma.dNAData.findFirst({
    where: { id, userId },
  });

  if (!upload) {
    throw new NotFoundError('DNA upload not found');
  }

  // Audit log: READ access to single DNA upload
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess(RESOURCE_TYPE, id, { req, userId });

  const response: ApiResponse<DNAUploadResponse> = {
    success: true,
    data: toDNAUploadResponse(upload),
  };

  res.json(response);
}

// Get variants for a DNA upload
export async function getDNAVariants(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;
  const { rsid, chromosome, page, limit } = req.query;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Parse pagination using query helper
  const pagination = parsePagination(page, limit, { defaultLimit: 50 });
  const rsidFilter = parseStringParam(rsid);
  const chromosomeFilter = parseStringParam(chromosome);

  // Verify ownership
  const upload = await prisma.dNAData.findFirst({
    where: { id, userId },
  });

  if (!upload) {
    throw new NotFoundError('DNA upload not found');
  }

  // Build where clause
  const where: {
    dnaDataId: string;
    rsid?: { contains: string; mode: 'insensitive' };
    chromosome?: string;
  } = { dnaDataId: id };

  if (rsidFilter) {
    where.rsid = { contains: rsidFilter, mode: 'insensitive' };
  }
  if (chromosomeFilter) {
    where.chromosome = chromosomeFilter;
  }

  // Get total count
  const total = await prisma.dNAVariant.count({ where });

  // Get paginated variants
  const variants = await prisma.dNAVariant.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
    orderBy: [{ chromosome: 'asc' }, { position: 'asc' }],
  });

  const decryptedVariants = variants.map((v) => toVariantResponse(v, userSalt));

  // Audit log: READ access to DNA variants
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess('DNAVariant', id, { req, userId }, {
    count: variants.length,
    total,
  });

  const response: ApiResponse<DNAVariantResponse[]> = {
    success: true,
    data: decryptedVariants,
    meta: createPaginationMeta(total, pagination),
  };

  res.json(response);
}

// Get genetic traits for a DNA upload
export async function getGeneticTraits(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Verify ownership
  const upload = await prisma.dNAData.findFirst({
    where: { id, userId },
  });

  if (!upload) {
    throw new NotFoundError('DNA upload not found');
  }

  const traits = await prisma.geneticTrait.findMany({
    where: { dnaDataId: id },
    orderBy: [{ riskLevel: 'asc' }, { category: 'asc' }],
  });

  const decryptedTraits = traits.map((t) => toTraitResponse(t, userSalt));

  // Audit log: READ access to genetic traits
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess('GeneticTrait', id, { req, userId }, {
    count: traits.length,
  });

  const response: ApiResponse<GeneticTraitResponse[]> = {
    success: true,
    data: decryptedTraits,
  };

  res.json(response);
}

// Extended response type for upload with parsing results
interface DNAUploadResultResponse extends DNAUploadResponse {
  parsingResult?: {
    source: string;
    totalLines: number;
    validVariants: number;
    invalidLines: number;
    processingTimeMs: number;
    errors: string[];
    warnings: string[];
  };
  traitSummary?: {
    total: number;
    byRisk: Record<string, number>;
    byCategory: Record<string, number>;
    highPriorityCount: number;
  };
}

// Upload DNA file
export async function uploadDNA(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  // Type-safe file access using type guard
  const file: MulterFile | undefined = getFile(req);

  if (!file) {
    throw new BadRequestError('No DNA file uploaded. Please provide a .txt or .csv file.');
  }

  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();
  const userSalt = await getUserEncryptionSalt(userId);

  dnaControllerLogger.info(`Processing DNA file: ${file.originalname}`, { size: file.size });

  // Parse the DNA file
  const parsingResult = await parseDNAFile(file.buffer, file.originalname);

  if (!parsingResult.success || parsingResult.variants.length === 0) {
    throw new BadRequestError(
      `Failed to parse DNA file: ${parsingResult.errors.join(', ') || 'No valid variants found'}`
    );
  }

  // Analyze traits from parsed variants
  const traits = analyzeTraits(parsingResult.variants);
  const traitSummary = getTraitSummary(traits);

  dnaControllerLogger.info(`Parsed variants`, { validVariants: parsingResult.validVariants, traitsCount: traits.length });

  // Create upload record
  const upload = await prisma.dNAData.create({
    data: {
      userId,
      filename: file.originalname,
      source: parsingResult.source,
      totalVariants: parsingResult.totalLines,
      validVariants: parsingResult.validVariants,
      processingStatus: 'PROCESSING',
    },
  });

  try {
    // Store variants in batches for efficiency (PHI encrypted)
    const BATCH_SIZE = 1000;
    const variantBatches = [];

    for (let i = 0; i < parsingResult.variants.length; i += BATCH_SIZE) {
      const batch = parsingResult.variants.slice(i, i + BATCH_SIZE);
      variantBatches.push(batch);
    }

    dnaControllerLogger.debug(`Storing variants in batches`, { variantCount: parsingResult.variants.length, batchCount: variantBatches.length });

    for (let batchIdx = 0; batchIdx < variantBatches.length; batchIdx++) {
      const batch = variantBatches[batchIdx];
      await prisma.dNAVariant.createMany({
        data: batch.map(v => ({
          dnaDataId: upload.id,
          rsid: v.rsid,
          chromosome: v.chromosome,
          position: v.position,
          genotypeEncrypted: encryptionService.encrypt(v.genotype, userSalt),
        })),
      });

      if ((batchIdx + 1) % 10 === 0) {
        dnaControllerLogger.debug(`Stored batch progress`, { batch: batchIdx + 1, total: variantBatches.length });
      }
    }

    // Store genetic traits (PHI encrypted) - PERFORMANCE: Use createMany for O(1) instead of O(n)
    dnaControllerLogger.debug(`Storing genetic traits`, { count: traits.length });

    if (traits.length > 0) {
      const traitData = traits.map(trait => ({
        dnaDataId: upload.id,
        traitName: trait.traitName,
        category: trait.category,
        rsid: trait.rsid,
        riskLevel: trait.riskLevel,
        descriptionEncrypted: encryptionService.encrypt(trait.description, userSalt),
        recommendationsEncrypted: encryptionService.encrypt(trait.recommendations, userSalt),
        confidence: trait.confidence,
        citationCount: trait.citationCount,
      }));

      await prisma.geneticTrait.createMany({
        data: traitData,
      });
    }

    // Update status to completed
    await prisma.dNAData.update({
      where: { id: upload.id },
      data: {
        processingStatus: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    // Audit log: CREATE DNA upload with parsing results
    const auditService = getAuditLogService(prisma);
    await auditService.logCreate(RESOURCE_TYPE, upload.id, {
      filename: upload.filename,
      source: upload.source,
      validVariants: parsingResult.validVariants,
      traitsIdentified: traits.length,
      highRiskTraits: traitSummary.byRisk['HIGH'] || 0,
    }, { req, userId });

    // Build response
    const responseData: DNAUploadResultResponse = {
      ...toDNAUploadResponse({
        ...upload,
        processingStatus: 'COMPLETED',
        processedAt: new Date(),
      }),
      parsingResult: {
        source: parsingResult.source,
        totalLines: parsingResult.totalLines,
        validVariants: parsingResult.validVariants,
        invalidLines: parsingResult.invalidLines,
        processingTimeMs: parsingResult.processingTimeMs,
        errors: parsingResult.errors,
        warnings: parsingResult.warnings,
      },
      traitSummary: {
        total: traitSummary.total,
        byRisk: traitSummary.byRisk,
        byCategory: traitSummary.byCategory,
        highPriorityCount: traitSummary.highPriority.length,
      },
    };

    const response: ApiResponse<DNAUploadResultResponse> = {
      success: true,
      data: responseData,
    };

    res.status(201).json(response);

  } catch (error) {
    // Mark as failed on error
    await prisma.dNAData.update({
      where: { id: upload.id },
      data: { processingStatus: 'FAILED' },
    });

    dnaControllerLogger.error(`Failed to process DNA file`, { error: error instanceof Error ? error.message : 'Unknown error' });
    throw error;
  }
}

// Process DNA file (called by background job or manually)
export async function processDNAFile(
  uploadId: string,
  variants: { rsid: string; chromosome: string; position: number; genotype: string }[],
  traits: {
    traitName: string;
    category: string;
    rsid: string;
    riskLevel: string;
    description: string;
    recommendations?: string;
    confidence: number;
    citationCount: number;
  }[]
): Promise<void> {
  const prisma = getPrismaClient();
  const encryptionService = getEncryptionService();

  // Get upload to find userId
  const upload = await prisma.dNAData.findUnique({
    where: { id: uploadId },
  });

  if (!upload) {
    throw new NotFoundError('DNA upload not found');
  }

  const userSalt = await getUserEncryptionSalt(upload.userId);

  // Update status to processing
  await prisma.dNAData.update({
    where: { id: uploadId },
    data: { processingStatus: 'PROCESSING' },
  });

  try {
    // Create variants with encrypted genotype
    for (const variant of variants) {
      await prisma.dNAVariant.create({
        data: {
          dnaDataId: uploadId,
          rsid: variant.rsid,
          chromosome: variant.chromosome,
          position: variant.position,
          genotypeEncrypted: encryptionService.encrypt(variant.genotype, userSalt),
        },
      });
    }

    // Create traits with encrypted fields
    for (const trait of traits) {
      await prisma.geneticTrait.create({
        data: {
          dnaDataId: uploadId,
          traitName: trait.traitName,
          category: trait.category,
          rsid: trait.rsid,
          riskLevel: trait.riskLevel as 'HIGH' | 'MODERATE' | 'LOW' | 'PROTECTIVE' | 'UNKNOWN',
          descriptionEncrypted: encryptionService.encrypt(trait.description, userSalt),
          recommendationsEncrypted: trait.recommendations
            ? encryptionService.encrypt(trait.recommendations, userSalt)
            : null,
          confidence: trait.confidence,
          citationCount: trait.citationCount,
        },
      });
    }

    // Update upload with final stats
    await prisma.dNAData.update({
      where: { id: uploadId },
      data: {
        totalVariants: variants.length,
        validVariants: variants.length,
        processingStatus: 'COMPLETED',
        processedAt: new Date(),
      },
    });
  } catch (error) {
    // Mark as failed on error
    await prisma.dNAData.update({
      where: { id: uploadId },
      data: { processingStatus: 'FAILED' },
    });
    throw error;
  }
}

// Delete DNA upload
export async function deleteDNAUpload(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  const prisma = getPrismaClient();

  const upload = await prisma.dNAData.findFirst({
    where: { id, userId },
  });

  if (!upload) {
    throw new NotFoundError('DNA upload not found');
  }

  // Audit log: DELETE DNA upload (log before deletion)
  const auditService = getAuditLogService(prisma);
  await auditService.logDelete(RESOURCE_TYPE, id, {
    filename: upload.filename,
    source: upload.source,
  }, { req, userId });

  // Delete upload (variants and traits will cascade delete)
  await prisma.dNAData.delete({
    where: { id },
  });

  const response: ApiResponse = {
    success: true,
  };

  res.json(response);
}

// Search variants by rsid
export async function searchVariants(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { rsid } = req.query;

  if (!rsid || typeof rsid !== 'string') {
    const response: ApiResponse<DNAVariantResponse[]> = {
      success: true,
      data: [],
    };
    res.json(response);
    return;
  }

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Get user's DNA uploads
  const uploads = await prisma.dNAData.findMany({
    where: { userId },
    select: { id: true },
  });

  const uploadIds = uploads.map((u) => u.id);

  // Search variants across all user's uploads
  const variants = await prisma.dNAVariant.findMany({
    where: {
      dnaDataId: { in: uploadIds },
      rsid: { contains: rsid, mode: 'insensitive' },
    },
    take: 100,
  });

  const decryptedVariants = variants.map((v) => toVariantResponse(v, userSalt));

  // Audit log: READ access to variant search
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess('DNAVariant', 'SEARCH', { req, userId }, {
    searchTerm: rsid,
    count: variants.length,
  });

  const response: ApiResponse<DNAVariantResponse[]> = {
    success: true,
    data: decryptedVariants,
  };

  res.json(response);
}

// Get traits by category
export async function getTraitsByCategory(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { category } = req.params;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Get user's DNA uploads
  const uploads = await prisma.dNAData.findMany({
    where: { userId },
    select: { id: true },
  });

  const uploadIds = uploads.map((u) => u.id);

  // Get traits by category
  const traits = await prisma.geneticTrait.findMany({
    where: {
      dnaDataId: { in: uploadIds },
      category: { equals: category, mode: 'insensitive' },
    },
    orderBy: { riskLevel: 'asc' },
  });

  const decryptedTraits = traits.map((t) => toTraitResponse(t, userSalt));

  // Audit log: READ access to traits by category
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess('GeneticTrait', 'CATEGORY', { req, userId }, {
    category,
    count: traits.length,
  });

  const response: ApiResponse<GeneticTraitResponse[]> = {
    success: true,
    data: decryptedTraits,
  };

  res.json(response);
}

// Get high risk traits across all uploads
export async function getHighRiskTraits(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const prisma = getPrismaClient();
  const userSalt = await getUserEncryptionSalt(userId);

  // Get user's DNA uploads
  const uploads = await prisma.dNAData.findMany({
    where: { userId },
    select: { id: true },
  });

  const uploadIds = uploads.map((u) => u.id);

  // Get high and moderate risk traits
  const traits = await prisma.geneticTrait.findMany({
    where: {
      dnaDataId: { in: uploadIds },
      riskLevel: { in: ['HIGH', 'MODERATE'] },
    },
    orderBy: [{ riskLevel: 'asc' }, { confidence: 'desc' }],
  });

  const decryptedTraits = traits.map((t) => toTraitResponse(t, userSalt));

  // Audit log: READ access to high risk traits
  const auditService = getAuditLogService(prisma);
  await auditService.logAccess('GeneticTrait', 'HIGH_RISK', { req, userId }, {
    count: traits.length,
  });

  const response: ApiResponse<GeneticTraitResponse[]> = {
    success: true,
    data: decryptedTraits,
  };

  res.json(response);
}
