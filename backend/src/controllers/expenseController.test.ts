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
import { analyzeCosts } from './expenseController.js';
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
    it('returns 503 and does not call messages.create when baaActive is false', async () => {
      mocks.config.anthropic.baaActive = false;

      const req = mockReq('user-1', { planId: 'plan-1' });
      const res = mockRes();

      await analyzeCosts(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body).toMatchObject({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: expect.stringContaining('ANTHROPIC_BAA_ACTIVE'),
        },
      });

      expect(mocks.messagesCreate).not.toHaveBeenCalled();
      // Blocked attempts are audit-logged.
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
});
