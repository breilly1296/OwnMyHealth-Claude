---
tags:
  - meta
  - phi
  - hipaa
type: shared
priority: 1
updated: 2026-06-01
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

Drawn from `backend/src/services/encryption.ts` (verify before citing):

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
| `HealthGoal` | `descriptionEncrypted`, `targetValueEncrypted` *(numeric target encrypted as of migration `20260420_encrypt_health_goal_target`)* |
| `GoalProgressHistory` | `noteEncrypted` |

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

### Provider collaboration
| Model | Encrypted fields |
|---|---|
| `ProviderPatient` | `notesEncrypted` |

### Audit
| Model | Encrypted fields |
|---|---|
| `AuditLog` | `previousValueEncrypted`, `newValueEncrypted` |

### Removed (DNA / Genetics — dropped from schema)
The `DNAVariant` (`genotypeEncrypted`) and `GeneticTrait` (`descriptionEncrypted`, `recommendationsEncrypted`) models were **dropped** in migration `20260423_drop_dna_genetics`. They no longer exist in `schema.prisma` or `PHI_FIELDS`. If a prompt or `CLAUDE.md` still references DNA/Genetics PHI, that reference is stale — flag it. There should be **no** `DNAVariant`/`GeneticTrait` hits anywhere in `backend/`.

---

## Verification queries (run these, don't assume)

Use the **Grep** tool, not Bash:

1. **Every `*Encrypted` schema field is in `PHI_FIELDS`**
   Grep `Encrypted` in `backend/prisma/schema.prisma`, diff against keys of `PHI_FIELDS` in `encryption.ts`.

2. **No plaintext writes of PHI fields**
   Grep for bare field names (`firstName`, `lastName`, `dateOfBirth`, `phone`, `address`, `memberId`, `groupId`, `healthProfile`, `targetValue`, `accessToken`, `refreshToken`) in `backend/src/controllers/**/*.ts` and `backend/src/services/**/*.ts`. Every hit should be: (a) inside an `encrypt(...)` call, (b) a decrypted output property, or (c) Zod schema input before encryption. Flag anything else.

3. **`CostAnalysis.claudeResponseEncrypted` is encrypted**
   Renamed from `claudeResponse` → `claudeResponseEncrypted` in migration `20260424_align_uuid_defaults_and_rename_claude_response` so the column name advertises ciphertext. Confirm the plaintext Claude response is run through `encryption.encrypt(...)` before the DB write in `backend/src/controllers/expenseController.ts` (write ~line 737; decrypt-on-read ~line 799, and `backend/src/controllers/settingsController.ts` ~line 613 for export).

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
