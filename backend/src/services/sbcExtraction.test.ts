/**
 * C-7 regression test for sbcExtraction.
 *
 * Scope: the BAA gate. Verifies `extractInsuranceFromSBC` throws without
 * any network call when `config.anthropic.baaActive` is false. Same shape
 * as the equivalent test in claudeExtraction.test.ts, narrower surface
 * here because SBC response parsing is complex and out of scope for C-7.
 * Full path-selection coverage of sbcExtraction is a follow-up.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  extractTextFromPDF: vi.fn(),
  config: { anthropic: { baaActive: true, apiKey: 'test-key' } },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.messagesCreate };
    constructor(_opts: unknown) {}
  },
}));

vi.mock('./pdfTextExtraction.js', () => ({
  extractTextFromPDF: mocks.extractTextFromPDF,
}));

vi.mock('./aiCostTracker.js', () => ({ trackAIUsage: vi.fn() }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    createServiceLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return mocks.config;
  },
}));

import { extractInsuranceFromSBC } from './sbcExtraction.js';

describe('extractInsuranceFromSBC (C-7)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mocks.messagesCreate.mockReset();
    mocks.extractTextFromPDF.mockReset();
  });

  it('BAA gate — throws when ANTHROPIC_BAA_ACTIVE is false, no network call', async () => {
    mocks.config.anthropic.baaActive = false;

    await expect(extractInsuranceFromSBC(Buffer.from('fake'), 'user_abc')).rejects.toThrow(
      /ANTHROPIC_BAA_ACTIVE=true/
    );

    expect(mocks.extractTextFromPDF).not.toHaveBeenCalled();
    expect(mocks.messagesCreate).not.toHaveBeenCalled();

    // Reset for subsequent tests.
    mocks.config.anthropic.baaActive = true;
  });

  it('refuses to send raw PDF base64 — text-only content block, no document', async () => {
    mocks.extractTextFromPDF.mockResolvedValue({
      text: Array.from({ length: 10 }, (_, i) => `SBC line ${i}: coverage detail`).join('\n') + '\n' + 'y'.repeat(300),
      pageCount: 5,
      usable: true,
      isLikelyScanned: false,
    });
    mocks.messagesCreate.mockResolvedValue({
      model: 'claude-sonnet-4-20250514',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            planName: 'Test Plan',
            insurerName: 'Test Insurer',
            benefits: [],
            extractionConfidence: 0.9,
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await extractInsuranceFromSBC(Buffer.from('fake'), 'user_abc');

    expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
    const args = mocks.messagesCreate.mock.calls[0][0];
    const content = args.messages[0].content;
    const documentBlocks = content.filter((c: { type: string }) => c.type === 'document');
    expect(documentBlocks).toEqual([]);
  });

  it('throws (no vision fallback) when local SBC text extraction is not usable', async () => {
    mocks.extractTextFromPDF.mockResolvedValue({
      text: '',
      pageCount: 0,
      usable: false,
      isLikelyScanned: true,
    });

    await expect(
      extractInsuranceFromSBC(Buffer.from('fake'), 'user_abc')
    ).rejects.toThrow(/scanned|readable text/i);

    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});
