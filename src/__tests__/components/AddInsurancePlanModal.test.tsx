/**
 * AddInsurancePlanModal a11y guard tests (wave 2).
 *
 * Pins the WAI-ARIA dialog + tabs semantics added in the accessibility wave so a
 * regression to a color-only tab bar or a non-dialog overlay fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../services/api/insurance', () => ({
  insuranceApi: { uploadSBC: vi.fn(), createPlan: vi.fn() },
}));

import AddInsurancePlanModal from '../../components/insurance/AddInsurancePlanModal';

describe('AddInsurancePlanModal accessibility', () => {
  const onClose = vi.fn();
  const onPlanAdded = vi.fn();
  const renderModal = () =>
    render(<AddInsurancePlanModal isOpen onClose={onClose} onPlanAdded={onPlanAdded} />);

  beforeEach(() => vi.clearAllMocks());

  it('renders the overlay as an accessible dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // accessible name wired via aria-labelledby to a heading that exists
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby as string)).toBeInTheDocument();
  });

  it('exposes the manual/upload tabs as a WAI-ARIA tablist with roving selection', () => {
    renderModal();
    expect(screen.getByRole('tablist')).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    // Default active tab is 'manual': selected + tabbable; the other is not.
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute('tabindex', '0');
    const unselected = tabs.filter((t) => t.getAttribute('aria-selected') !== 'true');
    expect(unselected[0]).toHaveAttribute('tabindex', '-1');

    // The active tab points at a tabpanel that exists.
    const controls = selected[0].getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls as string);
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'tabpanel');
  });

  it('moves the active tab with ArrowRight', () => {
    renderModal();
    const tabs = screen.getAllByRole('tab');
    const initiallySelected = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!;

    fireEvent.keyDown(initiallySelected, { key: 'ArrowRight' });

    const nowSelected = screen.getAllByRole('tab').filter(
      (t) => t.getAttribute('aria-selected') === 'true'
    );
    expect(nowSelected).toHaveLength(1);
    expect(nowSelected[0]).not.toBe(initiallySelected);
  });
});
