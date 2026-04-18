-- Add health_profile_encrypted column to users table.
-- Stores a JSON-serialized UserHealthProfile (conditions, medications,
-- demographics, lifestyle, additional context) encrypted with the user's
-- per-user salt via the existing PHI encryption service. PHI — column
-- holds ciphertext, never plaintext.

ALTER TABLE "users"
  ADD COLUMN "health_profile_encrypted" TEXT;
