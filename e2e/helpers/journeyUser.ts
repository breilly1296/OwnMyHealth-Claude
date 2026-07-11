/**
 * DB seed + forensics helpers for the export/delete journey spec (P0-3).
 *
 * The journey destroys its user, so it must NEVER share the standing
 * `e2e-test@ownmyhealth.io` seed user. The repo root has no dotenv/bcryptjs/
 * prisma deps (ESM resolves node_modules from the script's location, not the
 * cwd), so the actual DB work lives in `backend/scripts/e2e-db.ts`
 * and runs via `npx tsx` with the backend as cwd.
 */

import { execFileSync } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../../backend');
const SCRIPT = path.join('scripts', 'e2e-db.ts');

function runJourneyDb(args: string[]): Record<string, unknown> {
  const stdout = execFileSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf-8',
    shell: process.platform === 'win32', // npx is npx.cmd on Windows
    timeout: 60_000,
  });
  // The script prints its result JSON on the last non-empty stdout line
  // (dotenv/prisma may chat on earlier lines).
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

/** Create a verified PRO journey user; returns its id. Cleans up any leftover. */
export async function seedJourneyUser(email: string, password: string): Promise<string> {
  const result = runJourneyDb(['seed', email, password]);
  return result.userId as string;
}

export interface JourneyForensics {
  userExists: boolean;
  /** user_encryption_keys rows — 0 after deletion means the PHI salt is destroyed. */
  encryptionKeyCount: number;
  biomarkerCount: number;
  /** DELETE-on-User audit rows attributed to this user via resourceId. */
  deletionAuditCount: number;
}

/** Post-journey DB truth for the deleted user. */
export async function fetchJourneyForensics(userId: string): Promise<JourneyForensics> {
  return runJourneyDb(['forensics', userId]) as unknown as JourneyForensics;
}

/** afterAll safety net — remove the journey user if the spec failed mid-way. */
export async function cleanupJourneyUser(email: string): Promise<void> {
  runJourneyDb(['cleanup', email]);
}
