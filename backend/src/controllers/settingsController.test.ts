/**
 * settingsController C-6 regression tests.
 *
 * Scope: the GCS-cleanup behavior added by C-6 to `deleteAllData` and
 * `deleteAccount`. Intentionally narrow — these are control-flow /
 * sequencing tests. Full unit coverage of settingsController is out of
 * scope here.
 *
 * Two invariants under test for each handler:
 *   1. GCS deletion runs BEFORE any DB deletion.
 *   2. If any GCS delete fails (non-404), the handler throws and the DB
 *      stays intact, so the user's next retry still has the storageKeys
 *      to delete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Mocked tx — shared handle for both controllers ---------------------------
const mockTx = {
  userFile: { findMany: vi.fn(), deleteMany: vi.fn() },
  biomarker: { deleteMany: vi.fn() },
  insurancePlan: { deleteMany: vi.fn() },
  healthNeed: { deleteMany: vi.fn() },
  healthGoal: { deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), delete: vi.fn() },
};

// -- Mocks — hoisted by vitest, so the factories run before imports -----------
vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
}));

const mockAuditService = {
  logDelete: vi.fn(),
  logSystem: vi.fn(),
};
vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mockAuditService),
}));

vi.mock('../services/storageService.js', () => ({
  storageService: { deleteFiles: vi.fn() },
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({})),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../services/authService.js', () => ({
  verifyPassword: vi.fn(async () => true),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

// -- Imports AFTER mocks so the mocked modules resolve -------------------------
import { deleteAllData, deleteAccount } from './settingsController.js';
import { storageService } from '../services/storageService.js';

// Narrow helper for the res stub
function mockRes() {
  return { json: vi.fn() } as unknown as import('express').Response;
}

function mockReq(userId: string, body: Record<string, unknown> = {}) {
  return {
    user: { id: userId },
    body,
  } as unknown as import('../types/index.js').AuthenticatedRequest;
}

describe('deleteAllData (C-6)', () => {
  beforeEach(() => {
    // clearAllMocks preserves mock implementations (withRLSContext/Transaction
    // still invoke the fn arg). resetAllMocks would wipe them.
    vi.clearAllMocks();

    mockTx.userFile.findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'user-123/f1.pdf', filename: 'labs.pdf' },
      { id: 'f2', storageKey: 'user-123/f2.pdf', filename: 'sbc.pdf' },
    ]);
    mockTx.biomarker.deleteMany.mockResolvedValue({ count: 3 });
    mockTx.insurancePlan.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.healthNeed.deleteMany.mockResolvedValue({ count: 2 });
    mockTx.healthGoal.deleteMany.mockResolvedValue({ count: 4 });
    mockTx.userFile.deleteMany.mockResolvedValue({ count: 2 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes all GCS objects before any DB deletion, then deletes DB rows', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
      { storageKey: 'user-123/f2.pdf', ok: true },
    ]);

    const req = mockReq('user-123');
    const res = mockRes();

    await deleteAllData(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith([
      'user-123/f1.pdf',
      'user-123/f2.pdf',
    ]);
    expect(mockTx.userFile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalled();
    expect(mockAuditService.logDelete).toHaveBeenCalledWith(
      'UserData',
      'user-123',
      expect.objectContaining({
        deletedBiomarkers: 3,
        deletedUserFiles: 2,
        deletedGcsObjects: 2,
      }),
      expect.any(Object)
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('aborts and does NOT delete any DB rows if any GCS delete fails', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
      { storageKey: 'user-123/f2.pdf', ok: false, error: 'GCS 500' },
    ]);

    const req = mockReq('user-123');
    const res = mockRes();

    await expect(deleteAllData(req, res)).rejects.toThrow(/Failed to delete 1 of 2 files/);

    expect(mockTx.biomarker.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.insurancePlan.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.healthGoal.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).not.toHaveBeenCalled();

    expect(mockAuditService.logSystem).toHaveBeenCalledWith(
      'DELETE',
      'UserData',
      expect.objectContaining({
        action: 'DELETE_DATA_FAILED',
        component: 'settingsController.deleteAllData',
        count: 1,
      })
    );
    expect(mockAuditService.logDelete).not.toHaveBeenCalled();
  });

  it('handles a user with zero files (empty GCS call, DB deletion still runs)', async () => {
    mockTx.userFile.findMany.mockResolvedValue([]);
    vi.mocked(storageService.deleteFiles).mockResolvedValue([]);

    const req = mockReq('user-123');
    const res = mockRes();

    await deleteAllData(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith([]);
    expect(mockTx.biomarker.deleteMany).toHaveBeenCalled();
    expect(mockTx.userFile.deleteMany).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('deleteAccount (C-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTx.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      passwordHash: '$hash',
    });
    mockTx.userFile.findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'user-123/f1.pdf' },
    ]);
    mockTx.user.delete.mockResolvedValue({ id: 'user-123' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes GCS objects before cascading the user delete', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: true },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await deleteAccount(req, res);

    expect(storageService.deleteFiles).toHaveBeenCalledWith(['user-123/f1.pdf']);
    expect(mockTx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-123' } });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('does NOT cascade-delete the user if any GCS delete fails', async () => {
    vi.mocked(storageService.deleteFiles).mockResolvedValue([
      { storageKey: 'user-123/f1.pdf', ok: false, error: 'network timeout' },
    ]);

    const req = mockReq('user-123', { password: 'correct-horse' });
    const res = mockRes();

    await expect(deleteAccount(req, res)).rejects.toThrow(/Your account was not deleted/);
    expect(mockTx.user.delete).not.toHaveBeenCalled();
    expect(mockAuditService.logSystem).toHaveBeenCalledWith(
      'DELETE',
      'User',
      expect.objectContaining({
        action: 'DELETE_ACCOUNT_FAILED',
        component: 'settingsController.deleteAccount',
      })
    );
  });
});
