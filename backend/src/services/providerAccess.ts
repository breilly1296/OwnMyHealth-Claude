/**
 * Provider -> patient access resolution.
 *
 * Single choke point for "may this provider read/write this patient's data?"
 * It takes the REQUIRED consent flag as an argument, so a route physically
 * cannot forget to gate on a permission. Previously each provider route inlined
 * its own findUnique + status + expiry + flag block (4 copies that had already
 * drifted — the detail/list handlers omit the flag check by design, the PHI
 * handlers include it); a new route was one copy-paste away from silently
 * missing a gate. (M3/L35.)
 *
 * MUST run inside the caller's withRLSContext(providerId) transaction so the
 * subsequent PHI query executes in the same RLS context; the RLS
 * `has_provider_access()` policy branch remains the fail-closed DB backstop.
 *
 * Denial reasons mirror the audit `reason` values the provider routes already
 * emit, so callers log them unchanged.
 */

import type { Prisma, ProviderPatient } from '../../generated/prisma/index.js';
import { ForbiddenError, NotFoundError } from '../middleware/errorHandler.js';

export type ProviderPermissionFlag =
  | 'canViewBiomarkers'
  | 'canViewInsurance'
  | 'canViewHealthNeeds'
  | 'canEditData';

export type ProviderAccessDenialReason =
  | 'no_relationship'
  | 'relationship_not_active'
  | 'consent_expired'
  | 'permission_denied'
  | 'patient_inactive_or_locked';

export interface ProviderAccessResult {
  ok: boolean;
  reason?: ProviderAccessDenialReason;
  relationship: ProviderPatient | null;
}

/**
 * Resolve whether `providerId` may access `patientId`'s data requiring
 * `requiredFlag`. Checks, in order: relationship exists, status ACTIVE, consent
 * not expired, the specific permission flag granted, and the patient account is
 * active + unlocked (consent does not survive the patient deactivating or
 * locking their account).
 */
export async function resolveProviderAccess(
  tx: Prisma.TransactionClient,
  providerId: string,
  patientId: string,
  requiredFlag: ProviderPermissionFlag,
  now: Date = new Date()
): Promise<ProviderAccessResult> {
  const relationship = await tx.providerPatient.findUnique({
    where: { providerId_patientId: { providerId, patientId } },
  });

  if (!relationship) return { ok: false, reason: 'no_relationship', relationship: null };
  if (relationship.status !== 'ACTIVE') {
    return { ok: false, reason: 'relationship_not_active', relationship };
  }
  if (relationship.consentExpiresAt && new Date(relationship.consentExpiresAt) < now) {
    return { ok: false, reason: 'consent_expired', relationship };
  }
  if (!relationship[requiredFlag]) {
    return { ok: false, reason: 'permission_denied', relationship };
  }

  // Consent does not survive account deactivation/lock — drop access the moment
  // the patient's account is disabled or locked, mirroring the read handlers.
  const patient = await tx.user.findFirst({
    where: {
      id: patientId,
      isActive: true,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    select: { id: true },
  });
  if (!patient) return { ok: false, reason: 'patient_inactive_or_locked', relationship };

  return { ok: true, relationship };
}

/**
 * Map a denial reason to the HTTP error the provider routes throw, preserving
 * the existing per-resource messages. `resourceLabel` is e.g. "biomarkers".
 */
export function providerAccessError(
  reason: ProviderAccessDenialReason | undefined,
  resourceLabel: string
): Error {
  switch (reason) {
    case 'consent_expired':
      return new ForbiddenError('Provider consent has expired');
    case 'permission_denied':
      return new ForbiddenError(`You do not have permission to view this patient's ${resourceLabel}`);
    case 'patient_inactive_or_locked':
      return new NotFoundError('Patient not found or account is inactive');
    case 'no_relationship':
    case 'relationship_not_active':
    default:
      return new ForbiddenError('You do not have access to this patient');
  }
}
