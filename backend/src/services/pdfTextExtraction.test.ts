/**
 * C-7 tests for the local PDF text extractor.
 *
 * Scope: the three branches of the usability heuristic
 * (usable text, empty/scanned, extraction error), plus the
 * defensive-default contract (any thrown error produces a
 * usable=false result rather than propagating).
 *
 * Buffers must start with a valid `%PDF-` header: extraction now routes
 * through secureParsePdf, which validates the header (PDF-bomb DoS guard)
 * before invoking pdf-parse.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));
vi.mock('../utils/logger.js', () => ({
  logger: {
    createServiceLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  // securePdfParsing.ts (now in the extraction path) logs via pdfLogger.
  pdfLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { extractTextFromPDF } from './pdfTextExtraction.js';
import pdfParse from 'pdf-parse';

const mockedPdfParse = vi.mocked(pdfParse);

// A minimal buffer with a valid PDF header so secureParsePdf's header
// validation passes and the (mocked) pdf-parse path is exercised.
const VALID_PDF = Buffer.from('%PDF-1.4\n%mock pdf body\n');

describe('extractTextFromPDF (C-7)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns usable=true when text exceeds both thresholds', async () => {
    const longText = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: data data data`).join('\n');
    mockedPdfParse.mockResolvedValue({
      text: longText + '\n' + 'x'.repeat(300),
      numpages: 2,
      numrender: 2,
      info: {},
      metadata: null,
      version: '1.10.100',
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractTextFromPDF(VALID_PDF);

    expect(result.usable).toBe(true);
    expect(result.isLikelyScanned).toBe(false);
    expect(result.pageCount).toBe(2);
  });

  it('returns usable=false + isLikelyScanned=true for empty text (image-only PDF)', async () => {
    mockedPdfParse.mockResolvedValue({
      text: '',
      numpages: 3,
      numrender: 3,
      info: {},
      metadata: null,
      version: '1.10.100',
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractTextFromPDF(VALID_PDF);

    expect(result.usable).toBe(false);
    expect(result.isLikelyScanned).toBe(true);
    expect(result.text).toBe('');
  });

  it('returns usable=false for text that passes char-count but not line-count', async () => {
    // 500 chars but on a single line → passes char threshold, fails line threshold.
    mockedPdfParse.mockResolvedValue({
      text: 'x'.repeat(500),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.10.100',
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractTextFromPDF(VALID_PDF);

    expect(result.usable).toBe(false);
    // 500 chars is above the scanned threshold, so this isn't flagged as scanned —
    // just "extracted but not trusted as the sole input."
    expect(result.isLikelyScanned).toBe(false);
  });

  it('handles pdf-parse errors gracefully without throwing', async () => {
    mockedPdfParse.mockRejectedValue(new Error('corrupt PDF'));

    const result = await extractTextFromPDF(VALID_PDF);

    expect(result.usable).toBe(false);
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
    expect(result.isLikelyScanned).toBe(true);
  });

  it('rejects a buffer without a valid PDF header before parsing (DoS guard)', async () => {
    // secureParsePdf validates the %PDF- header first; a non-PDF buffer never
    // reaches pdf-parse and degrades to an unusable result.
    const result = await extractTextFromPDF(Buffer.from('this is not a pdf at all'));

    expect(result.usable).toBe(false);
    expect(result.isLikelyScanned).toBe(true);
    expect(mockedPdfParse).not.toHaveBeenCalled();
  });
});
