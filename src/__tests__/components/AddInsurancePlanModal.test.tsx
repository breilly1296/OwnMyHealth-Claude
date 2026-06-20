/**
 * AddInsurancePlanModal a11y guard tests (wave 2).
 *
 * Pins the WAI-ARIA dialog + tabs semantics added in the accessibility wave so a
 * regression to a color-only tab bar or a non-dialog overlay fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../services/api/insurance', () => ({
  insuranceApi: { uploadSBC: vi.fn(), createPlan: vi.fn() },
}));

import AddInsurancePlanModal from '../../components/insurance/AddInsurancePlanModal';
import { insuranceApi } from '../../services/api/insurance';

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

  // Regression: the SBC-upload success preview must actually paint. Previously
  // handleUpload called onPlanAdded() on success, which the parent uses to close
  // (unmount) the modal in the same render — so the green "Plan extracted
  // successfully!" summary + Done button were dead UI. The upload path now calls
  // onRefresh() (which does NOT close), leaving the summary visible until Done.
  it('keeps the success preview visible after a successful SBC upload', async () => {
    (insuranceApi.uploadSBC as ReturnType<typeof vi.fn>).mockResolvedValue({
      planName: 'Gold PPO',
      insurerName: 'Acme Health',
      planType: 'PPO',
      deductibleIndividual: 1500,
      oopMaxIndividual: 6000,
    });

    // onPlanAdded is a no-op vi.fn here: if the upload path wrongly called it,
    // the real parent would close the modal — but since it must NOT be on this
    // path, the success preview should render regardless.
    render(<AddInsurancePlanModal isOpen onClose={onClose} onPlanAdded={onPlanAdded} />);

    // Switch to the Upload SBC tab.
    fireEvent.click(screen.getByRole('tab', { name: /Upload SBC/i }));

    // Select a PDF file via the hidden file input.
    const fileInput = document.getElementById('sbc-upload') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'sbc.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Drive the Upload & Extract flow.
    fireEvent.click(screen.getByRole('button', { name: /Upload & Extract/i }));

    expect(await screen.findByText('Plan extracted successfully!')).toBeInTheDocument();
    // Extracted summary fields render and the Done button replaces Cancel.
    expect(screen.getByText('Plan: Gold PPO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
    // onPlanAdded must NOT be called on the upload path (that would close the modal).
    await waitFor(() => expect(insuranceApi.uploadSBC).toHaveBeenCalledTimes(1));
    expect(onPlanAdded).not.toHaveBeenCalled();
  });
});
