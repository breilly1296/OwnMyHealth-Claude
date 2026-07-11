/**
 * fileController unit tests (P1-6 — coverage for the GCS PHI-file CRUD +
 * download-proxy path).
 *
 * Pins the controller's contract:
 *   - L24 read path: originalFilename is decrypted (real
 *     decryptOriginalFilename) for the owner's own list/detail/download.
 *   - Ownership scoping: every lookup queries by (id, userId); a foreign id
 *     404s.
 *   - Download proxy: the EXPORT audit row is written BEFORE the stream
 *     starts (the disclosure is recorded even if the client aborts),
 *     Content-Disposition is injection-sanitized, and Cache-Control is
 *     no-store so intermediaries can't retain PHI.
 *   - F-22 delete ordering: the GCS object is deleted FIRST; a GCS failure
 *     aborts the DB deletion so PHI is never orphaned in the bucket with no
 *     DB pointer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockAuditService,
  createMockEncryptionService,
} from './testHelpers.js';
import type { Response } from 'express';

const mocks = vi.hoisted(() => ({
  tx: null as unknown,
  auditService: null as unknown,
  encryptionService: null as unknown,
  getFileStream: null as unknown,
  deleteFile: null as unknown,
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => mocks.encryptionService),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../services/storageService.js', () => ({
  getFileStream: vi.fn((...args: unknown[]) =>
    (mocks.getFileStream as ReturnType<typeof vi.fn>)(...args)
  ),
  deleteFile: vi.fn((...args: unknown[]) =>
    (mocks.deleteFile as ReturnType<typeof vi.fn>)(...args)
  ),
  uploadFile: vi.fn(),
  deleteFiles: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startup: vi.fn(),
    createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// decryptOriginalFilename is deliberately REAL — the L24 read-path tests must
// prove the controller wires decryption (mock encryption strips the enc: tag).

// -- Imports AFTER mocks --------------------------------------------------
import { getFiles, getFile, getFileDownloadUrl, deleteFile } from './fileController.js';
import { NotFoundError } from '../middleware/errorHandler.js';

function makeResponse() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.headersSent = false;
  return res as unknown as Response;
}

function makeDbFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    filename: 'Quest Diagnostics - 1/15/2026',
    originalFilename: null,
    originalFilenameEncrypted: 'enc:jane-doe-labs.pdf', // mock decrypt → jane-doe-labs.pdf
    fileType: 'application/pdf',
    fileSize: 1234,
    storageKey: 'test-user-id/file-1.pdf',
    labName: 'Quest Diagnostics',
    labDate: new Date('2026-01-15T00:00:00Z'),
    biomarkersExtracted: 2,
    extractionConfidence: 0.98,
    createdAt: new Date('2026-01-16T00:00:00Z'),
    biomarkers: [{ category: 'Lipids' }, { category: 'Lipids' }, { category: 'Metabolic' }],
    ...overrides,
  };
}

describe('fileController', () => {
  let auditService: ReturnType<typeof createMockAuditService>;
  let res: Response;
  let fakeStream: { on: ReturnType<typeof vi.fn>; pipe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = createMockAuditService();
    mocks.auditService = auditService;
    mocks.encryptionService = createMockEncryptionService();
    mocks.tx = {
      userFile: {
        findMany: vi.fn(async () => [makeDbFile()]),
        findFirst: vi.fn(async () => makeDbFile()),
        count: vi.fn(async () => 1),
        delete: vi.fn(async () => undefined),
      },
      biomarker: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    fakeStream = { on: vi.fn(), pipe: vi.fn() };
    mocks.getFileStream = vi.fn(() => fakeStream);
    mocks.deleteFile = vi.fn(async () => undefined);
    res = makeResponse();
  });

  const tx = () => mocks.tx as {
    userFile: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    biomarker: { updateMany: ReturnType<typeof vi.fn> };
  };

  describe('getFiles', () => {
    it('returns decrypted originalFilename (L24 read path), deduped categories, and audits the LIST', async () => {
      await getFiles(createMockRequest(), res);

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        data: Array<Record<string, unknown>>;
        pagination: Record<string, unknown>;
      };
      expect(body.data[0].originalFilename).toBe('jane-doe-labs.pdf');
      expect(body.data[0].categories).toEqual(['Lipids', 'Metabolic']);
      expect(body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });

      expect(auditService.logAccess).toHaveBeenCalledWith(
        'UserFile',
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'LIST', count: 1, total: 1 })
      );
    });

    it('falls back to the legacy plaintext filename for a pre-backfill row', async () => {
      tx().userFile.findMany.mockResolvedValue([
        makeDbFile({ originalFilenameEncrypted: null, originalFilename: 'legacy-plain.pdf' }),
      ]);

      await getFiles(createMockRequest(), res);

      const body = vi.mocked(res.json).mock.calls[0][0] as { data: Array<Record<string, unknown>> };
      expect(body.data[0].originalFilename).toBe('legacy-plain.pdf');
    });

    it('clamps the requested page size to 100', async () => {
      await getFiles(createMockRequest({ query: { page: '2', limit: '5000' } }), res);

      expect(tx().userFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 })
      );
    });
  });

  describe('getFile', () => {
    it('scopes the lookup by (id, userId) and 404s on a foreign id', async () => {
      tx().userFile.findFirst.mockResolvedValue(null);

      await expect(
        getFile(createMockRequest({ params: { id: 'not-mine' } }), res)
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(tx().userFile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'not-mine', userId: 'test-user-id' } })
      );
      expect(auditService.logAccess).not.toHaveBeenCalled();
    });

    it('returns the decrypted metadata and audits the READ with the file id', async () => {
      await getFile(createMockRequest({ params: { id: 'file-1' } }), res);

      const body = vi.mocked(res.json).mock.calls[0][0] as { data: Record<string, unknown> };
      expect(body.data.originalFilename).toBe('jane-doe-labs.pdf');
      expect(auditService.logAccess).toHaveBeenCalledWith('UserFile', 'file-1', expect.anything());
    });
  });

  describe('getFileDownloadUrl (audited proxy stream)', () => {
    it('writes the EXPORT audit row BEFORE the stream starts', async () => {
      await getFileDownloadUrl(createMockRequest({ params: { id: 'file-1' } }), res);

      expect(auditService.logExport).toHaveBeenCalledWith(
        'UserFile',
        ['file-1'],
        'FILE_DOWNLOAD',
        expect.anything(),
        expect.anything()
      );
      const auditOrder = auditService.logExport.mock.invocationCallOrder[0];
      const streamOrder = (mocks.getFileStream as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      expect(auditOrder).toBeLessThan(streamOrder);
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('sets no-store caching and a sanitized Content-Disposition with the decrypted name', async () => {
      await getFileDownloadUrl(createMockRequest({ params: { id: 'file-1' } }), res);

      const headers = vi.mocked(res.set).mock.calls[0][0] as Record<string, string>;
      expect(headers['Cache-Control']).toContain('no-store');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['Content-Disposition']).toContain('filename="jane-doe-labs.pdf"');
    });

    it('neutralizes header-injection characters in the filename', async () => {
      tx().userFile.findFirst.mockResolvedValue(
        makeDbFile({
          originalFilenameEncrypted: 'enc:evil"\r\nSet-Cookie: pwned=1;.pdf',
        })
      );

      await getFileDownloadUrl(createMockRequest({ params: { id: 'file-1' } }), res);

      const headers = vi.mocked(res.set).mock.calls[0][0] as Record<string, string>;
      const disposition = headers['Content-Disposition'];
      // The quoted ASCII token must carry no raw quote/CR/LF; the RFC 5987
      // starred value percent-encodes them.
      const quotedToken = disposition.match(/filename="([^"]*)"/)?.[1] ?? '';
      expect(quotedToken).not.toMatch(/["\r\n]/);
      expect(disposition).not.toMatch(/\r|\n/);
    });

    it('404s a foreign id without auditing or opening a stream', async () => {
      tx().userFile.findFirst.mockResolvedValue(null);

      await expect(
        getFileDownloadUrl(createMockRequest({ params: { id: 'not-mine' } }), res)
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(auditService.logExport).not.toHaveBeenCalled();
      expect(mocks.getFileStream).not.toHaveBeenCalled();
    });
  });

  describe('deleteFile (F-22 orphan-PHI protection)', () => {
    it('deletes the GCS object FIRST, then audits, unlinks biomarkers, and deletes the row', async () => {
      await deleteFile(createMockRequest({ params: { id: 'file-1' } }), res);

      expect(mocks.deleteFile).toHaveBeenCalledWith('test-user-id/file-1.pdf');
      const gcsOrder = (mocks.deleteFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const dbOrder = tx().userFile.delete.mock.invocationCallOrder[0];
      expect(gcsOrder).toBeLessThan(dbOrder);

      expect(auditService.logDelete).toHaveBeenCalledWith(
        'UserFile',
        'file-1',
        expect.anything(),
        expect.anything()
      );
      expect(tx().biomarker.updateMany).toHaveBeenCalledWith({
        where: { userFileId: 'file-1' },
        data: { userFileId: null },
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('aborts the DB deletion when the GCS delete fails (keeps the pointer for a clean retry)', async () => {
      const gcsBoom = new Error('GCS 503');
      mocks.deleteFile = vi.fn(async () => {
        throw gcsBoom;
      });

      await expect(
        deleteFile(createMockRequest({ params: { id: 'file-1' } }), res)
      ).rejects.toBe(gcsBoom);

      expect(tx().userFile.delete).not.toHaveBeenCalled();
      expect(tx().biomarker.updateMany).not.toHaveBeenCalled();
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('404s a foreign id without touching storage', async () => {
      tx().userFile.findFirst.mockResolvedValue(null);

      await expect(
        deleteFile(createMockRequest({ params: { id: 'not-mine' } }), res)
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mocks.deleteFile).not.toHaveBeenCalled();
    });
  });
});
