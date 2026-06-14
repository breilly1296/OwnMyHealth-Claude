import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';

// resolveEffectivePlan never touches withRLSContext (it uses the passed tx), but
// importing usageTracker pulls in database.js → mock it so the real Prisma client
// module is not loaded by the unit test.
vi.mock('./database.js', () => ({ withRLSContext: vi.fn() }));

import { resolveEffectivePlan } from './usageTracker.js';

function txWithUser(
  userRow: { plan: string | null; planExpiresAt: Date | null } | null
): Prisma.TransactionClient {
  return {
    user: { findUnique: vi.fn(async () => userRow) },
  } as unknown as Prisma.TransactionClient;
}

describe('resolveEffectivePlan (shared effective-plan resolution, mirrors planGating)', () => {
  it('returns the stored plan tier', async () => {
    expect(await resolveEffectivePlan(txWithUser({ plan: 'PRO', planExpiresAt: null }), 'u')).toBe('PRO');
    expect(await resolveEffectivePlan(txWithUser({ plan: 'TEAM', planExpiresAt: null }), 'u')).toBe('TEAM');
  });

  it('defaults to FREE for an unknown plan or a missing user row', async () => {
    expect(await resolveEffectivePlan(txWithUser({ plan: 'bogus', planExpiresAt: null }), 'u')).toBe('FREE');
    expect(await resolveEffectivePlan(txWithUser({ plan: null, planExpiresAt: null }), 'u')).toBe('FREE');
    expect(await resolveEffectivePlan(txWithUser(null), 'u')).toBe('FREE');
  });

  it('downgrades a paid plan to FREE once planExpiresAt is in the past', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await resolveEffectivePlan(txWithUser({ plan: 'PRO', planExpiresAt: past }), 'u')).toBe('FREE');
  });

  it('keeps a paid plan whose planExpiresAt is in the future', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(await resolveEffectivePlan(txWithUser({ plan: 'PRO', planExpiresAt: future }), 'u')).toBe('PRO');
  });
});
