---
tags:
  - meta
  - phi
  - hipaa
type: shared
priority: 1
updated: 2026-06-16
---

# PHI Inventory (shared)

**Single source of truth:** `backend/src/services/encryption.ts` — `PHI_FIELDS` constant.

Every other prompt that asks *"is field X encrypted?"* should reference **this file**, not re-list fields inline. When the schema changes, update `PHI_FIELDS` and the table below — then all prompts that reference this file are automatically current.

---

## How to use this file

1. **In a security review:** read `PHI_FIELDS` in `encryption.ts` and compare it to the schema. Report any field whose name ends in `Encrypted` in the schema but is missing from `PHI_FIELDS` (or vice versa).
2. **When adding a new PHI field:** edit the schema → add `Encrypted` suffix → add to `PHI_FIELDS` → update this table. All three must stay in lockstep.
3. **When removing a field:** delete from schema, `PHI_FIELDS`, and this table in the same commit.

---

## Canonical PHI fields

Drawn from `backend/src/services/encryption.ts` (verify before citing). At HEAD, `PHI_FIELDS` covers **14 models / 39 encrypted fields**, and the schema has exactly 39 matching `*Encrypted` columns — the two are in perfect lockstep (no orphans in either direction). If a diff against this table flags a `*Encrypted` column as "in schema but not in the inventory," first re-check that the column is one of the deliberate plaintext twins below before reporting it.

### Identity / profile
| Model | Encrypted fields |
|---|---|
| `User` | `firstNameEncrypted`, `lastNameEncrypted`, `dateOfBirthEncrypted`, `phoneEncrypted`, `addressEncrypted`, `healthProfileEncrypted` |

### Health data
| Model | Encrypted fields |
|---|---|
| `Biomarker` | `valueEncrypted`, `notesEncrypted` |
| `BiomarkerHistory` | `valueEncrypted` *(no notes — by design)* |
| `HealthNeed` | `descriptionEncrypted` |
| `HealthGoal` | `descriptionEncrypted`, `targetValueEncrypted`, `currentValueEncrypted`, `startValueEncrypted` *(numeric target encrypted as of migration `20260420_encrypt_health_goal_target`; current/start values added in `20260613_encrypt_goal_values` — M4)* |
| `GoalProgressHistory` | `noteEncrypted`, `valueEncrypted` *(numeric progress value encrypted as of migration `20260613_encrypt_goal_values` — M4)* |

### Insurance
| Model | Encrypted fields |
|---|---|
| `InsurancePlan` | `memberIdEncrypted`, `groupIdEncrypted` |

### Expenses (all monetary PHI stored as encrypted strings, **not** Decimal)
| Model | Encrypted fields |
|---|---|
| `ExpenseProjection` | `serviceTypeEncrypted`, `estimatedCostEncrypted`, `notesEncrypted` |
| `ExpenseActual` | `serviceTypeEncrypted`, `providerNameEncrypted`, `billedAmountEncrypted`, `insurancePaidEncrypted`, `patientPaidEncrypted`, `appliedToDeductibleEncrypted`, `appliedToOopEncrypted`, `notesEncrypted` |
| `CostAnalysis` | `claudeResponseEncrypted`, `totalProjectedOopEncrypted`, `projectedExpensesSnapshotEncrypted` |

### Lab connections (Quest / SMART-on-FHIR)
| Model | Encrypted fields |
|---|---|
| `LabConnection` | `accessTokenEncrypted`, `refreshTokenEncrypted` *(OAuth tokens for Quest FHIR lab sync — a stolen token is a direct path to live PHI at the lab, so treat as PHI)* |

### Files / documents
| Model | Encrypted fields |
|---|---|
| `UserFile` | `originalFilenameEncrypted` *(the raw client-supplied filename can embed PHI, e.g. `Jane Doe MRI.pdf` — encrypted at rest as of `20260615_encrypt_userfile_original_filename` — L24)* |

> The plaintext twin `UserFile.originalFilename` still exists (legacy column being phased out): new uploads write only the encrypted column + null the plaintext, the read path prefers the encrypted twin, and the `backfill-userfile-filenames` maintenance job re-encrypts legacy rows ahead of a follow-up migration that drops the plaintext column. It is deliberately **not** in `PHI_FIELDS`. The server-generated `UserFile.filename` (storage key) is intentionally plaintext (non-PHI). `Biomarker.sourceFile` is also plaintext by design — it is a FHIR idempotency/dedupe key, so encrypting it would break dedupe.

### Provider collaboration
| Model | Encrypted fields |
|---|---|
| `ProviderPatient` | `notesEncrypted` |

### Audit
| Model | Encrypted fields |
|---|---|
| `AuditLog` | `previousValueEncrypted`, `newValueEncrypted`, `metadataEncrypted` *(metadata encrypted column added in `20260606000001_encrypt_audit_metadata`; the legacy plaintext `metadata` column was irreversibly DROPPED in `20260615_drop_legacy_audit_metadata` — M6)* |

### Removed PHI (dropped from schema)

**DNA / Genetics models.** The `DNAVariant` (`genotypeEncrypted`) and `GeneticTrait` (`descriptionEncrypted`, `recommendationsEncrypted`) models were **dropped** in migration `20260423_drop_dna_genetics`. They no longer exist in `schema.prisma` or `PHI_FIELDS`. If a prompt or `CLAUDE.md` still references DNA/Genetics PHI, that reference is stale — flag it. There should be **no** `DNAVariant`/`GeneticTrait` hits anywhere in `backend/`.

**Legacy plaintext audit metadata.** The plaintext `audit_logs.metadata` column — which could carry PHI such as logged filenames — was **irreversibly DROPPED** in migration `20260615_drop_legacy_audit_metadata` (M6) and replaced by the encrypted `metadataEncrypted` column (added earlier in `20260606000001_encrypt_audit_metadata`). The DROP was done via DDL because `audit_logs` is immutable-by-RLS. If anything still reads or writes a plaintext `metadata` field on `AuditLog`, that is stale and broken — flag it.

---

## Verification queries (run these, don't assume)

Use the **Grep** tool, not Bash:

1. **Every `*Encrypted` schema field is in `PHI_FIELDS`**
   Grep `Encrypted` in `backend/prisma/schema.prisma`, diff against keys of `PHI_FIELDS` in `encryption.ts`.

2. **No plaintext writes of PHI fields**
   Grep for bare field names (`firstName`, `lastName`, `dateOfBirth`, `phone`, `address`, `memberId`, `groupId`, `healthProfile`, `targetValue`, `accessToken`, `refreshToken`) in `backend/src/controllers/**/*.ts` and `backend/src/services/**/*.ts`. Every hit should be: (a) inside an `encrypt(...)` call, (b) a decrypted output property, or (c) Zod schema input before encryption. Flag anything else.

3. **`CostAnalysis.claudeResponseEncrypted` is encrypted**
   Renamed from `claudeResponse` → `claudeResponseEncrypted` in migration `20260424_align_uuid_defaults_and_rename_claude_response` so the column name advertises ciphertext. Confirm the plaintext Claude response is run through `encryption.encrypt(...)` before the DB write in `backend/src/controllers/expenseController.ts` (write ~line 801; decrypt-on-read ~line 866, and `backend/src/controllers/settingsController.ts` ~line 640 for export).

4. **`LabConnection` OAuth tokens are encrypted**
   `accessTokenEncrypted` / `refreshTokenEncrypted` hold SMART-on-FHIR (Quest) tokens — a stolen access token reaches live PHI at the lab. Confirm both are encrypted with the user's per-user key before write, and never logged in plaintext. Token encrypt/decrypt lives in `backend/src/services/fhir/labSyncService.ts`; the OAuth handshake itself is in `backend/src/services/fhir/smartAuth.ts`.

5. **AuditLog uses the system salt, not per-user salt**
   Per-user salts are destroyed on account deletion; audit logs survive deletion (7-year HIPAA retention). If AuditLog PHI used per-user salt, it would become unreadable after deletion. Verify in `backend/src/services/auditLog.ts`.

---

## Fields that are NOT PHI (common confusion)

- `User.email` — identifier, but we do not classify email alone as PHI. Still log-redacted as precaution.
- `User.role` — enum, not PHI.
- Timestamps (`createdAt`, `updatedAt`, `measurementDate`) — metadata, not PHI.
- `Biomarker.category`, `Biomarker.unit` (the reference unit, distinct from `unitEncrypted` if present) — metadata.
- `InsurancePlan.planType` enum (HMO/PPO/etc.) — metadata.

If you're uncertain whether a field is PHI, treat it as PHI and flag the ambiguity in your review.

---

## Cross-references

- [review protocol](./_review-protocol.md) — output format for findings
- [02-encryption](./02-encryption.md) — encryption service review
- [05-audit-logging](./05-audit-logging.md) — audit log PHI handling
- [22-hipaa-checklist-doc](./22-hipaa-checklist-doc.md) — HIPAA §164.312 technical safeguards
- [27-ai-integration](./27-ai-integration.md) — PHI handling before external AI calls
- [09-external-apis](./09-external-apis.md) — Quest FHIR / SMART-on-FHIR OAuth (`LabConnection` token PHI, SSRF guard in `fhir/urlSafety.ts`)
- [31-logging-observability](./31-logging-observability.md) — PHI redaction in application logs (`utils/phiRedaction.ts`)
- [40-phi-taxonomy-doc](./40-phi-taxonomy-doc.md) — produced PHI taxonomy doc (consumes this inventory)
