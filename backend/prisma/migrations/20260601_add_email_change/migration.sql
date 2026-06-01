-- Add email-change fields to support the verified email-change flow.
-- Mirrors the existing email_verification_token / password_reset_token pattern:
-- pending_email holds the requested address until the user confirms it via a
-- tokenized link; email_change_token stores the SHA-256 hash of that link token
-- (never the plaintext), and email_change_expires bounds its validity.

ALTER TABLE "users"
  ADD COLUMN "pending_email" VARCHAR(255),
  ADD COLUMN "email_change_token" VARCHAR(255),
  ADD COLUMN "email_change_expires" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "users_email_change_token_key" ON "users"("email_change_token");
