/**
 * upload/shared.ts — F-15 filename-sanitization regression test.
 *
 * Invariant: `validateUploadFile` mutates `file.originalname` so every
 * downstream consumer (DB writes, audit logs, Content-Disposition headers
 * on signed-URL downloads) sees a sanitized string by default. Path
 * separators, control characters, and the Windows-illegal set get
 * replaced with `_`; the result is capped to 255 bytes.
 *
 * Magic-byte / mimetype / size checks live in the same function and are
 * exercised by the integration upload tests; this file pins only the
 * filename-mutation contract.
 */

import { describe, expect, it, vi } from 'vitest';

// shared.ts pulls in services/pdfParser.ts → pdf-parse, which has a
// module-load side effect that opens a debug fixture file. That fails in
// any environment without the fixture (CI, sandbox), so stub the module
// before importing shared. Mirrors the same trick used in
// services/pdfTextExtraction.test.ts.
vi.mock('pdf-parse', () => ({ default: vi.fn() }));

import { validateUploadFile } from './shared.js';

// %PDF magic bytes — the lab-report path requires PDF; using real magic
// bytes lets validateUploadFile's mimetype check pass so we can observe
// the post-validation `file.originalname` mutation.
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

function makeMulterFile(originalname: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: PDF_MAGIC.length,
    buffer: PDF_MAGIC,
    destination: '',
    filename: '',
    path: '',
    stream: null as unknown as NodeJS.ReadableStream,
  };
}

describe('validateUploadFile — filename sanitization (F-15)', () => {
  it('strips POSIX path separators (defends against ../ traversal)', () => {
    const file = makeMulterFile('../../etc/passwd');

    validateUploadFile(file, 'pdf');

    // path.basename peels off the directory components, then `/` is
    // replaced. The resulting filename has no path-separator at all.
    expect(file.originalname).not.toContain('/');
    expect(file.originalname).not.toContain('..');
    expect(file.originalname).toBe('passwd');
  });

  it('strips Windows backslash separators', () => {
    // path.basename on Linux doesn't treat `\` as a separator, so this
    // case relies on the regex replace step. Confirms sanitizer covers
    // both POSIX and Windows path syntaxes.
    const file = makeMulterFile('C:\\Windows\\System32\\config\\labs.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).not.toContain('\\');
  });

  it('strips ASCII control characters (C0 + DEL)', () => {
    // \x00 (NUL), \x0a (LF), \x09 (TAB), \x7f (DEL) — all replaced.
    const file = makeMulterFile('lab\x00report\x0aresult\x09\x7f.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe('lab_report_result__.pdf');
    // Belt-and-suspenders: no control chars survive at all.
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1F\x7F]/.test(file.originalname)).toBe(false);
  });

  it('strips Windows-illegal filesystem chars (" < > | : * ?)', () => {
    const file = makeMulterFile('"weird"<name>|labs:result*.pdf?');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).not.toMatch(/["<>|:*?]/);
  });

  it('truncates to 255 bytes (POSIX filename max)', () => {
    const long = 'a'.repeat(400) + '.pdf';
    const file = makeMulterFile(long);

    validateUploadFile(file, 'pdf');

    expect(file.originalname.length).toBeLessThanOrEqual(255);
  });

  it('preserves clean filenames untouched', () => {
    const file = makeMulterFile('quest-labs-2026-01-15.pdf');

    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe('quest-labs-2026-01-15.pdf');
  });

  it('is idempotent — running validate twice produces the same string', () => {
    const file = makeMulterFile('../labs.pdf');

    validateUploadFile(file, 'pdf');
    const firstPass = file.originalname;
    validateUploadFile(file, 'pdf');

    expect(file.originalname).toBe(firstPass);
  });
});
