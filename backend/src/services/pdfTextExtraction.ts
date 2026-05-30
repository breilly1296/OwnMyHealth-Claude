/**
 * Local PDF text extraction for minimum-necessary PHI handling before AI calls.
 *
 * Extracts text from a PDF buffer without any network call. Used as a
 * pre-processing step so we can run PHI redaction on the text (see
 * `utils/phiRedaction.ts`) before sending to Anthropic's API, instead of
 * sending the raw PDF bytes. See C-7 in SECURITY_STATUS.md.
 *
 * If extraction yields < MIN_USABLE_CHARS characters or fewer than
 * MIN_USABLE_LINES non-empty lines, the PDF is treated as scanned /
 * image-only and the caller should fall back to Claude's PDF vision
 * path (with the redacted text attached as a reference).
 *
 * @module services/pdfTextExtraction
 */

// Typed via the @types/pdf-parse dev dependency (audit #32) — no @ts-expect-error needed.
import pdfParse from 'pdf-parse';
import { logger } from '../utils/logger.js';
import { secureParsePdf } from '../utils/securePdfParsing.js';

const textExtractionLogger = logger.createServiceLogger('PDFTextExtraction');

const MIN_USABLE_CHARS = 200;
const MIN_USABLE_LINES = 5;

export interface PDFTextExtractionResult {
  text: string;
  pageCount: number;
  /** Text crossed both usability thresholds — safe to use as the sole AI input. */
  usable: boolean;
  /** Heuristic: image-only / scanned PDFs produce empty or near-empty text. */
  isLikelyScanned: boolean;
}

export async function extractTextFromPDF(
  buffer: Buffer,
  filename = 'upload.pdf'
): Promise<PDFTextExtractionResult> {
  try {
    // Route through the hardened parser so the PRIMARY (Claude) upload path
    // gets the same PDF-bomb DoS protection the regex fallback already had:
    // header validation + a 30s parse timeout + a 100MB heap-growth guard.
    // Previously this called pdfParse(buffer) directly with no bound, so a
    // crafted ~10MB PDF could hang the event loop or OOM the instance.
    const result = await secureParsePdf(buffer, filename, (b: Buffer) => pdfParse(b));
    const text = result.text ?? '';
    const lineCount = text.split('\n').filter((l: string) => l.trim().length > 0).length;
    const usable = text.length >= MIN_USABLE_CHARS && lineCount >= MIN_USABLE_LINES;
    const isLikelyScanned = text.length < MIN_USABLE_CHARS;

    textExtractionLogger.info('PDF text extraction complete', {
      pageCount: result.numpages,
      textLength: text.length,
      lineCount,
      usable,
      isLikelyScanned,
    });

    return {
      text,
      pageCount: result.numpages,
      usable,
      isLikelyScanned,
    };
  } catch (error) {
    // secureParsePdf throws for invalid headers, corrupt/encrypted files,
    // parse timeouts, or excessive memory growth (a likely bomb). The
    // resource bound has already been enforced by the time we get here, so
    // we degrade to "no usable text" and let the caller route to its
    // fallback (OCR for lab uploads, regex parser for SBC) instead of
    // surfacing a 5xx for what is most often an unusable/scanned document.
    textExtractionLogger.warn('PDF text extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      text: '',
      pageCount: 0,
      usable: false,
      isLikelyScanned: true,
    };
  }
}
