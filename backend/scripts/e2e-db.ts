/**
 * DB operations for the export/delete journey spec (P0-3).
 *
 * Lives under backend/ (NOT e2e/) so ESM resolution finds backend's
 * node_modules — dotenv/bcryptjs/the generated Prisma client are backend
 * deps and unresolvable from the repo root. Run from the backend dir:
 *
 *   npx tsx scripts/e2e-db.ts <command> <args...>
 *
 * Every command runs inside an ADMIN RLS transaction (`app.is_admin = true`,
 * mirroring services/database.ts applyRLSContext) — in CI the script connects
 * as the NOBYPASSRLS role with FORCE RLS, so a bare client would violate the
 * users-table policy on insert. (A dev DB whose role has BYPASSRLS masks this.)
 *
 * Commands (result JSON printed on the last stdout line):
 *   seed <email> <password>          → {"userId": "..."}  (verified PRO user; removes leftovers)
 *   seed-standing <email> <password> → {"userId": "..."}  (upsert-refresh — flags reset,
 *                                       existing data KEPT; for the shared spec user)
 *   forensics <userId>               → {"userExists":bool,"encryptionKeyCount":n,
 *                                       "biomarkerCount":n,"deletionAuditCount":n}
 *   cleanup <email>                  → {"deleted": n}
 *
 * Replaces the old `e2e/setup/seed-test-user.ts`, which broke on the Prisma 7
 * upgrade (`new PrismaClient()` without a driver adapter) and could not
 * resolve backend deps from e2e/ under ESM.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, type Prisma } from '../generated/prisma/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const NEW_USER_DATA = (email: string, passwordHash: string) => ({
  email,
  passwordHash,
  role: 'PATIENT',
  isActive: true,
  emailVerified: true,
  plan: 'PRO',
  planUpdatedAt: new Date(),
  onboardingCompletedAt: new Date(),
  termsAcceptedAt: new Date(),
  termsVersion: 'e2e',
});

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Ensure backend/.env exists.');
  }
  const [command, ...args] = process.argv.slice(2);
  // Prisma 7 requires a driver adapter (same construction as services/database.ts).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  /** Admin-context transaction — SET LOCAL app.is_admin so FORCE RLS admits us. */
  const withAdmin = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${''}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_admin', ${'true'}, true)`;
      return fn(tx);
    });

  try {
    if (command === 'seed') {
      const [email, password] = args;
      if (!email || !password) throw new Error('usage: seed <email> <password>');
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await withAdmin(async (tx) => {
        await tx.user.deleteMany({ where: { email } }); // leftover from a failed run
        return tx.user.create({ data: NEW_USER_DATA(email, passwordHash) });
      });
      console.log(JSON.stringify({ userId: user.id }));
      return;
    }

    if (command === 'seed-standing') {
      const [email, password] = args;
      if (!email || !password) throw new Error('usage: seed-standing <email> <password>');
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await withAdmin(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          // Refresh flags only — keep accumulated data so specs stay realistic.
          await tx.user.update({
            where: { email },
            data: {
              plan: 'PRO',
              planExpiresAt: null,
              planUpdatedAt: new Date(),
              emailVerified: true,
              isActive: true,
              lockedUntil: null,
              failedLoginAttempts: 0,
              onboardingCompletedAt: new Date(),
            },
          });
          return existing;
        }
        return tx.user.create({ data: NEW_USER_DATA(email, passwordHash) });
      });
      console.log(JSON.stringify({ userId: user.id }));
      return;
    }

    if (command === 'forensics') {
      const [userId] = args;
      if (!userId) throw new Error('usage: forensics <userId>');
      const result = await withAdmin(async (tx) => {
        const [user, encryptionKeyCount, biomarkerCount, deletionAuditCount] = await Promise.all([
          tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
          tx.userEncryptionKey.count({ where: { userId } }),
          tx.biomarker.count({ where: { userId } }),
          tx.auditLog.count({
            where: { resourceType: 'User', action: 'DELETE', resourceId: userId },
          }),
        ]);
        return {
          userExists: Boolean(user),
          encryptionKeyCount,
          biomarkerCount,
          deletionAuditCount,
        };
      });
      console.log(JSON.stringify(result));
      return;
    }

    if (command === 'cleanup') {
      const [email] = args;
      if (!email) throw new Error('usage: cleanup <email>');
      const result = await withAdmin((tx) => tx.user.deleteMany({ where: { email } }));
      console.log(JSON.stringify({ deleted: result.count }));
      return;
    }

    throw new Error(`unknown command: ${command ?? '(none)'}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[e2e-db] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
