/**
 * pdfReportGenerator tests.
 *
 * The "Share with doctor (PDF)" export (ExportMenu -> downloadHealthReport) was
 * wired into the UI but the 680-line generator had no test. These are smoke +
 * edge-case guards: the report must build (a valid, non-empty jsPDF) across the
 * branches that are easy to break — empty list, out-of-range values, the
 * history-driven trend/risk/insight sections, and the change-% divide-by-zero
 * guard. The chart-capture branch (html2canvas) is intentionally not exercised
 * (no chartElement) so this stays a pure, DOM-light unit test.
 */

import { describe, it, expect } from 'vitest';
import { generateHealthReport, generateReportBlob } from '../../utils/pdfReportGenerator';
import type { Biomarker } from '../../types';

const marker = (o: Partial<Biomarker> = {}): Biomarker => ({
  id: 'b1',
  name: 'LDL Cholesterol',
  value: 100,
  unit: 'mg/dL',
  date: '2026-05-01',
  category: 'Other',
  normalRange: { min: 0, max: 130, source: 'test' },
  ...o,
});

describe('pdfReportGenerator.generateHealthReport', () => {
  it('produces a non-empty PDF for a single normal biomarker', async () => {
    const doc = await generateHealthReport({ biomarkers: [marker()], options: { patientName: 'Jane Doe' } });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output('blob').size).toBeGreaterThan(0);
  });

  it('does not throw on an empty biomarker list', async () => {
    const doc = await generateHealthReport({ biomarkers: [], options: {} });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('renders out-of-range (high and low) values without error', async () => {
    const doc = await generateHealthReport({
      biomarkers: [
        marker({ id: 'hi', name: 'Glucose', value: 200, normalRange: { min: 70, max: 100, source: 't' } }),
        marker({ id: 'lo', name: 'Vitamin D', value: 10, normalRange: { min: 30, max: 100, source: 't' } }),
      ],
      options: {},
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('exercises the trend / risk / insight sections for a biomarker with history', async () => {
    const doc = await generateHealthReport({
      biomarkers: [
        marker({
          value: 120,
          history: [
            { date: '2026-01-01', value: 160 },
            { date: '2026-03-01', value: 140 },
          ],
        }),
      ],
      options: { includeTrends: true, includeRecommendations: true },
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('guards the change-% calculation against a zero prior value', async () => {
    const doc = await generateHealthReport({
      biomarkers: [marker({ value: 50, history: [{ date: '2026-01-01', value: 0 }] })],
      options: {},
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('paginates a large multi-category report', async () => {
    const cats: Biomarker['category'][] = ['Lipids', 'Vitamins', 'Hormones', 'Other'];
    const many = Array.from({ length: 40 }, (_, i) =>
      marker({ id: `m${i}`, name: `Marker ${i}`, category: cats[i % cats.length], value: i }),
    );
    const doc = await generateHealthReport({ biomarkers: many, options: {} });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('pdfReportGenerator.generateReportBlob', () => {
  it('returns a non-empty PDF blob', async () => {
    const blob = await generateReportBlob({ biomarkers: [marker()], options: {} });
    expect(blob.size).toBeGreaterThan(0);
  });
});
