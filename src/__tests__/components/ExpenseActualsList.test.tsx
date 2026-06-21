/**
 * ExpenseActualsList edit-affordance regression.
 *
 * The list previously rendered only a delete button, so the shipped edit path
 * (ExpenseActualModal accepts an `actual` prop and PATCHes via updateActual) was
 * unreachable — a recorded claim could only be deleted + re-entered. A per-row
 * Edit button now opens the self-owned modal in EDIT mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  expensesApi: {
    getActuals: vi.fn(),
    deleteActual: vi.fn(),
    updateActual: vi.fn(),
    createActual: vi.fn(),
  },
}));

import ExpenseActualsList from '../../components/insurance/ExpenseActualsList';
import { expensesApi } from '../../services/api';

const actual = {
  id: 'a1',
  planId: 'p1',
  serviceType: 'MRI',
  serviceDate: '2026-01-15',
  dateOfService: '2026-01-15',
  providerName: 'Radiology Inc',
  billedAmount: 1200,
  insurancePaid: 900,
  patientPaid: 300,
  appliedToDeductible: 300,
  appliedToOop: 300,
  claimStatus: 'processed',
  isInNetwork: true,
  notes: null,
};

describe('ExpenseActualsList edit affordance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(expensesApi.getActuals).mockResolvedValue([actual] as never);
  });

  it('opens the modal in EDIT mode when a claim row Edit button is clicked', async () => {
    render(<ExpenseActualsList planId="p1" />);
    await screen.findByText('MRI'); // row loaded

    fireEvent.click(screen.getByRole('button', { name: /edit claim/i }));

    // ExpenseActualModal titles itself "Edit Claim Entry" when an actual is passed.
    expect(await screen.findByText('Edit Claim Entry')).toBeInTheDocument();
  });

  it('opens the modal in CREATE mode from the Add claim button', async () => {
    render(<ExpenseActualsList planId="p1" />);
    await screen.findByText('MRI');

    fireEvent.click(screen.getByRole('button', { name: /add claim/i }));

    expect(await screen.findByText('Add Claim Entry')).toBeInTheDocument();
  });
});
