/**
 * Screen-reader accessibility regression tests (UX wave 1).
 *
 * A11Y-5: BiomarkerRangeBar must announce whether the value is in or out of the
 *         reference range (it previously hardcoded "within range").
 * A11Y-3: ErrorToast / SuccessToast must be live regions so screen readers
 *         announce them (assertive for errors, polite for success).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import BiomarkerRangeBar from '../../components/biomarkers/BiomarkerRangeBar';
import { ErrorToast } from '../../components/common/ErrorToast';
import { SuccessToast } from '../../components/common/SuccessToast';

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
