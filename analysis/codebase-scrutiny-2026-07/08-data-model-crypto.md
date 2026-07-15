# 08 — Data Model & Crypto Debt

---

## Data model snapshot

- **~19 Prisma models** (including sessions, revoked tokens, lab connections, expenses, etc.)
- **33 migrations** under `backend/prisma/migrations`
- Domain coverage: users/auth, biomarkers + history, insurance plans, expenses, goals/needs, files, provider–patient, audit logs, encryption keys, FHIR connections

Schema shows deliberate PHI design: encrypted field naming (`*Encrypted`), plan fields, consent timestamps, token revocation cutoffs.

---

## Crypto design (good)

- AES-256-GCM authenticated encryption
- Per-user salt / derived key model
- Master key exact-length hex validation
- Reject insecure placeholder keys in all environments
- PHI field maps for bulk encrypt/decrypt helpers

---

## Crypto / storage debt (open)

### 1. PBKDF2 iteration try-both scheme

- Current: 600,000 iterations
- Legacy: 100,000 on auth-tag failure
- TODO in code: store iteration count per user or ciphertext envelope; remove fallback after full re-encrypt

**Risk:** Permanent complexity; harder key rotation; subtle performance cost on decrypt paths that miss on first try.

### 2. Plaintext twin columns (legacy)

Documented twins include (see `KNOWN_ISSUES` / schema comments):

| Plaintext (legacy) | Encrypted twin |
|--------------------|----------------|
| `UserFile.originalFilename` | `originalFilenameEncrypted` |
| Health goal numeric value columns | `*ValueEncrypted` twins |
| Goal progress history value | `valueEncrypted` |

**Operational gap:** Filename backfill job may not have been run in production; DROP migration waits on backfill. New writes encrypt; old rows may still be plaintext.

### 3. Intentional plaintext fields

Some fields are plaintext by design (e.g. biomarker `sourceFile` as FHIR dedupe key). These must stay documented in PHI taxonomy so they are not “accidentally encrypted” (breaking dedupe) or “accidentally claimed encrypted” in marketing.

### 4. Performance interaction

600k PBKDF2 for key derivation is security-strong and **CPU-heavy**. Combined with list decrypts and multi-page FE loads, this becomes an ops/cost issue at scale — not just a crypto purity issue.

---

## Recommendations

1. Run backfills in prod (dry-run → apply); DROP plaintext twins.
2. Store KDF parameters with ciphertext or user key row; re-encrypt; remove legacy fallback.
3. Keep PHI taxonomy doc as the single source of “what is encrypted vs not.”
4. Measure decrypt cost per list endpoint; add summary endpoints before user growth.
5. Never claim “all PHI encrypted at rest” until twins and ops backfills are complete.
