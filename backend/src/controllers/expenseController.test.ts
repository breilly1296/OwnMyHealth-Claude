/**
 * expenseController C-7 regression tests.
 *
 * Two invariants under test for `analyzeCosts`:
 *   1. BAA gate — when `config.anthropic.baaActive` is false the handler
 *      responds 503 and `messages.create` is never called, so no plan data
 *      ever transits.
 *   2. Minimum-necessary prompt — `planName` / `insurerName` values never
 *      appear in the prompt sent to Claude. Canned distinctive values
 *      make the test unambiguous if either field regresses back into the
 *      prompt string.
 *
 * Full coverage of expenseController (projections CRUD, analysis parsing)
 * is out of scope here — this is narrow to C-7.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Mocks ---------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  config: { anthropic: { baaActive: true, apiKey: 'test-key' } },
  withRLSTransaction: vi.fn(),
  logAccess: vi.fn(),
  logCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.messagesCreate };
    constructor(_opts: unknown) {}
  },
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return mocks.config;
  },
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSTransaction: (userId: string, fn: (tx: unknown) => unknown) =>
    mocks.withRLSTransaction(userId, fn),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => ({
    logAccess: mocks.logAccess,
    logCreate: mocks.logCreate,
  })),
}));

vi.mock('../services/encryption.js', () => ({
  getEncryptionService: vi.fn(() => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v.replace(/^enc\(/, '').replace(/\)$/, ''),
  })),
}));

vi.mock('../services/userEncryption.js', () => ({
  getUserEncryptionSalt: vi.fn(async () => 'salt'),
}));

vi.mock('../services/aiCostTracker.js', () => ({
  trackAIUsage: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// -- Imports AFTER mocks -------------------------------------------------
import { analyzeCosts, createProjection, createActual } from './expenseController.js';
import type { AuthenticatedRequest } from '../types/index.js';

function mockReq(userId: string, body: Record<string, unknown> = {}) {
  return {
    user: { id: userId },
    body,
    get: () => undefined,
    headers: {},
  } as unknown as AuthenticatedRequest;
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as import('express').Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

const PLAN_NAME_CANARY = 'TEST-PLAN-NAME-SHOULD-NOT-LEAK';
const INSURER_NAME_CANARY = 'TEST-INSURER-NAME-SHOULD-NOT-LEAK';

function cannedPlanAndProjections() {
  const plan = {
    id: 'plan-1',
    userId: 'user-1',
    planName: PLAN_NAME_CANARY,
    insurerName: INSURER_NAME_CANARY,
    planType: 'PPO',
    deductibleIndividual: 2000,
    deductibleFamily: 4000,
    deductibleMetIndividual: 500,
    oopMaxIndividual: 8000,
    oopMaxFamily: 16000,
    oopMetIndividual: 500,
    coinsuranceRate: 20,
    copayPrimaryCare: 25,
    copaySpecialist: 50,
    copayEmergency: 250,
  };
  const projections: Array<{
    id: string;
    serviceTypeEncrypted: string;
    estimatedCostEncrypted: string;
    frequencyPerYear: number;
    isInNetwork: boolean;
    notesEncrypted: string | null;
  }> = [
    {
      id: 'proj-1',
      serviceTypeEncrypted: 'enc(Primary Care Visit)',
      estimatedCostEncrypted: 'enc(200)',
      frequencyPerYear: 4,
      isInNetwork: true,
      notesEncrypted: null,
    },
  ];
  return { plan, projections };
}

describe('analyzeCosts (C-7)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mocks.config.anthropic.baaActive = true;
    mocks.messagesCreate.mockReset();
    mocks.withRLSTransaction.mockReset();
    mocks.logAccess.mockReset();
    mocks.logCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BAA gate', () => {
    it('throws ServiceUnavailableError and does not call messages.create when baaActive is false', async () => {
      // Post-F-22 refactor: analyzeCosts throws typed errors instead of
      // calling res.status() directly. Routes wrap the handler in
      // asyncHandler so the central errorHandler maps SERVICE_UNAVAILABLE →
      // 503 with the standard envelope. We assert the throw + audit + that
      // no PHI ever transited; the 503-response shape is verified inside
      // errorHandler's own tests.
      mocks.config.anthropic.baaActive = false;

      const req = mockReq('user-1', { planId: 'plan-1' });
      const res = mockRes();

      await expect(analyzeCosts(req, res)).rejects.toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('ANTHROPIC_BAA_ACTIVE'),
      });

      expect(mocks.messagesCreate).not.toHaveBeenCalled();
      // Blocked attempts are still audit-logged before the throw.
      expect(mocks.logAccess).toHaveBeenCalledWith(
        'cost_analysis',
        'plan-1',
        expect.any(Object),
        expect.objectContaining({ operation: 'ANALYZE_BLOCKED_NO_BAA' })
      );
    });
  });

  describe('minimum-necessary prompt', () => {
    it('does not include planName or insurerName values in the Claude prompt', async () => {
      const { plan, projections } = cannedPlanAndProjections();

      // First withRLSTransaction call returns { plan, projections }, second
      // call (for analysis.create) returns a dummy analysis row.
      mocks.withRLSTransaction
        .mockImplementationOnce(async () => ({ plan, projections }))
        .mockImplementationOnce(async () => ({
          id: 'analysis-1',
          analysisDate: new Date(),
        }));

      mocks.messagesCreate.mockResolvedValue({
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'analysis markdown' }],
        usage: { input_tokens: 100, output_tokens: 200 },
      });

      const req = mockReq('user-1', { planId: 'plan-1' });
      const res = mockRes();

      await analyzeCosts(req, res);

      expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
      const callArgs = mocks.messagesCreate.mock.calls[0][0];
      const promptText = callArgs.messages[0].content;

      expect(promptText).not.toContain(PLAN_NAME_CANARY);
      expect(promptText).not.toContain(INSURER_NAME_CANARY);

      // The non-PHI analysis inputs are still there.
      expect(promptText).toContain('PPO');
      expect(promptText).toContain('2,000');
    });
  });

  describe('disclaimer enforcement (L33)', () => {
    function primeForResponse(text: string) {
      const { plan, projections } = cannedPlanAndProjections();
      mocks.withRLSTransaction
        .mockImplementationOnce(async () => ({ plan, projections }))
        .mockImplementationOnce(async () => ({
          id: 'analysis-1',
          planId: 'plan-1',
          analysisDate: new Date(),
        }));
      mocks.messagesCreate.mockResolvedValue({
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 100, output_tokens: 200 },
      });
    }

    it('appends the educational disclaimer when the model omits it', async () => {
      primeForResponse('Your projected out-of-pocket cost is about $1,200 this year.');

      const res = mockRes();
      await analyzeCosts(mockReq('user-1', { planId: 'plan-1' }), res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.claudeResponse).toContain('consult your healthcare provider');
    });

    it('does not double-append when the model already supplied a disclaimer', async () => {
      primeForResponse(
        'Your projected cost is about $1,200. Always consult your healthcare provider for medical advice.'
      );

      const res = mockRes();
      await analyzeCosts(mockReq('user-1', { planId: 'plan-1' }), res);

      const payload = res.json.mock.calls[0][0];
      const matches = payload.data.claudeResponse.match(/consult your healthcare provider/gi) || [];
      expect(matches.length).toBe(1);
    });
  });
});

// L-4: a user must not be able to attach a projection/actual to a plan they
// don't own (the FK check bypasses RLS, so without an explicit ownership lookup
// the orphan-referencing insert would succeed).
describe('expense create plan-ownership guard (L-4)', () => {
  beforeEach(() => {
    mocks.withRLSTransaction.mockReset();
    mocks.logCreate.mockReset();
  });

  // Run the handler's tx callback against a tx whose insurancePlan.findFirst
  // returns `found` (null = not owned by the caller).
  function txReturning(found: unknown, create = vi.fn()) {
    return (_uid: string, fn: (tx: unknown) => unknown) =>
      fn({
        insurancePlan: { findFirst: vi.fn().mockResolvedValue(found) },
        expenseProjection: { create },
        expenseActual: { create },
      });
  }

  const projBody = { planId: 'someone-elses-plan', serviceType: 'MRI', estimatedCost: 500, frequencyPerYear: 1 };
  const actualBody = { planId: 'someone-elses-plan', serviceType: 'MRI', billedAmount: 500 };

  it('createProjection rejects a non-owned planId with NotFoundError', async () => {
    const create = vi.fn();
    mocks.withRLSTransaction.mockImplementation(txReturning(null, create));
    await expect(createProjection(mockReq('user-1', projBody), mockRes())).rejects.toThrow('Insurance plan not found');
    expect(create).not.toHaveBeenCalled(); // never inserted the orphan row
  });

  it('createActual rejects a non-owned planId with NotFoundError', async () => {
    const create = vi.fn();
    mocks.withRLSTransaction.mockImplementation(txReturning(null, create));
    await expect(createActual(mockReq('user-1', actualBody), mockRes())).rejects.toThrow('Insurance plan not found');
    expect(create).not.toHaveBeenCalled();
  });

  it('createProjection still succeeds when the plan IS owned', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'proj-1',
      serviceTypeEncrypted: 'enc(MRI)',
      estimatedCostEncrypted: 'enc(500)',
      notesEncrypted: null,
    });
    mocks.withRLSTransaction.mockImplementation(txReturning({ id: 'someone-elses-plan' }, create));
    const res = mockRes();
    await createProjection(mockReq('user-1', projBody), res);
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
