/**
 * Focus-trap + dialog-semantics regression for the bespoke modals wired in the
 * accessibility wave. Each must expose role="dialog" + aria-modal="true" + an
 * aria-labelledby that resolves to a heading, and close on Escape (via the
 * shared useFocusTrap hook). A regression to a bare overlay fails loudly here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  settingsApi: { changePassword: vi.fn() },
  authApi: { requestEmailChange: vi.fn(), changeEmail: vi.fn() },
}));

import ChangePasswordModal from '../../components/settings/ChangePasswordModal';
import ChangeEmailModal from '../../components/settings/ChangeEmailModal';
import BiomarkerInsurancePanel from '../../components/biomarkers/BiomarkerInsurancePanel';
import type { Biomarker } from '../../types';

function expectAccessibleDialog() {
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  const labelledby = dialog.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  // aria-labelledby must resolve to a heading that actually exists.
  expect(document.getElementById(labelledby as string)).toBeInTheDocument();
}

describe('bespoke modal focus-trap accessibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ChangePasswordModal exposes an accessible dialog and closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal isOpen onClose={onClose} />);
    expectAccessibleDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ChangeEmailModal exposes an accessible dialog and closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChangeEmailModal isOpen onClose={onClose} />);
    expectAccessibleDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('BiomarkerInsurancePanel exposes an accessible dialog and closes on Escape', () => {
    const onClose = vi.fn();
    const biomarker = {
      id: 'b1',
      name: 'LDL',
      value: 160,
      unit: 'mg/dL',
      date: '2026-01-01',
      category: 'Lipids',
      normalRange: { min: 0, max: 100, source: 'Std' },
      history: [],
    } as unknown as Biomarker;
    render(<BiomarkerInsurancePanel biomarker={biomarker} insurancePlans={[]} onClose={onClose} />);
    expectAccessibleDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
