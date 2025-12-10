/**
 * Biomarker Controller Unit Tests
 *
 * Tests for the biomarker CRUD operations including:
 * - Create biomarker (valid data, invalid data, out-of-range calculation)
 * - Get biomarkers (pagination, filtering by category)
 * - Update biomarker (ownership check, out-of-range recalculation)
 * - Delete biomarker (ownership check, cascade to history)
 * - Batch create (partial success handling)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { createMockPrismaClient, type MockPrismaClient } from '../mocks/prisma';
import {
  TEST_USER_ID,
  TEST_USER_SALT,
  OTHER_USER_ID,
  biomarkerCreateInputs,
  mockBiomarkerRecords,
  mockHistoryRecords,
  biomarkerUpdateInputs,
  bulkBiomarkerInputs,
  CATEGORIES,
} from '../fixtures/biomarkers';

// Mock the database service
let mockPrisma: MockPrismaClient;

vi.mock('../../services/database.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

// Mock the encryption service
const mockEncrypt = vi.fn((value: string) => `encrypted:${value}`);
const mockDecrypt = vi.fn((value: string) => value.replace('encrypted:', ''));

vi.mock('../../services/encryption.js', () => ({
  getEncryptionService: () => ({
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
    generateUserSalt: () => TEST_USER_SALT,
  }),
}));

// Mock user encryption service
vi.mock('../../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn().mockResolvedValue(TEST_USER_SALT),
}));

// Mock audit log service
const mockAuditLog = {
  logAccess: vi.fn().mockResolvedValue(undefined),
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../services/auditLog.js', () => ({
  getAuditLogService: () => mockAuditLog,
}));

// Import controllers after mocking
import * as biomarkerController from '../../controllers/biomarkerController.js';

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: TEST_USER_ID, email: 'test@example.com', role: 'PATIENT' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

// Helper to create mock response
function createMockResponse(): Response & {
  jsonData: unknown;
  statusCode: number;
} {
  const res: Partial<Response> & { jsonData: unknown; statusCode: number } = {
    jsonData: null,
    statusCode: 200,
    json: vi.fn(function(this: typeof res, data: unknown) {
      this.jsonData = data;
      return this as Response;
    }),
    status: vi.fn(function(this: typeof res, code: number) {
      this.statusCode = code;
      return this as Response;
    }),
  };
  return res as Response & { jsonData: unknown; statusCode: number };
}

describe('BiomarkerController', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();

    // Setup default decrypt behavior
    mockDecrypt.mockImplementation((value: string) => {
      if (value.startsWith('encrypted:')) return value.replace('encrypted:', '');
      if (value.includes('encrypted-')) return value.replace('encrypted-', '');
      return value;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // GET /biomarkers - List biomarkers
  // ============================================
  describe('getBiomarkers', () => {
    it('should return paginated biomarkers for user', async () => {
      const biomarkers = [mockBiomarkerRecords.glucose, mockBiomarkerRecords.ldl];
      mockPrisma.biomarker.count.mockResolvedValue(2);
      mockPrisma.biomarker.findMany.mockResolvedValue(
        biomarkers.map(b => ({ ...b, history: [] }))
      );

      const req = createMockRequest({ query: { page: '1', limit: '10' } });
      const res = createMockResponse();

      await biomarkerController.getBiomarkers(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.any(Array),
        pagination: expect.objectContaining({
          total: 2,
          page: 1,
          limit: 10,
        }),
      });
      expect(mockAuditLog.logAccess).toHaveBeenCalledWith(
        'Biomarker',
        undefined,
        expect.any(Object),
        expect.objectContaining({ operation: 'LIST' })
      );
    });

    it('should filter by category', async () => {
      mockPrisma.biomarker.count.mockResolvedValue(1);
      mockPrisma.biomarker.findMany.mockResolvedValue([
        { ...mockBiomarkerRecords.glucose, history: [] },
      ]);

      const req = createMockRequest({
        query: { category: CATEGORIES.METABOLIC }
      });
      const res = createMockResponse();

      await biomarkerController.getBiomarkers(req as any, res);

      expect(mockPrisma.biomarker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: TEST_USER_ID,
            category: CATEGORIES.METABOLIC,
          }),
        })
      );
    });

    it('should return empty array when user has no biomarkers', async () => {
      mockPrisma.biomarker.count.mockResolvedValue(0);
      mockPrisma.biomarker.findMany.mockResolvedValue([]);

      const req = createMockRequest();
      const res = createMockResponse();

      await biomarkerController.getBiomarkers(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: [],
        pagination: expect.objectContaining({ total: 0 }),
      });
    });

    it('should use default pagination when not provided', async () => {
      mockPrisma.biomarker.count.mockResolvedValue(0);
      mockPrisma.biomarker.findMany.mockResolvedValue([]);

      const req = createMockRequest();
      const res = createMockResponse();

      await biomarkerController.getBiomarkers(req as any, res);

      expect(mockPrisma.biomarker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20, // Default limit
        })
      );
    });
  });

  // ============================================
  // GET /biomarkers/:id - Get single biomarker
  // ============================================
  describe('getBiomarker', () => {
    it('should return biomarker with decrypted values', async () => {
      const biomarker = { ...mockBiomarkerRecords.glucose, history: mockHistoryRecords };
      mockPrisma.biomarker.findFirst.mockResolvedValue(biomarker);

      const req = createMockRequest({ params: { id: biomarker.id } });
      const res = createMockResponse();

      await biomarkerController.getBiomarker(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.objectContaining({
          id: biomarker.id,
          name: 'Glucose',
          category: CATEGORIES.METABOLIC,
        }),
      });
      expect(mockDecrypt).toHaveBeenCalled(); // Value was decrypted
    });

    it('should throw NotFoundError for non-existent biomarker', async () => {
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({ params: { id: 'non-existent' } });
      const res = createMockResponse();

      await expect(
        biomarkerController.getBiomarker(req as any, res)
      ).rejects.toThrow('not found');
    });

    it('should not return biomarker belonging to another user', async () => {
      // Simulate Prisma not finding due to userId filter
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: mockBiomarkerRecords.otherUserBiomarker.id }
      });
      const res = createMockResponse();

      await expect(
        biomarkerController.getBiomarker(req as any, res)
      ).rejects.toThrow('not found');
    });

    it('should log access to audit log', async () => {
      const biomarker = { ...mockBiomarkerRecords.glucose, history: [] };
      mockPrisma.biomarker.findFirst.mockResolvedValue(biomarker);

      const req = createMockRequest({ params: { id: biomarker.id } });
      const res = createMockResponse();

      await biomarkerController.getBiomarker(req as any, res);

      expect(mockAuditLog.logAccess).toHaveBeenCalledWith(
        'Biomarker',
        biomarker.id,
        expect.objectContaining({ req, userId: TEST_USER_ID })
      );
    });
  });

  // ============================================
  // POST /biomarkers - Create biomarker
  // ============================================
  describe('createBiomarker', () => {
    it('should create biomarker with encrypted values', async () => {
      const input = biomarkerCreateInputs.valid;
      const createdBiomarker = {
        id: 'new-biomarker-id',
        userId: TEST_USER_ID,
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted: `encrypted:${input.value}`,
        notesEncrypted: `encrypted:${input.notes}`,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: input.normalRange.source,
        measurementDate: new Date(input.date),
        sourceType: input.sourceType,
        sourceFile: null,
        extractionConfidence: null,
        labName: input.labName,
        isOutOfRange: false,
        isAcknowledged: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      };

      mockPrisma.biomarker.create.mockResolvedValue(createdBiomarker);

      const req = createMockRequest({ body: input });
      const res = createMockResponse();

      await biomarkerController.createBiomarker(req as any, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.objectContaining({
          id: 'new-biomarker-id',
          name: input.name,
        }),
      });
      expect(mockEncrypt).toHaveBeenCalledWith(String(input.value), TEST_USER_SALT);
      expect(mockEncrypt).toHaveBeenCalledWith(input.notes, TEST_USER_SALT);
    });

    it('should calculate isOutOfRange correctly - in range', async () => {
      const input = biomarkerCreateInputs.inRange;
      mockPrisma.biomarker.create.mockResolvedValue({
        id: 'new-id',
        userId: TEST_USER_ID,
        ...input,
        valueEncrypted: `encrypted:${input.value}`,
        notesEncrypted: null,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: null,
        measurementDate: new Date(input.date),
        sourceType: 'MANUAL',
        sourceFile: null,
        extractionConfidence: null,
        labName: null,
        isOutOfRange: false,
        isAcknowledged: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      });

      const req = createMockRequest({ body: input });
      const res = createMockResponse();

      await biomarkerController.createBiomarker(req as any, res);

      expect(mockPrisma.biomarker.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isOutOfRange: false,
          }),
        })
      );
    });

    it('should calculate isOutOfRange correctly - out of range', async () => {
      const input = biomarkerCreateInputs.outOfRange;
      mockPrisma.biomarker.create.mockResolvedValue({
        id: 'new-id',
        userId: TEST_USER_ID,
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted: `encrypted:${input.value}`,
        notesEncrypted: null,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: null,
        measurementDate: new Date(input.date),
        sourceType: 'MANUAL',
        sourceFile: null,
        extractionConfidence: null,
        labName: null,
        isOutOfRange: true,
        isAcknowledged: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      });

      const req = createMockRequest({ body: input });
      const res = createMockResponse();

      await biomarkerController.createBiomarker(req as any, res);

      expect(mockPrisma.biomarker.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isOutOfRange: true,
          }),
        })
      );
    });

    it('should create biomarker without notes', async () => {
      const input = biomarkerCreateInputs.minimal;
      mockPrisma.biomarker.create.mockResolvedValue({
        id: 'new-id',
        userId: TEST_USER_ID,
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted: `encrypted:${input.value}`,
        notesEncrypted: null,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: null,
        measurementDate: new Date(input.date),
        sourceType: 'MANUAL',
        sourceFile: null,
        extractionConfidence: null,
        labName: null,
        isOutOfRange: false,
        isAcknowledged: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      });

      const req = createMockRequest({ body: input });
      const res = createMockResponse();

      await biomarkerController.createBiomarker(req as any, res);

      expect(mockPrisma.biomarker.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notesEncrypted: null,
          }),
        })
      );
    });

    it('should log creation to audit log', async () => {
      const input = biomarkerCreateInputs.valid;
      mockPrisma.biomarker.create.mockResolvedValue({
        id: 'new-biomarker-id',
        userId: TEST_USER_ID,
        category: input.category,
        name: input.name,
        unit: input.unit,
        valueEncrypted: `encrypted:${input.value}`,
        notesEncrypted: `encrypted:${input.notes}`,
        normalRangeMin: input.normalRange.min,
        normalRangeMax: input.normalRange.max,
        normalRangeSource: input.normalRange.source,
        measurementDate: new Date(input.date),
        sourceType: input.sourceType,
        sourceFile: null,
        extractionConfidence: null,
        labName: input.labName,
        isOutOfRange: false,
        isAcknowledged: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      });

      const req = createMockRequest({ body: input });
      const res = createMockResponse();

      await biomarkerController.createBiomarker(req as any, res);

      expect(mockAuditLog.logCreate).toHaveBeenCalledWith(
        'Biomarker',
        'new-biomarker-id',
        expect.objectContaining({
          name: input.name,
          category: input.category,
          value: input.value,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================
  // PUT /biomarkers/:id - Update biomarker
  // ============================================
  describe('updateBiomarker', () => {
    it('should update biomarker value and re-encrypt', async () => {
      const existing = { ...mockBiomarkerRecords.glucose };
      const input = biomarkerUpdateInputs.valueOnly;

      mockPrisma.biomarker.findFirst.mockResolvedValue(existing);
      mockPrisma.biomarkerHistory.create.mockResolvedValue({} as any);
      mockPrisma.biomarker.update.mockResolvedValue({
        ...existing,
        valueEncrypted: `encrypted:${input.value}`,
        history: [],
      });

      const req = createMockRequest({
        params: { id: existing.id },
        body: input,
      });
      const res = createMockResponse();

      await biomarkerController.updateBiomarker(req as any, res);

      expect(mockEncrypt).toHaveBeenCalledWith(String(input.value), TEST_USER_SALT);
      expect(res.jsonData).toMatchObject({ success: true });
    });

    it('should save old value to history when value changes', async () => {
      const existing = { ...mockBiomarkerRecords.glucose };
      const input = biomarkerUpdateInputs.valueOnly;

      mockPrisma.biomarker.findFirst.mockResolvedValue(existing);
      mockPrisma.biomarkerHistory.create.mockResolvedValue({} as any);
      mockPrisma.biomarker.update.mockResolvedValue({
        ...existing,
        valueEncrypted: `encrypted:${input.value}`,
        history: [],
      });

      const req = createMockRequest({
        params: { id: existing.id },
        body: input,
      });
      const res = createMockResponse();

      await biomarkerController.updateBiomarker(req as any, res);

      expect(mockPrisma.biomarkerHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          biomarkerId: existing.id,
          valueEncrypted: existing.valueEncrypted,
        }),
      });
    });

    it('should recalculate isOutOfRange when value changes', async () => {
      const existing = { ...mockBiomarkerRecords.glucose, isOutOfRange: false };
      const input = biomarkerUpdateInputs.triggersOutOfRange;

      mockDecrypt.mockReturnValueOnce('95'); // Original value
      mockPrisma.biomarker.findFirst.mockResolvedValue(existing);
      mockPrisma.biomarkerHistory.create.mockResolvedValue({} as any);
      mockPrisma.biomarker.update.mockResolvedValue({
        ...existing,
        isOutOfRange: true,
        history: [],
      });

      const req = createMockRequest({
        params: { id: existing.id },
        body: input,
      });
      const res = createMockResponse();

      await biomarkerController.updateBiomarker(req as any, res);

      expect(mockPrisma.biomarker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isOutOfRange: true,
          }),
        })
      );
    });

    it('should recalculate isOutOfRange when range changes', async () => {
      const existing = { ...mockBiomarkerRecords.glucose, isOutOfRange: false };
      mockDecrypt.mockReturnValueOnce('95'); // Decrypt for comparison
      mockDecrypt.mockReturnValueOnce('95'); // Decrypt for recalculation

      mockPrisma.biomarker.findFirst.mockResolvedValue(existing);
      mockPrisma.biomarker.update.mockResolvedValue({
        ...existing,
        normalRangeMin: 100,
        normalRangeMax: 120,
        isOutOfRange: true, // 95 is now below min
        history: [],
      });

      const req = createMockRequest({
        params: { id: existing.id },
        body: { normalRange: { min: 100, max: 120 } },
      });
      const res = createMockResponse();

      await biomarkerController.updateBiomarker(req as any, res);

      expect(mockPrisma.biomarker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isOutOfRange: true,
          }),
        })
      );
    });

    it('should throw NotFoundError when updating non-existent biomarker', async () => {
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: 'non-existent' },
        body: biomarkerUpdateInputs.valueOnly,
      });
      const res = createMockResponse();

      await expect(
        biomarkerController.updateBiomarker(req as any, res)
      ).rejects.toThrow('not found');
    });

    it('should not update biomarker belonging to another user (ownership check)', async () => {
      // findFirst with userId filter returns null for other user's biomarker
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: mockBiomarkerRecords.otherUserBiomarker.id },
        body: biomarkerUpdateInputs.valueOnly,
      });
      const res = createMockResponse();

      await expect(
        biomarkerController.updateBiomarker(req as any, res)
      ).rejects.toThrow('not found');
    });

    it('should log update to audit log', async () => {
      const existing = { ...mockBiomarkerRecords.glucose };
      const input = biomarkerUpdateInputs.valueOnly;

      mockPrisma.biomarker.findFirst.mockResolvedValue(existing);
      mockPrisma.biomarkerHistory.create.mockResolvedValue({} as any);
      mockPrisma.biomarker.update.mockResolvedValue({
        ...existing,
        history: [],
      });

      const req = createMockRequest({
        params: { id: existing.id },
        body: input,
      });
      const res = createMockResponse();

      await biomarkerController.updateBiomarker(req as any, res);

      expect(mockAuditLog.logUpdate).toHaveBeenCalledWith(
        'Biomarker',
        existing.id,
        expect.any(Object), // previousValue
        expect.any(Object), // newValue
        expect.any(Object)  // context
      );
    });
  });

  // ============================================
  // DELETE /biomarkers/:id - Delete biomarker
  // ============================================
  describe('deleteBiomarker', () => {
    it('should delete biomarker', async () => {
      const biomarker = mockBiomarkerRecords.glucose;
      mockPrisma.biomarker.findFirst.mockResolvedValue(biomarker);
      mockPrisma.biomarker.delete.mockResolvedValue(biomarker);

      const req = createMockRequest({ params: { id: biomarker.id } });
      const res = createMockResponse();

      await biomarkerController.deleteBiomarker(req as any, res);

      expect(mockPrisma.biomarker.delete).toHaveBeenCalledWith({
        where: { id: biomarker.id },
      });
      expect(res.jsonData).toMatchObject({ success: true });
    });

    it('should throw NotFoundError for non-existent biomarker', async () => {
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({ params: { id: 'non-existent' } });
      const res = createMockResponse();

      await expect(
        biomarkerController.deleteBiomarker(req as any, res)
      ).rejects.toThrow('not found');
    });

    it('should not delete biomarker belonging to another user (ownership check)', async () => {
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: mockBiomarkerRecords.otherUserBiomarker.id },
      });
      const res = createMockResponse();

      await expect(
        biomarkerController.deleteBiomarker(req as any, res)
      ).rejects.toThrow('not found');

      expect(mockPrisma.biomarker.delete).not.toHaveBeenCalled();
    });

    it('should log deletion to audit log before deleting', async () => {
      const biomarker = mockBiomarkerRecords.glucose;
      mockPrisma.biomarker.findFirst.mockResolvedValue(biomarker);
      mockPrisma.biomarker.delete.mockResolvedValue(biomarker);

      const req = createMockRequest({ params: { id: biomarker.id } });
      const res = createMockResponse();

      await biomarkerController.deleteBiomarker(req as any, res);

      expect(mockAuditLog.logDelete).toHaveBeenCalledWith(
        'Biomarker',
        biomarker.id,
        expect.objectContaining({
          name: biomarker.name,
          category: biomarker.category,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================
  // POST /biomarkers/bulk - Bulk create biomarkers
  // ============================================
  describe('bulkCreateBiomarkers', () => {
    it('should create all valid biomarkers successfully', async () => {
      const inputs = bulkBiomarkerInputs.allValid;

      mockPrisma.biomarker.createMany.mockResolvedValue({ count: inputs.length });
      mockPrisma.biomarker.findMany.mockResolvedValue(
        inputs.map((input, i) => ({
          id: `bulk-id-${i}`,
          userId: TEST_USER_ID,
          category: input.category,
          name: input.name,
          unit: input.unit,
          valueEncrypted: `encrypted:${input.value}`,
          notesEncrypted: null,
          normalRangeMin: input.normalRange.min,
          normalRangeMax: input.normalRange.max,
          normalRangeSource: null,
          measurementDate: new Date(input.date),
          sourceType: 'MANUAL',
          sourceFile: null,
          extractionConfidence: null,
          labName: null,
          isOutOfRange: false,
          isAcknowledged: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          history: [],
        }))
      );

      const req = createMockRequest({ body: { biomarkers: inputs } });
      const res = createMockResponse();

      await biomarkerController.bulkCreateBiomarkers(req as any, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.any(Array),
        meta: {
          total: inputs.length,
          succeeded: inputs.length,
          failed: 0,
        },
      });
    });

    it('should handle partial success (207 Multi-Status)', async () => {
      const inputs = bulkBiomarkerInputs.mixedValid;
      const validCount = 2; // First and third are valid

      mockPrisma.biomarker.createMany.mockResolvedValue({ count: validCount });
      mockPrisma.biomarker.findMany.mockResolvedValue([
        {
          id: 'bulk-id-0',
          userId: TEST_USER_ID,
          category: inputs[0].category!,
          name: inputs[0].name!,
          unit: inputs[0].unit!,
          valueEncrypted: `encrypted:${inputs[0].value}`,
          notesEncrypted: null,
          normalRangeMin: inputs[0].normalRange!.min,
          normalRangeMax: inputs[0].normalRange!.max,
          normalRangeSource: null,
          measurementDate: new Date(inputs[0].date!),
          sourceType: 'MANUAL',
          sourceFile: null,
          extractionConfidence: null,
          labName: null,
          isOutOfRange: false,
          isAcknowledged: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          history: [],
        },
        {
          id: 'bulk-id-2',
          userId: TEST_USER_ID,
          category: inputs[2].category!,
          name: inputs[2].name!,
          unit: inputs[2].unit!,
          valueEncrypted: `encrypted:${inputs[2].value}`,
          notesEncrypted: null,
          normalRangeMin: inputs[2].normalRange!.min,
          normalRangeMax: inputs[2].normalRange!.max,
          normalRangeSource: null,
          measurementDate: new Date(inputs[2].date!),
          sourceType: 'MANUAL',
          sourceFile: null,
          extractionConfidence: null,
          labName: null,
          isOutOfRange: false,
          isAcknowledged: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          history: [],
        },
      ]);

      const req = createMockRequest({ body: { biomarkers: inputs } });
      const res = createMockResponse();

      await biomarkerController.bulkCreateBiomarkers(req as any, res);

      expect(res.statusCode).toBe(207);
      expect(res.jsonData).toMatchObject({
        success: false,
        meta: expect.objectContaining({
          total: inputs.length,
          succeeded: validCount,
          failed: 1,
        }),
      });
    });

    it('should return 400 when all biomarkers fail validation', async () => {
      const inputs = bulkBiomarkerInputs.allInvalid;

      const req = createMockRequest({ body: { biomarkers: inputs } });
      const res = createMockResponse();

      await biomarkerController.bulkCreateBiomarkers(req as any, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData).toMatchObject({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
        }),
        meta: expect.objectContaining({
          total: inputs.length,
          succeeded: 0,
          failed: inputs.length,
        }),
      });
      expect(mockPrisma.biomarker.createMany).not.toHaveBeenCalled();
    });

    it('should log bulk creation to audit log', async () => {
      const inputs = bulkBiomarkerInputs.allValid;

      mockPrisma.biomarker.createMany.mockResolvedValue({ count: inputs.length });
      mockPrisma.biomarker.findMany.mockResolvedValue(
        inputs.map((input, i) => ({
          id: `bulk-id-${i}`,
          userId: TEST_USER_ID,
          category: input.category,
          name: input.name,
          unit: input.unit,
          valueEncrypted: `encrypted:${input.value}`,
          notesEncrypted: null,
          normalRangeMin: input.normalRange.min,
          normalRangeMax: input.normalRange.max,
          normalRangeSource: null,
          measurementDate: new Date(input.date),
          sourceType: 'MANUAL',
          sourceFile: null,
          extractionConfidence: null,
          labName: null,
          isOutOfRange: false,
          isAcknowledged: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          history: [],
        }))
      );

      const req = createMockRequest({ body: { biomarkers: inputs } });
      const res = createMockResponse();

      await biomarkerController.bulkCreateBiomarkers(req as any, res);

      expect(mockAuditLog.logCreate).toHaveBeenCalledWith(
        'Biomarker',
        'BULK',
        expect.objectContaining({
          count: inputs.length,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================
  // GET /biomarkers/categories - Get categories
  // ============================================
  describe('getCategories', () => {
    it('should return unique categories for user', async () => {
      mockPrisma.biomarker.findMany.mockResolvedValue([
        { category: CATEGORIES.METABOLIC },
        { category: CATEGORIES.LIPID },
        { category: CATEGORIES.VITAMIN },
      ]);

      const req = createMockRequest();
      const res = createMockResponse();

      await biomarkerController.getCategories(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: [CATEGORIES.METABOLIC, CATEGORIES.LIPID, CATEGORIES.VITAMIN],
      });
    });

    it('should return empty array when user has no biomarkers', async () => {
      mockPrisma.biomarker.findMany.mockResolvedValue([]);

      const req = createMockRequest();
      const res = createMockResponse();

      await biomarkerController.getCategories(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: [],
      });
    });
  });

  // ============================================
  // GET /biomarkers/summary - Get summary stats
  // ============================================
  describe('getSummary', () => {
    it('should return summary statistics', async () => {
      mockPrisma.biomarker.findMany.mockResolvedValue([
        { id: '1', category: CATEGORIES.METABOLIC, isOutOfRange: false, isAcknowledged: false, updatedAt: new Date() },
        { id: '2', category: CATEGORIES.METABOLIC, isOutOfRange: true, isAcknowledged: false, updatedAt: new Date() },
        { id: '3', category: CATEGORIES.LIPID, isOutOfRange: false, isAcknowledged: true, updatedAt: new Date() },
      ]);

      const req = createMockRequest();
      const res = createMockResponse();

      await biomarkerController.getSummary(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.objectContaining({
          totalBiomarkers: 3,
          inRangeCount: 2,
          outOfRangeCount: 1,
          acknowledgedCount: 1,
          byCategory: expect.any(Array),
        }),
      });
    });
  });

  // ============================================
  // GET /biomarkers/:id/history - Get history
  // ============================================
  describe('getHistory', () => {
    it('should return biomarker history with decrypted values', async () => {
      const biomarker = {
        ...mockBiomarkerRecords.glucose,
        history: mockHistoryRecords,
      };
      mockPrisma.biomarker.findFirst.mockResolvedValue(biomarker);

      const req = createMockRequest({ params: { id: biomarker.id } });
      const res = createMockResponse();

      await biomarkerController.getHistory(req as any, res);

      expect(res.jsonData).toMatchObject({
        success: true,
        data: expect.objectContaining({
          biomarkerId: biomarker.id,
          name: biomarker.name,
          history: expect.any(Array),
        }),
      });
      expect(mockDecrypt).toHaveBeenCalled();
    });

    it('should throw NotFoundError for non-existent biomarker', async () => {
      mockPrisma.biomarker.findFirst.mockResolvedValue(null);

      const req = createMockRequest({ params: { id: 'non-existent' } });
      const res = createMockResponse();

      await expect(
        biomarkerController.getHistory(req as any, res)
      ).rejects.toThrow('not found');
    });
  });
});
