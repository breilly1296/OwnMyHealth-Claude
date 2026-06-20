/**
 * CareTeamPage component tests — patient-facing provider consent management.
 * Covers pending-request approve/deny (with the default scope draft + duration),
 * and active-provider permission edit / revoke.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CareTeamPage from '../../components/provider/CareTeamPage';
import type {
  PatientProviderRelationship,
  PendingProviderRequest,
} from '../../services/api/patient';

vi.mock('../../services/api/patient', () => ({
  patientApi: {
    getProviders: vi.fn(),
    getPendingRequests: vi.fn(),
    approveProvider: vi.fn(),
    denyProvider: vi.fn(),
    updateProviderPermissions: vi.fn(),
    revokeProvider: vi.fn(),
    removeProvider: vi.fn(),
  },
}));

import { patientApi } from '../../services/api/patient';
const mocked = vi.mocked(patientApi);

const pending = (overrides: Partial<PendingProviderRequest> = {}): PendingProviderRequest => ({
  requestId: 'req-1',
  providerId: 'prov-1',
  provider: { id: 'prov-1', email: 'dr@clinic.io' },
  relationshipType: 'PRIMARY_CARE',
  requestedAt: '2026-05-01T00:00:00.000Z',
  ...overrides,
});

const active = (overrides: Partial<PatientProviderRelationship> = {}): PatientProviderRelationship => ({
  relationshipId: 'rel-1',
  providerId: 'prov-2',
  provider: { id: 'prov-2', email: 'active@clinic.io' },
  permissions: { canViewBiomarkers: true, canViewInsurance: false, canViewHealthNeeds: true, canEditData: false },
  relationshipType: 'SPECIALIST',
  status: 'ACTIVE',
  consentGrantedAt: '2026-04-01T00:00:00.000Z',
  consentExpiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

describe('CareTeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPendingRequests.mockResolvedValue([]);
    mocked.getProviders.mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders empty states for pending + active sections', async () => {
    render(<CareTeamPage />);
    expect(await screen.findByText(/no pending provider requests/i)).toBeInTheDocument();
    expect(screen.getByText(/no providers currently have access/i)).toBeInTheDocument();
  });

  it('lists a pending request and approves it with the default scopes + 90-day consent', async () => {
    mocked.getPendingRequests.mockResolvedValue([pending()]);
    mocked.approveProvider.mockResolvedValue({ message: 'ok' });
    render(<CareTeamPage />);

    expect(await screen.findByText('dr@clinic.io')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(mocked.approveProvider).toHaveBeenCalledWith('req-1', {
        canViewBiomarkers: true,
        canViewInsurance: false,
        canViewHealthNeeds: true,
        canEditData: false,
        consentDurationDays: 90,
      })
    );
    // Reloads the lists after a successful approve.
    await waitFor(() => expect(mocked.getProviders).toHaveBeenCalledTimes(2));
  });

  it('denies a pending request', async () => {
    mocked.getPendingRequests.mockResolvedValue([pending()]);
    mocked.denyProvider.mockResolvedValue({ message: 'ok' });
    render(<CareTeamPage />);

    fireEvent.click(await screen.findByRole('button', { name: /deny/i }));
    await waitFor(() => expect(mocked.denyProvider).toHaveBeenCalledWith('req-1'));
  });

  it('edits an active provider’s permissions and saves the new scope set', async () => {
    mocked.getProviders.mockResolvedValue([active()]);
    mocked.updateProviderPermissions.mockResolvedValue(active());
    render(<CareTeamPage />);

    expect(await screen.findByText('active@clinic.io')).toBeInTheDocument();
    // Flip the (currently false) insurance scope on.
    fireEvent.click(screen.getByRole('checkbox', { name: /insurance/i }));
    fireEvent.click(screen.getByRole('button', { name: /save permissions/i }));

    await waitFor(() =>
      expect(mocked.updateProviderPermissions).toHaveBeenCalledWith('rel-1', {
        canViewBiomarkers: true,
        canViewInsurance: true,
        canViewHealthNeeds: true,
        canEditData: false,
      })
    );
  });

  it('revokes an active provider after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocked.getProviders.mockResolvedValue([active()]);
    mocked.revokeProvider.mockResolvedValue({ message: 'ok' });
    render(<CareTeamPage />);

    fireEvent.click(await screen.findByRole('button', { name: /revoke access/i }));
    await waitFor(() => expect(mocked.revokeProvider).toHaveBeenCalledWith('rel-1'));
  });

  it('renders a back control that calls onBack when the prop is provided', async () => {
    const onBack = vi.fn();
    render(<CareTeamPage onBack={onBack} />);

    const backButton = await screen.findByRole('button', { name: /back to dashboard/i });
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('omits the back control when onBack is not provided', async () => {
    render(<CareTeamPage />);

    expect(await screen.findByText(/no pending provider requests/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /back to dashboard/i })
    ).not.toBeInTheDocument();
  });
});
