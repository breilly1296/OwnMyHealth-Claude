/**
 * Seed the E2E test user. Idempotent — runs before `playwright test` (see
 * `test:e2e` script in package.json). Uses the backend's generated Prisma
 * client and reads `DATABASE_URL` from `backend/.env` via dotenv.
 *
 * The seeded user is given:
 *   - `emailVerified: true` — skips the email-gate that blocks login.
 *   - `plan: 'PRO'`          — unlimited rate-limits + feature flags so plan
 *                              gating doesn't interfere with flow tests.
 *   - `onboardingCompletedAt: now` — skips the wizard so tests land on the
 *                              real dashboard.
 *
 * Run manually:
 *   npx tsx e2e/setup/seed-test-user.ts
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
// @ts-expect-error — generated Prisma client lives in backend/generated; no types for relative-from-e2e path
import { PrismaClient } from '../../backend/generated/prisma/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend/.env so DATABASE_URL is available when running from the repo root.
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const EMAIL = 'e2e-test@ownmyhealth.io';
const PASSWORD = 'E2ETestPass123!';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Ensure backend/.env exists and contains a valid DATABASE_URL.'
    );
  }

  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (existing) {
      // Refresh the plan / onboarding / verification flags so a pre-existing
      // row from an older test run doesn't silently fail the specs.
      await prisma.user.update({
        where: { email: EMAIL },
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
      console.log(`[seed] Refreshed existing E2E user: ${EMAIL}`);
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash,
        role: 'PATIENT',
        isActive: true,
        emailVerified: true,
        plan: 'PRO',
        planUpdatedAt: new Date(),
        onboardingCompletedAt: new Date(),
      },
    });
    console.log(`[seed] Created E2E user: ${EMAIL}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
