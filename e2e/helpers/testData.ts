import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Sample fixture PDFs for upload specs. Create these files under
 * `e2e/fixtures/` before running upload tests — a minimal valid PDF
 * starts with `%PDF-1.4` magic bytes (the upload handler's validatePdfHeader
 * check requires that prefix). Real lab-report content is NOT needed; the
 * specs only exercise the upload path, not extraction quality.
 */
export const SAMPLE_LAB_REPORT = path.resolve(__dirname, '../fixtures/sample-lab-report.pdf');
export const SAMPLE_SBC = path.resolve(__dirname, '../fixtures/sample-sbc.pdf');
