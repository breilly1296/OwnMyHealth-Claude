/**
 * Audit Log Service Tests
 *
 * Tests that audit logs are created for PHI access:
 * - READ operations are logged
 * - CREATE operations are logged
 * - UPDATE operations are logged
 * - DELETE operations are logged
 * - Audit values are encrypted
 * - IP address and user agent are captured
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request } from 'express';
import crypto from 'crypto';

// Set up test encryption key before imports
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.PHI_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

// Mock Prisma
const mockPrismaCreate = vi.fn();
const mockPrismaFindUnique = vi.fn();
const mockPrismaFindMany = vi.fn();
const mockPrismaCount = vi.fn();
const mockPrismaDeleteMany = vi.fn();

const mockPrisma = {
  auditLog: {
    create: mockPrismaCreate,
    findMany: mockPrismaFindMany,
    count: mockPrismaCount,
    deleteMany: mockPrismaDeleteMany,
  },
  systemConfig: {
    findUnique: mockPrismaFindUnique,
    create: vi.fn(),
  },
};

// Import after setting up mocks
import { AuditLogService } from '../../services/auditLog.js';

describe('AuditLogService', () => {
  let auditService: AuditLogService;
  const testUserId = 'test-user-123';
  const testResourceId = 'resource-456';
  const systemSalt = crypto.randomBytes(32).toString('hex');

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock system config to return existing salt
    mockPrismaFindUnique.mockResolvedValue({
      key: 'audit_encryption_salt',
      value: systemSalt,
    });

    auditService = new AuditLogService(mockPrisma as any);
    await auditService.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create mock request
  function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
      ip: '192.168.1.100',
      socket: { remoteAddress: '192.168.1.100' },
      get: vi.fn((header: string) => {
        if (header === 'user-agent') return 'Test Browser/1.0';
        if (header === 'x-forwarded-for') return undefined;
        return undefined;
      }),
      ...overrides,
    } as unknown as Request;
  }

  // ============================================
  // Initialization Tests
  // ============================================
  describe('initialize', () => {
    it('should create system salt if not exists', async () => {
      mockPrismaFindUnique.mockResolvedValueOnce(null);
      const newAuditService = new AuditLogService(mockPrisma as any);

      await newAuditService.initialize();

      expect(mockPrisma.systemConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: 'audit_encryption_salt',
        }),
      });
    });

    it('should use existing salt if already configured', async () => {
      mockPrismaFindUnique.mockResolvedValueOnce({
        key: 'audit_encryption_salt',
        value: systemSalt,
      });

      const newAuditService = new AuditLogService(mockPrisma as any);
      await newAuditService.initialize();

      expect(mockPrisma.systemConfig.create).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // PHI Access Logging Tests
  // ============================================
  describe('logAccess', () => {
    it('should log READ access to PHI', async () => {
      const req = createMockRequest();

      await auditService.logAccess(
        'Biomarker',
        testResourceId,
        { req, userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: testUserId,
          actorType: 'USER',
          action: 'READ',
          resourceType: 'Biomarker',
          resourceId: testResourceId,
          ipAddress: '192.168.1.100',
          userAgent: 'Test Browser/1.0',
        }),
      });
    });

    it('should log list operations with metadata', async () => {
      const req = createMockRequest();

      await auditService.logAccess(
        'Biomarker',
        undefined,
        { req, userId: testUserId },
        { operation: 'LIST', count: 10, category: 'Metabolic' }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceId: undefined,
          metadata: expect.stringContaining('LIST'),
        }),
      });
    });

    it('should capture X-Forwarded-For header for proxied requests', async () => {
      const req = createMockRequest({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '10.0.0.1, 192.168.1.1';
          return undefined;
        }),
      });

      await auditService.logAccess(
        'Biomarker',
        testResourceId,
        { req, userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '10.0.0.1', // First IP from X-Forwarded-For
        }),
      });
    });

    it('should use SYSTEM actor type when no user', async () => {
      await auditService.logAccess(
        'Biomarker',
        testResourceId,
        { req: createMockRequest() }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'SYSTEM',
        }),
      });
    });
  });

  // ============================================
  // PHI Create Logging Tests
  // ============================================
  describe('logCreate', () => {
    it('should log CREATE operations with new value encrypted', async () => {
      const newValue = { name: 'Glucose', value: 95 };

      await auditService.logCreate(
        'Biomarker',
        testResourceId,
        newValue,
        { req: createMockRequest(), userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATE',
          resourceType: 'Biomarker',
          resourceId: testResourceId,
          newValueEncrypted: expect.any(String),
        }),
      });

      // Verify the new value is encrypted (not plaintext)
      const createCall = mockPrismaCreate.mock.calls[0][0];
      expect(createCall.data.newValueEncrypted).not.toContain('Glucose');
      expect(createCall.data.newValueEncrypted).not.toContain('95');
    });

    it('should include session ID if provided', async () => {
      await auditService.logCreate(
        'Biomarker',
        testResourceId,
        { value: 100 },
        { req: createMockRequest(), userId: testUserId, sessionId: 'session-abc' }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 'session-abc',
        }),
      });
    });
  });

  // ============================================
  // PHI Update Logging Tests
  // ============================================
  describe('logUpdate', () => {
    it('should log UPDATE operations with both old and new values encrypted', async () => {
      const previousValue = { value: 90 };
      const newValue = { value: 95 };

      await auditService.logUpdate(
        'Biomarker',
        testResourceId,
        previousValue,
        newValue,
        { req: createMockRequest(), userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          previousValueEncrypted: expect.any(String),
          newValueEncrypted: expect.any(String),
        }),
      });

      // Verify values are encrypted
      const createCall = mockPrismaCreate.mock.calls[0][0];
      expect(createCall.data.previousValueEncrypted).not.toContain('90');
      expect(createCall.data.newValueEncrypted).not.toContain('95');
    });
  });

  // ============================================
  // PHI Delete Logging Tests
  // ============================================
  describe('logDelete', () => {
    it('should log DELETE operations with previous value encrypted', async () => {
      const previousValue = { name: 'Glucose', category: 'Metabolic' };

      await auditService.logDelete(
        'Biomarker',
        testResourceId,
        previousValue,
        { req: createMockRequest(), userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELETE',
          previousValueEncrypted: expect.any(String),
        }),
      });
    });
  });

  // ============================================
  // Authentication Event Logging Tests
  // ============================================
  describe('logAuth', () => {
    it('should log LOGIN events', async () => {
      await auditService.logAuth(
        'LOGIN',
        { req: createMockRequest(), userId: testUserId },
        { email: 'user@example.com' }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'LOGIN',
          resourceType: 'Authentication',
          metadata: expect.stringContaining('LOGIN'),
        }),
      });
    });

    it('should log LOGIN_FAILED with ANONYMOUS actor', async () => {
      await auditService.logAuth(
        'LOGIN_FAILED',
        { req: createMockRequest() },
        { reason: 'INVALID_CREDENTIALS' }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'ANONYMOUS',
          action: 'LOGIN',
        }),
      });
    });

    it('should log PASSWORD_CHANGE as UPDATE action', async () => {
      await auditService.logAuth(
        'PASSWORD_CHANGE',
        { req: createMockRequest(), userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          metadata: expect.stringContaining('PASSWORD_CHANGE'),
        }),
      });
    });
  });

  // ============================================
  // Export Logging Tests
  // ============================================
  describe('logExport', () => {
    it('should log EXPORT operations with record IDs', async () => {
      const resourceIds = ['id-1', 'id-2', 'id-3'];

      await auditService.logExport(
        'Biomarker',
        resourceIds,
        'CSV',
        { req: createMockRequest(), userId: testUserId }
      );

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'EXPORT',
          metadata: expect.stringContaining('CSV'),
        }),
      });
    });

    it('should limit stored resource IDs to 100', async () => {
      const resourceIds = Array.from({ length: 150 }, (_, i) => `id-${i}`);

      await auditService.logExport(
        'Biomarker',
        resourceIds,
        'PDF',
        { req: createMockRequest(), userId: testUserId }
      );

      const createCall = mockPrismaCreate.mock.calls[0][0];
      const metadata = JSON.parse(createCall.data.metadata);
      expect(metadata.resourceIds).toHaveLength(100);
    });
  });

  // ============================================
  // System Event Logging Tests
  // ============================================
  describe('logSystem', () => {
    it('should log system events with SYSTEM actor', async () => {
      await auditService.logSystem('DELETE', 'Session', {
        action: 'cleanup',
        deletedCount: 50,
      });

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'SYSTEM',
          action: 'DELETE',
          resourceType: 'Session',
        }),
      });
    });
  });

  // ============================================
  // Query and Retention Tests
  // ============================================
  describe('queryLogs', () => {
    it('should query logs with filters', async () => {
      mockPrismaFindMany.mockResolvedValue([]);
      mockPrismaCount.mockResolvedValue(0);

      const result = await auditService.queryLogs({
        userId: testUserId,
        resourceType: 'Biomarker',
        action: 'READ',
        limit: 50,
      });

      expect(mockPrismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: testUserId,
            resourceType: 'Biomarker',
            action: 'READ',
          }),
          take: 50,
        })
      );
      expect(result).toEqual({ logs: [], total: 0 });
    });

    it('should support date range filtering', async () => {
      mockPrismaFindMany.mockResolvedValue([]);
      mockPrismaCount.mockResolvedValue(0);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await auditService.queryLogs({ startDate, endDate });

      expect(mockPrismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          }),
        })
      );
    });
  });

  describe('cleanupOldLogs', () => {
    it('should delete logs older than retention period', async () => {
      mockPrismaDeleteMany.mockResolvedValue({ count: 100 });

      const deleted = await auditService.cleanupOldLogs();

      expect(mockPrismaDeleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expect.any(Date) },
        },
      });
      expect(deleted).toBe(100);
    });

    it('should log cleanup event', async () => {
      mockPrismaDeleteMany.mockResolvedValue({ count: 50 });

      await auditService.cleanupOldLogs();

      // Should have been called twice: once for cleanup log itself
      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'SYSTEM',
          action: 'DELETE',
          resourceType: 'AuditLog',
        }),
      });
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================
  describe('error handling', () => {
    it('should not throw on logging failure (graceful degradation)', async () => {
      mockPrismaCreate.mockRejectedValueOnce(new Error('DB connection failed'));

      // Should not throw
      await expect(
        auditService.logAccess('Biomarker', testResourceId, {
          req: createMockRequest(),
          userId: testUserId,
        })
      ).resolves.not.toThrow();
    });

    it('should handle encryption failure gracefully', async () => {
      // Create a service instance that will fail to encrypt
      const brokenService = new AuditLogService(mockPrisma as any);
      mockPrismaFindUnique.mockResolvedValueOnce({
        key: 'audit_encryption_salt',
        value: 'invalid-salt', // This may cause issues
      });

      await brokenService.initialize();

      // Should not throw even with bad salt
      await expect(
        brokenService.logCreate('Biomarker', 'id', { value: 100 }, {
          req: createMockRequest(),
          userId: testUserId,
        })
      ).resolves.not.toThrow();
    });
  });

  // ============================================
  // Context Extraction Tests
  // ============================================
  describe('extractContext', () => {
    it('should extract all context from request', () => {
      const req = createMockRequest();
      (req as any).sessionId = 'session-123';
      (req as any).userId = testUserId;

      const context = auditService.extractContext(req);

      expect(context).toMatchObject({
        ipAddress: '192.168.1.100',
        userAgent: 'Test Browser/1.0',
      });
    });

    it('should handle missing headers gracefully', () => {
      const req = createMockRequest({
        ip: undefined,
        socket: { remoteAddress: undefined } as any,
        get: vi.fn(() => undefined),
      });

      const context = auditService.extractContext(req);

      expect(context.ipAddress).toBe('unknown');
      expect(context.userAgent).toBeUndefined();
    });

    it('should truncate long user agent strings', () => {
      const longUserAgent = 'A'.repeat(1000);
      const req = createMockRequest({
        get: vi.fn((header: string) => {
          if (header === 'user-agent') return longUserAgent;
          return undefined;
        }),
      });

      const context = auditService.extractContext(req);

      expect(context.userAgent).toHaveLength(500);
    });
  });
});
