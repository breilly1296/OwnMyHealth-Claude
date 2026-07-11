/**
 * Account-deletion cascade regression test (P0-3 — "salt destroyed" evidence).
 *
 * settingsController.deleteAccount ends in one admin transaction: insert the
 * HIPAA deletion audit row, then `tx.user.delete` and let the schema cascade.
 * The unit tests prove the controller performs that sequence; what they CANNOT
 * prove (mocked tx) is what the cascade actually destroys. This suite runs the
 * same terminal transaction against a live Postgres and pins the DB truth:
 *
 *   1. `user_encryption_keys` rows are cascade-deleted — the per-user PHI salt
 *      is destroyed, so any ciphertext that survived elsewhere (backups, logs)
 *      is undecryptable. This is the crypto guarantee behind account deletion.
 *   2. PHI and auth rows cascade (biomarkers, sessions, revoked tokens).
 *   3. The deletion audit row SURVIVES with user_id SET NULL — the mandated
 *      deletion record outlives the account, attribution kept in resourceId.
 *   4. #19 ordering is load-bearing: inserting the audit row AFTER
 *      tx.user.delete violates the FK (23503) and rolls the whole tx back.
 *   5. Another tenant's rows are untouched.
 *
 * Same live-DB gate as rls.test.ts: runs in CI's RLS job (real Postgres 16,
 * NOBYPASSRLS role) and skips in unit-only runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  disconnectDatabase,
  getPrismaClient,
  withRLSContext,
} from './database.js';

const hasLiveDb = Boolean(process.env.DATABASE_URL) && Boolean(process.env.PHI_ENCRYPTION_KEY);

describe.skipIf(!hasLiveDb)('account deletion cascade (P0-3)', () => {
  const victim = { id: randomUUID(), email: `del-victim-${Date.now()}@test.local` };
  const victim2 = { id: randomUUID(), email: `del-victim2-${Date.now()}@test.local` };
  const survivor = { id: randomUUID(), email: `del-survivor-${Date.now()}@test.local` };
  const deletionAuditId = randomUUID();
  const MARKER = '__DEL_CASCADE_TEST__';

  /** Seed one user with a salt row + PHI + auth artifacts. */
  async function seedUser(tx: Parameters<Parameters<typeof withRLSContext>[1]>[0], user: { id: string; email: string }) {
    await tx.user.create({
      data: { id: user.id, email: user.email, passwordHash: 'test-hash-not-used' },
    });
    // The per-user PHI salt — the row whose destruction P0-3 requires.
    await tx.userEncryptionKey.create({
      data: {
        userId: user.id,
        keyType: 'phi_encryption',
        keyHash: 'a'.repeat(64),
        encryptedKey: 'test-encrypted-salt-not-used',
        version: 1,
        isActive: true,
      },
    });
    await tx.biomarker.create({
      data: {
        userId: user.id,
        category: 'test',
        name: MARKER,
        unit: 'test',
        valueEncrypted: 'ct-not-used',
        normalRangeMin: 0,
        normalRangeMax: 1,
        measurementDate: new Date(),
      },
    });
    await tx.session.create({
      data: {
        userId: user.id,
        token: `del-cascade-${user.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await tx.revokedAccessToken.create({
      data: { jti: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
  }

  beforeAll(async () => {
    getPrismaClient();
    await withRLSContext(null, async (tx) => {
      await seedUser(tx, victim);
      await seedUser(tx, victim2);
      await seedUser(tx, survivor);
    });
  });

  afterAll(async () => {
    await withRLSContext(null, async (tx) => {
      // Users cascade their own artifacts; audit rows are cleaned by id/marker.
      await tx.auditLog.deleteMany({
        where: { id: { in: [deletionAuditId] } },
      }).catch(() => undefined);
      await tx.user.deleteMany({
        where: { id: { in: [victim.id, victim2.id, survivor.id] } },
      });
    });
    await disconnectDatabase();
  });

  it('destroys the encryption salt, PHI, and auth rows; the deletion audit row survives with user_id NULL', async () => {
    // The exact terminal transaction deleteAccount runs (#19 ordering:
    // audit insert BEFORE user.delete, same tx).
    await withRLSContext(null, async (tx) => {
      await tx.auditLog.create({
        data: {
          id: deletionAuditId,
          userId: victim.id,
          actorType: 'USER',
          action: 'DELETE',
          resourceType: 'User',
          resourceId: victim.id,
        },
      });
      await tx.user.delete({ where: { id: victim.id } });
    });

    await withRLSContext(null, async (tx) => {
      // 1. Salt destroyed — the P0-3 crypto guarantee.
      expect(await tx.userEncryptionKey.count({ where: { userId: victim.id } })).toBe(0);
      // 2. PHI + auth artifacts cascaded.
      expect(await tx.biomarker.count({ where: { userId: victim.id } })).toBe(0);
      expect(await tx.session.count({ where: { userId: victim.id } })).toBe(0);
      expect(await tx.revokedAccessToken.count({ where: { userId: victim.id } })).toBe(0);
      // 3. The deletion record outlives the account: user_id SET NULL,
      //    attribution preserved in resourceId.
      const auditRow = await tx.auditLog.findUnique({ where: { id: deletionAuditId } });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.userId).toBeNull();
      expect(auditRow!.resourceId).toBe(victim.id);
      // 5. The other tenant is untouched.
      expect(await tx.userEncryptionKey.count({ where: { userId: survivor.id } })).toBe(1);
      expect(await tx.biomarker.count({ where: { userId: survivor.id } })).toBe(1);
    });
  });

  it('#19 ordering is load-bearing: audit insert AFTER user.delete violates the FK and rolls back', async () => {
    await expect(
      withRLSContext(null, async (tx) => {
        await tx.user.delete({ where: { id: victim2.id } });
        // audit_logs.user_id → users(id): the row is gone, so this insert
        // raises 23503 — exactly why deleteAccount inserts first.
        await tx.auditLog.create({
          data: {
            userId: victim2.id,
            actorType: 'USER',
            action: 'DELETE',
            resourceType: 'User',
            resourceId: victim2.id,
          },
        });
      })
    ).rejects.toThrow();

    // The whole tx rolled back: victim2 (and their salt) still exist —
    // a failed audit write must never leave a half-deleted account.
    await withRLSContext(null, async (tx) => {
      expect(await tx.user.count({ where: { id: victim2.id } })).toBe(1);
      expect(await tx.userEncryptionKey.count({ where: { userId: victim2.id } })).toBe(1);
    });
  });
});
