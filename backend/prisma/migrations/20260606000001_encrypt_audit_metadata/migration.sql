-- Field-level encryption for audit-log metadata.
--
-- previous_value / new_value snapshots are already encrypted, but metadata was
-- stored as plaintext JSON. Metadata can carry PHI (e.g. uploaded filenames like
-- "Jane Doe MRI.pdf" logged on file download/export), so it must meet the same
-- AES-256-GCM field-level standard. New rows write metadata_encrypted; the
-- legacy "metadata" column is retained read-only for pre-existing rows.
ALTER TABLE "audit_logs" ADD COLUMN "metadata_encrypted" TEXT;
