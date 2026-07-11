/**
 * DB operations for the export/delete journey spec (P0-3).
 *
 * Lives under backend/ (NOT e2e/) so ESM resolution finds backend's
 * node_modules — dotenv/bcryptjs/the generated Prisma client are backend
 * deps and unresolvable from the repo root. Run from the backend dir:
 *
 *   npx tsx scripts/e2e-db.ts <command> <args...>
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
import { PrismaClient } from '../generated/prisma/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Ensure backend/.env exists.');
  }
  const [command, ...args] = process.argv.slice(2);
  // Prisma 7 requires a driver adapter (same construction as services/database.ts).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    if (command === 'seed') {
      const [email, password] = args;
      if (!email || !password) throw new Error('usage: seed <email> <password>');
      await prisma.user.deleteMany({ where: { email } }); // leftover from a failed run
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
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
        },
      });
      console.log(JSON.stringify({ userId: user.id }));
      return;
    }

    if (command === 'seed-standing') {
      const [email, password] = args;
      if (!email || !password) throw new Error('usage: seed-standing <email> <password>');
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        // Refresh flags only — keep accumulated data so specs stay realistic.
        await prisma.user.update({
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
        console.log(JSON.stringify({ userId: existing.id }));
        return;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
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
        },
      });
      console.log(JSON.stringify({ userId: user.id }));
      return;
    }

    if (command === 'forensics') {
      const [userId] = args;
      if (!userId) throw new Error('usage: forensics <userId>');
      const [user, encryptionKeyCount, biomarkerCount, deletionAuditCount] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
        prisma.userEncryptionKey.count({ where: { userId } }),
        prisma.biomarker.count({ where: { userId } }),
        prisma.auditLog.count({
          where: { resourceType: 'User', action: 'DELETE', resourceId: userId },
        }),
      ]);
      console.log(
        JSON.stringify({
          userExists: Boolean(user),
          encryptionKeyCount,
          biomarkerCount,
          deletionAuditCount,
        })
      );
      return;
    }

    if (command === 'cleanup') {
      const [email] = args;
      if (!email) throw new Error('usage: cleanup <email>');
      const result = await prisma.user.deleteMany({ where: { email } });
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
