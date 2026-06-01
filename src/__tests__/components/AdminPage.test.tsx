/**
 * AdminPage component tests — ADMIN console.
 * Covers each tab loading its data (stats / users / audit log / relationships)
 * and the key mutations (role change, relationship scope toggle).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPage from '../../components/admin/AdminPage';
import type { AdminUser, SystemStats, AdminAuditLog, AdminProviderRelationship } from '../../services/api/admin';

vi.mock('../../services/api/admin', () => ({
  adminApi: {
    getStats: vi.fn(),
    getUsers: vi.fn(),
    updateUser: vi.fn(),
    updateUserPlan: vi.fn(),
    deleteUserPermanently: vi.fn(),
    getAuditLogs: vi.fn(),
    getProviderRelationships: vi.fn(),
    updateProviderRelationship: vi.fn(),
  },
}));

import { adminApi } from '../../services/api/admin';
const mocked = vi.mocked(adminApi);

const STATS: SystemStats = {
  users: { total: 5, active: 5, byRole: { PATIENT: 3, PROVIDER: 1, ADMIN: 1 }, recentLogins: 2 },
  data: { biomarkers: 0, insurancePlans: 0, healthNeeds: 0 },
};

const USER: AdminUser = {
  id: 'u1', email: 'someone@omh.io', role: 'PATIENT', isActive: true, emailVerified: true,
  plan: 'FREE', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-05-01T00:00:00.000Z',
};

const LOG: AdminAuditLog = {
  id: 'log-1', userId: 'u1', actorType: 'USER', action: 'LOGIN', resourceType: 'session',
  resourceId: null, ipAddress: '127.0.0.1', success: true, errorMessage: null, metadata: null,
  createdAt: '2026-05-30T12:00:00.000Z', user: { id: 'u1', email: 'someone@omh.io', role: 'PATIENT' },
};

const REL: AdminProviderRelationship = {
  id: 'rel-1', providerId: 'prov-aaaaaaaa', patientId: 'pat-bbbbbbbb', relationshipType: 'PRIMARY_CARE',
  status: 'ACTIVE', canViewBiomarkers: true, canViewInsurance: false, canViewHealthNeeds: true,
  canEditData: false, consentGrantedAt: '2026-04-01T00:00:00.000Z', consentExpiresAt: null,
  createdAt: '2026-04-01T00:00:00.000Z',
};

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getStats.mockResolvedValue(STATS);
    mocked.getUsers.mockResolvedValue({ users: [USER], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    mocked.getAuditLogs.mockResolvedValue({ logs: [LOG], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } });
    mocked.getProviderRelationships.mockResolvedValue([REL]);
  });

  it('shows the Overview stats by default', async () => {
    render(<AdminPage />);
    expect(await screen.findByText('Total users')).toBeInTheDocument();
    expect(screen.getByText('Users by role')).toBeInTheDocument();
    // The PATIENT-by-role count from the stats payload.
    expect(await screen.findByText('PATIENT')).toBeInTheDocument();
  });

  it('lists users on the Users tab and changes a role', async () => {
    mocked.updateUser.mockResolvedValue({ ...USER, role: 'PROVIDER' });
    render(<AdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    expect(await screen.findByText('someone@omh.io')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'PROVIDER' } });

    await waitFor(() => expect(mocked.updateUser).toHaveBeenCalledWith('u1', { role: 'PROVIDER' }));
  });

  it('changes a user plan via updateUserPlan', async () => {
    mocked.updateUserPlan.mockResolvedValue({ id: 'u1', email: 'someone@omh.io', plan: 'PRO', planExpiresAt: null, planUpdatedAt: '2026-06-01T00:00:00.000Z' });
    render(<AdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    await screen.findByText('someone@omh.io');

    fireEvent.change(screen.getByRole('combobox', { name: 'Plan' }), { target: { value: 'PRO' } });
    await waitFor(() => expect(mocked.updateUserPlan).toHaveBeenCalledWith('u1', { plan: 'PRO' }));
  });

  it('renders audit-log rows on the Audit Log tab', async () => {
    render(<AdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Audit Log' }));
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(screen.getByText('someone@omh.io')).toBeInTheDocument();
  });

  it('toggles a relationship scope on the Relationships tab', async () => {
    mocked.updateProviderRelationship.mockResolvedValue({ ...REL, canViewBiomarkers: false });
    render(<AdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Relationships' }));

    const bioToggle = await screen.findByRole('checkbox', { name: /biomarkers/i });
    fireEvent.click(bioToggle); // currently true → false
    await waitFor(() =>
      expect(mocked.updateProviderRelationship).toHaveBeenCalledWith('rel-1', { canViewBiomarkers: false })
    );
  });
});
