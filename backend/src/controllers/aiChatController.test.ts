/**
 * aiChatController unit tests (P1-6 — first coverage for the highest-traffic
 * PHI-egress path: user health context streamed to Claude over SSE).
 *
 * Covers the controller's security contract, not Claude's answers:
 *   - BAA gate: no Claude call and no context assembly when
 *     ANTHROPIC_BAA_ACTIVE is off; blocked attempt audited under the
 *     non-quota resource type (L-35).
 *   - L42 fail-closed pre-flight audit: if the CHAT_INITIATED audit row
 *     cannot be written, NO PHI leaves for Anthropic.
 *   - PHI scrubbing on the stream, including a pattern that straddles an
 *     SSE chunk boundary (the PHI_SCRUB_WINDOW trailing buffer).
 *   - L33 disclaimer enforcement: appended when the model omits it,
 *     not duplicated when the model included one.
 *   - History truncation to the last 20 messages before the Claude call.
 *   - Stream failure: error SSE + failed attempt audited under the
 *     non-quota resource type, and no usage tracked.
 *
 * Follows the hoisted-mock pattern from `biomarkerController.test.ts`:
 * every `vi.mock(...)` is declared BEFORE the controller import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockAuditService } from './testHelpers.js';
import { AI_DISCLAIMER } from '../utils/aiDisclaimer.js';
import type { Response } from 'express';

const mocks = vi.hoisted(() => ({
  auditService: null as unknown,
  config: { anthropic: { baaActive: true, apiKey: 'test-key' } },
  streamFactory: null as unknown,
  assembleHealthContext: null as unknown,
  trackAIUsage: null as unknown,
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../services/healthContextService.js', () => ({
  assembleHealthContext: vi.fn(async (userId: string) => {
    if (mocks.assembleHealthContext) {
      return (mocks.assembleHealthContext as ReturnType<typeof vi.fn>)(userId);
    }
    return { biomarkers: [] };
  }),
  serializeHealthContext: vi.fn(() => 'USER HEALTH DATA:\n(none)'),
  summarizeContextCategories: vi.fn(() => ({ contextCategories: 'none' })),
  estimateContextTokens: vi.fn(() => 100),
}));

vi.mock('../services/knowledge/knowledgeRetrieval.js', () => ({
  retrieveKnowledge: vi.fn(() => ({ documents: [], totalTokens: 0 })),
}));

// Passthrough sanitizer with the real length-cap behavior the controller
// relies on; the real implementation's control-char stripping is covered by
// validation.test.ts.
vi.mock('../middleware/validation.js', () => ({
  sanitizeForPrompt: vi.fn((s: string, max: number) => String(s).slice(0, max)),
}));

vi.mock('../services/aiCostTracker.js', () => ({
  trackAIUsage: vi.fn((...args: unknown[]) => {
    if (mocks.trackAIUsage) (mocks.trackAIUsage as ReturnType<typeof vi.fn>)(...args);
  }),
}));

vi.mock('../services/anthropicClient.js', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: (...args: unknown[]) =>
        (mocks.streamFactory as ReturnType<typeof vi.fn>)(...args),
    },
  }),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return mocks.config;
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startup: vi.fn(),
    createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// phiRedaction + aiDisclaimer are deliberately REAL — the scrub-window and
// disclaimer tests must prove the controller wires the real behavior.

// -- Imports AFTER mocks --------------------------------------------------
import { handleAIChat } from './aiChatController.js';

// -- Fixtures ---------------------------------------------------------------

/** Fake Anthropic message stream: async-iterable text deltas + finalMessage. */
function makeFakeStream(
  chunks: string[],
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 11, output_tokens: 22 },
  failAfterFirstChunk = false
) {
  return {
    async *[Symbol.asyncIterator]() {
      let emitted = 0;
      for (const text of chunks) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
        emitted++;
        if (failAfterFirstChunk && emitted === 1) {
          throw new Error('anthropic stream dropped');
        }
      }
    },
    finalMessage: vi.fn(async () => ({ usage })),
  };
}

/** Response stub that records SSE writes; parses them back for assertions. */
function makeSSEResponse() {
  const writes: string[] = [];
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.flushHeaders = vi.fn();
  res.write = vi.fn((chunk: string) => {
    writes.push(String(chunk));
    return true;
  });
  res.end = vi.fn().mockReturnValue(res);
  const events = (): Array<Record<string, unknown>> =>
    writes
      .join('')
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)));
  const emittedText = (): string =>
    events()
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => (e.delta as { text: string }).text)
      .join('');
  return { res: res as unknown as Response, events, emittedText };
}

function makeChatRequest(message = 'What does my LDL mean?', history?: Array<{ role: string; content: string }>) {
  return createMockRequest({
    body: { message, ...(history ? { conversationHistory: history } : {}) },
  });
}

describe('handleAIChat', () => {
  let auditService: ReturnType<typeof createMockAuditService>;
  let streamFactory: ReturnType<typeof vi.fn>;
  let trackAIUsage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    auditService = createMockAuditService();
    mocks.auditService = auditService;
    mocks.config = { anthropic: { baaActive: true, apiKey: 'test-key' } };
    streamFactory = vi.fn(() => makeFakeStream(['Hello. ', 'LDL is a lipid measure.']));
    mocks.streamFactory = streamFactory;
    trackAIUsage = vi.fn();
    mocks.trackAIUsage = trackAIUsage;
    mocks.assembleHealthContext = null;
  });

  describe('BAA gate (C-7)', () => {
    it('refuses with 503 and never calls Claude when ANTHROPIC_BAA_ACTIVE is off', async () => {
      mocks.config = { anthropic: { baaActive: false, apiKey: 'test-key' } };
      const { res } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(streamFactory).not.toHaveBeenCalled();
      // Blocked attempt is audited under the NON-quota resource type (L-35)
      // so it does not consume an aiChatsPerDay slot.
      expect(auditService.logAccess).toHaveBeenCalledWith(
        'HealthGuideAttempt',
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'CHAT_BLOCKED_NO_BAA' }),
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('context assembly failure', () => {
    it('returns 500 without calling Claude when health-context assembly throws', async () => {
      mocks.assembleHealthContext = vi.fn(async () => {
        throw new Error('decrypt blew up');
      });
      const { res } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'CONTEXT_ASSEMBLY_FAILED' }),
        })
      );
      expect(streamFactory).not.toHaveBeenCalled();
    });
  });

  describe('L42 fail-closed pre-flight audit', () => {
    it('makes NO Claude call and flushes no SSE headers when the CHAT_INITIATED audit write fails', async () => {
      auditService.logAccess.mockImplementation(
        async (_r: string, _id: unknown, _ctx: unknown, meta: Record<string, unknown>) => {
          if (meta?.operation === 'CHAT_INITIATED') throw new Error('audit DB down');
        }
      );
      const { res } = makeSSEResponse();

      await expect(handleAIChat(makeChatRequest(), res)).rejects.toThrow('audit DB down');

      expect(streamFactory).not.toHaveBeenCalled();
      expect((res as unknown as { flushHeaders: ReturnType<typeof vi.fn> }).flushHeaders).not.toHaveBeenCalled();
    });
  });

  describe('happy path streaming', () => {
    it('streams SSE deltas, reports usage, tracks cost, and audits under the quota resource type', async () => {
      const { res, events, emittedText } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(emittedText()).toContain('LDL is a lipid measure.');

      const stop = events().find((e) => e.type === 'message_stop');
      expect(stop?.usage).toEqual({ input_tokens: 11, output_tokens: 22 });
      expect(res.end).toHaveBeenCalled();

      expect(trackAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'ai-chat',
          inputTokens: 11,
          outputTokens: 22,
          userId: 'test-user-id',
        })
      );

      // Success audit under the QUOTA-counted resource type, and it must
      // never carry the question or the answer.
      const successCall = auditService.logAccess.mock.calls.find(
        (c: unknown[]) => c[0] === 'HealthGuide'
      );
      expect(successCall).toBeDefined();
      const meta = successCall![3] as Record<string, unknown>;
      expect(meta.operation).toBe('CHAT');
      expect(JSON.stringify(meta)).not.toContain('What does my LDL mean?');
      expect(JSON.stringify(meta)).not.toContain('LDL is a lipid measure.');
    });

    it('appends the educational disclaimer exactly once when the model omits it (L33)', async () => {
      streamFactory.mockImplementation(() => makeFakeStream(['Your LDL is in range.']));
      const { res, emittedText } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      const text = emittedText();
      expect(text).toContain(AI_DISCLAIMER);
      expect(text.split(AI_DISCLAIMER)).toHaveLength(2); // exactly one occurrence
    });

    it('does NOT duplicate the disclaimer when the model already included an equivalent', async () => {
      streamFactory.mockImplementation(() =>
        makeFakeStream(['Your LDL looks fine. Always consult your healthcare provider for advice.'])
      );
      const { res, emittedText } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(emittedText()).not.toContain(AI_DISCLAIMER);
    });
  });

  describe('PHI scrubbing on the output stream', () => {
    it('redacts an SSN emitted by the model', async () => {
      streamFactory.mockImplementation(() => makeFakeStream(['Your record shows 123-45-6789 on file.']));
      const { res, emittedText } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(emittedText()).not.toContain('123-45-6789');
      expect(emittedText()).toContain('[SSN_REDACTED]');
    });

    it('redacts a PHI pattern that STRADDLES an SSE chunk boundary (scrub window)', async () => {
      // Padding pushes the first fragment past PHI_SCRUB_WINDOW (64 chars) so
      // the controller flushes mid-pattern; the trailing buffer must keep the
      // fragment back until chunk 2 completes it.
      const padding = 'x'.repeat(100);
      streamFactory.mockImplementation(() =>
        makeFakeStream([`${padding} the number 123-45-`, '6789 is on file.'])
      );
      const { res, emittedText } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      expect(emittedText()).not.toContain('123-45-6789');
      expect(emittedText()).toContain('[SSN_REDACTED]');
    });
  });

  describe('conversation history bounds', () => {
    it('truncates history to the last 20 messages before the Claude call', async () => {
      const history = Array.from({ length: 25 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `msg-${i}`,
      }));
      const { res } = makeSSEResponse();

      await handleAIChat(makeChatRequest('newest question', history), res);

      const callArgs = streamFactory.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
      expect(callArgs.messages).toHaveLength(21); // 20 history + the new message
      expect(callArgs.messages[0].content).toBe('msg-5'); // oldest 5 dropped
      expect(callArgs.messages[20]).toEqual({ role: 'user', content: 'newest question' });
    });
  });

  describe('stream failure', () => {
    it('emits an error SSE event, audits the failure under the non-quota resource, and tracks no usage', async () => {
      streamFactory.mockImplementation(() => makeFakeStream(['partial ans'], undefined, true));
      const { res, events } = makeSSEResponse();

      await handleAIChat(makeChatRequest(), res);

      const errorEvent = events().find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(res.end).toHaveBeenCalled();
      expect(trackAIUsage).not.toHaveBeenCalled();

      // Failed chat must not burn a quota slot (L-35): audited under
      // HealthGuideAttempt with success:false, and no 'HealthGuide' success row.
      expect(auditService.logAccess).toHaveBeenCalledWith(
        'HealthGuideAttempt',
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'CHAT_FAILED' }),
        expect.objectContaining({ success: false })
      );
      const successCall = auditService.logAccess.mock.calls.find((c: unknown[]) => c[0] === 'HealthGuide');
      expect(successCall).toBeUndefined();
    });
  });
});
