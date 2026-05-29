/**
 * RLS tenant-isolation regression test (C-1).
 *
 * Proves `withRLSContext` enforces isolation at the DB layer via Row-Level
 * Security — the queries intentionally omit a `where: { userId }` filter, so
 * if RLS is actually enforced, only the caller's row comes back.
 *
 * Verified to fail against the pre-C-1-fix implementation, where `SET LOCAL`
 * ran outside a transaction and was discarded before the callback's queries
 * ran — `app.current_user_id` was NULL at query time and the policy matched
 * against NULL (either leaking rows or returning none depending on pool
 * state, but never deterministically isolating).
 *
 * Requires a live Postgres with migration `20260107_add_rls_policies`
 * applied. Set DATABASE_URL and PHI_ENCRYPTION_KEY to enable; otherwise the
 * suite skips so unit-only CI runs stay green.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  disconnectDatabase,
  getPrismaClient,
  withRLSContext,
} from './database.js';

const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.PHI_ENCRYPTION_KEY);

describe.skipIf(!hasLiveDb)('RLS tenant isolation (withRLSContext)', () => {
  const userA = { id: randomUUID(), email: `rls-a-${Date.now()}@test.local` };
  const userB = { id: randomUUID(), email: `rls-b-${Date.now()}@test.local` };
  const markerNames = ['__RLS_TEST_A__', '__RLS_TEST_B__'];
  // Provider-consent fixtures (userA plays the patient). providerOk holds an
  // ACTIVE biomarker-consent over userA; providerNo holds none.
  const providerOk = { id: randomUUID(), email: `rls-prov-ok-${Date.now()}@test.local` };
  const providerNo = { id: randomUUID(), email: `rls-prov-no-${Date.now()}@test.local` };

  beforeAll(async () => {
    // Lazy-init Prisma only. initializeDatabase() would also kick off
    // auditService.initialize() which needs admin context against
    // system_config and is unrelated to the tenant-isolation behavior
    // under test here.
    getPrismaClient();

    // Seed via admin context so we can insert rows for both tenants.
    await withRLSContext(null, async (tx) => {
      await tx.user.create({
        data: {
          id: userA.id,
          email: userA.email,
          passwordHash: 'test-hash-not-used',
        },
      });
      await tx.user.create({
        data: {
          id: userB.id,
          email: userB.email,
          passwordHash: 'test-hash-not-used',
        },
      });
      await tx.biomarker.create({
        data: {
          userId: userA.id,
          category: 'test',
          name: markerNames[0],
          unit: 'test',
          valueEncrypted: 'ct-a',
          normalRangeMin: 0,
          normalRangeMax: 1,
          measurementDate: new Date(),
        },
      });
      await tx.biomarker.create({
        data: {
          userId: userB.id,
          category: 'test',
          name: markerNames[1],
          unit: 'test',
          valueEncrypted: 'ct-b',
          normalRangeMin: 0,
          normalRangeMax: 1,
          measurementDate: new Date(),
        },
      });

      // Provider users + an ACTIVE biomarker-consent from providerOk over userA.
      await tx.user.create({
        data: { id: providerOk.id, email: providerOk.email, passwordHash: 'test-hash-not-used' },
      });
      await tx.user.create({
        data: { id: providerNo.id, email: providerNo.email, passwordHash: 'test-hash-not-used' },
      });
      await tx.providerPatient.create({
        data: {
          providerId: providerOk.id,
          patientId: userA.id,
          status: 'ACTIVE',
          canViewBiomarkers: true,
        },
      });
      // PENDING relationship providerOk -> userB: has_active_consent is false
      // for PENDING, so providerOk must NOT be able to read userB's identity.
      await tx.providerPatient.create({
        data: {
          providerId: providerOk.id,
          patientId: userB.id,
          status: 'PENDING',
          canViewBiomarkers: true,
        },
      });
    });
  });

  afterAll(async () => {
    await withRLSContext(null, async (tx) => {
      await tx.providerPatient.deleteMany({
        where: { providerId: { in: [providerOk.id, providerNo.id] } },
      });
      await tx.biomarker.deleteMany({ where: { name: { in: markerNames } } });
      await tx.user.deleteMany({
        where: { id: { in: [userA.id, userB.id, providerOk.id, providerNo.id] } },
      });
    });
    await disconnectDatabase();
  });

  it('user A sees only their row when no where-filter is applied', async () => {
    const rows = await withRLSContext(userA.id, async (tx) => {
      return tx.biomarker.findMany({ where: { name: { in: markerNames } } });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userA.id);
  });

  it('user B sees only their row when no where-filter is applied', async () => {
    const rows = await withRLSContext(userB.id, async (tx) => {
      return tx.biomarker.findMany({ where: { name: { in: markerNames } } });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userB.id);
  });

  it('admin context sees both tenants', async () => {
    const rows = await withRLSContext(null, async (tx) => {
      return tx.biomarker.findMany({ where: { name: { in: markerNames } } });
    });
    expect(rows).toHaveLength(2);
  });

  it('queries across pooled connections do not leak context between calls', async () => {
    // Issue the two calls back-to-back on the same pool. If SET LOCAL leaked
    // (F-14), B's call could see A's view. Must stay deterministic.
    const aRows = await withRLSContext(userA.id, async (tx) =>
      tx.biomarker.findMany({ where: { name: { in: markerNames } } })
    );
    const bRows = await withRLSContext(userB.id, async (tx) =>
      tx.biomarker.findMany({ where: { name: { in: markerNames } } })
    );
    expect(aRows.map((r) => r.userId)).toEqual([userA.id]);
    expect(bRows.map((r) => r.userId)).toEqual([userB.id]);
  });

  // Consent-scoped cross-tenant access through the has_provider_access() policy
  // branch. This is the path that was silently broken: the function referenced
  // the dropped provider_patients.can_view_dna column and threw for ANY
  // permission_type under a NOBYPASSRLS role — which also breaks the own-data
  // reads above (the biomarkers_select policy evaluates has_provider_access for
  // every non-owned row). Fixed by migration 20260529_fix_has_provider_access.
  describe('provider-consent access (has_provider_access)', () => {
    const readUserAMarker = (asUserId: string) =>
      withRLSContext(asUserId, async (tx) =>
        tx.biomarker.findMany({ where: { name: markerNames[0] } })
      );

    it('a consented provider reads the patient biomarker via the policy', async () => {
      const rows = await readUserAMarker(providerOk.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userA.id);
    });

    it('a provider with NO consent relationship sees nothing', async () => {
      const rows = await readUserAMarker(providerNo.id);
      expect(rows).toHaveLength(0);
    });

    it('the patient still sees their own biomarker (provider consent does not affect owner view)', async () => {
      const rows = await readUserAMarker(userA.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userA.id);
    });

    // users_select_provider policy (P7): a consented provider can read the
    // patient's minimal identity {id,email}; a non-consented provider cannot.
    it('a consented provider can read the patient user row {id,email}', async () => {
      const row = await withRLSContext(providerOk.id, async (tx) =>
        tx.user.findUnique({ where: { id: userA.id }, select: { id: true, email: true } })
      );
      expect(row).not.toBeNull();
      expect(row?.id).toBe(userA.id);
      expect(row?.email).toBe(userA.email);
    });

    it('a non-consented provider cannot read the patient user row', async () => {
      const row = await withRLSContext(providerNo.id, async (tx) =>
        tx.user.findUnique({ where: { id: userA.id }, select: { id: true, email: true } })
      );
      expect(row).toBeNull();
    });

    it('a PENDING relationship does NOT expose the patient user row', async () => {
      // providerOk has an ACTIVE consent over userA but only PENDING over userB.
      const row = await withRLSContext(providerOk.id, async (tx) =>
        tx.user.findUnique({ where: { id: userB.id }, select: { id: true, email: true } })
      );
      expect(row).toBeNull();
    });

    // Runs last — mutates the shared consent row to an expired state.
    it('access is revoked once consent expires', async () => {
      await withRLSContext(null, async (tx) => {
        await tx.providerPatient.updateMany({
          where: { providerId: providerOk.id, patientId: userA.id },
          data: { consentExpiresAt: new Date(Date.now() - 60_000) },
        });
      });
      const rows = await readUserAMarker(providerOk.id);
      expect(rows).toHaveLength(0);
    });
  });
});
