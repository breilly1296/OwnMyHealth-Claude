/**
 * resolveProviderAccess unit tests (M3/L35).
 *
 * This is the single choke point gating provider access to patient PHI. The
 * tests pin every denial reason, that the REQUIRED flag (not a hard-coded one)
 * drives the permission check, and that a denied flag short-circuits before the
 * patient row is loaded. providerAccessError's reason->HTTP mapping is covered too.
 */

import { describe, it, expect } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';
import { createMockPrismaTransaction, type MockPrismaTx } from '../controllers/testHelpers.js';
import {
  resolveProviderAccess,
  providerAccessError,
  type ProviderPermissionFlag,
} from './providerAccess.js';
import { ForbiddenError, NotFoundError } from '../middleware/errorHandler.js';

const NOW = new Date('2026-06-13T00:00:00.000Z');

function relRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel-1',
    providerId: 'prov-1',
    patientId: 'pat-1',
    canViewBiomarkers: true,
    canViewInsurance: false,
    canViewHealthNeeds: true,
    canEditData: false,
    relationshipType: 'PRIMARY_CARE',
    status: 'ACTIVE',
    consentGrantedAt: new Date('2026-01-01'),
    consentExpiresAt: null,
    notesEncrypted: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function tx() {
  return createMockPrismaTransaction() as unknown as MockPrismaTx & Prisma.TransactionClient;
}

async function run(t: ReturnType<typeof tx>, flag: ProviderPermissionFlag) {
  return resolveProviderAccess(t, 'prov-1', 'pat-1', flag, NOW);
}

describe('resolveProviderAccess', () => {
  it('denies with no_relationship when none exists', async () => {
    const t = tx();
    t.providerPatient.findUnique.mockResolvedValue(null);
    expect(await run(t, 'canViewBiomarkers')).toMatchObject({ ok: false, reason: 'no_relationship' });
  });

  it('denies with relationship_not_active for any non-ACTIVE status', async () => {
    for (const status of ['PENDING', 'REVOKED', 'SUSPENDED', 'EXPIRED']) {
      const t = tx();
      t.providerPatient.findUnique.mockResolvedValue(relRow({ status }));
      expect(await run(t, 'canViewBiomarkers')).toMatchObject({ ok: false, reason: 'relationship_not_active' });
    }
  });

  it('denies with consent_expired when consentExpiresAt is in the past', async () => {
    const t = tx();
    t.providerPatient.findUnique.mockResolvedValue(relRow({ consentExpiresAt: new Date('2026-01-01') }));
    expect(await run(t, 'canViewBiomarkers')).toMatchObject({ ok: false, reason: 'consent_expired' });
  });

  it('denies with permission_denied when the REQUIRED flag is false, before loading the patient', async () => {
    const t = tx();
    t.providerPatient.findUnique.mockResolvedValue(relRow({ canViewInsurance: false }));
    expect(await run(t, 'canViewInsurance')).toMatchObject({ ok: false, reason: 'permission_denied' });
    // Short-circuits — no patient lookup when the flag is denied.
    expect(t.user.findFirst).not.toHaveBeenCalled();
  });

  it('denies with patient_inactive_or_locked when the patient account is gone/locked', async () => {
    const t = tx();
    t.providerPatient.findUnique.mockResolvedValue(relRow({ canViewInsurance: true }));
    t.user.findFirst.mockResolvedValue(null);
    expect(await run(t, 'canViewInsurance')).toMatchObject({ ok: false, reason: 'patient_inactive_or_locked' });
  });

  it('grants access when ACTIVE, unexpired, flag granted, and patient active', async () => {
    const t = tx();
    t.providerPatient.findUnique.mockResolvedValue(relRow({ canViewInsurance: true }));
    t.user.findFirst.mockResolvedValue({ id: 'pat-1' });
    const r = await run(t, 'canViewInsurance');
    expect(r.ok).toBe(true);
    expect(r.relationship).not.toBeNull();
  });

  it('checks the SPECIFIC required flag, not a fixed one', async () => {
    // canViewBiomarkers true, canEditData false: viewing biomarkers ok, editing denied.
    const tView = tx();
    tView.providerPatient.findUnique.mockResolvedValue(relRow({ canViewBiomarkers: true, canEditData: false }));
    tView.user.findFirst.mockResolvedValue({ id: 'pat-1' });
    expect((await run(tView, 'canViewBiomarkers')).ok).toBe(true);

    const tEdit = tx();
    tEdit.providerPatient.findUnique.mockResolvedValue(relRow({ canViewBiomarkers: true, canEditData: false }));
    expect((await run(tEdit, 'canEditData')).reason).toBe('permission_denied');
  });
});

describe('providerAccessError', () => {
  it('maps denial reasons to the right HTTP error + message', () => {
    expect(providerAccessError('consent_expired', 'insurance')).toBeInstanceOf(ForbiddenError);
    expect(providerAccessError('consent_expired', 'insurance').message).toBe('Provider consent has expired');

    const denied = providerAccessError('permission_denied', 'insurance');
    expect(denied).toBeInstanceOf(ForbiddenError);
    expect(denied.message).toBe("You do not have permission to view this patient's insurance");

    expect(providerAccessError('patient_inactive_or_locked', 'biomarkers')).toBeInstanceOf(NotFoundError);

    for (const reason of ['no_relationship', 'relationship_not_active', undefined] as const) {
      const e = providerAccessError(reason, 'biomarkers');
      expect(e).toBeInstanceOf(ForbiddenError);
      expect(e.message).toBe('You do not have access to this patient');
    }
  });
});
