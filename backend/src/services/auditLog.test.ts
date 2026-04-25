import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request } from 'express';

// C-8 — auditLog.ts now imports `config` which validates env vars at module
// load. Mock the config module so this test file doesn't depend on a real
// .env having AUDIT_LOG_SALT (or anything else) set. The salt value here
// only needs to clear the 16-char minimum.
vi.mock('../config/index.js', () => ({
  config: {
    auditSalt: 'test-audit-salt-for-unit-tests',
  },
}));

import { AuditLogService, getAuditLogService, startAuditCleanup, stopAuditCleanup } from './auditLog.js';

// Mock dependencies
vi.mock('./encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
    generateUserSalt: vi.fn(() => 'generated-salt-1234567890'),
    encryptWithMasterKey: vi.fn((value: string) => `master-encrypted:${value}`),
    decryptWithMasterKey: vi.fn((value: string) =>
      value.startsWith('master-encrypted:') ? value.slice('master-encrypted:'.length) : value
    ),
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    startup: vi.fn(),
  },
}));

// C-8 Part 1 — `auditService.initialize()` now wraps all system_config
// access in withRLSContext(null, (tx) => ..., { isAdmin: true }). The
// mock forwards the same mockPrisma object as `tx`, so existing tests
// that set up `mockPrisma.systemConfig.findUnique/create/update` keep
// working unchanged — just via tx.* inside the callback.
//
// FOR FUTURE TEST AUTHORS: any Prisma call inside a withRLSContext
// callback must be wired through `mockPrismaForRLS` (which is the same
// mockPrisma instance), not constructed independently. See the
// beforeEach below.
const mocks = vi.hoisted(() => ({
  mockPrismaForRLS: null as unknown,
  withRLSContext: vi.fn(),
}));

vi.mock('./database.js', () => ({
  withRLSContext: mocks.withRLSContext,
}));

// Mock Prisma client
interface MockPrismaClient {
  systemConfig: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

function createMockPrisma(): MockPrismaClient {
  return {
    systemConfig: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

// Standard encrypted-row shape used by most tests (normal post-migration boot).
const ENCRYPTED_SALT_ROW = {
  key: 'audit_encryption_salt',
  value: 'master-encrypted:valid-salt-1234567890',
  isEncrypted: true,
};

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: '192.168.1.100',
    socket: { remoteAddress: '127.0.0.1' },
    get: vi.fn((header: string) => {
      if (header === 'user-agent') return 'Test Browser/1.0';
      return undefined;
    }),
    ...overrides,
  } as unknown as Request;
}

describe('AuditLogService', () => {
  let mockPrisma: MockPrismaClient;
  let auditService: AuditLogService;

  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma = createMockPrisma();
    // Re-bind withRLSContext each test — vi.resetAllMocks() wipes the
    // implementation. Point it at the same prisma instance so `tx.*`
    // calls inside initialize() hit the same findUnique/create/update mocks.
    mocks.mockPrismaForRLS = mockPrisma;
    mocks.withRLSContext.mockImplementation(
      async (_userId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(mocks.mockPrismaForRLS)
    );
    auditService = new AuditLogService(mockPrisma as unknown as Parameters<typeof getAuditLogService>[0]);
  });

  describe('initialize()', () => {
    // C-8 — initialize() no longer touches system_config; it reads
    // config.auditSalt (validated at module load). Only behavior left to
    // test is: it sources the salt from config and doesn't hit the DB.

    it('sources systemSalt from config.auditSalt (no DB call)', async () => {
      await auditService.initialize();

      // No system_config interaction — whole point of the refactor.
      expect(mockPrisma.systemConfig.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.systemConfig.create).not.toHaveBeenCalled();
      expect(mockPrisma.systemConfig.update).not.toHaveBeenCalled();
      // withRLSContext was previously the admin-wrap for system_config; that
      // call is gone too, so no RLS context is entered during init now.
      expect(mocks.withRLSContext).not.toHaveBeenCalled();
    });
  });

  describe('extractContext()', () => {
    it('should extract IP address from request', () => {
      const req = createMockRequest({ ip: '10.0.0.1' });

      const context = auditService.extractContext(req);

      expect(context.ipAddress).toBe('10.0.0.1');
    });

    it('should extract user agent from request', () => {
      const req = createMockRequest();

      const context = auditService.extractContext(req);

      expect(context.userAgent).toBe('Test Browser/1.0');
    });

    it('should truncate long user agents', () => {
      const longUserAgent = 'A'.repeat(600);
      const req = createMockRequest({
        get: vi.fn(() => longUserAgent),
      });

      const context = auditService.extractContext(req);

      expect(context.userAgent?.length).toBeLessThanOrEqual(500);
    });

    it('should use socket address as fallback', () => {
      const req = createMockRequest({
        ip: undefined,
        socket: { remoteAddress: '192.168.1.1' },
      } as unknown as Partial<Request>);

      const context = auditService.extractContext(req);

      // The getClientIp function returns req.ip || req.socket.remoteAddress || 'unknown'
      expect(context.ipAddress).toBeDefined();
    });
  });

  describe('log()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
    });

    it('should create audit log entry with encrypted values', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await auditService.logCreate(
        'Biomarker',
        'biomarker-123',
        { name: 'Glucose', value: 95 },
        { userId: 'user-1' }
      );

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          actorType: 'USER',
          action: 'CREATE',
          resourceType: 'Biomarker',
          resourceId: 'biomarker-123',
          newValueEncrypted: expect.stringContaining('encrypted:'),
        }),
      });
    });

    it('should handle create log errors gracefully', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(
        auditService.logCreate('Biomarker', 'bio-1', { test: 'data' }, { userId: 'user-1' })
      ).resolves.toBeUndefined();
    });
  });

  describe('logAccess()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('should log PHI read access', async () => {
      const req = createMockRequest();

      await auditService.logAccess('Biomarker', 'bio-123', { userId: 'user-1', req });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'READ',
          resourceType: 'Biomarker',
          resourceId: 'bio-123',
          ipAddress: '192.168.1.100',
        }),
      });
    });

    it('should log list access without specific resourceId', async () => {
      await auditService.logAccess('Biomarker', undefined, { userId: 'user-1' }, { operation: 'LIST', count: 50 });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'READ',
          resourceType: 'Biomarker',
          resourceId: undefined,
          metadata: expect.stringContaining('LIST'),
        }),
      });
    });
  });

  describe('logUpdate()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('should log update with previous and new values', async () => {
      await auditService.logUpdate(
        'Biomarker',
        'bio-123',
        { value: 90 },
        { value: 95 },
        { userId: 'user-1' }
      );

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          previousValueEncrypted: expect.stringContaining('encrypted:'),
          newValueEncrypted: expect.stringContaining('encrypted:'),
        }),
      });
    });
  });

  describe('logDelete()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('should log delete with previous value', async () => {
      await auditService.logDelete(
        'Biomarker',
        'bio-123',
        { name: 'Glucose', value: 95 },
        { userId: 'user-1' }
      );

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELETE',
          previousValueEncrypted: expect.stringContaining('encrypted:'),
        }),
      });
    });
  });

  describe('logAuth()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('should log successful login', async () => {
      const req = createMockRequest();

      await auditService.logAuth('LOGIN', { userId: 'user-1', req });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'LOGIN',
          resourceType: 'Authentication',
          actorType: 'USER',
        }),
      });
    });

    it('should log failed login with anonymous actor', async () => {
      const req = createMockRequest();

      await auditService.logAuth('LOGIN_FAILED', { req }, { authAction: 'LOGIN_FAILED' });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'ANONYMOUS',
          metadata: expect.stringContaining('LOGIN_FAILED'),
        }),
      });
    });

    it('should log logout', async () => {
      await auditService.logAuth('LOGOUT', { userId: 'user-1' });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'LOGOUT',
        }),
      });
    });

    it('should log password change', async () => {
      await auditService.logAuth('PASSWORD_CHANGE', { userId: 'user-1' });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          resourceType: 'Authentication',
        }),
      });
    });

    it('should log registration', async () => {
      await auditService.logAuth('REGISTER', { userId: 'new-user' });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATE',
        }),
      });
    });
  });

  describe('logExport()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('should log data export with format and count', async () => {
      await auditService.logExport(
        'Biomarker',
        ['bio-1', 'bio-2', 'bio-3'],
        'CSV',
        { userId: 'user-1' }
      );

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'EXPORT',
          resourceType: 'Biomarker',
          metadata: expect.stringContaining('CSV'),
        }),
      });
    });

    it('should limit exported resource IDs to 100', async () => {
      const manyIds = Array(150).fill(null).map((_, i) => `bio-${i}`);

      await auditService.logExport('Biomarker', manyIds, 'JSON', { userId: 'user-1' });

      const createCall = mockPrisma.auditLog.create.mock.calls[0][0];
      const metadata = JSON.parse(createCall.data.metadata);
      expect(metadata.resourceIds.length).toBeLessThanOrEqual(100);
    });
  });

  describe('queryLogs()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
    });

    it('should query logs with filters', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await auditService.queryLogs({
        userId: 'user-1',
        resourceType: 'Biomarker',
        action: 'READ',
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            resourceType: 'Biomarker',
            action: 'READ',
          }),
        })
      );
      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should support date range filtering', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await auditService.queryLogs({ startDate, endDate });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
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

    it('should support pagination', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await auditService.queryLogs({ limit: 50, offset: 100 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 100,
        })
      );
    });
  });

  describe('cleanupOldLogs()', () => {
    beforeEach(async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
    });

    it('should delete logs older than retention period', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 10 });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'system-log' });

      const deletedCount = await auditService.cleanupOldLogs();

      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expect.any(Date) },
        },
      });
      expect(deletedCount).toBe(10);
    });

    it('should log cleanup action', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'system-log' });

      await auditService.cleanupOldLogs();

      // Second call should be the system log
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: 'SYSTEM',
          action: 'DELETE',
          resourceType: 'AuditLog',
        }),
      });
    });
  });

  describe('RLS context wrapping for runtime methods (C-8 Part 2b-ii)', () => {
    it('log() runs inside admin RLS context', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
      // Clear the withRLSContext history so we assert on log()'s call only,
      // not on initialize()'s.
      mocks.withRLSContext.mockClear();

      await auditService.log({
        actorType: 'USER',
        action: 'READ',
        resourceType: 'Biomarker',
        userId: 'user-1',
      });

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });

    it('queryLogs() runs findMany + count inside admin RLS context', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mocks.withRLSContext.mockClear();

      await auditService.queryLogs({ userId: 'user-1' });

      expect(mocks.withRLSContext).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        { isAdmin: true }
      );
    });

    it('cleanupOldLogs() wraps only the deleteMany in admin context; logSystem opens its own wrapper', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);
      await auditService.initialize();
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'sys-log' });
      mocks.withRLSContext.mockClear();

      await auditService.cleanupOldLogs();

      // Two withRLSContext calls expected: one for deleteMany, one inside
      // logSystem → log().
      expect(mocks.withRLSContext).toHaveBeenCalledTimes(2);
      // Both with admin context.
      for (const call of mocks.withRLSContext.mock.calls) {
        expect(call[0]).toBeNull();
        expect(call[2]).toEqual({ isAdmin: true });
      }
    });
  });
});

describe('Audit cleanup scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopAuditCleanup();
    vi.useRealTimers();
  });

  it('should start and stop cleanup scheduler', () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.systemConfig.findUnique.mockResolvedValue(ENCRYPTED_SALT_ROW);

    startAuditCleanup(mockPrisma as unknown as Parameters<typeof startAuditCleanup>[0]);
    // Starting again should be idempotent
    startAuditCleanup(mockPrisma as unknown as Parameters<typeof startAuditCleanup>[0]);

    stopAuditCleanup();
    // Stopping again should be safe
    stopAuditCleanup();
  });
});
