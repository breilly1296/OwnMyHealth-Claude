/**
 * sbcUploadController unit tests (P1-6 — coverage for the insurance SBC
 * ingestion path: PDF upload → Claude/regex extraction → plan + benefits).
 *
 * Extraction quality is extractSBCData's problem (mocked); shared.js stays
 * otherwise REAL (validateUploadFile, mappers, withGcsOrphanCleanup). Pins:
 *   - L24: the raw client filename is stored encrypted with the plaintext
 *     twin null on the SBC path too.
 *   - Empty extractions fail with an audited PARSE_FAILED / REANALYZE_FAILED
 *     and never create rows.
 *   - L32: an unparseable extracted effectiveDate falls back to a valid
 *     Date instead of poisoning the Prisma write.
 *   - M8/M25: a rolled-back transaction deletes the uploaded GCS object.
 *   - reanalyzePlan enforces ownership BEFORE extraction and preserves
 *     user-entered fields (member/group ids, tracking, isActive/isPrimary)
 *     while replacing extracted coverage + benefits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  createMockAuditService,
  createMockEncryptionService,
} from '../testHelpers.js';
import type { Response } from 'express';

// shared.ts → services/pdfParser.ts → pdf-parse module-load side effect.
vi.mock('pdf-parse', () => ({ default: vi.fn() }));

const mocks = vi.hoisted(() => ({
  tx: null as unknown,
  auditService: null as unknown,
  encryptionService: null as unknown,
  extractSBCData: null as unknown,
  uploadFile: null as unknown,
  deleteFile: null as unknown,
}));

vi.mock('../../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
}));

vi.mock('../../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => mocks.encryptionService),
}));

vi.mock('../../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../../services/storageService.js', () => ({
  uploadFile: vi.fn((...args: unknown[]) => (mocks.uploadFile as ReturnType<typeof vi.fn>)(...args)),
  deleteFile: vi.fn((...args: unknown[]) => (mocks.deleteFile as ReturnType<typeof vi.fn>)(...args)),
  deleteFiles: vi.fn(),
  getFileStream: vi.fn(),
}));

// Keep shared.js REAL except the extraction entry point (Claude + regex
// fallback orchestration, exercised by its own service tests).
vi.mock('./shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shared.js')>();
  return {
    ...actual,
    extractSBCData: vi.fn((...args: unknown[]) =>
      (mocks.extractSBCData as ReturnType<typeof vi.fn>)(...args)
    ),
  };
});

vi.mock('../../utils/logger.js', () => {
  const serviceLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startup: vi.fn(),
    createServiceLogger: serviceLogger,
  };
  return {
    logger,
    default: logger,
    pdfLogger: serviceLogger(),
    authLogger: serviceLogger(),
    encryptionLogger: serviceLogger(),
  };
});

// -- Imports AFTER mocks --------------------------------------------------
import { uploadSBC, reanalyzePlan } from './sbcUploadController.js';
import { SBC_RESOURCE, type UploadRequest } from './shared.js';
import { withRLSTransaction } from '../../services/database.js';

// -- Fixtures ---------------------------------------------------------------

const PDF_MAGIC = Buffer.from('%PDF-1.4 fake sbc body');

function makeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'Doe Family 2026 SBC.pdf', // deliberately PHI-adjacent
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: PDF_MAGIC.length,
    buffer: PDF_MAGIC,
    destination: '',
    filename: '',
    path: '',
    stream: null as unknown as NodeJS.ReadableStream,
    ...overrides,
  };
}

function makeUploadRequest(
  file: Express.Multer.File,
  params: Record<string, string> = {}
): UploadRequest {
  return createMockRequest({ file, params }) as unknown as UploadRequest;
}

function makeExtracted(overrides: Record<string, unknown> = {}) {
  return {
    planName: 'Gold PPO 1500',
    insurerName: 'Acme Health',
    planType: 'PPO',
    planIdNumber: 'GP-1500',
    effectiveDate: '2026-01-01',
    deductibleIndividual: 1500,
    oopMaxIndividual: 8000,
    coinsuranceRate: 20,
    benefits: [
      {
        serviceName: 'Office Visit',
        serviceCategory: 'Primary',
        inNetworkCovered: true,
        inNetworkCopay: 30,
        inNetworkDeductibleApplies: true,
        outNetworkCovered: false,
        outNetworkDeductibleApplies: true,
        preAuthRequired: false,
      },
    ],
    extractionConfidence: 0.9,
    usedClaudeExtraction: true,
    ...overrides,
  };
}

function makeExistingPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    userId: 'test-user-id',
    planName: 'Old Plan',
    insurerName: 'Old Insurer',
    planType: 'HMO',
    planIdNumber: 'OLD-1',
    memberIdEncrypted: 'enc:member-123',
    groupIdEncrypted: 'enc:group-456',
    effectiveDate: new Date('2025-01-01T00:00:00Z'),
    terminationDate: null,
    premiumMonthly: 450,
    deductibleIndividual: 1000,
    deductibleFamily: 2000,
    oopMaxIndividual: 5000,
    oopMaxFamily: 10000,
    deductibleMetIndividual: 250,
    deductibleMetFamily: 250,
    oopMetIndividual: 300,
    oopMetFamily: 300,
    isActive: true,
    isPrimary: true,
    extractedFromSbc: true,
    sbcExtractionConfidence: 0.8,
    coinsuranceRate: 10,
    copayPrimaryCare: 20,
    copaySpecialist: 40,
    copayUrgentCare: 50,
    copayEmergency: 250,
    benefits: [{ id: 'ben-old' }],
    ...overrides,
  };
}

function makeTx() {
  const createdFiles: Array<Record<string, unknown>> = [];
  const tx = {
    userFile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdFiles.push(data);
        return data;
      }),
    },
    insurancePlan: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const benefits = (data.benefits as { create?: unknown[] } | undefined)?.create ?? [];
        return { id: 'plan-new', ...data, benefits, extractedFromSbc: true, sbcExtractionConfidence: 0.9 };
      }),
      findFirst: vi.fn(async () => makeExistingPlan()),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const benefits = (data.benefits as { create?: unknown[] } | undefined)?.create ?? [];
        return { ...makeExistingPlan(), ...data, benefits };
      }),
    },
    insuranceBenefit: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
  return { tx, createdFiles };
}

describe('sbcUploadController', () => {
  let auditService: ReturnType<typeof createMockAuditService>;
  let txHarness: ReturnType<typeof makeTx>;
  let res: Response;

  beforeEach(() => {
    auditService = createMockAuditService();
    mocks.auditService = auditService;
    mocks.encryptionService = createMockEncryptionService();
    txHarness = makeTx();
    mocks.tx = txHarness.tx;
    mocks.extractSBCData = vi.fn(async () => makeExtracted());
    mocks.uploadFile = vi.fn(async (userId: string, fileId: string) => `${userId}/${fileId}.pdf`);
    mocks.deleteFile = vi.fn(async () => undefined);
    res = createMockResponse();
    vi.mocked(withRLSTransaction).mockClear();
  });

  describe('uploadSBC', () => {
    it('creates the plan + benefits and returns 201 with the extracted shape', async () => {
      await uploadSBC(makeUploadRequest(makeMulterFile()), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = vi.mocked(res.json).mock.calls[0][0] as { data: Record<string, unknown> };
      expect(body.data.planName).toBe('Gold PPO 1500');
      expect(body.data.insurerName).toBe('Acme Health');
      expect(body.data.deductibleIndividual).toBe(1500);
      // Family figures default to 2× individual when the SBC omits them.
      expect(body.data.deductibleFamily).toBe(3000);
      expect(body.data.oopMaxFamily).toBe(16000);

      const planData = txHarness.tx.insurancePlan.create.mock.calls[0][0].data as Record<string, unknown>;
      expect((planData.benefits as { create: unknown[] }).create).toHaveLength(1);
      // Member/group ids are user-entered — never fabricated from extraction.
      expect(planData.memberIdEncrypted).toBeNull();
      expect(planData.groupIdEncrypted).toBeNull();

      expect(auditService.logCreate).toHaveBeenCalledWith(
        SBC_RESOURCE,
        'plan-new',
        expect.objectContaining({ benefitsExtracted: 1, usedClaudeExtraction: true }),
        expect.anything()
      );
    });

    it('L24: stores the client filename ENCRYPTED with the plaintext twin null', async () => {
      await uploadSBC(makeUploadRequest(makeMulterFile()), res);

      expect(txHarness.createdFiles).toHaveLength(1);
      const fileRow = txHarness.createdFiles[0];
      expect(fileRow.originalFilename).toBeNull();
      expect(fileRow.originalFilenameEncrypted).toBe('enc:Doe Family 2026 SBC.pdf');
      expect(fileRow.filename).not.toContain('Doe Family');
    });

    it('rejects an empty extraction with an audited PARSE_FAILED and touches neither GCS nor the DB', async () => {
      mocks.extractSBCData = vi.fn(async () =>
        makeExtracted({ planName: undefined, insurerName: undefined, benefits: [] })
      );

      await expect(uploadSBC(makeUploadRequest(makeMulterFile()), res)).rejects.toThrow(
        /Could not extract insurance plan information/
      );

      expect(auditService.logAccess).toHaveBeenCalledWith(
        SBC_RESOURCE,
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'PARSE_FAILED' })
      );
      expect(mocks.uploadFile).not.toHaveBeenCalled();
      expect(withRLSTransaction).not.toHaveBeenCalled();
    });

    it('L32: an unparseable extracted effectiveDate falls back to a valid Date', async () => {
      mocks.extractSBCData = vi.fn(async () => makeExtracted({ effectiveDate: 'sometime next year' }));

      await uploadSBC(makeUploadRequest(makeMulterFile()), res);

      const planData = txHarness.tx.insurancePlan.create.mock.calls[0][0].data as { effectiveDate: Date };
      expect(planData.effectiveDate).toBeInstanceOf(Date);
      expect(Number.isNaN(planData.effectiveDate.getTime())).toBe(false);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('a GCS outage is non-fatal: the plan is still created, only the file record is skipped', async () => {
      mocks.uploadFile = vi.fn(async () => {
        throw new Error('GCS unavailable');
      });

      await uploadSBC(makeUploadRequest(makeMulterFile()), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = vi.mocked(res.json).mock.calls[0][0] as { data: Record<string, unknown> };
      expect(body.data.file).toBeUndefined();
      expect(txHarness.tx.userFile.create).not.toHaveBeenCalled();
      expect(txHarness.tx.insurancePlan.create).toHaveBeenCalled();
    });

    it('M8/M25: a rolled-back transaction deletes the just-uploaded GCS object and rethrows', async () => {
      const boom = new Error('plan insert failed');
      txHarness.tx.insurancePlan.create.mockRejectedValueOnce(boom);

      await expect(uploadSBC(makeUploadRequest(makeMulterFile()), res)).rejects.toBe(boom);

      expect(mocks.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^test-user-id\//));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('reanalyzePlan', () => {
    const request = () => makeUploadRequest(makeMulterFile(), { id: 'plan-1' });

    it('enforces ownership BEFORE extraction: a foreign plan id 404s with no Claude call', async () => {
      txHarness.tx.insurancePlan.findFirst.mockResolvedValue(null);

      await expect(reanalyzePlan(request(), res)).rejects.toThrow(/Insurance plan not found/);

      expect(txHarness.tx.insurancePlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan-1', userId: 'test-user-id' } })
      );
      expect(mocks.extractSBCData).not.toHaveBeenCalled();
    });

    it('replaces extracted coverage + benefits while PRESERVING user-entered fields', async () => {
      await reanalyzePlan(request(), res);

      // Old benefits wiped, new ones created.
      expect(txHarness.tx.insuranceBenefit.deleteMany).toHaveBeenCalledWith({
        where: { planId: 'plan-1' },
      });
      const updateArg = txHarness.tx.insurancePlan.update.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(updateArg.where).toEqual({ id: 'plan-1' });
      expect((updateArg.data.benefits as { create: unknown[] }).create).toHaveLength(1);
      expect(updateArg.data.planName).toBe('Gold PPO 1500');

      // User-entered fields must be ABSENT from the update payload so the
      // existing values survive: member/group ids, tracking, active/primary.
      for (const preserved of [
        'memberIdEncrypted',
        'groupIdEncrypted',
        'deductibleMetIndividual',
        'deductibleMetFamily',
        'oopMetIndividual',
        'oopMetFamily',
        'isActive',
        'isPrimary',
      ]) {
        expect(updateArg.data).not.toHaveProperty(preserved);
      }
    });

    it('audits the reanalysis with before/after benefit counts', async () => {
      await reanalyzePlan(request(), res);

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        SBC_RESOURCE,
        'plan-1',
        expect.objectContaining({ previousBenefitsCount: 1 }),
        expect.objectContaining({ benefitsExtracted: 1 }),
        expect.anything(),
        expect.objectContaining({ operation: 'REANALYZE' })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects an empty re-extraction with an audited REANALYZE_FAILED and leaves the plan untouched', async () => {
      mocks.extractSBCData = vi.fn(async () =>
        makeExtracted({ planName: undefined, insurerName: undefined, benefits: [] })
      );

      await expect(reanalyzePlan(request(), res)).rejects.toThrow(
        /Could not extract insurance plan information/
      );

      expect(auditService.logAccess).toHaveBeenCalledWith(
        SBC_RESOURCE,
        'plan-1',
        expect.anything(),
        expect.objectContaining({ operation: 'REANALYZE_FAILED' })
      );
      expect(txHarness.tx.insurancePlan.update).not.toHaveBeenCalled();
      expect(txHarness.tx.insuranceBenefit.deleteMany).not.toHaveBeenCalled();
    });
  });
});
