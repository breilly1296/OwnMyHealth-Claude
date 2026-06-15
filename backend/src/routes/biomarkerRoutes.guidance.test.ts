/**
 * biomarkerRoutes /:id/guidance — C-7 BAA gate + F-3 IDOR regression tests.
 *
 * Invariants under test:
 *   1. BAA gate — with `config.anthropic.baaActive` false, the route returns
 *      503 and `fetch` is never called. No biomarker data transits.
 *   2. IDOR — if the authenticated user does not own the biomarker (row
 *      returns null under RLS), the route returns 404 without calling
 *      `fetch`, and logs the access attempt.
 *   3. Happy path — owner gets guidance back when `fetch` returns a canned
 *      Anthropic response. Prompt is built from DB-decrypted values, never
 *      from `req.body`.
 *
 * Uses supertest against a minimal Express app that mounts the router with
 * auth/rate-limit/demo middleware stubbed out so they don't short-circuit
 * the handler we care about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Hoisted mocks -------------------------------------------------------
const mocks = vi.hoisted(() => ({
  config: { anthropic: { baaActive: true, apiKey: 'test-key' } },
  withRLSTransaction: vi.fn(),
  logAccess: vi.fn(),
  currentUserId: 'user-A',
  // Post-F-29: route was migrated from raw `fetch` to the shared
  // anthropicClient SDK. We stub the SDK at the boundary instead of
  // intercepting fetch — same observable contract for the test (we still
  // assert "the network call did/didn't happen and got the right prompt"),
  // but the mock matches the new code path.
  messagesCreate: vi.fn(),
  // Kept for back-compat with assertions written against `fetchMock`.
  // Forwarded from `messagesCreate` so existing `expect(mocks.fetchMock)`
  // stays meaningful: a call to messages.create is the new "did the
  // network call happen" signal.
  fetchMock: vi.fn(),
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
  // aiSpendGuard middleware (now on the guidance route) calls this atomic gate
  // and registers the returned settle() on response completion.
  admitAISpend: vi.fn(async () => ({ admitted: true, scope: null, settle: vi.fn() })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub authenticate so every request is treated as `mocks.currentUserId`.
vi.mock('../middleware/auth.js', () => ({
  authenticate: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    (req as { user?: { id: string; role: string; email: string } }).user = {
      id: mocks.currentUserId,
      role: 'PATIENT',
      email: 'test@example.com',
    };
    next();
  },
}));

// Rate limiter and demo guard — pass-through in tests.
vi.mock('../middleware/rateLimiter.js', () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkOperationLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/demoProtection.js', () => ({
  blockDemoAI: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Plan gating is covered in its own tests — pass-through here so the
// BAA / IDOR / happy-path invariants aren't coupled to a plan-limit check.
vi.mock('../middleware/planGating.js', () => ({
  requirePlanLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePlanFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Real controller not exercised here — mount-time import only.
vi.mock('../controllers/biomarkerController.js', () => ({
  getBiomarkers: vi.fn(),
  getBiomarker: vi.fn(),
  getHistory: vi.fn(),
  getSummary: vi.fn(),
  getCategories: vi.fn(),
  createBiomarker: vi.fn(),
  bulkCreateBiomarkers: vi.fn(),
  updateBiomarker: vi.fn(),
  deleteBiomarker: vi.fn(),
}));

// Stub the shared Anthropic client. Both spies fire on every call so
// existing `expect(mocks.fetchMock)…` assertions still pass — fetchMock
// is now an alias for "any Anthropic network call from this route".
vi.mock('../services/anthropicClient.js', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: (...args: unknown[]) => {
        mocks.fetchMock(...args);
        return mocks.messagesCreate(...args);
      },
    },
  })),
  isEnabled: () => Boolean(process.env.ANTHROPIC_API_KEY),
  reset: vi.fn(),
}));

// -- Imports AFTER mocks -------------------------------------------------
import express from 'express';
import request from 'supertest';
import biomarkerRouter from './biomarkerRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/biomarkers', biomarkerRouter);
  app.use(errorHandler);
  return app;
}

function validUuid(): string {
  return '11111111-1111-1111-1111-111111111111';
}

function cannedBiomarkerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: validUuid(),
    userId: 'user-A',
    name: 'HDL Cholesterol',
    unit: 'mg/dL',
    valueEncrypted: 'enc(55)',
    normalRangeMin: 40,
    normalRangeMax: 60,
    isOutOfRange: false,
    category: 'LIPIDS',
    measurementDate: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('POST /biomarkers/:id/guidance (C-7 + F-3)', () => {
  beforeEach(() => {
    mocks.config.anthropic.baaActive = true;
    mocks.currentUserId = 'user-A';
    mocks.withRLSTransaction.mockReset();
    mocks.logAccess.mockReset();
    mocks.fetchMock.mockReset();
    mocks.messagesCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BAA gate', () => {
    it('returns 503 and never calls fetch when baaActive is false', async () => {
      mocks.config.anthropic.baaActive = false;

      const app = buildApp();
      const res = await request(app)
        .post(`/api/v1/biomarkers/${validUuid()}/guidance`)
        .send({});

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: expect.stringContaining('ANTHROPIC_BAA_ACTIVE'),
        },
      });
      expect(mocks.fetchMock).not.toHaveBeenCalled();
      expect(mocks.withRLSTransaction).not.toHaveBeenCalled();
      expect(mocks.logAccess).toHaveBeenCalledWith(
        'biomarker_ai_guidance',
        validUuid(),
        expect.any(Object),
        expect.objectContaining({ operation: 'GUIDANCE_BLOCKED_NO_BAA' })
      );
    });
  });

  describe('F-3 IDOR regression', () => {
    it('returns 404 and does not call fetch when the biomarker is not owned by the caller', async () => {
      // userB is the caller, but the DB lookup returns null because RLS
      // filtered the row belonging to userA.
      mocks.currentUserId = 'user-B';
      mocks.withRLSTransaction.mockImplementationOnce(async () => ({
        biomarker: null,
        historyRows: [],
      }));

      const app = buildApp();
      const res = await request(app)
        .post(`/api/v1/biomarkers/${validUuid()}/guidance`)
        .send({
          // Body should be ignored — a malicious client might try to pass
          // an attacker-controlled biomarker shape here.
          biomarker: { name: 'EVIL-INJECTED', value: 999, unit: 'x', status: 'foo' },
        });

      expect(res.status).toBe(404);
      expect(mocks.fetchMock).not.toHaveBeenCalled();
      expect(mocks.logAccess).toHaveBeenCalledWith(
        'biomarker_ai_guidance',
        validUuid(),
        expect.any(Object),
        expect.objectContaining({ operation: 'GUIDANCE_NOT_FOUND' })
      );
    });
  });

  describe('happy path', () => {
    it('returns guidance built from DB-decrypted values, not req.body', async () => {
      mocks.currentUserId = 'user-A';
      mocks.withRLSTransaction.mockImplementationOnce(async () => ({
        biomarker: cannedBiomarkerRow(),
        historyRows: [
          {
            valueEncrypted: 'enc(52)',
            measurementDate: new Date('2025-10-01'),
          },
        ],
      }));

      // Post-F-29: SDK call shape (no `.ok` / `.json()` indirection).
      mocks.messagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Canned guidance text.' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const app = buildApp();
      const res = await request(app)
        .post(`/api/v1/biomarkers/${validUuid()}/guidance`)
        .send({
          // Attacker-supplied shape that MUST NOT appear in the prompt.
          biomarker: { name: 'INJECTED', value: 999, unit: 'BAD', status: 'hacked' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // L33: the mocked model output carries no disclaimer, so the server
      // appends the canonical educational disclaimer to the returned guidance.
      expect(res.body.data.guidance).toContain('Canned guidance text.');
      expect(res.body.data.guidance).toContain('This information is educational only');

      // Post-F-29: assert against the SDK call shape. messages.create
      // receives `{ model, max_tokens, messages: [{ role, content }] }` as
      // the first arg; no `https://api.anthropic.com/v1/messages` URL to
      // check (the SDK manages that). Prompt text is at messages[0].content.
      expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
      const callArgs = mocks.messagesCreate.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      const promptText = callArgs.messages[0].content;

      // DB-decrypted values are in the prompt.
      expect(promptText).toContain('HDL Cholesterol');
      expect(promptText).toContain('55 mg/dL');
      expect(promptText).toContain('52 (2025-10-01)');

      // req.body values are NOT in the prompt.
      expect(promptText).not.toContain('INJECTED');
      expect(promptText).not.toContain('BAD');
      expect(promptText).not.toContain('hacked');

      // PHI-access audit log entry.
      expect(mocks.logAccess).toHaveBeenCalledWith(
        'biomarker_ai_guidance',
        validUuid(),
        expect.any(Object),
        expect.objectContaining({ operation: 'PHI_ACCESS' })
      );

      // F-16 fix: the audit metadata must NOT contain the biomarker name
      // in plaintext. The resourceId (positional arg #2 = the UUID) is
      // already enough for traceability; storing names like "HIV viral
      // load" in plaintext metadata leaks condition info that the
      // encrypted PHI columns are supposed to protect.
      const phiAccessCall = mocks.logAccess.mock.calls.find(
        (c) => c[3]?.operation === 'PHI_ACCESS'
      );
      expect(phiAccessCall).toBeDefined();
      const auditMetadata = phiAccessCall![3] as Record<string, unknown>;
      expect(auditMetadata).not.toHaveProperty('biomarkerName');
      expect(JSON.stringify(auditMetadata)).not.toContain('HDL Cholesterol');
    });
  });
});
