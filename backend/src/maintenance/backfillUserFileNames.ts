/**
 * One-time backfill: re-encrypt legacy plaintext user_files.original_filename
 * into its encrypted twin (L24).
 *
 * Companion to the L24 change (upload controllers + migration
 * 20260615_encrypt_userfile_original_filename). That change makes NEW uploads
 * store AES-256-GCM ciphertext in `originalFilenameEncrypted` and null the
 * plaintext `originalFilename`. Rows written BEFORE it still hold the raw client
 * filename in plaintext. This re-encrypts each such value (per-user key, via the
 * userEncryption service — which pure SQL migrations can't do) and nulls the
 * plaintext. Run it ONCE, AFTER the L24 code is deployed; a follow-up migration
 * then drops the plaintext column.
 *
 * Mirrors backfillGoalValues: compiled into dist/maintenance by `npm run build`
 * so it runs in the production image with plain `node`, executed against prod as
 * a Cloud Run job by .github/workflows/maintenance.yml (which mounts the same
 * PHI_ENCRYPTION_KEY the service uses). Nothing imports this module.
 *
 * Safe by default: DRY RUN unless `--apply`. Operates per-user inside that user's
 * RLS context (so RLS authorizes the update), encrypting with the user's key.
 * Logs COUNTS only — never a filename (PHI). Idempotent: a row is backfilled only
 * when its plaintext is set AND the encrypted twin is null, so a second run finds
 * nothing.
 *
 * Usage:
 *   Local (from backend/, with backend/.env): npm run backfill:userfile-names -- [--apply] [--user <uuid>]
 *   Prod  (Cloud Run job): node dist/maintenance/backfillUserFileNames.js [--apply] [--user <uuid>]
 */

import {
  initializeDatabase,
  disconnectDatabase,
  withRLSContext,
} from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';

const APPLY = process.argv.includes('--apply');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const onlyUser = argValue('--user');

async function listUserIds(): Promise<string[]> {
  if (onlyUser) return [onlyUser];
  const users = await withRLSContext(null, async (tx) =>
    tx.user.findMany({ select: { id: true } })
  );
  return users.map((u) => u.id);
}

async function main(): Promise<void> {
  await initializeDatabase();

  const userIds = await listUserIds();
  console.log(`[backfill-userfile-names] ${APPLY ? 'APPLY' : 'DRY RUN'} over ${userIds.length} user(s)`);

  let usersAffected = 0;
  let rowsTotal = 0;

  for (const userId of userIds) {
    // Legacy rows: plaintext set, encrypted twin still null.
    const pending = await withRLSContext(userId, async (tx) =>
      tx.userFile.findMany({
        where: { userId, originalFilename: { not: null }, originalFilenameEncrypted: null },
        select: { id: true, originalFilename: true },
      })
    );
    if (pending.length === 0) continue;

    usersAffected++;
    rowsTotal += pending.length;
    console.log(`  user ${userId}: ${pending.length} file row(s) to encrypt`);

    if (APPLY) {
      const salt = await getUserEncryptionSalt(userId);
      const encryption = getEncryptionService();
      await withRLSContext(userId, async (tx) => {
        for (const f of pending) {
          await tx.userFile.update({
            where: { id: f.id },
            data: {
              originalFilenameEncrypted: encryption.encrypt(f.originalFilename!, salt),
              originalFilename: null,
            },
          });
        }
      });
    }
  }

  console.log('');
  console.log(
    `[backfill-userfile-names] ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${usersAffected} user(s), ` +
      `${rowsTotal} file row(s) ${APPLY ? 'encrypted' : 'to encrypt'}.`
  );
  if (!APPLY) console.log('[backfill-userfile-names] Re-run with --apply to perform the migration.');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('[backfill-userfile-names] FAILED:', err instanceof Error ? err.message : err);
  try {
    await disconnectDatabase();
  } catch {
    /* ignore disconnect errors during failure cleanup */
  }
  process.exit(1);
});
