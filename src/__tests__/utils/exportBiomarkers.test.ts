/**
 * exportBiomarkers CSV-escaping tests.
 *
 * Guards the doctor-facing CSV export against:
 *  - formula injection (=, +, -, @, tab, CR leading a cell — evaluated by
 *    Excel/Sheets even inside quotes), and
 *  - RFC 4180 corruption (embedded double-quotes must be doubled).
 * The exported biomarker name/unit/description are free text from OCR/AI
 * extraction of user-uploaded lab reports, so they are attacker-influenceable.
 */

import { describe, it, expect } from 'vitest';
import { escapeCsvCell, buildBiomarkerCsv } from '../../utils/biomarkers/exportBiomarkers';
import type { Biomarker } from '../../types';

const makeBiomarker = (overrides: Partial<Biomarker> = {}): Biomarker => ({
  id: 'bm-1',
  name: 'Glucose',
  value: 95,
  unit: 'mg/dL',
  date: '2026-01-15',
  category: 'Blood',
  normalRange: { min: 70, max: 100, source: 'Standard' },
  description: 'Blood sugar',
  history: [],
  ...overrides,
});

describe('escapeCsvCell', () => {
  it('wraps a plain value in double quotes', () => {
    expect(escapeCsvCell('Glucose')).toBe('"Glucose"');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'neutralizes a formula-leading character %j with a single quote',
    (lead) => {
      const out = escapeCsvCell(`${lead}HYPERLINK("http://evil")`);
      // Leading apostrophe is inserted before the dangerous char, inside the quotes.
      expect(out.startsWith('"\'')).toBe(true);
      expect(out).toContain(`'${lead}HYPERLINK`);
    }
  );

  it('does not prefix a value whose dangerous char is not first', () => {
    expect(escapeCsvCell('1+1')).toBe('"1+1"');
  });

  it('doubles embedded double-quotes (RFC 4180)', () => {
    expect(escapeCsvCell('He said "high"')).toBe('"He said ""high"""');
  });

  it('keeps commas and newlines safe inside the quoted field', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('handles empty/nullish input without throwing', () => {
    expect(escapeCsvCell('')).toBe('""');
    expect(escapeCsvCell(undefined as unknown as string)).toBe('""');
  });
});

describe('buildBiomarkerCsv', () => {
  it('emits a header row and one CRLF-delimited record per biomarker', () => {
    const csv = buildBiomarkerCsv([makeBiomarker()]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('"Name","Value","Unit","Normal Range","Date","Description"');
    expect(lines[1]).toContain('"Glucose"');
    expect(lines[1]).toContain('"95"');
  });

  it('neutralizes a malicious biomarker name (formula injection)', () => {
    const csv = buildBiomarkerCsv([makeBiomarker({ name: '=cmd|/c calc' })]);
    // The dangerous name must be quote-prefixed so it is never evaluated.
    expect(csv).toContain('"\'=cmd|/c calc"');
    expect(csv).not.toContain('"=cmd|/c calc"');
  });

  it('doubles quotes inside a free-text description', () => {
    const csv = buildBiomarkerCsv([makeBiomarker({ description: 'reads "elevated"' })]);
    expect(csv).toContain('"reads ""elevated"""');
  });
});
