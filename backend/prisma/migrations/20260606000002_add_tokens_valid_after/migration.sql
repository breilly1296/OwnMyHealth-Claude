-- M-4: per-user cross-instance access-token cutoff.
--
-- The in-memory access-token blacklist only stops a token on the instance that
-- handled the revocation. tokens_valid_after is a shared, DB-backed cutoff:
-- authenticate() rejects any access JWT whose iat predates it, on every replica.
-- Stamped on logout-all / password change+reset / email change / admin
-- deactivation+role change. NULL means "no cutoff" (the common case).
ALTER TABLE "users" ADD COLUMN "tokens_valid_after" TIMESTAMPTZ(6);
