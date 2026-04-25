---
tags:
  - documentation
  - phi
  - hipaa
  - reference
type: prompt
priority: 2
updated: 2026-04-24
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
| `backend/src/services/encryption.ts` | **Source of truth** — `PHI_FIELDS` constant. Any encrypted column must appear here. |
| `backend/src/services/userEncryption.ts` | Per-user key derivation; how `encrypt*` / `decrypt*` functions consume it. |
| `backend/prisma/schema.prisma` | Every `*Encrypted` column; diff against `PHI_FIELDS`. |
| `backend/src/utils/logger.ts` | `SENSITIVE_FIELDS` / `stripPHIFromText()` / redaction map. Any PHI name not in the redaction map is a leak vector. |
| `backend/src/services/auditLog.ts` | Fields logged on PHI access; retention; scheduler. |
| `backend/src/controllers/*.ts`, `backend/src/services/*.ts` | **All** encrypt/decrypt call sites. Grep for each field name. |
| `_phi-inventory.md` | Seed list — every field in the inventory must appear in the taxonomy (or appear in a "promoted out" change log). |

---

## Required sections

1. **Purpose and scope** — one paragraph; distinguish from `_phi-inventory.md`.
2. **Canonical model × field list** — master table (see Required artifacts).
3. **Per-field deep dives** — one H3 per field, grouped by model. Each entry: write site(s), read site(s), audit coverage, logger-redaction status, cross-user exposure risk.
4. **Logger redaction coverage** — diff between `PHI_FIELDS` and `logger.ts` `SENSITIVE_FIELDS`. Any field in the former not in the latter = leak risk.
5. **Audit log coverage** — per field: is read audited? is write audited? file:line of `auditLog.log(...)` call sites.
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
| **Audited on write?** | `file:line` of matching `auditLog.log({...})`. |
| **Audited on read?** | `file:line` of matching `auditLog.log({...})` in the read path. |
| **Redacted in logger?** | `yes/no` — `SENSITIVE_FIELDS` in `logger.ts`. |
| **Provider-accessible?** | `yes/no + permission flag` — `ProviderPatient` permission (e.g., `canViewBiomarkers`). |
| **Notes** | Edge cases, deprecations, known drift. |

Cover every model with PHI per `_phi-inventory.md` at minimum:
- `User` (name, DOB, phone, address)
- `Biomarker`, `BiomarkerHistory` (value, unit, notes)
- `InsurancePlan`, `InsuranceBenefit` (member ID, group ID, plan name, provider name, benefits)
- `HealthGoal`, `GoalProgressHistory` (descriptions, notes, targets)
- `HealthNeed` (description)
- `ProviderPatient` (relationship notes)
- `ExpenseProjection`, `ExpenseActual`, `CostAnalysis` (all monetary + descriptions + provider names)
- `AuditLog` (previousValuesEncrypted, newValuesEncrypted)
- Deprecated: `DNAData`, `DNAVariant`, `GeneticTrait` — include but mark deprecated.

### Per-field deep dive template

```markdown
#### `Biomarker.valueEncrypted`

- **Column**: `value_encrypted` — `backend/prisma/schema.prisma:Lxx`
- **Encryption site**: `biomarkerController.createBiomarker` — `backend/src/controllers/biomarkerController.ts:Lxx-Lyy` (calls `encryptPHI(userId, plaintext)`).
- **Decryption site(s)**:
  - `biomarkerController.listBiomarkers` — `...:Lxx`
  - `biomarkerController.getBiomarker` — `...:Lyy`
  - `providerController.getPatientBiomarkers` — `...:Lzz` (provider path, gated by `canViewBiomarkers`)
- **Audit**: write — `auditLog.log({ action: 'BIOMARKER_CREATE', ... })` at `...:Lxx`; read — `BIOMARKER_LIST` at `...:Lyy`.
- **Logger redaction**: `value` / `valueEncrypted` entries in `SENSITIVE_FIELDS` — `backend/src/utils/logger.ts:Lxx`.
- **Provider exposure**: yes, via `ProviderPatient.canViewBiomarkers = true`.
- **Snippet**:
  ```ts
  // Source: backend/src/controllers/biomarkerController.ts:Lxx-Lyy
  const valueEncrypted = await encryptPHI(req.user.id, String(value));
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

1. How many PHI fields are defined in `PHI_FIELDS`, and do all map to `*Encrypted` columns in the schema?
2. Where is `Biomarker.valueEncrypted` decrypted, and how many call sites?
3. Is `ExpenseActual.providerNameEncrypted` covered by logger redaction?
4. Which PHI fields can a PROVIDER read, and via which consent permission flag?
5. How is the per-user encryption key derived, and where is it stored?
6. Does every PHI write have a matching `auditLog.log(...)` call, and what's the drift if not?
7. Which deprecated models still hold PHI, and is it safe to drop them?
8. Which audit log fields themselves hold encrypted PHI (previous/new values)?
9. What's the rotation policy for `PHI_ENCRYPTION_KEY`, and where is that recorded?
10. Is there a redaction gap in `logger.ts` for any PHI field?
11. How is `ProviderPatient.relationshipNotesEncrypted` accessed — patient-only, provider-only, or both?
12. What happens to PHI on user deletion — cascade or soft delete, and where is the purge logged?
13. Which controllers decrypt PHI for non-owner access, and what permission check gates each?
14. Is `HealthNeed.description` encrypted? (consistency check against inventory)

---

## No-TBD enforcement

Before marking anything TBD:

- **For write sites**: `Grep pattern: "encryptPHI\\(|encrypt\\("` over `backend/src/**`; filter by encrypted field name.
- **For read sites**: `Grep pattern: "decryptPHI\\(|decrypt\\("` over `backend/src/**`.
- **For audit coverage**: `Grep pattern: "auditLog\\.log\\("` over `backend/src/**`; cross-reference with the controllers that touch each field.
- **For logger redaction**: read `backend/src/utils/logger.ts` and grep `SENSITIVE_FIELDS`.
- **For provider consent gating**: `Grep pattern: "canView|canEdit"` over `backend/src/**`.
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
| Find encrypt call sites | Grep | `pattern: "encryptPHI\\(|encrypt\\("` over `backend/src/**` |
| Find decrypt call sites | Grep | `pattern: "decryptPHI\\(|decrypt\\("` over `backend/src/**` |
| Find audit log calls | Grep | `pattern: "auditLog\\.log\\("` over `backend/src/**` |
| Read logger redaction map | Read | `backend/src/utils/logger.ts` |
| Find consent flags | Grep | `pattern: "canView|canEdit"` over `backend/src/**` |

---

## Output: file and location

Write the final document to `New Project Documents/PHI_TAXONOMY.md`.
