/**
 * MyPatientsPage component tests.
 *
 * Centerpiece: a regression guard for the provider patient-detail contract bug
 * — GET /provider/patients/:id returns scope flags NESTED under
 * `relationship.permissions.{…}`, not flat on `relationship`. The component
 * must read the nested shape, or the consent-gated sections silently render
 * "hasn't shared" even when the patient granted access (which is exactly the
 * bug that shipped and was caught by manual smoke testing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MyPatientsPage from '../../components/provider/MyPatientsPage';
import type { ProviderPatientRelationship } from '../../services/api/provider';

vi.mock('../../services/api/provider', () => ({
  providerApi: {
    getPatients: vi.fn(),
    requestPatientAccess: vi.fn(),
    getPatient: vi.fn(),
    getPatientBiomarkers: vi.fn(),
    getPatientHealthNeeds: vi.fn(),
    removePatient: vi.fn(),
  },
}));

import { providerApi } from '../../services/api/provider';
const mocked = vi.mocked(providerApi);

const activeRel = (overrides: Partial<ProviderPatientRelationship> = {}): ProviderPatientRelationship => ({
  relationshipId: 'rel-1',
  patientId: 'patient-1',
  patient: { id: 'patient-1', email: 'jane@patient.io', createdAt: '2026-01-01T00:00:00.000Z' },
  permissions: {
    canViewBiomarkers: true,
    canViewInsurance: false,
    canViewHealthNeeds: true,
    canEditData: false,
  },
  relationshipType: 'PRIMARY_CARE',
  status: 'ACTIVE',
  consentGrantedAt: '2026-02-01T00:00:00.000Z',
  consentExpiresAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-02-01T00:00:00.000Z',
  ...overrides,
});

// The nested response shape the backend actually returns from GET /provider/patients/:id.
const detailResponse = (perms: Partial<{
  canViewBiomarkers: boolean;
  canViewInsurance: boolean;
  canViewHealthNeeds: boolean;
  canEditData: boolean;
}> = {}) => ({
  patient: { id: 'patient-1', email: 'jane@patient.io', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null },
  relationship: {
    id: 'rel-1',
    relationshipType: 'PRIMARY_CARE',
    permissions: {
      canViewBiomarkers: true,
      canViewInsurance: false,
      canViewHealthNeeds: true,
      canEditData: false,
      ...perms,
    },
    consentGrantedAt: '2026-02-01T00:00:00.000Z',
    consentExpiresAt: '2026-08-01T00:00:00.000Z',
  },
});

describe('MyPatientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPatients.mockResolvedValue([]);
    mocked.getPatientBiomarkers.mockResolvedValue([]);
    mocked.getPatientHealthNeeds.mockResolvedValue([]);
  });

  it('renders the request-access form and an empty roster', async () => {
    render(<MyPatientsPage />);
    expect(await screen.findByRole('heading', { name: 'Request patient access' })).toBeInTheDocument();
    expect(await screen.findByText(/no patients yet/i)).toBeInTheDocument();
  });

  it('submits an access request with the entered email + relationship', async () => {
    mocked.requestPatientAccess.mockResolvedValue({ relationshipId: 'rel-x', status: 'PENDING' });
    render(<MyPatientsPage />);

    fireEvent.change(await screen.findByPlaceholderText(/patient@example.com/i), {
      target: { value: 'new@patient.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() =>
      expect(mocked.requestPatientAccess).toHaveBeenCalledWith('new@patient.io', 'PRIMARY_CARE', undefined)
    );
  });

  it('lists an active patient with a View action', async () => {
    mocked.getPatients.mockResolvedValue([activeRel()]);
    render(<MyPatientsPage />);
    expect(await screen.findByText('jane@patient.io')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^view$/i })).toBeInTheDocument();
  });

  // ---- THE REGRESSION GUARD ----
  it('renders consent-granted sections from relationship.permissions (nested shape)', async () => {
    mocked.getPatients.mockResolvedValue([activeRel()]);
    mocked.getPatient.mockResolvedValue(detailResponse({ canViewBiomarkers: true, canViewHealthNeeds: true }));
    render(<MyPatientsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^view$/i }));

    // Sections must render (consent granted) — NOT the "hasn't shared" fallback.
    expect(await screen.findByRole('heading', { name: /^Biomarkers/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Health needs/i })).toBeInTheDocument();
    expect(screen.queryByText(/hasn.t shared/i)).not.toBeInTheDocument();
    // And it actually fetched the gated data because the nested flag read true.
    await waitFor(() => expect(mocked.getPatientBiomarkers).toHaveBeenCalledWith('patient-1'));
    expect(mocked.getPatientHealthNeeds).toHaveBeenCalledWith('patient-1');
  });

  it('shows the not-shared fallback and skips the fetch when a scope is denied', async () => {
    mocked.getPatients.mockResolvedValue([activeRel()]);
    mocked.getPatient.mockResolvedValue(detailResponse({ canViewBiomarkers: false, canViewHealthNeeds: false }));
    render(<MyPatientsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^view$/i }));

    expect(await screen.findByText(/hasn.t shared biomarkers/i)).toBeInTheDocument();
    expect(screen.getByText(/hasn.t shared health needs/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Biomarkers/i })).not.toBeInTheDocument();
    // Denied scopes must not trigger a PHI fetch.
    expect(mocked.getPatientBiomarkers).not.toHaveBeenCalled();
    expect(mocked.getPatientHealthNeeds).not.toHaveBeenCalled();
  });

  it('renders the patient biomarker rows in the detail view', async () => {
    mocked.getPatients.mockResolvedValue([activeRel()]);
    mocked.getPatient.mockResolvedValue(detailResponse({ canViewBiomarkers: true }));
    mocked.getPatientBiomarkers.mockResolvedValue([
      {
        id: 'b1', name: 'Vitamin D', value: 22, unit: 'ng/mL', date: '2026-03-01', category: 'Vitamins',
        normalRange: { min: 30, max: 100 }, isOutOfRange: true,
      },
    ]);
    render(<MyPatientsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^view$/i }));
    expect(await screen.findByText('Vitamin D')).toBeInTheDocument();
    expect(screen.getByText(/22 ng\/mL/i)).toBeInTheDocument();
  });
});
