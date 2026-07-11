-- OMH-L04: consent record at registration (Terms of Service + Privacy Policy).
--
-- The registration flow presented an agreement notice but recorded no proof of
-- consent to the stated data practices / AI processing of health data — a gap
-- under the FTC Health Breach Notification Rule for a consumer health app. These
-- columns capture, per user, WHEN they accepted and WHICH policy version, stamped
-- on successful registration (createUser).
--
-- These are a timestamp + a short version string, NOT PHI: not encrypted, not
-- added to PHI_FIELDS. Nullable with no default → pre-existing users (registered
-- before this column) carry NULL; every new registration stamps both.
--
-- No new RLS policy needed: these live on the users table, which already carries
-- is_admin_session()/owner RLS policies under FORCE RLS, and createUser writes them
-- in the admin/system RLS context.

ALTER TABLE "users"
  ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "terms_version" VARCHAR(20);
