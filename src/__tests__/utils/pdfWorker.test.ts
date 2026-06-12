import { describe, it, expect } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import '../../utils/pdf/pdfWorker';

describe('pdfWorker', () => {
  it('sets GlobalWorkerOptions.workerSrc to the bundled worker', () => {
    expect(GlobalWorkerOptions.workerSrc).toBeTruthy();
    expect(GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min');
  });

  it('does not load the worker from a third-party CDN', () => {
    // CSP script-src 'self' (index.html) blocks cross-origin workers, and the
    // old cdnjs URL 404'd for pdfjs-dist 4.x (.mjs-only worker builds).
    expect(GlobalWorkerOptions.workerSrc).not.toContain('cdnjs');
    expect(GlobalWorkerOptions.workerSrc).not.toMatch(/^(https?:)?\/\//);
  });

  // Each PDF-consuming parser imports the shared pdfWorker module for its
  // side effect — but a `GlobalWorkerOptions.workerSrc = <CDN URL>` assignment
  // re-added INSIDE a parser would run after that import and win. Import each
  // parser and re-assert the bundled worker is still configured afterwards.
  describe('per-parser worker configuration', () => {
    const parsers: [string, () => Promise<unknown>][] = [
      ['labReportParser', () => import('../../utils/biomarkers/labReportParser')],
      ['documentParser', () => import('../../utils/documents/documentParser')],
      ['sbcParser', () => import('../../utils/insurance/sbcParser')],
    ];

    it.each(parsers)(
      'still uses the bundled worker after importing %s',
      async (_name, importParser) => {
        await importParser();
        expect(GlobalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.min.*\.mjs/);
        expect(GlobalWorkerOptions.workerSrc).not.toContain('cdnjs');
      }
    );
  });
});
