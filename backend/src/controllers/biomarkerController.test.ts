/**
 * biomarkerController unit tests.
 *
 * Covers:
 *   - getBiomarkers: user scoping + decryption on the way out
 *   - createBiomarker: value/notes are encrypted before `tx.biomarker.create`
 *   - deleteBiomarker: ownership-scoped delete + 404 when the row belongs
 *     to another user
 *   - POST /:id/guidance (F-3 IDOR regression): the handler re-fetches the
 *     biomarker from the DB by (id, userId) under RLS instead of trusting
 *     `req.body.biomarker`. Before F-3 was fixed, a client could spoof any
 *     biomarker shape in the body and have it sent to Claude.
 *     The guidance handler is not a named export on biomarkerController —
 *     it lives inline in biomarkerRoutes.ts. We exercise it via supertest
 *     against a minimal Express app (same shape as
 *     `biomarkerRoutes.guidance.test.ts`), since it's semantically a
 *     biomarker controller endpoint.
 *
 * Follows the hoisted-mock pattern from `settingsController.test.ts` and
 * `expenseController.test.ts`: every `vi.mock(...)` call is declared BEFORE
 * the controller/router import so the mocks resolve the mocked modules.
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

// -- Hoisted handles — shared across both the controller-unit tests and
//    the route-level guidance test. vi.hoisted() runs before vi.mock()
//    factories, which run before the top-level imports.
const mocks = vi.hoisted(() => ({
  tx: null as unknown,
  auditService: null as unknown,
  encryptionService: null as unknown,
  config: { anthropic: { baaActive: true, apiKey: 'test-key' } },
  // Post-F-29: route now uses the shared anthropicClient SDK instead of
  // raw fetch. `fetchMock` stays as the assertion handle (legacy name) and
  // gets called for every messages.create — see the vi.mock below.
  fetchMock: null as unknown,
  messagesCreate: null as unknown,
  currentUserId: 'test-user-id',
  // Guidance-path transaction return. Distinct from the default `tx` because
  // the guidance route returns a shaped `{ biomarker, historyRows }` object
  // from its own withRLSTransaction callback rather than calling tx methods.
  guidanceTxResult: null as unknown,
}));

// -- Mocks ----------------------------------------------------------------

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn((mocks.tx as Record<string, unknown>) ?? {})
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) => {
    // If a guidance-specific result was staged, return that (the guidance
    // route constructs and returns its own shape from inside the callback).
    if (mocks.guidanceTxResult !== null) {
      const result = mocks.guidanceTxResult;
      mocks.guidanceTxResult = null;
      return result;
    }
    return fn((mocks.tx as Record<string, unknown>) ?? {});
  }),
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

vi.mock('../services/aiCostTracker.js', () => ({
  trackAIUsage: vi.fn(),
  // The controller only uses trackAIUsage; admitAISpend is mocked too so the
  // module stub stays complete if the guard is ever exercised here.
  admitAISpend: vi.fn(async () => ({ admitted: true, scope: null, settle: vi.fn() })),
}));

// Post-F-29: route now uses the shared anthropicClient SDK. Stub
// `getAnthropicClient` to return a client whose `messages.create` forwards
// to both `mocks.fetchMock` (legacy alias for "the network call happened")
// and `mocks.messagesCreate` (the SDK-shaped resolver each test sets).
vi.mock('../services/anthropicClient.js', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: (...args: unknown[]) => {
        if (mocks.fetchMock) (mocks.fetchMock as ReturnType<typeof vi.fn>)(...args);
        if (mocks.messagesCreate) {
          return (mocks.messagesCreate as ReturnType<typeof vi.fn>)(...args);
        }
        return Promise.resolve({ content: [{ type: 'text', text: '' }] });
      },
    },
  }),
  isEnabled: () => Boolean(process.env.ANTHROPIC_API_KEY),
  reset: () => undefined,
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return mocks.config;
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() },
}));

// For the guidance-route test only: stub authenticate and rate-limit
// middleware so the request reaches the handler.
vi.mock('../middleware/auth.js', () => ({
  authenticate: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    (req as { user?: { id: string; role: string; email: string } }).user = {
      id: mocks.currentUserId,
      role: 'PATIENT',
      email: 'test@example.com',
    };
    next();
  },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkOperationLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/demoProtection.js', () => ({
  blockDemoAI: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/planGating.js', () => ({
  requirePlanLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePlanFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// -- Imports AFTER mocks --------------------------------------------------
import {
  getBiomarkers,
  createBiomarker,
  bulkCreateBiomarkers,
  deleteBiomarker,
} from './biomarkerController.js';
import { NotFoundError } from '../middleware/errorHandler.js';

// ============================================================================
// getBiomarkers
// ============================================================================
describe('getBiomarkers', () => {
  let tx: MockPrismaTx;
  let audit: MockAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createMockPrismaTransaction();
    audit = createMockAuditService();
    mocks.tx = tx;
    mocks.auditService = audit;
    mocks.encryptionService = createMockEncryptionService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scopes the findMany to the authenticated userId', async () => {
    tx.biomarker.count.mockResolvedValue(3);
    tx.biomarker.findMany.mockResolvedValue([
      makeBiomarkerRow({ id: 'b1', valueEncrypted: 'enc:120' }),
      makeBiomarkerRow({ id: 'b2', valueEncrypted: 'enc:130' }),
      makeBiomarkerRow({ id: 'b3', valueEncrypted: 'enc:140' }),
    ]);

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      query: {},
    });
    const res = createMockResponse();

    await getBiomarkers(req, res);

    expect(tx.biomarker.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = tx.biomarker.findMany.mock.calls[0][0];
    expect(findManyArg.where).toEqual({ userId: 'user-A' });

    // Audit log was written for the LIST access.
    expect(audit.logAccess).toHaveBeenCalledWith(
      'Biomarker',
      undefined,
      expect.any(Object),
      expect.objectContaining({ operation: 'LIST', count: 3 })
    );

    // Response returned three rows.
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(3);
  });

  it('returns decrypted values (parsed as numbers) in the response', async () => {
    tx.biomarker.count.mockResolvedValue(1);
    tx.biomarker.findMany.mockResolvedValue([
      makeBiomarkerRow({ id: 'b1', valueEncrypted: 'enc:123' }),
    ]);

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
    });
    const res = createMockResponse();

    await getBiomarkers(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data[0].value).toBe(123);
    expect(typeof payload.data[0].value).toBe('number');
  });
});

// ============================================================================
// createBiomarker
// ============================================================================
describe('createBiomarker', () => {
  let tx: MockPrismaTx;
  let audit: MockAuditService;
  let encryption: ReturnType<typeof createMockEncryptionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createMockPrismaTransaction();
    audit = createMockAuditService();
    encryption = createMockEncryptionService();
    mocks.tx = tx;
    mocks.auditService = audit;
    mocks.encryptionService = encryption;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts value and notes before calling tx.biomarker.create', async () => {
    const createdRow = makeBiomarkerRow({
      id: 'new-b',
      valueEncrypted: 'enc:95',
      notesEncrypted: 'enc:Fasted 12h',
    });
    tx.biomarker.create.mockResolvedValue(createdRow);

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      body: {
        name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        category: 'METABOLIC',
        date: '2026-04-18',
        normalRange: { min: 70, max: 100 },
        notes: 'Fasted 12h',
        sourceType: 'MANUAL',
      },
    });
    const res = createMockResponse();

    await createBiomarker(req, res);

    // Encryption service called for both value and notes with userSalt.
    expect(encryption.encrypt).toHaveBeenCalledWith('95', 'salt');
    expect(encryption.encrypt).toHaveBeenCalledWith('Fasted 12h', 'salt');

    // tx.biomarker.create called with the encrypted payload, not the raw value.
    expect(tx.biomarker.create).toHaveBeenCalledTimes(1);
    const createArg = tx.biomarker.create.mock.calls[0][0];
    expect(createArg.data.valueEncrypted).toBe('enc:95');
    expect(createArg.data.notesEncrypted).toBe('enc:Fasted 12h');
    expect(createArg.data.userId).toBe('user-A');

    // Raw `value` field is never persisted.
    expect(createArg.data).not.toHaveProperty('value');
    expect(createArg.data).not.toHaveProperty('notes');

    // Out-of-range correctly computed: 95 is in [70, 100].
    expect(createArg.data.isOutOfRange).toBe(false);

    // Audit log written.
    expect(audit.logCreate).toHaveBeenCalledWith(
      'Biomarker',
      'new-b',
      expect.objectContaining({ name: 'Glucose', category: 'METABOLIC', value: 95 }),
      expect.any(Object)
    );

    // Response is 201 with the decrypted-on-the-way-out payload.
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('persists notesEncrypted as null when notes are omitted', async () => {
    tx.biomarker.create.mockResolvedValue(
      makeBiomarkerRow({ id: 'b2', notesEncrypted: null })
    );

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      body: {
        name: 'HDL',
        value: 55,
        unit: 'mg/dL',
        category: 'LIPIDS',
        date: '2026-04-18',
        normalRange: { min: 40, max: 60 },
      },
    });
    const res = createMockResponse();

    await createBiomarker(req, res);

    const createArg = tx.biomarker.create.mock.calls[0][0];
    expect(createArg.data.notesEncrypted).toBeNull();
    // encrypt should only have been called once (for the value), not for notes.
    const encryptedStringCalls = encryption.encrypt.mock.calls.filter(
      (c) => c[0] !== '55'
    );
    expect(encryptedStringCalls).toHaveLength(0);
  });

  it('appends a newer reading to an existing series and responds 200 (promoted)', async () => {
    // An existing Glucose series whose current point is 2026-01-15.
    const existing = makeBiomarkerRow({
      id: 'series-1',
      measurementDate: new Date('2026-01-15'),
      valueEncrypted: 'enc:88',
    });
    tx.biomarker.findFirst.mockResolvedValue(existing);
    tx.biomarker.update.mockResolvedValue(
      makeBiomarkerRow({
        id: 'series-1',
        valueEncrypted: 'enc:99',
        measurementDate: new Date('2026-02-01'),
        history: [{ measurementDate: new Date('2026-01-15'), valueEncrypted: 'enc:88' }],
      })
    );

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      body: {
        name: 'Glucose',
        value: 99,
        unit: 'mg/dL',
        category: 'METABOLIC',
        date: '2026-02-01',
        normalRange: { min: 70, max: 100 },
      },
    });
    const res = createMockResponse();

    await createBiomarker(req, res);

    // The prior current point was archived and the series advanced — NOT a new row.
    expect(tx.biomarkerHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.biomarker.update).toHaveBeenCalledTimes(1);
    expect(tx.biomarker.create).not.toHaveBeenCalled();

    // A merge mints no new resource → 200, and the audit records the outcome.
    expect(res.status).toHaveBeenCalledWith(200);
    expect(audit.logCreate).toHaveBeenCalledWith(
      'Biomarker',
      'series-1',
      expect.objectContaining({ name: 'Glucose', seriesOutcome: 'promoted' }),
      expect.any(Object)
    );
  });

  // Note: the controller does NOT itself validate `category` against an
  // allowlist — that is delegated to the Zod route-level schema, and the
  // Zod schema allows any sanitized 1-50 char string (not an enum). There
  // is therefore no controller-level invalid-category test to write here.
});

// ============================================================================
// bulkCreateBiomarkers — series merge
// ============================================================================
describe('bulkCreateBiomarkers', () => {
  let tx: MockPrismaTx;
  let audit: MockAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createMockPrismaTransaction();
    audit = createMockAuditService();
    mocks.tx = tx;
    mocks.auditService = audit;
    mocks.encryptionService = createMockEncryptionService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('collapses two readings of the same metric into one series row', async () => {
    const created1 = makeBiomarkerRow({
      id: 'series-1',
      measurementDate: new Date('2026-01-01'),
      valueEncrypted: 'enc:90',
    });
    // 1st item: no existing series -> create. 2nd item (same name, newer): finds it -> promote.
    tx.biomarker.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(created1);
    tx.biomarker.create.mockResolvedValue({ ...created1, history: [] });
    tx.biomarker.update.mockResolvedValue(
      makeBiomarkerRow({
        id: 'series-1',
        valueEncrypted: 'enc:99',
        measurementDate: new Date('2026-02-01'),
        history: [{ measurementDate: new Date('2026-01-01'), valueEncrypted: 'enc:90' }],
      })
    );

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      body: {
        biomarkers: [
          { name: 'Glucose', value: 90, unit: 'mg/dL', category: 'METABOLIC', date: '2026-01-01', normalRange: { min: 70, max: 100 } },
          { name: 'Glucose', value: 99, unit: 'mg/dL', category: 'METABOLIC', date: '2026-02-01', normalRange: { min: 70, max: 100 } },
        ],
      },
    });
    const res = createMockResponse();

    await bulkCreateBiomarkers(req, res);

    // One create (anchor) + one promote (merge), NOT two inserts.
    expect(tx.biomarker.create).toHaveBeenCalledTimes(1);
    expect(tx.biomarker.update).toHaveBeenCalledTimes(1);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Two readings persisted, but only one series row returned.
    expect(payload.data).toHaveLength(1);
    expect(payload.meta).toMatchObject({ total: 2, succeeded: 2, seriesAffected: 1, failed: 0 });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ============================================================================
// deleteBiomarker
// ============================================================================
describe('deleteBiomarker', () => {
  let tx: MockPrismaTx;
  let audit: MockAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createMockPrismaTransaction();
    audit = createMockAuditService();
    mocks.tx = tx;
    mocks.auditService = audit;
    mocks.encryptionService = createMockEncryptionService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('finds + deletes scoped to (id, userId), then audit-logs', async () => {
    const row = makeBiomarkerRow({ id: 'b-to-delete', name: 'LDL', category: 'LIPIDS' });
    tx.biomarker.findFirst.mockResolvedValue(row);
    tx.biomarker.delete.mockResolvedValue(row);

    const req = createMockRequest({
      user: { id: 'user-A', email: 'a@example.com', role: 'PATIENT' },
      params: { id: 'b-to-delete' },
    });
    const res = createMockResponse();

    await deleteBiomarker(req, res);

    // Lookup scoped to both id and userId.
    expect(tx.biomarker.findFirst).toHaveBeenCalledWith({
      where: { id: 'b-to-delete', userId: 'user-A' },
    });

    // Delete executed against that row.
    expect(tx.biomarker.delete).toHaveBeenCalledWith({
      where: { id: 'b-to-delete' },
    });

    // Audit trail.
    expect(audit.logDelete).toHaveBeenCalledWith(
      'Biomarker',
      'b-to-delete',
      expect.objectContaining({ name: 'LDL', category: 'LIPIDS' }),
      expect.any(Object)
    );

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('throws NotFoundError when the biomarker belongs to another user (findFirst returns null)', async () => {
    // Simulate the RLS-scoped lookup returning null because the row is owned
    // by someone else.
    tx.biomarker.findFirst.mockResolvedValue(null);

    const req = createMockRequest({
      user: { id: 'user-B', email: 'b@example.com', role: 'PATIENT' },
      params: { id: 'b-owned-by-user-A' },
    });
    const res = createMockResponse();

    await expect(deleteBiomarker(req, res)).rejects.toBeInstanceOf(NotFoundError);

    // Never attempted to delete.
    expect(tx.biomarker.delete).not.toHaveBeenCalled();
    // No audit log for a delete that didn't happen.
    expect(audit.logDelete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// POST /:id/guidance — F-3 IDOR regression
//
// The guidance handler is defined as an inline closure in biomarkerRoutes.ts,
// not as a named export on biomarkerController. It's semantically a
// biomarker-endpoint test so we cover it here. Exercised via supertest
// against a minimal Express app mirroring `biomarkerRoutes.guidance.test.ts`.
// ============================================================================
describe('POST /biomarkers/:id/guidance — F-3 IDOR regression', () => {
  // Dynamic imports inside beforeEach so the mocks above are already applied
  // before Express/supertest/biomarkerRouter are loaded.
  let app: import('express').Express;
  let request: typeof import('supertest').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.currentUserId = 'user-A';
    mocks.config.anthropic.baaActive = true;
    mocks.encryptionService = {
      encrypt: vi.fn((v: string) => `enc:${v}`),
      decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
    };
    mocks.auditService = createMockAuditService();
    mocks.fetchMock = vi.fn();
    mocks.messagesCreate = vi.fn();
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const express = (await import('express')).default;
    request = (await import('supertest')).default;
    const biomarkerRouter = (await import('../routes/biomarkerRoutes.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/biomarkers', biomarkerRouter);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.guidanceTxResult = null;
  });

  const VALID_UUID = '11111111-1111-1111-1111-111111111111';

  it('returns 404 when the biomarker does not exist for this user', async () => {
    mocks.guidanceTxResult = { biomarker: null, historyRows: [] };

    const res = await request(app)
      .post(`/api/v1/biomarkers/${VALID_UUID}/guidance`)
      .send({});

    expect(res.status).toBe(404);
    expect((mocks.fetchMock as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const audit = mocks.auditService as MockAuditService;
    expect(audit.logAccess).toHaveBeenCalledWith(
      'biomarker_ai_guidance',
      VALID_UUID,
      expect.any(Object),
      expect.objectContaining({ operation: 'GUIDANCE_NOT_FOUND' })
    );
  });

  it('returns 404 when the biomarker belongs to a different user (RLS filters it)', async () => {
    // user-B calls the endpoint for a biomarker owned by user-A. Under RLS,
    // the query returns null; the handler treats that as 404 regardless of
    // whether the row exists, to avoid enumeration.
    mocks.currentUserId = 'user-B';
    mocks.guidanceTxResult = { biomarker: null, historyRows: [] };

    const res = await request(app)
      .post(`/api/v1/biomarkers/${VALID_UUID}/guidance`)
      .send({
        // Attacker-supplied body — must be ignored.
        biomarker: {
          name: 'EVIL-INJECTED',
          value: 999,
          unit: 'bad',
          status: 'out-of-range',
        },
      });

    expect(res.status).toBe(404);
    expect((mocks.fetchMock as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('builds the Claude prompt from DB-sourced data, NOT from req.body', async () => {
    // The DB has the TRUE biomarker. The request body has a spoofed one.
    mocks.guidanceTxResult = {
      biomarker: {
        id: VALID_UUID,
        userId: 'user-A',
        name: 'HDL Cholesterol',
        unit: 'mg/dL',
        valueEncrypted: 'enc:55',
        normalRangeMin: 40,
        normalRangeMax: 60,
        isOutOfRange: false,
        category: 'LIPIDS',
        measurementDate: new Date('2026-01-01'),
      },
      historyRows: [
        { valueEncrypted: 'enc:52', measurementDate: new Date('2025-10-01') },
      ],
    };

    // SDK shape — no `.ok` / `.json()` indirection.
    (mocks.messagesCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: 'text', text: 'Canned guidance text.' }],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const res = await request(app)
      .post(`/api/v1/biomarkers/${VALID_UUID}/guidance`)
      .send({
        // Attacker-controlled shape — MUST NOT make it into the prompt.
        biomarker: {
          name: 'INJECTED',
          value: 999,
          unit: 'BAD',
          status: 'hacked',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { guidance: 'Canned guidance text.' },
    });

    // Post-F-29: SDK call shape. messages.create receives the request body
    // directly as the first arg; no fetch URL to assert (the SDK manages
    // that). The fetchMock alias still records the call so legacy
    // assertions like `not.toHaveBeenCalled()` keep working.
    expect((mocks.messagesCreate as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const callArgs = (mocks.messagesCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    const promptText: string = callArgs.messages[0].content;

    // The DB-sourced values appear in the prompt.
    expect(promptText).toContain('HDL Cholesterol');
    expect(promptText).toContain('55 mg/dL');
    expect(promptText).toContain('52 (2025-10-01)');

    // The client-supplied spoof does NOT appear in the prompt.
    expect(promptText).not.toContain('INJECTED');
    expect(promptText).not.toContain('BAD');
    expect(promptText).not.toContain('hacked');
    expect(promptText).not.toContain('999');

    // PHI-disclosure audit entry was recorded.
    const audit = mocks.auditService as MockAuditService;
    expect(audit.logAccess).toHaveBeenCalledWith(
      'biomarker_ai_guidance',
      VALID_UUID,
      expect.any(Object),
      expect.objectContaining({ operation: 'PHI_ACCESS' })
    );
  });
});

// ============================================================================
// Local helpers
// ============================================================================

interface BiomarkerRowOverrides {
  id?: string;
  userId?: string;
  name?: string;
  category?: string;
  unit?: string;
  valueEncrypted?: string;
  notesEncrypted?: string | null;
  normalRangeMin?: number;
  normalRangeMax?: number;
  normalRangeSource?: string | null;
  measurementDate?: Date;
  sourceType?: string;
  sourceFile?: string | null;
  extractionConfidence?: number | null;
  labName?: string | null;
  isOutOfRange?: boolean;
  isAcknowledged?: boolean;
  history?: { measurementDate: Date; valueEncrypted: string }[];
  createdAt?: Date;
  updatedAt?: Date;
}

function makeBiomarkerRow(overrides: BiomarkerRowOverrides = {}) {
  return {
    id: 'b1',
    userId: 'user-A',
    name: 'Glucose',
    category: 'METABOLIC',
    unit: 'mg/dL',
    valueEncrypted: 'enc:95',
    notesEncrypted: null,
    normalRangeMin: 70,
    normalRangeMax: 100,
    normalRangeSource: null,
    measurementDate: new Date('2026-04-18'),
    sourceType: 'MANUAL',
    sourceFile: null,
    extractionConfidence: null,
    labName: null,
    isOutOfRange: false,
    isAcknowledged: false,
    history: [],
    createdAt: new Date('2026-04-18'),
    updatedAt: new Date('2026-04-18'),
    ...overrides,
  };
}
