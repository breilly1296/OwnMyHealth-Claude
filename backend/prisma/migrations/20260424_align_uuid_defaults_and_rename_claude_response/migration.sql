-- F-24 + F-27 cleanup: align UUID defaults and the encryption-naming convention.
--
-- ## What changes
--
-- 1. UUID generation (F-24)
--    Four tables (`user_files`, `expense_projections`, `expense_actuals`,
--    `cost_analyses`) used Prisma's `@default(uuid())` which generates the UUID
--    in application code before the INSERT. Every other table in the schema
--    uses Postgres-native `gen_random_uuid()` via `@default(dbgenerated(…))`.
--    The defaults shift to `gen_random_uuid()` so:
--      - Bulk inserts skip the JS UUID round-trip
--      - INSERTs with omitted `id` work the same in raw SQL and through Prisma
--      - There's only one source-of-truth for ID format across the schema
--    Existing rows keep their IDs — only the column DEFAULT changes.
--
-- 2. CostAnalysis.claude_response → claude_response_encrypted (F-27 area)
--    The column stores AES-256-GCM ciphertext (encrypted in
--    `expenseController.analyzeCosts`) but lacked the `_encrypted` suffix
--    every other PHI column uses. The rename is column-only; data is
--    untouched. Logger redaction matches on `*Encrypted` suffix variants
--    (PHI_TAXONOMY) so the rename also closes a latent log-leak risk that
--    sat behind the old column name.
--
-- ## Safety
--
-- All four DEFAULT changes are DDL-only and don't rewrite rows. The column
-- rename is a metadata operation in Postgres (instant, no table rewrite).
-- No application code reads the old column name post-2026-04-24 — Prisma
-- client uses the @map'd name and the Prisma model field has been renamed
-- to `claudeResponseEncrypted`.

-- ============================================
-- 1. UUID default alignment
-- ============================================

ALTER TABLE "user_files"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "expense_projections"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "expense_actuals"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "cost_analyses"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- ============================================
-- 2. CostAnalysis column rename
-- ============================================

ALTER TABLE "cost_analyses"
  RENAME COLUMN "claude_response" TO "claude_response_encrypted";
