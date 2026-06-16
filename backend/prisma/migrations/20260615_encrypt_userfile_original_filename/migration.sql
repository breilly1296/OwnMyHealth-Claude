-- L24 — encrypt the raw client filename at rest.
--
-- user_files.original_filename stored the RAW uploaded filename, which can embed
-- PHI (e.g. "Jane Doe MRI.pdf"). New rows now store AES-256-GCM ciphertext
-- (per-user key) in original_filename_encrypted and null the plaintext column;
-- reads decrypt the twin and fall back to the plaintext only for legacy rows
-- not yet re-encrypted by the backfill job.
--
-- The plaintext column is made nullable (so new writes can null it) and is
-- retained for the backfill transition; a follow-up migration drops it once the
-- backfill (maintenance Cloud Run job: backfill-userfile-filenames) has run.
ALTER TABLE "user_files" ADD COLUMN "original_filename_encrypted" TEXT;
ALTER TABLE "user_files" ALTER COLUMN "original_filename" DROP NOT NULL;
