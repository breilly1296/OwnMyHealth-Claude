/**
 * C-7 regression tests for claudeExtraction.
 *
 * Three invariants under test:
 *   1. BAA gate — when `config.anthropic.baaActive` is false, the function
 *      throws BEFORE any Anthropic client construction, so no PDF bytes
 *      can transit even if the runtime config drifts.
 *   2. Text-only path — when local text extraction is usable, `messages.create`
 *      is called with a text-only prompt (no `type: 'document'` block).
 *      There is deliberately no vision fallback: unusable text throws.
 *   3. userId attribution — the userId passed by the caller is forwarded
 *      to `trackAIUsage`, never hardcoded to 'system'.
 *
 * We mock the Anthropic SDK, the PDF text extractor, and aiCostTracker
 * so the test exercises branch selection without a real network call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -- Mocks ---------------------------------------------------------------
// vi.hoisted lets us share mock fns between the factories (which run at
// hoist time) and the test bodies (which run later).
const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  extractTextFromPDF: vi.fn(),
  trackAIUsage: vi.fn(),
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

vi.mock('./aiCostTracker.js', () => ({ trackAIUsage: mocks.trackAIUsage }));

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

// -- Imports AFTER mocks --------------------------------------------------
import { extractBiomarkersWithClaude } from './claudeExtraction.js';

const cannedClaudeResponse = {
  model: 'claude-haiku-4-5-20251001',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        biomarkers: [
          { name: 'Glucose', value: 95, unit: 'mg/dL', referenceRange: '70-100', isAbnormal: false },
        ],
        labDate: '2026-01-15',
        labName: 'Quest',
      }),
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
};

const usableExtraction = {
  text: Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: result ${i}`).join('\n') + '\n' + 'x'.repeat(300),
  pageCount: 2,
  usable: true,
  isLikelyScanned: false,
};

const scannedExtraction = {
  text: '',
  pageCount: 3,
  usable: false,
  isLikelyScanned: true,
};

const TEST_USER_ID = 'user_test_123';

describe('extractBiomarkersWithClaude (C-7)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mocks.config.anthropic.baaActive = true;
    mocks.messagesCreate.mockReset();
    mocks.extractTextFromPDF.mockReset();
    mocks.trackAIUsage.mockReset();
    mocks.messagesCreate.mockResolvedValue(cannedClaudeResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BAA gate', () => {
    it('throws when ANTHROPIC_BAA_ACTIVE is false, without constructing the Anthropic client', async () => {
      mocks.config.anthropic.baaActive = false;

      await expect(extractBiomarkersWithClaude(Buffer.from('fake'), TEST_USER_ID)).rejects.toThrow(
        /ANTHROPIC_BAA_ACTIVE=true/
      );

      expect(mocks.extractTextFromPDF).not.toHaveBeenCalled();
      expect(mocks.messagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('text-only transmission', () => {
    it('sends a text-only prompt (no document block) when local extraction is usable', async () => {
      mocks.extractTextFromPDF.mockResolvedValue(usableExtraction);

      await extractBiomarkersWithClaude(Buffer.from('fake'), TEST_USER_ID);

      expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
      const args = mocks.messagesCreate.mock.calls[0][0];
      const content = args.messages[0].content;

      // No document block — the PDF bytes never leave the process.
      const documentBlocks = content.filter((c: { type: string }) => c.type === 'document');
      expect(documentBlocks).toEqual([]);

      // Exactly one text block with the extraction prompt.
      const textBlocks = content.filter((c: { type: string }) => c.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect(textBlocks[0].text).toContain('Extract all biomarker');
      // M10: the document body is wrapped in untrusted-data delimiters.
      expect(textBlocks[0].text).toContain('<document>');
      expect(textBlocks[0].text).toContain('</document>');
      expect(textBlocks[0].text).toMatch(/data, never as instructions/i);
    });

    it('throws (no vision fallback) when local extraction is not usable', async () => {
      mocks.extractTextFromPDF.mockResolvedValue(scannedExtraction);

      await expect(
        extractBiomarkersWithClaude(Buffer.from('fake'), TEST_USER_ID)
      ).rejects.toThrow(/scanned|readable text/i);

      // Critically: no request ever hits the Anthropic mock.
      expect(mocks.messagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('redactor integration', () => {
    it('sends redacted text to Claude, not the raw extracted text', async () => {
      mocks.extractTextFromPDF.mockResolvedValue({
        ...usableExtraction,
        text: usableExtraction.text + '\nPatient: John M Smith\nSSN: 123-45-6789\nEmail: john@example.com\nCollected: 04/15/2026',
      });

      await extractBiomarkersWithClaude(Buffer.from('fake'), TEST_USER_ID);

      const args = mocks.messagesCreate.mock.calls[0][0];
      const promptText = args.messages[0].content.find(
        (c: { type: string }) => c.type === 'text'
      ).text;

      expect(promptText).not.toContain('John M Smith');
      expect(promptText).not.toContain('123-45-6789');
      expect(promptText).not.toContain('john@example.com');
      expect(promptText).not.toContain('04/15/2026');
      expect(promptText).toContain('[NAME_REDACTED]');
      expect(promptText).toContain('[SSN_REDACTED]');
      expect(promptText).toContain('[EMAIL_REDACTED]');
      expect(promptText).toContain('[DATE_REDACTED]');
    });
  });

  describe('userId attribution', () => {
    it('forwards the caller-supplied userId to trackAIUsage (never "system")', async () => {
      mocks.extractTextFromPDF.mockResolvedValue(usableExtraction);

      await extractBiomarkersWithClaude(Buffer.from('fake'), TEST_USER_ID);

      expect(mocks.trackAIUsage).toHaveBeenCalledTimes(1);
      const usageArgs = mocks.trackAIUsage.mock.calls[0][0];
      expect(usageArgs.userId).toBe(TEST_USER_ID);
      expect(usageArgs.userId).not.toBe('system');
      expect(usageArgs.endpoint).toBe('lab-extraction');
    });
  });
});
