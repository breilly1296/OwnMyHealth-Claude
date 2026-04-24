-- Drop deprecated DNA / genetics feature.
--
-- Context: the DNA upload + variant-browsing feature was scaffolded in the
-- original schema (see 00000000000000_initial_schema) but never reached a
-- shipped state — no frontend, no upload endpoint, no extraction pipeline
-- was ever wired up. CLAUDE.md has listed the models as deprecated since
-- Jan 2026. User confirmed (2026-04-23) the tables are empty in every env,
-- so this migration is safe to apply without backup.
--
-- Tables are dropped with CASCADE to clear the FK from `genetic_traits` and
-- `dna_variants` onto `dna_data`; order still matters for determinism in
-- logs if CASCADE is ever tightened at the PG role level.
--
-- Also drops:
--   - `can_view_dna` column on `provider_patients` — provider-consent flag
--     that no endpoint ever enforced (see F-18 / F-30 in security audit)
--   - RLS policies on the three DNA tables (`rls_dna_*`) — dropped
--     implicitly with the tables, listed here for audit trail
--   - `ProcessingStatus` and `RiskLevel` enums — only referenced by the
--     DNA tables

-- Drop dependent tables first (even with CASCADE, keeps the operation log readable).
DROP TABLE IF EXISTS "genetic_traits" CASCADE;
DROP TABLE IF EXISTS "dna_variants" CASCADE;
DROP TABLE IF EXISTS "dna_data" CASCADE;

-- Provider-consent flag for a resource that no longer exists.
ALTER TABLE "provider_patients" DROP COLUMN IF EXISTS "can_view_dna";

-- Enums only used by the dropped tables.
DROP TYPE IF EXISTS "ProcessingStatus";
DROP TYPE IF EXISTS "RiskLevel";
