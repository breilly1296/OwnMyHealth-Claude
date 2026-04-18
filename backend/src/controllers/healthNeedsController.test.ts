/**
 * healthNeedsController unit tests.
 *
 * Scope: CRUD basics, status transitions, and biomarker analysis behavior.
 *   - getHealthNeeds: urgency ordering (IMMEDIATE → URGENT → FOLLOW_UP →
 *     ROUTINE, then createdAt desc) and status/urgency filter pass-through.
 *   - createHealthNeed: encrypts description via `descriptionEncrypted`.
 *   - updateHealthNeedStatus: sets `resolvedAt` only when the new status
 *     is COMPLETED; other transitions (IN_PROGRESS, DISMISSED) leave it alone.
 *   - deleteHealthNeed: scopes findFirst/delete to the owning userId.
 *   - analyzeHealthNeeds: pure read — returns suggestions based on
 *     out-of-range biomarkers but never creates HealthNeed rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPrismaTransaction, createMockAuditService, createMockEncryptionService, createMockRequest, createMockResponse } from './testHelpers.js';

// -- Shared mock handles ------------------------------------------------------
const mockTx = createMockPrismaTransaction();
const mockAuditService = createMockAuditService();
const mockEncryptionService = createMockEncryptionService();

// -- Mocks — hoisted by vitest, so factories run before imports --------------
vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx)
  ),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mockAuditService),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => mockEncryptionService),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

// -- Imports AFTER mocks so the mocked modules resolve ------------------------
import {
  getHealthNeeds,
  createHealthNeed,
  updateHealthNeedStatus,
  deleteHealthNeed,
  analyzeHealthNeeds,
} from './healthNeedsController.js';

// Reset mocks between tests but keep the module-level mocks (database, etc.)
// intact. Per-method vi.fn()s inside `mockTx` / `mockAuditService` are reset
// individually, matching the settingsController pattern.
function resetTxMocks() {
  for (const model of Object.values(mockTx)) {
    if (model && typeof model === 'object') {
      for (const fn of Object.values(model)) {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as ReturnType<typeof vi.fn>).mockReset();
        }
      }
    }
  }
  for (const fn of Object.values(mockAuditService)) {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  mockEncryptionService.encrypt.mockClear();
  mockEncryptionService.decrypt.mockClear();
}

// ---------------------------------------------------------------------------
// getHealthNeeds
// ---------------------------------------------------------------------------
describe('getHealthNeeds', () => {
  beforeEach(() => {
    resetTxMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sorts needs IMMEDIATE → URGENT → FOLLOW_UP → ROUTINE even when Prisma returns them unordered', async () => {
    // Deliberately unsorted input to exercise the controller's in-memory sort.
    // Controller does a custom sort because Prisma can't order by enum value.
    const unsorted = [
      { id: 'n1', userId: 'user-123', needType: 'ACTION', name: 'routine-need',  descriptionEncrypted: 'enc:d1', urgency: 'ROUTINE',    status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), resolvedAt: null },
      { id: 'n2', userId: 'user-123', needType: 'ACTION', name: 'immediate-need',descriptionEncrypted: 'enc:d2', urgency: 'IMMEDIATE',  status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02'), resolvedAt: null },
      { id: 'n3', userId: 'user-123', needType: 'ACTION', name: 'followup-need', descriptionEncrypted: 'enc:d3', urgency: 'FOLLOW_UP',  status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03'), resolvedAt: null },
      { id: 'n4', userId: 'user-123', needType: 'ACTION', name: 'urgent-need',   descriptionEncrypted: 'enc:d4', urgency: 'URGENT',     status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-04'), updatedAt: new Date('2026-01-04'), resolvedAt: null },
    ];
    mockTx.healthNeed.findMany.mockResolvedValue(unsorted);

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await getHealthNeeds(req, res);

    const payload = vi.mocked(res.json).mock.calls[0][0] as {
      success: boolean;
      data: Array<{ urgency: string }>;
    };
    expect(payload.success).toBe(true);
    expect(payload.data.map((n) => n.urgency)).toEqual([
      'IMMEDIATE',
      'URGENT',
      'FOLLOW_UP',
      'ROUTINE',
    ]);
  });

  it('breaks urgency ties by createdAt descending (newest first within same urgency)', async () => {
    const sameUrgency = [
      { id: 'a', userId: 'user-123', needType: 'ACTION', name: 'older-urgent',  descriptionEncrypted: 'enc:a', urgency: 'URGENT', status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), resolvedAt: null },
      { id: 'b', userId: 'user-123', needType: 'ACTION', name: 'newer-urgent',  descriptionEncrypted: 'enc:b', urgency: 'URGENT', status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-02-15'), updatedAt: new Date('2026-02-15'), resolvedAt: null },
      { id: 'c', userId: 'user-123', needType: 'ACTION', name: 'middle-urgent', descriptionEncrypted: 'enc:c', urgency: 'URGENT', status: 'PENDING', relatedBiomarkerIds: [], createdAt: new Date('2026-01-20'), updatedAt: new Date('2026-01-20'), resolvedAt: null },
    ];
    mockTx.healthNeed.findMany.mockResolvedValue(sameUrgency);

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await getHealthNeeds(req, res);

    const payload = vi.mocked(res.json).mock.calls[0][0] as {
      data: Array<{ name: string }>;
    };
    expect(payload.data.map((n) => n.name)).toEqual([
      'newer-urgent',
      'middle-urgent',
      'older-urgent',
    ]);
  });

  it('passes status and urgency filters through to the findMany where clause', async () => {
    mockTx.healthNeed.findMany.mockResolvedValue([]);

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      query: { status: 'IN_PROGRESS', urgency: 'IMMEDIATE' },
    });
    const res = createMockResponse();

    await getHealthNeeds(req, res);

    expect(mockTx.healthNeed.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-123',
          status: 'IN_PROGRESS',
          urgency: 'IMMEDIATE',
        },
      })
    );
  });

  it('omits status/urgency from the where clause when not provided', async () => {
    mockTx.healthNeed.findMany.mockResolvedValue([]);

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await getHealthNeeds(req, res);

    expect(mockTx.healthNeed.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123' },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// createHealthNeed
// ---------------------------------------------------------------------------
describe('createHealthNeed', () => {
  beforeEach(() => {
    resetTxMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts description into descriptionEncrypted before calling tx.healthNeed.create', async () => {
    mockTx.healthNeed.create.mockResolvedValue({
      id: 'need-1',
      userId: 'user-123',
      needType: 'ACTION',
      name: 'Schedule cardiologist follow-up',
      descriptionEncrypted: 'enc:Follow up on LDL',
      urgency: 'URGENT',
      status: 'PENDING',
      relatedBiomarkerIds: ['bm-1'],
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    });

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      body: {
        needType: 'ACTION',
        name: 'Schedule cardiologist follow-up',
        description: 'Follow up on LDL',
        urgency: 'URGENT',
        relatedBiomarkerIds: ['bm-1'],
      },
    });
    const res = createMockResponse();

    await createHealthNeed(req, res);

    expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('Follow up on LDL', 'salt');
    expect(mockTx.healthNeed.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-123',
        needType: 'ACTION',
        name: 'Schedule cardiologist follow-up',
        descriptionEncrypted: 'enc:Follow up on LDL',
        urgency: 'URGENT',
        status: 'PENDING',
        relatedBiomarkerIds: ['bm-1'],
      }),
    });

    const createCallArgs = mockTx.healthNeed.create.mock.calls[0]![0] as {
      data: { descriptionEncrypted: string };
    };
    expect(createCallArgs.data.descriptionEncrypted.startsWith('enc:')).toBe(true);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockAuditService.logCreate).toHaveBeenCalled();
  });

  it('defaults relatedBiomarkerIds to an empty array when the client omits it', async () => {
    mockTx.healthNeed.create.mockResolvedValue({
      id: 'need-2',
      userId: 'user-123',
      needType: 'CONDITION',
      name: 'High cholesterol',
      descriptionEncrypted: 'enc:Chronic',
      urgency: 'ROUTINE',
      status: 'PENDING',
      relatedBiomarkerIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    });

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      body: {
        needType: 'CONDITION',
        name: 'High cholesterol',
        description: 'Chronic',
        urgency: 'ROUTINE',
      },
    });
    const res = createMockResponse();

    await createHealthNeed(req, res);

    expect(mockTx.healthNeed.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ relatedBiomarkerIds: [] }),
    });
  });
});

// ---------------------------------------------------------------------------
// updateHealthNeedStatus
// ---------------------------------------------------------------------------
describe('updateHealthNeedStatus', () => {
  beforeEach(() => {
    resetTxMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function existingNeed(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'need-1',
      userId: 'user-123',
      needType: 'ACTION',
      name: 'Some need',
      descriptionEncrypted: 'enc:desc',
      urgency: 'URGENT',
      status: 'PENDING',
      relatedBiomarkerIds: [],
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      resolvedAt: null,
      ...overrides,
    };
  }

  it('sets resolvedAt to a Date when status transitions to COMPLETED', async () => {
    mockTx.healthNeed.findFirst.mockResolvedValue(existingNeed());
    mockTx.healthNeed.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...existingNeed(),
      ...args.data,
    }));

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'need-1' },
      body: { status: 'COMPLETED' },
    });
    const res = createMockResponse();

    await updateHealthNeedStatus(req, res);

    expect(mockTx.healthNeed.update).toHaveBeenCalledWith({
      where: { id: 'need-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        resolvedAt: expect.any(Date),
      }),
    });

    const updateArgs = mockTx.healthNeed.update.mock.calls[0]![0] as {
      data: { resolvedAt: Date };
    };
    expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('does NOT set resolvedAt when the new status is IN_PROGRESS', async () => {
    mockTx.healthNeed.findFirst.mockResolvedValue(existingNeed());
    mockTx.healthNeed.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...existingNeed(),
      ...args.data,
    }));

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'need-1' },
      body: { status: 'IN_PROGRESS' },
    });
    const res = createMockResponse();

    await updateHealthNeedStatus(req, res);

    const updateArgs = mockTx.healthNeed.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.status).toBe('IN_PROGRESS');
    expect(updateArgs.data).not.toHaveProperty('resolvedAt');
  });

  it('does NOT set resolvedAt when the new status is DISMISSED', async () => {
    // NOTE: controller treats DISMISSED like any non-COMPLETED status —
    // it only branches on `status === 'COMPLETED'`. Mirror that exactly.
    mockTx.healthNeed.findFirst.mockResolvedValue(existingNeed());
    mockTx.healthNeed.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...existingNeed(),
      ...args.data,
    }));

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'need-1' },
      body: { status: 'DISMISSED' },
    });
    const res = createMockResponse();

    await updateHealthNeedStatus(req, res);

    const updateArgs = mockTx.healthNeed.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.status).toBe('DISMISSED');
    expect(updateArgs.data).not.toHaveProperty('resolvedAt');
  });

  it('throws NotFoundError when the need does not belong to the caller', async () => {
    mockTx.healthNeed.findFirst.mockResolvedValue(null);

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'does-not-exist' },
      body: { status: 'COMPLETED' },
    });
    const res = createMockResponse();

    await expect(updateHealthNeedStatus(req, res)).rejects.toThrow(/not found/i);
    expect(mockTx.healthNeed.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteHealthNeed
// ---------------------------------------------------------------------------
describe('deleteHealthNeed', () => {
  beforeEach(() => {
    resetTxMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scopes ownership check to both id AND userId, then deletes by id', async () => {
    mockTx.healthNeed.findFirst.mockResolvedValue({
      id: 'need-1',
      userId: 'user-123',
      needType: 'ACTION',
      name: 'Some need',
      descriptionEncrypted: 'enc:d',
      urgency: 'URGENT',
      status: 'PENDING',
      relatedBiomarkerIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    });
    mockTx.healthNeed.delete.mockResolvedValue({});

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'need-1' },
    });
    const res = createMockResponse();

    await deleteHealthNeed(req, res);

    expect(mockTx.healthNeed.findFirst).toHaveBeenCalledWith({
      where: { id: 'need-1', userId: 'user-123' },
    });
    expect(mockTx.healthNeed.delete).toHaveBeenCalledWith({ where: { id: 'need-1' } });
    expect(mockAuditService.logDelete).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('throws NotFoundError when the need does not exist for the caller (never calls delete)', async () => {
    mockTx.healthNeed.findFirst.mockResolvedValue(null);

    const req = createMockRequest({
      user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' },
      params: { id: 'someone-elses-need' },
    });
    const res = createMockResponse();

    await expect(deleteHealthNeed(req, res)).rejects.toThrow(/not found/i);
    expect(mockTx.healthNeed.delete).not.toHaveBeenCalled();
    expect(mockAuditService.logDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// analyzeHealthNeeds
// ---------------------------------------------------------------------------
describe('analyzeHealthNeeds', () => {
  beforeEach(() => {
    resetTxMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns suggestions keyed to out-of-range biomarkers and NEVER creates HealthNeed rows', async () => {
    // Controller only queries biomarkers where isOutOfRange=true, so we
    // simulate that by returning only out-of-range rows. In-range rows
    // would never be returned by the controller's `where` clause.
    mockTx.biomarker.findMany.mockResolvedValue([
      { id: 'bm-1', name: 'LDL',      category: 'Lipids'    },
      { id: 'bm-2', name: 'Glucose',  category: 'Metabolic' },
    ]);
    mockTx.healthNeed.findMany.mockResolvedValue([]); // no existing conditions

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await analyzeHealthNeeds(req, res);

    // Critical: analysis is pure read — no HealthNeed rows may be created.
    expect(mockTx.healthNeed.create).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.createMany).not.toHaveBeenCalled();

    const payload = vi.mocked(res.json).mock.calls[0][0] as {
      success: boolean;
      data: {
        detectedConditions: unknown[];
        recommendations: string[];
        outOfRangeBiomarkers: Array<{ id: string; name: string; category: string }>;
      };
    };
    expect(payload.success).toBe(true);
    // Only the out-of-range biomarkers come back — nothing from "in range" leaks
    // in (because the where clause filters them out upstream).
    expect(payload.data.outOfRangeBiomarkers).toEqual([
      { id: 'bm-1', name: 'LDL',     category: 'Lipids' },
      { id: 'bm-2', name: 'Glucose', category: 'Metabolic' },
    ]);
    // Category-specific recommendations reflect the categories present.
    expect(payload.data.recommendations).toEqual(
      expect.arrayContaining([
        'Schedule appointment with healthcare provider to discuss out-of-range biomarkers',
        'Consider heart-healthy dietary modifications',
        'Monitor blood glucose levels regularly',
      ])
    );
    // And does NOT include category-specific recs for absent categories.
    expect(payload.data.recommendations).not.toEqual(
      expect.arrayContaining(['Continue regular blood monitoring']),
    );
  });

  it('queries biomarkers with isOutOfRange=true so in-range values are excluded at the DB boundary', async () => {
    mockTx.biomarker.findMany.mockResolvedValue([]);
    mockTx.healthNeed.findMany.mockResolvedValue([]);

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await analyzeHealthNeeds(req, res);

    expect(mockTx.biomarker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123', isOutOfRange: true },
      })
    );
    // Still returns generic recommendations even with no out-of-range hits,
    // so the response is always useful — but no HealthNeed rows created.
    expect(mockTx.healthNeed.create).not.toHaveBeenCalled();
    expect(mockTx.healthNeed.createMany).not.toHaveBeenCalled();
  });

  it('always appends the generic lifestyle recommendations (physical/exercise/sleep)', async () => {
    mockTx.biomarker.findMany.mockResolvedValue([]);
    mockTx.healthNeed.findMany.mockResolvedValue([]);

    const req = createMockRequest({ user: { id: 'user-123', email: 't@e.co', role: 'PATIENT' } });
    const res = createMockResponse();

    await analyzeHealthNeeds(req, res);

    const payload = vi.mocked(res.json).mock.calls[0][0] as {
      data: { recommendations: string[] };
    };
    expect(payload.data.recommendations).toEqual(
      expect.arrayContaining([
        'Schedule annual physical examination',
        'Maintain regular exercise routine',
        'Ensure adequate sleep and stress management',
      ])
    );
  });
});
