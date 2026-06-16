/**
 * Screen-reader accessibility regression tests (UX wave 1).
 *
 * A11Y-5: BiomarkerRangeBar must announce whether the value is in or out of the
 *         reference range (it previously hardcoded "within range").
 * A11Y-3: ErrorToast / SuccessToast must be live regions so screen readers
 *         announce them (assertive for errors, polite for success).
 * A11Y-4: biomarker category cards are keyboard-operable buttons, and a keystroke
 *         bubbling from a nested action button must NOT also toggle the card.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BiomarkerRangeBar from '../../components/biomarkers/BiomarkerRangeBar';
import { ErrorToast } from '../../components/common/ErrorToast';
import { SuccessToast } from '../../components/common/SuccessToast';
import { CategoryContent } from '../../components/dashboard/CategoryContent';
import type { Biomarker } from '../../types';

describe('BiomarkerRangeBar announcement (A11Y-5)', () => {
  it('announces an in-range value as WITHIN the reference range', () => {
    const { getByRole } = render(<BiomarkerRangeBar value={50} min={40} max={60} />);
    expect(getByRole('img').getAttribute('aria-label')).toMatch(/within the reference range/i);
  });

  it('announces an out-of-range value as OUTSIDE the reference range', () => {
    const { getByRole } = render(<BiomarkerRangeBar value={80} min={40} max={60} />);
    const label = getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/outside the reference range/i);
    expect(label).not.toMatch(/within the reference range/i);
  });
});

describe('Toast live regions (A11Y-3)', () => {
  it('ErrorToast is an assertive alert live region', () => {
    const { getByRole } = render(
      <ErrorToast message="Something broke" isVisible onDismiss={() => {}} />
    );
    const el = getByRole('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(el.getAttribute('aria-atomic')).toBe('true');
  });

  it('SuccessToast is a polite status live region', () => {
    const { getByRole } = render(
      <SuccessToast message="Saved" isVisible onDismiss={() => {}} />
    );
    const el = getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Biomarker card keyboard access (A11Y-4)', () => {
  const outOfRange = (): Biomarker =>
    ({
      id: 'g1',
      name: 'Glucose',
      value: 180,
      unit: 'mg/dL',
      date: '2026-01-01',
      category: 'Metabolic',
      normalRange: { min: 70, max: 100 },
      history: [],
    } as unknown as Biomarker);

  const renderCard = (bm: Biomarker, onSelectBiomarker: (b: Biomarker | null) => void) =>
    render(
      <CategoryContent
        selectedCategory="Metabolic"
        categories={[]}
        biomarkers={[bm]}
        filteredBiomarkers={[bm]}
        insurancePlans={[]}
        selectedBiomarker={null}
        onSelectBiomarker={onSelectBiomarker}
        onTrendClick={() => {}}
        onInsuranceClick={() => {}}
        onOpenAddMeasurement={() => {}}
        onOpenPDFUpload={() => {}}
      />
    );

  it('Enter on the card toggles selection', () => {
    const bm = outOfRange();
    const onSelect = vi.fn();
    renderCard(bm, onSelect);
    const card = screen.getByRole('button', { name: /Glucose, 180 mg\/dL/ });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(bm);
  });

  it('a keystroke bubbling from a descendant does NOT toggle the card (bubbling guard)', () => {
    const bm = outOfRange();
    const onSelect = vi.fn();
    renderCard(bm, onSelect);
    const card = screen.getByRole('button', { name: /Glucose, 180 mg\/dL/ });
    // The range bar (role="img") is a descendant. A keydown on it bubbles to the
    // card's handler, which must ignore it (e.target !== e.currentTarget) so a
    // keyboard activation of a nested action button can't also toggle the card.
    const descendant = within(card).getByRole('img');
    fireEvent.keyDown(descendant, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
