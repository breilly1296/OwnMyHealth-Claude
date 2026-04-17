/**
 * C-7 regression tests for claudeExtraction.
 *
 * Two invariants under test:
 *   1. BAA gate — when `config.anthropic.baaActive` is false, the function
 *      throws BEFORE any Anthropic client construction, so no PDF bytes
 *      can transit even if the runtime config drifts.
 *   2. Minimum-necessary path selection — when local text extraction is
 *      usable, `messages.create` is called with a text-only prompt
 *      (no `type: 'document'` block). When extraction is not usable,
 *      the vision fallback attaches a `document` block AND the redacted
 *      text so Claude has a scrubbed reference.
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

describe('extractBiomarkersWithClaude (C-7)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mocks.config.anthropic.baaActive = true;
    mocks.messagesCreate.mockReset();
    mocks.extractTextFromPDF.mockReset();
    mocks.messagesCreate.mockResolvedValue(cannedClaudeResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BAA gate', () => {
    it('throws when ANTHROPIC_BAA_ACTIVE is false, without constructing the Anthropic client', async () => {
      mocks.config.anthropic.baaActive = false;

      await expect(extractBiomarkersWithClaude(Buffer.from('fake'))).rejects.toThrow(
        /ANTHROPIC_BAA_ACTIVE is not set to "true"/
      );

      expect(mocks.extractTextFromPDF).not.toHaveBeenCalled();
      expect(mocks.messagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('minimum-necessary path selection', () => {
    it('uses text-only prompt (no document block) when local extraction is usable', async () => {
      mocks.extractTextFromPDF.mockResolvedValue(usableExtraction);

      await extractBiomarkersWithClaude(Buffer.from('fake'));

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
      expect(textBlocks[0].text).toContain('LAB REPORT TEXT (PHI-redacted)');
    });

    it('falls back to vision (includes document block) when local extraction is not usable', async () => {
      mocks.extractTextFromPDF.mockResolvedValue(scannedExtraction);

      await extractBiomarkersWithClaude(Buffer.from('fake'));

      expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
      const args = mocks.messagesCreate.mock.calls[0][0];
      const content = args.messages[0].content;

      const documentBlocks = content.filter((c: { type: string }) => c.type === 'document');
      expect(documentBlocks).toHaveLength(1);
      expect(documentBlocks[0].source.type).toBe('base64');
      expect(documentBlocks[0].source.media_type).toBe('application/pdf');

      const textBlocks = content.filter((c: { type: string }) => c.type === 'text');
      expect(textBlocks[0].text).toContain('scanned');
    });
  });

  describe('redactor integration', () => {
    it('sends redacted text to Claude, not the raw extracted text', async () => {
      mocks.extractTextFromPDF.mockResolvedValue({
        ...usableExtraction,
        text: usableExtraction.text + '\nPatient: John M Smith\nSSN: 123-45-6789\nEmail: john@example.com',
      });

      await extractBiomarkersWithClaude(Buffer.from('fake'));

      const args = mocks.messagesCreate.mock.calls[0][0];
      const promptText = args.messages[0].content.find(
        (c: { type: string }) => c.type === 'text'
      ).text;

      expect(promptText).not.toContain('John M Smith');
      expect(promptText).not.toContain('123-45-6789');
      expect(promptText).not.toContain('john@example.com');
      expect(promptText).toContain('[NAME_REDACTED]');
      expect(promptText).toContain('[SSN_REDACTED]');
      expect(promptText).toContain('[EMAIL_REDACTED]');
    });
  });
});
