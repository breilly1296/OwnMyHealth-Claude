/**
 * PDF Redaction Utility
 *
 * Covers the top band of every PDF page with a solid white rectangle before
 * the document is handed off to Claude Vision. Lab reports and SBC documents
 * always render patient demographics (name, DOB, MRN, address, subscriber ID)
 * in the header band of each page, so an opaque cover there removes the most
 * common vision-PHI leak without breaking the tabular biomarker / benefit
 * content lower on the page.
 *
 * This is a defense-in-depth complement to `redactPHI` (which only scrubs
 * extracted text). It runs in the vision fallback path where local text
 * extraction failed — see `claudeExtraction.ts` and `sbcExtraction.ts`.
 *
 * The cover is crude by design — it's not a surgical strike on identified
 * regions, it's a blanket that eats the whole header. That trades some
 * content loss (page numbers, report titles) for robustness: we don't need
 * to know exactly where the PHI is, just that labs and insurers always put
 * it up top.
 *
 * @module utils/pdfRedaction
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { logger } from './logger.js';

const pdfLogger = logger.createServiceLogger('PDFRedaction');

/**
 * Fraction of page height (from the top) to cover with an opaque band.
 * 15% matches the typical patient-banner region on both LabCorp/Quest lab
 * reports and HHS-format SBC documents. Adjust if we see PHI slipping
 * through at bottom-heavy layouts — and if so, add a bottom-band cover too.
 */
const BANNER_FRACTION = 0.15;

/**
 * Draw a white rectangle over the top BANNER_FRACTION of every page in the
 * PDF. Returns a new buffer; the input is not mutated.
 *
 * Failures (malformed PDF, pdf-lib throws) are logged and the ORIGINAL buffer
 * is returned — we'd rather ship the unredacted document to Claude under BAA
 * coverage than fail the whole extraction. This keeps the vision fallback
 * working on edge-case PDFs while the logs surface the pages we couldn't
 * redact for follow-up.
 */
export async function redactPatientBanner(pdfBuffer: Buffer): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, {
      // Some lab reports ship with broken xrefs; pdf-lib defaults to strict
      // parsing. Relaxing here so scanned/damaged PDFs still get redacted.
      ignoreEncryption: false,
      throwOnInvalidObject: false,
    });

    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();
      // PDF coordinates: origin is bottom-left. The "top 15%" is the band
      // from y = height * 0.85 up to y = height.
      page.drawRectangle({
        x: 0,
        y: height * (1 - BANNER_FRACTION),
        width,
        height: height * BANNER_FRACTION,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    const redacted = await pdfDoc.save();

    pdfLogger.info('PDF patient banner redacted', {
      pages: pages.length,
      bannerFraction: BANNER_FRACTION,
      originalBytes: pdfBuffer.length,
      redactedBytes: redacted.length,
    });

    return Buffer.from(redacted);
  } catch (error) {
    pdfLogger.error('PDF banner redaction failed; returning original buffer', {
      error: error instanceof Error ? error.message : 'Unknown error',
      originalBytes: pdfBuffer.length,
    });
    // Fall back to the original buffer. The BAA is the backstop; failing
    // closed here would break legitimate extractions on malformed PDFs.
    return pdfBuffer;
  }
}
