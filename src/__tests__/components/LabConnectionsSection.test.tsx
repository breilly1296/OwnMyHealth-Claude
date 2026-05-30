/**
 * LabConnectionsSection Component Tests
 *
 * Covers the SMART-on-FHIR lab-connect UI wiring: list/empty rendering,
 * the connect flow's not-configured (503) handling, on-demand sync, and the
 * disconnect confirm flow. Browser navigation (the OAuth redirect) and the
 * ?labConnected callback are exercised separately because they require
 * stubbing window.location, which jsdom guards against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LabConnectionsSection from '../../components/settings/LabConnectionsSection';
import type { LabConnectionSummary } from '../../services/api';

vi.mock('../../services/api', () => ({
  fhirApi: {
    listConnections: vi.fn(),
    connectQuest: vi.fn(),
    syncConnection: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// Import the mocked module after vi.mock so we get the mock functions.
import { fhirApi } from '../../services/api';

const mockedFhir = vi.mocked(fhirApi);

const makeConnection = (overrides: Partial<LabConnectionSummary> = {}): LabConnectionSummary => ({
  id: 'conn-1',
  provider: 'quest',
  connectedAt: '2026-05-01T10:00:00.000Z',
  lastSyncAt: '2026-05-20T08:30:00.000Z',
  syncStatus: 'idle',
  syncError: null,
  lastImportedCount: 4,
  isActive: true,
  ...overrides,
});

describe('LabConnectionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFhir.listConnections.mockResolvedValue([]);
  });

  it('renders the empty state with a connect button when no labs are connected', async () => {
    render(<LabConnectionsSection />);

    expect(await screen.findByText(/no labs connected yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /connect quest diagnostics/i })
    ).toBeInTheDocument();
  });

  it('lists an existing connection with provider, status and last-sync info', async () => {
    mockedFhir.listConnections.mockResolvedValue([makeConnection()]);
    render(<LabConnectionsSection />);

    expect(await screen.findByText('Quest Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/4 results imported/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  it('surfaces a sync-error status and message', async () => {
    mockedFhir.listConnections.mockResolvedValue([
      makeConnection({ syncStatus: 'error', syncError: 'Token expired' }),
    ]);
    render(<LabConnectionsSection />);

    expect(await screen.findByText('Sync error')).toBeInTheDocument();
    expect(screen.getByText('Token expired')).toBeInTheDocument();
  });

  it('triggers a sync and reports the imported count', async () => {
    mockedFhir.listConnections.mockResolvedValue([makeConnection()]);
    mockedFhir.syncConnection.mockResolvedValue({
      imported: 3,
      skipped: 1,
      unmappedCodes: [],
      errors: [],
    });
    const onSuccess = vi.fn();
    render(<LabConnectionsSection onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole('button', { name: /sync now/i }));

    await waitFor(() => expect(mockedFhir.syncConnection).toHaveBeenCalledWith('conn-1'));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith('Imported 3 results, skipped 1.')
    );
  });

  it('shows a friendly message when the integration is not configured (503)', async () => {
    mockedFhir.connectQuest.mockRejectedValue({ status: 503, message: 'not configured' });
    const onError = vi.fn();
    render(<LabConnectionsSection onError={onError} />);

    fireEvent.click(await screen.findByRole('button', { name: /connect quest diagnostics/i }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Lab connections are not available on this server yet.')
    );
    // The connect flow rejected before navigation, so no redirect was attempted.
    expect(mockedFhir.connectQuest).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before disconnecting, then calls the API', async () => {
    mockedFhir.listConnections.mockResolvedValue([makeConnection()]);
    mockedFhir.disconnect.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<LabConnectionsSection onSuccess={onSuccess} />);

    // First click reveals the confirm prompt — no API call yet.
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    expect(await screen.findByText(/disconnect quest diagnostics\?/i)).toBeInTheDocument();
    expect(mockedFhir.disconnect).not.toHaveBeenCalled();

    // Confirm: the prompt adds a second "Disconnect" button — click the last.
    const disconnectButtons = screen.getAllByRole('button', { name: /^disconnect$/i });
    fireEvent.click(disconnectButtons[disconnectButtons.length - 1]);

    await waitFor(() => expect(mockedFhir.disconnect).toHaveBeenCalledWith('conn-1'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Lab disconnected.'));
  });

  it('shows an error with a retry affordance when the list fails to load', async () => {
    mockedFhir.listConnections.mockRejectedValueOnce(new Error('Network down'));
    render(<LabConnectionsSection />);

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
