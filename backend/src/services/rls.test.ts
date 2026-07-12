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
  // Scope + status matrix fixtures, all over userA (the patient):
  //  - bioNoNeeds: ACTIVE, biomarkers granted but health-needs DENIED (per-scope isolation)
  //  - revoked / suspended: non-ACTIVE statuses must grant nothing, even with the flags on
  const providerBioNoNeeds = { id: randomUUID(), email: `rls-prov-bio-${Date.now()}@test.local` };
  const providerRevoked = { id: randomUUID(), email: `rls-prov-rev-${Date.now()}@test.local` };
  const providerSuspended = { id: randomUUID(), email: `rls-prov-susp-${Date.now()}@test.local` };
  const needName = '__RLS_TEST_NEED_A__';
  // M19 audit-retention fixtures: one row well past the 7-year window, one recent.
  const auditOldId = randomUUID();
  const auditRecentId = randomUUID();
  // M1: revoked-access-token rows, one per tenant, to exercise the
  // revoked_access_tokens RLS policies (mirror of sessions).
  const revokedJtiA = randomUUID();
  const revokedJtiB = randomUUID();

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

      // A health need for userA — exercises the health_needs_select policy,
      // which gates provider reads on has_provider_access(user_id, 'view_health_needs').
      await tx.healthNeed.create({
        data: {
          userId: userA.id,
          needType: 'CONDITION',
          name: needName,
          descriptionEncrypted: 'ct-need',
          urgency: 'ROUTINE',
          relatedBiomarkerIds: [],
        },
      });

      // Matrix providers + their relationships over userA.
      for (const p of [providerBioNoNeeds, providerRevoked, providerSuspended]) {
        await tx.user.create({
          data: { id: p.id, email: p.email, passwordHash: 'test-hash-not-used' },
        });
      }
      // ACTIVE but health-needs explicitly denied → biomarkers visible, needs not.
      await tx.providerPatient.create({
        data: {
          providerId: providerBioNoNeeds.id,
          patientId: userA.id,
          status: 'ACTIVE',
          canViewBiomarkers: true,
          canViewHealthNeeds: false,
        },
      });
      // Non-ACTIVE statuses: flags are on, but status alone must block all access.
      await tx.providerPatient.create({
        data: {
          providerId: providerRevoked.id,
          patientId: userA.id,
          status: 'REVOKED',
          canViewBiomarkers: true,
          canViewHealthNeeds: true,
        },
      });
      await tx.providerPatient.create({
        data: {
          providerId: providerSuspended.id,
          patientId: userA.id,
          status: 'SUSPENDED',
          canViewBiomarkers: true,
          canViewHealthNeeds: true,
        },
      });

      // M19: two audit rows for the retention-delete policy test — one aged past
      // the 7-year window, one recent.
      await tx.auditLog.create({
        data: {
          id: auditOldId,
          actorType: 'SYSTEM',
          action: 'READ',
          resourceType: '__RLS_TEST_AUDIT__',
          createdAt: new Date('2010-01-01T00:00:00.000Z'),
        },
      });
      await tx.auditLog.create({
        data: {
          id: auditRecentId,
          actorType: 'SYSTEM',
          action: 'READ',
          resourceType: '__RLS_TEST_AUDIT__',
        },
      });

      // M1: one revoked-access-token row per tenant.
      await tx.revokedAccessToken.create({
        data: { jti: revokedJtiA, userId: userA.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      await tx.revokedAccessToken.create({
        data: { jti: revokedJtiB, userId: userB.id, expiresAt: new Date(Date.now() + 60_000) },
      });
    });
  });

  afterAll(async () => {
    await withRLSContext(null, async (tx) => {
      const providerIds = [
        providerOk.id,
        providerNo.id,
        providerBioNoNeeds.id,
        providerRevoked.id,
        providerSuspended.id,
      ];
      await tx.providerPatient.deleteMany({ where: { providerId: { in: providerIds } } });
      await tx.healthNeed.deleteMany({ where: { name: needName } });
      await tx.revokedAccessToken.deleteMany({ where: { jti: { in: [revokedJtiA, revokedJtiB] } } });
      await tx.biomarker.deleteMany({ where: { name: { in: markerNames } } });
      // Aged test audit row is deletable; the recent one is policy-blocked and
      // survives (the CI Postgres is ephemeral, so the leftover is harmless).
      await tx.auditLog.deleteMany({ where: { resourceType: '__RLS_TEST_AUDIT__' } });
      await tx.user.deleteMany({
        where: { id: { in: [userA.id, userB.id, ...providerIds] } },
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

  // M1: revoked_access_tokens carries (jti, user_id) and backs cross-instance
  // single-device logout. Its RLS policies mirror sessions — a tenant must see
  // only their own revocation rows, admin sees all.
  describe('revoked_access_tokens isolation', () => {
    it('user A sees only their own revoked-token rows', async () => {
      const rows = await withRLSContext(userA.id, async (tx) =>
        tx.revokedAccessToken.findMany({ where: { jti: { in: [revokedJtiA, revokedJtiB] } } })
      );
      expect(rows.map((r) => r.jti)).toEqual([revokedJtiA]);
    });

    it('user B cannot see user A revoked-token row', async () => {
      const rows = await withRLSContext(userB.id, async (tx) =>
        tx.revokedAccessToken.findMany({ where: { jti: revokedJtiA } })
      );
      expect(rows).toHaveLength(0);
    });

    it('admin context sees both tenants revoked-token rows', async () => {
      const rows = await withRLSContext(null, async (tx) =>
        tx.revokedAccessToken.findMany({ where: { jti: { in: [revokedJtiA, revokedJtiB] } } })
      );
      expect(rows).toHaveLength(2);
    });
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
    const readUserANeed = (asUserId: string) =>
      withRLSContext(asUserId, async (tx) =>
        tx.healthNeed.findMany({ where: { name: needName } })
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

    // ---- health_needs policy + per-scope + non-ACTIVE-status matrix ----

    it('a consented provider reads the patient health need (view_health_needs)', async () => {
      // providerOk has canViewHealthNeeds = true (schema default).
      const rows = await readUserANeed(providerOk.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userA.id);
    });

    it('per-scope isolation: a biomarker-only consent reads biomarkers but NOT health needs', async () => {
      // canViewBiomarkers = true, canViewHealthNeeds = false on an ACTIVE consent.
      expect(await readUserAMarker(providerBioNoNeeds.id)).toHaveLength(1);
      expect(await readUserANeed(providerBioNoNeeds.id)).toHaveLength(0);
    });

    it('a REVOKED relationship grants nothing — biomarkers, health needs, or identity', async () => {
      expect(await readUserAMarker(providerRevoked.id)).toHaveLength(0);
      expect(await readUserANeed(providerRevoked.id)).toHaveLength(0);
      const row = await withRLSContext(providerRevoked.id, async (tx) =>
        tx.user.findUnique({ where: { id: userA.id }, select: { id: true } })
      );
      expect(row).toBeNull();
    });

    it('a SUSPENDED relationship grants nothing', async () => {
      expect(await readUserAMarker(providerSuspended.id)).toHaveLength(0);
      expect(await readUserANeed(providerSuspended.id)).toHaveLength(0);
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

  // M2 / M19 — RLS hardening: FORCE on every table + DB-enforced audit retention.
  describe('RLS hardening (M2 FORCE + M19 audit retention)', () => {
    it('every RLS-enabled public table is also FORCE-protected (M2)', async () => {
      const prisma = getPrismaClient();
      const unforced = await prisma.$queryRaw<Array<{ relname: string }>>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
        ORDER BY c.relname
      `;
      // Migration 20260613 forces every RLS table; a non-empty list means a
      // table enabled RLS without FORCE — an owner-bypass tenant-isolation gap.
      expect(unforced.map((r) => r.relname)).toEqual([]);
    });

    it('admin context CANNOT delete a recent audit row (within the 7-year window)', async () => {
      const res = await withRLSContext(null, async (tx) =>
        tx.auditLog.deleteMany({ where: { id: auditRecentId } })
      );
      expect(res.count).toBe(0);
      // ...and the row is still present.
      const still = await withRLSContext(null, async (tx) =>
        tx.auditLog.findUnique({ where: { id: auditRecentId } })
      );
      expect(still).not.toBeNull();
    });

    it('admin context CAN delete an audit row past the 7-year window', async () => {
      const res = await withRLSContext(null, async (tx) =>
        tx.auditLog.deleteMany({ where: { id: auditOldId } })
      );
      expect(res.count).toBe(1);
    });
  });

  // L23 — provider_patients consent columns are patient-owned at the DB layer:
  // a BEFORE UPDATE trigger reverts the permission booleans on any non-patient,
  // non-admin write, so a provider session cannot self-grant access even though
  // the UPDATE policy lets it write the row (for the legitimate re-request).
  // L40 — audit_logs_insert no longer accepts a forged user_id from a non-admin
  // user session.
  describe('consent-column immutability (L23) + audit insert check (L40)', () => {
    const providerMut = { id: randomUUID(), email: `rls-prov-mut-${Date.now()}@test.local` };
    let relId = '';

    beforeAll(async () => {
      await withRLSContext(null, async (tx) => {
        await tx.user.create({
          data: { id: providerMut.id, email: providerMut.email, passwordHash: 'test-hash-not-used' },
        });
        const rel = await tx.providerPatient.create({
          data: {
            providerId: providerMut.id,
            patientId: userA.id,
            status: 'ACTIVE',
            canViewBiomarkers: true,
            canViewInsurance: false,
            canViewHealthNeeds: false,
            canEditData: false,
          },
        });
        relId = rel.id;
      });
    });

    afterAll(async () => {
      await withRLSContext(null, async (tx) => {
        await tx.providerPatient.deleteMany({ where: { providerId: providerMut.id } });
        await tx.user.deleteMany({ where: { id: providerMut.id } });
      });
    });

    it('a provider session CANNOT change the consent permission columns (trigger reverts)', async () => {
      // Provider tries to self-escalate to insurance + edit + health-needs access.
      await withRLSContext(providerMut.id, async (tx) => {
        await tx.providerPatient.update({
          where: { id: relId },
          data: { canViewInsurance: true, canEditData: true, canViewHealthNeeds: true },
        });
      });
      const row = await withRLSContext(null, async (tx) =>
        tx.providerPatient.findUnique({ where: { id: relId } })
      );
      // Every consent boolean is unchanged — the provider cannot grant itself access.
      expect(row?.canViewInsurance).toBe(false);
      expect(row?.canEditData).toBe(false);
      expect(row?.canViewHealthNeeds).toBe(false);
    });

    it('a provider session CAN still update its re-request fields (status / notes)', async () => {
      await withRLSContext(providerMut.id, async (tx) => {
        await tx.providerPatient.update({
          where: { id: relId },
          data: { status: 'PENDING', notesEncrypted: 'ct-rerequest' },
        });
      });
      const row = await withRLSContext(null, async (tx) =>
        tx.providerPatient.findUnique({ where: { id: relId } })
      );
      expect(row?.status).toBe('PENDING');
      expect(row?.notesEncrypted).toBe('ct-rerequest');
    });

    it('the PATIENT can change the consent columns (ownership preserved)', async () => {
      await withRLSContext(userA.id, async (tx) => {
        await tx.providerPatient.update({
          where: { id: relId },
          data: { canViewInsurance: true },
        });
      });
      const row = await withRLSContext(null, async (tx) =>
        tx.providerPatient.findUnique({ where: { id: relId } })
      );
      expect(row?.canViewInsurance).toBe(true);
    });

    it('a non-admin user session CANNOT insert an audit row attributed to another user (L40)', async () => {
      await expect(
        withRLSContext(userA.id, async (tx) =>
          tx.auditLog.create({
            data: {
              userId: providerMut.id, // forged — not the session user
              actorType: 'USER',
              action: 'READ',
              resourceType: '__RLS_TEST_AUDIT_FORGE__',
            },
          })
        )
      ).rejects.toThrow();
    });

    it('a user session CAN insert an audit row attributed to itself (L40)', async () => {
      const created = await withRLSContext(userA.id, async (tx) =>
        tx.auditLog.create({
          data: {
            userId: userA.id,
            actorType: 'USER',
            action: 'READ',
            resourceType: '__RLS_TEST_AUDIT_SELF__',
          },
        })
      );
      expect(created.userId).toBe(userA.id);
    });
  });

  describe('sessions row lock (refresh rotation regression)', () => {
    // Regression for the missing sessions UPDATE policy: PostgreSQL applies
    // UPDATE-policy checks to SELECT ... FOR UPDATE, so without
    // sessions_update_own (migration 20260712) the refresh-rotation lock in
    // authService.refreshTokens() saw ZERO rows under FORCE RLS — every prod
    // refresh 401'd and misfired the M-1 reuse detector into a full family
    // revoke. Dev's BYPASSRLS role masked it; this pins it against a real
    // NOBYPASSRLS role.
    it('an admin-context SELECT ... FOR UPDATE can see and lock a session row', async () => {
      const sessionId = randomUUID();
      await withRLSContext(null, async (tx) => {
        await tx.session.create({
          data: {
            id: sessionId,
            userId: userA.id,
            token: `__RLS_TEST_SESSION_${sessionId}__`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
      });

      // The exact lock shape refreshTokens() uses.
      const locked = await withRLSContext(null, async (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE
        `
      );
      expect(locked).toHaveLength(1);

      await withRLSContext(null, async (tx) =>
        tx.session.delete({ where: { id: sessionId } })
      );
    });

    it("a user's own context can also lock its own session row", async () => {
      const sessionId = randomUUID();
      await withRLSContext(null, async (tx) => {
        await tx.session.create({
          data: {
            id: sessionId,
            userId: userA.id,
            token: `__RLS_TEST_SESSION_OWN_${sessionId}__`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
      });

      const locked = await withRLSContext(userA.id, async (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE
        `
      );
      expect(locked).toHaveLength(1);

      await withRLSContext(null, async (tx) =>
        tx.session.delete({ where: { id: sessionId } })
      );
    });
  });
});
