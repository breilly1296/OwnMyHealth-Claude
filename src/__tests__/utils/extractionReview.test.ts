/**
 * planExtractionReview tests (M21).
 *
 * The server-OCR upload auto-saves every extracted biomarker before review, so
 * the review must be reconciled as deltas: deselected rows are deleted, edited
 * rows are updated. These pin that mapping.
 */

import { describe, it, expect } from 'vitest';
import { planExtractionReview } from '../../utils/extractionReview';
import type { ExtractedBiomarkerPreview } from '../../components/upload/ExtractionReviewStep';

function preview(overrides: Partial<ExtractedBiomarkerPreview> & { id: string }): ExtractedBiomarkerPreview {
  return {
    name: 'Glucose',
    value: 95,
    unit: 'mg/dL',
    category: 'METABOLIC',
    isOutOfRange: false,
    confidence: 0.9,
    selected: true,
    edited: false,
    source: 'ocr',
    ...overrides,
  };
}

describe('planExtractionReview', () => {
  it('is a no-op when every row is kept and unedited', () => {
    const extracted = [{ id: 'a' }, { id: 'b' }];
    const selected = [preview({ id: 'a' }), preview({ id: 'b' })];
    expect(planExtractionReview(extracted, selected)).toEqual({ deselectedIds: [], edits: [] });
  });

  it('deletes rows the user deselected (extracted but not in selected)', () => {
    const extracted = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const selected = [preview({ id: 'a' })]; // b, c deselected
    const plan = planExtractionReview(extracted, selected);
    expect([...plan.deselectedIds].sort()).toEqual(['b', 'c']);
    expect(plan.edits).toEqual([]);
  });

  it('updates rows the user edited with the new name/value/unit', () => {
    const extracted = [{ id: 'a' }];
    const selected = [preview({ id: 'a', name: 'HDL', value: 55, unit: 'mg/dL', edited: true })];
    const plan = planExtractionReview(extracted, selected);
    expect(plan.deselectedIds).toEqual([]);
    expect(plan.edits).toEqual([{ id: 'a', data: { name: 'HDL', value: 55, unit: 'mg/dL' } }]);
  });

  it('never updates a deselected row (delete wins over edit)', () => {
    const extracted = [{ id: 'a' }];
    const selected: ExtractedBiomarkerPreview[] = []; // a deselected entirely
    const plan = planExtractionReview(extracted, selected);
    expect(plan.deselectedIds).toEqual(['a']);
    expect(plan.edits).toEqual([]);
  });

  it('handles a mix: keep-unchanged + edit + deselect', () => {
    const extracted = [{ id: 'keep' }, { id: 'edit' }, { id: 'drop' }];
    const selected = [
      preview({ id: 'keep' }),
      preview({ id: 'edit', value: 120, edited: true }),
    ];
    const plan = planExtractionReview(extracted, selected);
    expect(plan.deselectedIds).toEqual(['drop']);
    expect(plan.edits).toEqual([{ id: 'edit', data: { name: 'Glucose', value: 120, unit: 'mg/dL' } }]);
  });
});
