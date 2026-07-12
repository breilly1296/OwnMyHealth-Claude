-- L24 / OF-03: drop the legacy plaintext filename column.
--
-- New writes have stored the client filename ONLY as AES-256-GCM ciphertext
-- (original_filename_encrypted) since 20260615_encrypt_userfile_original_filename;
-- the backfill-userfile-filenames maintenance job re-encrypts legacy rows.
--
-- GUARD (self-protecting): refuse to apply while ANY row still holds a
-- plaintext filename without its encrypted twin — dropping the column then
-- would destroy the only copy of that filename. The migrate job runs before
-- the new revision serves, so a mis-sequenced deploy fails the DEPLOY (the
-- running service is untouched) with the instruction below.
DO $$
DECLARE
  unbackfilled bigint;
BEGIN
  SELECT COUNT(*) INTO unbackfilled
  FROM "user_files"
  WHERE "original_filename" IS NOT NULL
    AND "original_filename_encrypted" IS NULL;
  IF unbackfilled > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop user_files.original_filename: % row(s) still hold an un-backfilled plaintext filename. Run the backfill-userfile-filenames maintenance job (dry run, then apply=true) via .github/workflows/maintenance.yml first, then redeploy.',
      unbackfilled;
  END IF;
END $$;

-- Rows where BOTH columns are set (plaintext not yet nulled but ciphertext
-- present) lose only the redundant plaintext copy — the encrypted value
-- remains the source of truth.
ALTER TABLE "user_files" DROP COLUMN "original_filename";
