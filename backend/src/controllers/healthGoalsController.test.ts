/**
 * healthGoalsController unit tests.
 *
 * Scope: CRUD + the progress-calculation invariants that the analytics
 * dashboard relies on. The tests lock in the controller's current progress
 * formulas exactly — see `calculateProgress` in the controller:
 *   - INCREASE: (current - start) / (target - start) * 100, clamped 0..100
 *   - DECREASE: (start - current) / (start - target) * 100, clamped 0..100
 *   - MAINTAIN: 100 if |current - target| <= target * 0.05, else
 *               max(0, 100 - (|current - target| / target) * 100)
 * Auto-achieve: when progress >= 100 the handler sets status = 'ACHIEVED'
 * and stamps `completedAt` with a new Date.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockRequest,
  createMockResponse,
  createMockPrismaTransaction,
  createMockAuditService,
  createMockEncryptionService,
  type MockPrismaTx,
  type MockAuditService,
} from './testHelpers.js';

// -- Mocked tx / services — shared handles ----------------------------------
let mockTx: MockPrismaTx;
let mockAuditService: MockAuditService;
const mockEncryptionService = createMockEncryptionService();

// -- Mocks — hoisted by vitest, so the factories run before imports ----------
vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mockTx)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mockTx)
  ),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => mockEncryptionService),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mockAuditService),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

// -- Imports AFTER mocks -----------------------------------------------------
import {
  getHealthGoals,
  createHealthGoal,
  updateGoalProgress,
  deleteHealthGoal,
  suggestGoals,
} from './healthGoalsController.js';
import { schemas } from '../middleware/validation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'test-user-id';

/** A realistic HealthGoal row — toResponse() calls .toISOString() on the
 *  date fields, so these must be real Date instances. */
function goalFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'goal-1',
    userId: USER_ID,
    name: 'Lower LDL',
    descriptionEncrypted: 'enc:Reduce LDL cholesterol',
    category: 'Cardiovascular',
    targetValue: 100,
    currentValue: 150,
    startValue: 200,
    unit: 'mg/dL',
    direction: 'DECREASE',
    relatedBiomarkerId: null,
    startDate: new Date('2026-01-01'),
    targetDate: new Date('2026-12-31'),
    status: 'ACTIVE',
    progress: 50,
    milestones: null,
    reminderFrequency: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTx = createMockPrismaTransaction();
  mockAuditService = createMockAuditService();
  mockEncryptionService.encrypt.mockClear();
  mockEncryptionService.decrypt.mockClear();
  // Re-apply the default implementation after clearing — mockClear wipes calls
  // but leaves implementations in place; being explicit here is defensive.
  mockEncryptionService.encrypt.mockImplementation((value: string) => `enc:${value}`);
  mockEncryptionService.decrypt.mockImplementation((value: string) =>
    value.replace(/^enc:/, '')
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getHealthGoals
// ---------------------------------------------------------------------------

describe('getHealthGoals', () => {
  it('scopes findMany to the authenticated userId', async () => {
    mockTx.healthGoal.findMany.mockResolvedValue([goalFixture()]);

    const req = createMockRequest({ user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' } });
    const res = createMockResponse();

    await getHealthGoals(req, res);

    expect(mockTx.healthGoal.findMany).toHaveBeenCalledTimes(1);
    const args = mockTx.healthGoal.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: USER_ID });
    // Default (no status/category query) should not add those filters
    expect(args.where.status).toBeUndefined();
    expect(args.where.category).toBeUndefined();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
      })
    );
  });

  it('applies status and category filters from the query string', async () => {
    mockTx.healthGoal.findMany.mockResolvedValue([]);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      query: { status: 'ACTIVE', category: 'Cardiovascular' },
    });
    const res = createMockResponse();

    await getHealthGoals(req, res);

    const args = mockTx.healthGoal.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      userId: USER_ID,
      status: 'ACTIVE',
      category: 'Cardiovascular',
    });
  });
});

// ---------------------------------------------------------------------------
// createHealthGoal
// ---------------------------------------------------------------------------

describe('createHealthGoal', () => {
  it('encrypts the description before writing', async () => {
    mockTx.healthGoal.create.mockResolvedValue(goalFixture());

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body: {
        name: 'Lower LDL',
        description: 'Reduce LDL cholesterol',
        category: 'Cardiovascular',
        targetValue: 100,
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      },
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
      'Reduce LDL cholesterol',
      'salt'
    );
    expect(mockTx.healthGoal.create).toHaveBeenCalledTimes(1);
    const data = mockTx.healthGoal.create.mock.calls[0][0].data;
    expect(data.descriptionEncrypted).toBe('enc:Reduce LDL cholesterol');
    expect(data.userId).toBe(USER_ID);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('encrypts target/current/start values and nulls the plaintext twins (M4)', async () => {
    mockTx.healthGoal.create.mockResolvedValue(goalFixture());
    mockTx.goalProgressHistory.create.mockResolvedValue({});

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body: {
        name: 'Lower LDL',
        category: 'Cardiovascular',
        targetValue: 100,
        currentValue: 150, // startValue defaults to currentValue
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      },
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    const data = mockTx.healthGoal.create.mock.calls[0][0].data;
    // Every numeric health value is written encrypted...
    expect(data.targetValueEncrypted).toBe('enc:100');
    expect(data.currentValueEncrypted).toBe('enc:150');
    expect(data.startValueEncrypted).toBe('enc:150');
    // ...and NO raw numeric value is persisted in a plaintext column.
    expect(data.currentValue).toBeNull();
    expect(data.startValue).toBeNull();
    expect(data.targetValue).toBeUndefined();
  });

  it('preserves startValue through the real create-schema validation (regression: contract drift)', () => {
    // The frontend goal-suggestion flow sends the initial value as `startValue`.
    // Before the fix the create schema only declared `currentValue`, so Zod
    // silently stripped `startValue` and the goal lost its baseline. Run the
    // REAL schema the route mounts to lock the contract.
    const parsed = schemas.healthGoal.create.parse({
      name: 'Lower BP',
      category: 'Vital Signs',
      targetValue: 120,
      startValue: 140,
      unit: 'mmHg',
      direction: 'DECREASE',
      startDate: '2026-01-01',
      targetDate: '2026-12-31',
    });
    expect(parsed.startValue).toBe(140);
  });

  it('uses startValue as the initial value when currentValue is absent (regression)', async () => {
    mockTx.healthGoal.create.mockResolvedValue(goalFixture());
    mockTx.goalProgressHistory.create.mockResolvedValue({});

    // Body exactly as it arrives after the real validate() middleware for the
    // suggestion flow: `startValue` present, NO `currentValue`.
    const body = schemas.healthGoal.create.parse({
      name: 'Lower BP',
      category: 'Vital Signs',
      targetValue: 120,
      startValue: 140,
      unit: 'mmHg',
      direction: 'DECREASE',
      startDate: '2026-01-01',
      targetDate: '2026-12-31',
    });
    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body,
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    const data = mockTx.healthGoal.create.mock.calls[0][0].data;
    // The user's start value (140) must survive — not be dropped to null/target.
    expect(data.currentValueEncrypted).toBe('enc:140');
    expect(data.startValueEncrypted).toBe('enc:140');
    expect(data.currentValue).toBeNull();
    // And the initial progress-history row is seeded from 140.
    expect(mockTx.goalProgressHistory.create).toHaveBeenCalledTimes(1);
    const historyData = mockTx.goalProgressHistory.create.mock.calls[0][0].data;
    expect(historyData.valueEncrypted).toBe('enc:140');
  });

  it('decrypts the encrypted current/start values in the response (M4)', async () => {
    mockTx.healthGoal.create.mockResolvedValue(
      goalFixture({
        currentValue: null,
        startValue: null,
        currentValueEncrypted: 'enc:142',
        startValueEncrypted: 'enc:170',
      })
    );

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body: {
        name: 'Lower LDL',
        category: 'Cardiovascular',
        targetValue: 100,
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      },
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.currentValue).toBe(142);
    expect(payload.data.startValue).toBe(170);
  });

  it('sets initial progress to 0 when no currentValue is supplied', async () => {
    mockTx.healthGoal.create.mockResolvedValue(goalFixture({ progress: 0, currentValue: null }));

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body: {
        name: 'Lower LDL',
        category: 'Cardiovascular',
        targetValue: 100,
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      },
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    const data = mockTx.healthGoal.create.mock.calls[0][0].data;
    expect(data.progress).toBe(0);
    expect(data.currentValue).toBeNull();
    expect(data.status).toBe('ACTIVE');
    // No currentValue → controller does NOT create an initial history row
    expect(mockTx.goalProgressHistory.create).not.toHaveBeenCalled();
  });

  it('creates an initial GoalProgressHistory row when currentValue is supplied', async () => {
    mockTx.healthGoal.create.mockResolvedValue(goalFixture());
    mockTx.goalProgressHistory.create.mockResolvedValue({});

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      body: {
        name: 'Lower LDL',
        description: 'Reduce LDL cholesterol',
        category: 'Cardiovascular',
        targetValue: 100,
        currentValue: 150,
        unit: 'mg/dL',
        direction: 'DECREASE',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      },
    });
    const res = createMockResponse();

    await createHealthGoal(req, res);

    expect(mockTx.goalProgressHistory.create).toHaveBeenCalledTimes(1);
    const historyData = mockTx.goalProgressHistory.create.mock.calls[0][0].data;
    // Value is encrypted at rest; the plaintext twin is nulled (M4).
    expect(historyData.valueEncrypted).toBe('enc:150');
    expect(historyData.value).toBeNull();
    // startValue defaults to currentValue when no prior start is known, so
    // DECREASE progress at create-time is 0 for (start=150, target=100, current=150).
    expect(historyData.progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateGoalProgress — progress math + auto-achieve
// ---------------------------------------------------------------------------

describe('updateGoalProgress', () => {
  function wireUpdateGoal(existing: ReturnType<typeof goalFixture>) {
    // 1st findFirst → the existing goal (pre-update)
    // 2nd findFirst → the goal-with-history payload returned in the response.
    // The 2nd return just needs to be a valid row for toResponse(); we reuse
    // the fixture but with an empty history array.
    mockTx.healthGoal.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, progressHistory: [] });
    mockTx.healthGoal.update.mockResolvedValue({ ...existing });
    mockTx.goalProgressHistory.create.mockResolvedValue({});
  }

  it('INCREASE: start=100, target=200, new=150 → progress=50, not ACHIEVED', async () => {
    const existing = goalFixture({
      direction: 'INCREASE',
      startValue: 100,
      targetValue: 200,
      currentValue: 100,
      progress: 0,
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 150 },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    expect(mockTx.healthGoal.update).toHaveBeenCalledTimes(1);
    const data = mockTx.healthGoal.update.mock.calls[0][0].data;
    // Current value is encrypted at rest; the plaintext twin is nulled (M4).
    expect(data.currentValueEncrypted).toBe('enc:150');
    expect(data.currentValue).toBeNull();
    expect(data.progress).toBeCloseTo(50, 5);
    expect(data.status).toBe('ACTIVE'); // preserved, not ACHIEVED
    expect(data.completedAt).toBeNull();
  });

  it('DECREASE: start=200, target=100, new=150 → progress=50, not ACHIEVED', async () => {
    const existing = goalFixture({
      direction: 'DECREASE',
      startValue: 200,
      targetValue: 100,
      currentValue: 200,
      progress: 0,
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 150 },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    const data = mockTx.healthGoal.update.mock.calls[0][0].data;
    expect(data.progress).toBeCloseTo(50, 5);
    expect(data.status).toBe('ACTIVE');
    expect(data.completedAt).toBeNull();
  });

  it('MAINTAIN: value within ±5% of target → progress=100 (auto-achieved)', async () => {
    // target=120, allowed variance = 6; |118-120|=2 <= 6, so progress=100
    // which trips the >= 100 branch and sets ACHIEVED + completedAt.
    const existing = goalFixture({
      direction: 'MAINTAIN',
      startValue: 120,
      targetValue: 120,
      currentValue: 120,
      progress: 100,
      status: 'ACTIVE',
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 118 },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    const data = mockTx.healthGoal.update.mock.calls[0][0].data;
    expect(data.progress).toBe(100);
    expect(data.status).toBe('ACHIEVED');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('MAINTAIN: value outside tolerance → progress drops below 100, not ACHIEVED', async () => {
    // target=100, |current - target| = 20, variance/target*100 = 20%
    // progress = max(0, 100 - 20) = 80; allowedVariance = 5, 20 > 5, so the
    // non-short-circuit branch applies.
    const existing = goalFixture({
      direction: 'MAINTAIN',
      startValue: 100,
      targetValue: 100,
      currentValue: 100,
      progress: 100,
      status: 'ACTIVE',
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 120 },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    const data = mockTx.healthGoal.update.mock.calls[0][0].data;
    expect(data.progress).toBeCloseTo(80, 5);
    expect(data.status).toBe('ACTIVE');
    expect(data.completedAt).toBeNull();
  });

  it('auto-marks INCREASE goal ACHIEVED with completedAt when current reaches target', async () => {
    const existing = goalFixture({
      direction: 'INCREASE',
      startValue: 100,
      targetValue: 200,
      currentValue: 150,
      progress: 50,
      status: 'ACTIVE',
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 200 },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    const data = mockTx.healthGoal.update.mock.calls[0][0].data;
    expect(data.progress).toBe(100);
    expect(data.status).toBe('ACHIEVED');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('creates exactly one GoalProgressHistory row per progress update', async () => {
    const existing = goalFixture({
      direction: 'INCREASE',
      startValue: 100,
      targetValue: 200,
      currentValue: 100,
      progress: 0,
    });
    wireUpdateGoal(existing);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
      body: { value: 150, note: 'feeling good' },
    });
    const res = createMockResponse();

    await updateGoalProgress(req, res);

    expect(mockTx.goalProgressHistory.create).toHaveBeenCalledTimes(1);
    const historyData = mockTx.goalProgressHistory.create.mock.calls[0][0].data;
    expect(historyData.goalId).toBe('goal-1');
    // Value is encrypted at rest; the plaintext twin is nulled (M4).
    expect(historyData.valueEncrypted).toBe('enc:150');
    expect(historyData.value).toBeNull();
    expect(historyData.progress).toBeCloseTo(50, 5);
    // Note was encrypted
    expect(historyData.noteEncrypted).toBe('enc:feeling good');
  });
});

// ---------------------------------------------------------------------------
// deleteHealthGoal
// ---------------------------------------------------------------------------

describe('deleteHealthGoal', () => {
  it('only deletes the goal if it belongs to the userId (findFirst is userId-scoped)', async () => {
    mockTx.healthGoal.findFirst.mockResolvedValue(goalFixture());
    mockTx.healthGoal.delete.mockResolvedValue(goalFixture());

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-1' },
    });
    const res = createMockResponse();

    await deleteHealthGoal(req, res);

    expect(mockTx.healthGoal.findFirst).toHaveBeenCalledWith({
      where: { id: 'goal-1', userId: USER_ID },
    });
    expect(mockTx.healthGoal.delete).toHaveBeenCalledWith({
      where: { id: 'goal-1' },
    });
    // Progress-history rows are cascaded by Prisma relations — the controller
    // does NOT issue an explicit goalProgressHistory.deleteMany.
    expect(mockTx.goalProgressHistory.deleteMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('throws NotFoundError when the goal does not exist or is not the user\'s', async () => {
    mockTx.healthGoal.findFirst.mockResolvedValue(null);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
      params: { id: 'goal-doesnt-exist' },
    });
    const res = createMockResponse();

    await expect(deleteHealthGoal(req, res)).rejects.toThrow(/Health goal not found/);
    expect(mockTx.healthGoal.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// suggestGoals
// ---------------------------------------------------------------------------

describe('suggestGoals', () => {
  it('returns suggestions derived from out-of-range biomarkers', async () => {
    mockTx.biomarker.findMany.mockResolvedValue([
      {
        id: 'bio-ldl',
        name: 'LDL Cholesterol',
        category: 'Lipids',
        valueEncrypted: 'enc:200',
        unit: 'mg/dL',
        normalRangeMin: 0,
        normalRangeMax: 100,
      },
    ]);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
    });
    const res = createMockResponse();

    await suggestGoals(req, res);

    // The controller filters to isOutOfRange biomarkers
    expect(mockTx.biomarker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, isOutOfRange: true }),
      })
    );

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.data[0]).toMatchObject({
      name: 'Optimize LDL Cholesterol',
      category: 'Lipids',
      targetValue: 50, // midpoint of (0, 100)
      unit: 'mg/dL',
      direction: 'MAINTAIN',
      relatedBiomarkerId: 'bio-ldl',
    });
  });

  it('falls back to generic suggestions when there are no out-of-range biomarkers', async () => {
    // Controller behavior: if out-of-range list is empty, it does NOT return an
    // empty array — it seeds two generic suggestions (blood-pressure + exercise).
    // This test locks in that current behavior.
    mockTx.biomarker.findMany.mockResolvedValue([]);

    const req = createMockRequest({
      user: { id: USER_ID, email: 'test@example.com', role: 'PATIENT' },
    });
    const res = createMockResponse();

    await suggestGoals(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(2);
    expect(payload.data.map((s: { name: string }) => s.name)).toEqual([
      'Maintain Healthy Blood Pressure',
      'Regular Exercise',
    ]);
    // Generic suggestions are NOT biomarker-linked
    expect(payload.data.every((s: { relatedBiomarkerId: string }) => s.relatedBiomarkerId === '')).toBe(true);
  });
});
