/**
 * labUploadController unit tests (P1-6 — first coverage for the lab-report
 * PHI ingestion path: PDF/image upload → extraction → GCS + encrypted rows).
 *
 * Extraction quality is ocrService's problem (mocked here); these tests pin
 * the controller's own contract:
 *   - L24: the raw client filename is stored ENCRYPTED with the plaintext
 *     twin column explicitly null — the core PHI-at-rest invariant of this
 *     controller.
 *   - Zero-biomarker uploads fail with an audited PARSE_FAILED and never
 *     touch GCS or the database.
 *   - A GCS outage is non-fatal: biomarkers still persist, only the file
 *     record is skipped.
 *   - M8/M25: a rolled-back transaction deletes the just-uploaded GCS object
 *     (no orphaned PHI in the bucket).
 *   - Out-of-range biomarkers trigger the notification path with the right
 *     high/low classification.
 *   - The OCR route accepts images and hard-rejects a fake "PDF" without
 *     the %PDF magic bytes.
 *
 * shared.js (validateUploadFile / createBiomarkersFromOCRResult /
 * withGcsOrphanCleanup) is deliberately REAL so the tests exercise the same
 * plumbing production runs; only external I/O modules are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  createMockAuditService,
  createMockEncryptionService,
} from '../testHelpers.js';
import type { Response } from 'express';

// shared.ts → services/pdfParser.ts → pdf-parse has a module-load side effect
// (opens a debug fixture). Stub it exactly like shared.test.ts does.
vi.mock('pdf-parse', () => ({ default: vi.fn() }));

const mocks = vi.hoisted(() => ({
  tx: null as unknown,
  auditService: null as unknown,
  encryptionService: null as unknown,
  processDocument: null as unknown,
  uploadFile: null as unknown,
  deleteFile: null as unknown,
  notifyNewResults: null as unknown,
  notifyOutOfRange: null as unknown,
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

vi.mock('../../services/ocrService.js', () => ({
  processDocument: vi.fn((...args: unknown[]) =>
    (mocks.processDocument as ReturnType<typeof vi.fn>)(...args)
  ),
  extractDateFromText: vi.fn(() => null),
  extractLabNameFromText: vi.fn(() => null),
}));

vi.mock('../../services/storageService.js', () => ({
  uploadFile: vi.fn((...args: unknown[]) => (mocks.uploadFile as ReturnType<typeof vi.fn>)(...args)),
  deleteFile: vi.fn((...args: unknown[]) => (mocks.deleteFile as ReturnType<typeof vi.fn>)(...args)),
  deleteFiles: vi.fn(),
  getFileStream: vi.fn(),
}));

vi.mock('../../services/notificationService.js', () => ({
  notifyNewResults: vi.fn((...args: unknown[]) =>
    (mocks.notifyNewResults as ReturnType<typeof vi.fn>)(...args)
  ),
  notifyOutOfRange: vi.fn((...args: unknown[]) =>
    (mocks.notifyOutOfRange as ReturnType<typeof vi.fn>)(...args)
  ),
}));

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
import { uploadLabReport, uploadLabResultOCR } from './labUploadController.js';
import { LAB_REPORT_RESOURCE, LAB_OCR_RESOURCE, type UploadRequest } from './shared.js';
import { withRLSTransaction } from '../../services/database.js';

// -- Fixtures ---------------------------------------------------------------

const PDF_MAGIC = Buffer.from('%PDF-1.4 fake body');
const PNG_MAGIC = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake png body'),
]);

function makeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'Jane Doe 1990-01-01 labs.pdf', // deliberately PHI-bearing
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

function makeUploadRequest(file: Express.Multer.File): UploadRequest {
  return createMockRequest({ file }) as unknown as UploadRequest;
}

function makeOcrResult(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Glucose 95 mg/dL\nLDL Cholesterol 160 mg/dL',
    biomarkers: [
      { name: 'Glucose', value: 95, unit: 'mg/dL', category: 'Metabolic', confidence: 0.98, normalRange: { min: 70, max: 100 } },
      { name: 'LDL Cholesterol', value: 160, unit: 'mg/dL', category: 'Lipids', confidence: 0.97, normalRange: { min: 0, max: 130 } },
    ],
    confidence: 0.98,
    pageCount: 2,
    metadata: {
      processorType: 'claude-api',
      processingTimeMs: 1200,
      labDate: '2026-01-15T00:00:00.000Z',
      labName: 'Quest Diagnostics',
    },
    ...overrides,
  };
}

/** Minimal tx: PRO plan (no biomarker cap), recording creates. */
function makeTx() {
  const createdBiomarkers: Array<Record<string, unknown>> = [];
  const createdFiles: Array<Record<string, unknown>> = [];
  return {
    createdBiomarkers,
    createdFiles,
    tx: {
      user: { findUnique: vi.fn(async () => ({ plan: 'PRO', planExpiresAt: null })) },
      biomarker: {
        count: vi.fn(async () => 0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `bm-${createdBiomarkers.length}`, ...data };
          createdBiomarkers.push(row);
          return row;
        }),
      },
      userFile: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data };
          createdFiles.push(row);
          return row;
        }),
      },
    },
  };
}

describe('labUploadController', () => {
  let auditService: ReturnType<typeof createMockAuditService>;
  let txHarness: ReturnType<typeof makeTx>;
  let res: Response;

  beforeEach(() => {
    auditService = createMockAuditService();
    mocks.auditService = auditService;
    mocks.encryptionService = createMockEncryptionService();
    txHarness = makeTx();
    mocks.tx = txHarness.tx;
    mocks.processDocument = vi.fn(async () => makeOcrResult());
    mocks.uploadFile = vi.fn(async (userId: string, fileId: string) => `${userId}/${fileId}.pdf`);
    mocks.deleteFile = vi.fn(async () => undefined);
    mocks.notifyNewResults = vi.fn(async () => undefined);
    mocks.notifyOutOfRange = vi.fn(async () => undefined);
    res = createMockResponse();
    vi.mocked(withRLSTransaction).mockClear();
  });

  describe('uploadLabReport (Claude extraction path)', () => {
    it('persists biomarkers + file record and returns 201 with the response shape', async () => {
      await uploadLabReport(makeUploadRequest(makeMulterFile()), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const payload = vi.mocked(res.json).mock.calls[0][0] as {
        success: boolean;
        data: Record<string, unknown>;
      };
      expect(payload.success).toBe(true);
      expect(payload.data.biomarkersCreated).toBe(2);
      expect(payload.data.labName).toBe('Quest Diagnostics');
      expect(payload.data.file).toBeDefined();

      expect(mocks.uploadFile).toHaveBeenCalledWith(
        'test-user-id',
        expect.any(String),
        expect.any(Buffer),
        'application/pdf'
      );
      expect(auditService.logCreate).toHaveBeenCalledWith(
        LAB_REPORT_RESOURCE,
        'BATCH',
        expect.objectContaining({ biomarkersExtracted: 2 }),
        expect.anything()
      );
    });

    it('L24: stores the client filename ENCRYPTED and keeps the plaintext twin null', async () => {
      await uploadLabReport(makeUploadRequest(makeMulterFile()), res);

      expect(txHarness.createdFiles).toHaveLength(1);
      const fileRow = txHarness.createdFiles[0];
      expect(fileRow).not.toHaveProperty('originalFilename'); // column dropped (OF-03)
      // createMockEncryptionService tags with `enc:` — proves the value went
      // through encrypt() and the raw name is not what got stored.
      expect(fileRow.originalFilenameEncrypted).toBe('enc:Jane Doe 1990-01-01 labs.pdf');
      // The non-PHI display label must not embed the client filename either.
      expect(fileRow.filename).not.toContain('Jane Doe');
    });

    it('rejects a zero-biomarker extraction with an audited PARSE_FAILED and touches neither GCS nor the DB', async () => {
      mocks.processDocument = vi.fn(async () => makeOcrResult({ biomarkers: [] }));

      await expect(uploadLabReport(makeUploadRequest(makeMulterFile()), res)).rejects.toThrow(
        /Could not extract any biomarkers/
      );

      expect(auditService.logAccess).toHaveBeenCalledWith(
        LAB_REPORT_RESOURCE,
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'PARSE_FAILED' }),
      );
      expect(mocks.uploadFile).not.toHaveBeenCalled();
      expect(withRLSTransaction).not.toHaveBeenCalled();
    });

    it('a GCS outage is non-fatal: biomarkers persist, only the file record is skipped', async () => {
      mocks.uploadFile = vi.fn(async () => {
        throw new Error('GCS unavailable');
      });

      await uploadLabReport(makeUploadRequest(makeMulterFile()), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const payload = vi.mocked(res.json).mock.calls[0][0] as { data: Record<string, unknown> };
      expect(payload.data.biomarkersCreated).toBe(2);
      expect(payload.data.file).toBeUndefined();
      expect(txHarness.tx.userFile.create).not.toHaveBeenCalled();
      expect(txHarness.createdBiomarkers).toHaveLength(2);
    });

    it('M8/M25: a rolled-back transaction deletes the just-uploaded GCS object and rethrows', async () => {
      const boom = new Error('userFile insert failed');
      txHarness.tx.userFile.create.mockRejectedValueOnce(boom);

      await expect(uploadLabReport(makeUploadRequest(makeMulterFile()), res)).rejects.toBe(boom);

      expect(mocks.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^test-user-id\//));
      expect(res.status).not.toHaveBeenCalled();
    });

    it('classifies out-of-range biomarkers and fires both notifications', async () => {
      await uploadLabReport(makeUploadRequest(makeMulterFile()), res);

      expect(mocks.notifyNewResults).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ biomarkerCount: 2, outOfRangeCount: 1 })
      );
      expect(mocks.notifyOutOfRange).toHaveBeenCalledWith('test-user-id', {
        biomarkers: [{ name: 'LDL Cholesterol', status: 'high' }],
      });
    });

    it('hard-rejects a spoofed PDF (pdf mimetype without %PDF magic bytes) before any processing', async () => {
      const spoofed = makeMulterFile({ buffer: Buffer.from('MZ not a pdf'), size: 12 });

      await expect(uploadLabReport(makeUploadRequest(spoofed), res)).rejects.toThrow();

      expect(mocks.processDocument).not.toHaveBeenCalled();
      expect(mocks.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('uploadLabResultOCR (Document AI path)', () => {
    it('accepts a PNG image, persists rows, and returns 201 with OCR metadata', async () => {
      const png = makeMulterFile({
        originalname: 'scan.png',
        mimetype: 'image/png',
        buffer: PNG_MAGIC,
        size: PNG_MAGIC.length,
      });

      await uploadLabResultOCR(makeUploadRequest(png), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const payload = vi.mocked(res.json).mock.calls[0][0] as { data: Record<string, unknown> };
      expect(payload.data.biomarkersCreated).toBe(2);
      expect(payload.data.ocrMetadata).toEqual(
        expect.objectContaining({ pageCount: 2, processingTimeMs: 1200 })
      );

      // Same L24 invariant on the OCR path.
      const fileRow = txHarness.createdFiles[0];
      expect(fileRow).not.toHaveProperty('originalFilename'); // column dropped (OF-03)
      expect(fileRow.originalFilenameEncrypted).toBe('enc:scan.png');

      expect(auditService.logCreate).toHaveBeenCalledWith(
        LAB_OCR_RESOURCE,
        'BATCH',
        expect.objectContaining({ mimeType: 'image/png' }),
        expect.anything()
      );
    });

    it('rejects a zero-biomarker OCR with an audited OCR_PARSE_FAILED', async () => {
      mocks.processDocument = vi.fn(async () => makeOcrResult({ biomarkers: [] }));
      const png = makeMulterFile({
        originalname: 'scan.png',
        mimetype: 'image/png',
        buffer: PNG_MAGIC,
        size: PNG_MAGIC.length,
      });

      await expect(uploadLabResultOCR(makeUploadRequest(png), res)).rejects.toThrow(
        /Could not extract any biomarkers/
      );

      expect(auditService.logAccess).toHaveBeenCalledWith(
        LAB_OCR_RESOURCE,
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'OCR_PARSE_FAILED' }),
      );
      expect(withRLSTransaction).not.toHaveBeenCalled();
    });

    it('the OCR route also header-checks PDFs (PDF-bomb guard applies to both uploaders)', async () => {
      const spoofed = makeMulterFile({ buffer: Buffer.from('MZ not a pdf'), size: 12 });

      await expect(uploadLabResultOCR(makeUploadRequest(spoofed), res)).rejects.toThrow();

      expect(mocks.processDocument).not.toHaveBeenCalled();
    });
  });
});
