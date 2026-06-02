---
tags:
  - documentation
  - phi
  - hipaa
  - reference
type: prompt
priority: 2
updated: 2026-06-01
---

# Generate PHI_TAXONOMY.md

## Required reading before generating

Before writing a single line, read:

1. [`_doc-quality.md`](./_doc-quality.md) — self-containedness, citation, TBD, cross-link, and format rules.
2. [`_verification-tools.md`](./_verification-tools.md) — Grep/Glob/Read cheat sheet.
3. [`_phi-inventory.md`](./_phi-inventory.md) — **baseline** canonical PHI list; this doc is its richer standalone expansion.

This doc must pass the five tests in `_doc-quality.md` before you stop.

---

## Purpose

Produce `New Project Documents/PHI_TAXONOMY.md` — the **authoritative, citation-dense reference for every PHI field**. Unlike `_phi-inventory.md` (which stays lightweight for security-prompt inheritance), this doc is optimized for Claude Project retrieval: *where is each PHI field written, read, audited, and redacted?*

Distinction from `_phi-inventory.md`:

| `_phi-inventory.md` | `PHI_TAXONOMY.md` |
|---|---|
| Short reference, read-once | Full standalone doc, Claude-Project attached |
| Lists field names | Lists field × every site that touches it |
| Updated when schema changes | Regenerated per release |

Both stay in sync: the inventory is the seed; the taxonomy is the verified expansion.

---

## Files to review

| File | Why read it |
|---|---|
| `backend/src/services/encryption.ts` | **Source of truth** — `PHI_FIELDS` constant (~L410). Any encrypted column must appear here. Currently 13 models; `LabConnection` (OAuth tokens) is the newest entry. |
| `backend/src/services/userEncryption.ts` | Per-user salt lookup (`getUserEncryptionSalt`, `UserEncryptionKey` table); how `encrypt*` / `decrypt*` derive the per-user key from the master key. |
| `backend/prisma/schema.prisma` | Every `*Encrypted` column; diff against `PHI_FIELDS`. 18 models total; `DNAVariant`/`GeneticTrait` are **gone** (migration `20260423_drop_dna_genetics`). |
| `backend/src/utils/logger.ts` | `SENSITIVE_FIELDS` (set, ~L21) / recursive sanitizer. Any PHI name not in the redaction map is a leak vector. Note: the set still lists `genotype` (DNA, removed model) and `claudeResponse` (renamed to `claudeResponseEncrypted`) — flag both as drift. |
| `backend/src/utils/phiRedaction.ts` | PHI redaction helper used in log/free-text paths — cross-reference for free-text leak coverage. |
| `backend/src/services/auditLog.ts` | Fields logged on PHI access; retention; scheduler. |
| `backend/src/controllers/*.ts`, `backend/src/services/*.ts` | **All** encrypt/decrypt call sites. Grep for each field name. New PHI surfaces live in `aiChatController.ts`, `fhirController.ts`, and `services/fhir/labSyncService.ts` / `services/healthProfileService.ts`. |
| `_phi-inventory.md` | Seed list — every field in the inventory must appear in the taxonomy (or appear in a "promoted out" change log). |

---

## Required sections

1. **Purpose and scope** — one paragraph; distinguish from `_phi-inventory.md`.
2. **Canonical model × field list** — master table (see Required artifacts).
3. **Per-field deep dives** — one H3 per field, grouped by model. Each entry: write site(s), read site(s), audit coverage, logger-redaction status, cross-user exposure risk.
4. **Logger redaction coverage** — diff between `PHI_FIELDS` and `logger.ts` `SENSITIVE_FIELDS`. Any field in the former not in the latter = leak risk.
5. **Audit log coverage** — per field: is read audited? is write audited? file:line of the `AuditLogService` helper call sites (`auditService.logAccess/logCreate/logUpdate/logDelete/logExport(...)` from `getAuditLogService`), not a bare `auditLog.log(...)`.
6. **Encryption key lifecycle** — user-level key derivation (`userEncryption.ts`), wrap key storage (`UserEncryptionKey` model), rotation policy (or `TBD (external: ...)` with resolution path).
7. **Cross-user exposure matrix** — for each PHI field, can another user (including PROVIDER via consent) read it? If yes, via what route, filtered by what permission flag?
8. **Drift findings** — any field present in schema but absent from `PHI_FIELDS`; any PHI field absent from logger redaction; any field audited on write but not on read.
9. **Related Documents** — cross-links.
10. **Prompt drift log** — if this prompt's file list or field list is stale.

---

## Required artifacts

### Master PHI table (columns, in this exact order)

| Column | Source |
|---|---|
| **Model** | From `schema.prisma`. |
| **Field** | `*Encrypted` column name. |
| **Column (DB)** | `@map(...)` value. |
| **In `PHI_FIELDS`?** | `encryption.ts`. |
| **Write sites** | `file:line` list — grep `encrypt*` callers + direct assignment to `fieldEncrypted`. |
| **Read sites** | `file:line` list — grep `decrypt*` callers + `select: { fieldEncrypted }` followed by decode. |
| **Audited on write?** | `file:line` of the matching audit call. Call sites use the `AuditLogService` helpers (`auditService.logCreate/logUpdate/logDelete(...)`), obtained via `getAuditLogService(prisma)` — **not** a bare `auditLog.log(...)`. |
| **Audited on read?** | `file:line` of the matching `auditService.logAccess(...)` in the read path. |
| **Redacted in logger?** | `yes/no` — `SENSITIVE_FIELDS` in `logger.ts`. |
| **Provider-accessible?** | `yes/no + permission flag` — `ProviderPatient` permission (e.g., `canViewBiomarkers`). |
| **Notes** | Edge cases, deprecations, known drift. |

Cover every model with PHI per `PHI_FIELDS` (13 models, verified in `encryption.ts`):
- `User` — `firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`, `healthProfileEncrypted` (NEW — onboarding/health-profile JSON blob, migration `20260418_add_health_profile`)
- `Biomarker` (`valueEncrypted`, `notesEncrypted`), `BiomarkerHistory` (`valueEncrypted` only — no notes column)
- `InsurancePlan` (`memberIdEncrypted`, `groupIdEncrypted`). Note: `InsuranceBenefit` is in the schema but holds **no** `*Encrypted` columns — confirm and record that, not member/group IDs.
- `HealthGoal` (`descriptionEncrypted`, `targetValueEncrypted` — NEW, migration `20260420_encrypt_health_goal_target`), `GoalProgressHistory` (`noteEncrypted`)
- `HealthNeed` (`descriptionEncrypted`)
- `ProviderPatient` (`notesEncrypted` — relationship notes)
- `ExpenseProjection` (`serviceTypeEncrypted`, `estimatedCostEncrypted`, `notesEncrypted`), `ExpenseActual` (8 fields incl. provider name + all monetary), `CostAnalysis` (`claudeResponseEncrypted`, `totalProjectedOopEncrypted`, `projectedExpensesSnapshotEncrypted`)
- `AuditLog` (`previousValueEncrypted`, `newValueEncrypted`)
- `LabConnection` (NEW — `accessTokenEncrypted`, `refreshTokenEncrypted`; SMART-on-FHIR OAuth tokens for Quest lab sync, migration `20260418_add_lab_connections`). A stolen token is a direct path to live PHI at the lab — treat as top-tier.
- Removed (do NOT list as deprecated — the models no longer exist): `DNAVariant`, `GeneticTrait`, dropped in migration `20260423_drop_dna_genetics`. If the seed inventory still names them, record as a "removed since seed" change-log entry.

### Per-field deep dive template

```markdown
#### `Biomarker.valueEncrypted`

- **Column**: `value_encrypted` — `backend/prisma/schema.prisma:Lxx`
- **Encryption site**: `biomarkerController.createBiomarker` — `backend/src/controllers/biomarkerController.ts:Lxx-Lyy`. The real API is `getEncryptionService().encrypt(plaintext, userSalt)` where `userSalt` comes from `getUserEncryptionSalt(userId)` (`userEncryption.ts`) — there is **no** `encryptPHI(userId, plaintext)` helper, so do not cite one.
- **Decryption site(s)**:
  - `biomarkerController.listBiomarkers` — `...:Lxx`
  - `biomarkerController.getBiomarker` — `...:Lyy`
  - `providerController.getPatientBiomarkers` — `...:Lzz` (provider path, gated by `canViewBiomarkers`)
- **Audit**: write — `auditService.logCreate('BIOMARKER', ...)` at `...:Lxx`; read — `auditService.logAccess('BIOMARKER', ...)` at `...:Lyy`. (Audit calls go through the `AuditLogService` helpers — `logCreate`/`logUpdate`/`logDelete`/`logAccess`/`logExport` — from `getAuditLogService(prisma)`, never a bare `auditLog.log(...)`. Cross-check `AuditAction` enum values in `schema.prisma`.)
- **Logger redaction**: `valueEncrypted` entry in `SENSITIVE_FIELDS` — `backend/src/utils/logger.ts:Lxx` (the set lowercases keys before matching).
- **Provider exposure**: yes, via `ProviderPatient.canViewBiomarkers = true` (default `true`).
- **Snippet**:
  ```ts
  // Source: backend/src/controllers/biomarkerController.ts:Lxx-Lyy
  const userSalt = await getUserEncryptionSalt(req.user.id);
  const valueEncrypted = getEncryptionService().encrypt(String(value), userSalt);
  ```
```

### Drift tables

**Logger redaction gaps**:

| PHI field | In `PHI_FIELDS`? | In `SENSITIVE_FIELDS`? | Risk |
|---|---|---|---|
| `Biomarker.value` | yes | yes | — |
| `ExpenseActual.providerName` | yes | **no** | Could leak into logs — patch `logger.ts` |

**Audit coverage gaps**:

| PHI field | Audited on write? | Audited on read? | Notes |
|---|---|---|---|
| `HealthNeed.description` | yes | no | Read path should add `HEALTH_NEED_READ` event |

**Schema vs `PHI_FIELDS` drift**:

| Column | In schema? | In `PHI_FIELDS`? | Action |
|---|---|---|---|
| `User.ssnEncrypted` | yes | no | Add to `PHI_FIELDS` or remove column |

---

## Acceptance questions

After writing the doc, self-answer each **using only the doc**:

1. How many PHI fields are defined in `PHI_FIELDS` (count across all 13 models), and do all map to `*Encrypted` columns in the schema?
2. Where is `Biomarker.valueEncrypted` decrypted, and how many call sites?
3. Is `ExpenseActual.providerNameEncrypted` covered by logger redaction?
4. Which PHI fields can a PROVIDER read, and via which consent permission flag (`canViewBiomarkers` / `canViewInsurance` / `canViewHealthNeeds` / `canEditData`)?
5. How is the per-user encryption key derived (per-user salt from `getUserEncryptionSalt` + master key), and where is the salt stored (`UserEncryptionKey`)?
6. Does every PHI write have a matching audit call (an `AuditLogService` helper — `auditService.logCreate/logUpdate/logDelete(...)`), and what's the drift if not?
7. `LabConnection.accessTokenEncrypted` / `refreshTokenEncrypted` are SMART-on-FHIR OAuth tokens — where are they written/read (`services/fhir/`), and is access user-scoped only (never provider-shared)?
8. Which audit log fields themselves hold encrypted PHI (`previousValueEncrypted` / `newValueEncrypted`)?
9. What's the rotation policy for `PHI_ENCRYPTION_KEY`, and where is that recorded?
10. Is there a redaction gap in `logger.ts` for any PHI field? (Confirm whether stale entries `genotype` (removed DNA model) and `claudeResponse` (renamed to `claudeResponseEncrypted`) should be cleaned up, and whether `claudeResponseEncrypted` / `accessTokenEncrypted` / `healthProfileEncrypted` are actually covered.)
11. How is `ProviderPatient.notesEncrypted` accessed — patient-only, provider-only, or both?
12. What happens to PHI on user deletion — cascade or soft delete, and where is the purge logged?
13. Which controllers decrypt PHI for non-owner access, and what permission check gates each?
14. Is `HealthNeed.descriptionEncrypted` encrypted, and is `User.healthProfileEncrypted` (the onboarding profile blob) covered everywhere it is read/written?

---

## No-TBD enforcement

Before marking anything TBD:

- **For write sites**: `Grep pattern: "\\.encrypt\\(|getEncryptionService"` over `backend/src/**`; filter by encrypted field name. (The encryption API is `getEncryptionService().encrypt(plaintext, salt)`, not a top-level `encryptPHI`.)
- **For read sites**: `Grep pattern: "\\.decrypt\\("` over `backend/src/**`.
- **For audit coverage**: `Grep pattern: "\\.log(Access|Create|Update|Delete|Export|Auth|System)\\("` over `backend/src/**`; cross-reference with the controllers that touch each field. (These `AuditLogService` helpers are the real call sites; a bare `auditLog.log(` matches nothing outside `auditLog.ts` itself.)
- **For logger redaction**: read `backend/src/utils/logger.ts` and grep `SENSITIVE_FIELDS`; also check `backend/src/utils/phiRedaction.ts` for free-text redaction.
- **For provider consent gating**: `Grep pattern: "canViewBiomarkers|canViewInsurance|canViewHealthNeeds|canEditData"` over `backend/src/**` (these are the four real flags on `ProviderPatient`).
- **For schema**: `Grep pattern: "Encrypted[\\s]+String"` over `backend/prisma/schema.prisma`.
- **For key rotation**: check `RUNBOOK.md`, `SECURITY_STATUS.md`, `CLAUDE.md`, session summaries. Only mark TBD if absent everywhere:

```
TBD (external: PHI_ENCRYPTION_KEY rotation cadence not documented in repo — define in RUNBOOK and cross-link here)
```

---

## Cross-links

The generated `PHI_TAXONOMY.md` must link to:

- [`DATA_MODEL.md`](./DATA_MODEL.md) — full schema and RLS context.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — encryption layer and audit flow.
- [`API_REFERENCE.md`](./API_REFERENCE.md) — endpoints that expose decrypted PHI.
- [`HIPAA_CHECKLIST.md`](./HIPAA_CHECKLIST.md) — technical safeguards citing this doc.
- [`ENV_VARS.md`](./ENV_VARS.md) — `PHI_ENCRYPTION_KEY`.
- `_phi-inventory.md` (seed list).
- [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) — open PHI-related findings.

---

## Verification (tool usage)

| Task | Tool | How |
|---|---|---|
| Read PHI_FIELDS | Read | `backend/src/services/encryption.ts` |
| Find encrypted columns | Grep | `pattern: "Encrypted[\\s]+String"` over `backend/prisma/schema.prisma` |
| Find encrypt call sites | Grep | `pattern: "\\.encrypt\\(|getEncryptionService"` over `backend/src/**` |
| Find decrypt call sites | Grep | `pattern: "\\.decrypt\\("` over `backend/src/**` |
| Find audit log calls | Grep | `pattern: "\\.log(Access|Create|Update|Delete|Export|Auth|System)\\("` over `backend/src/**` (the `AuditLogService` helpers from `getAuditLogService`) |
| Read logger redaction map | Read | `backend/src/utils/logger.ts` + `backend/src/utils/phiRedaction.ts` |
| Find consent flags | Grep | `pattern: "canViewBiomarkers|canViewInsurance|canViewHealthNeeds|canEditData"` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/PHI_TAXONOMY.md`.
