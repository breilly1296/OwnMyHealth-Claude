---
tags:
  - meta
  - maintenance
  - drift-log
type: shared
priority: 2
updated: 2026-08-01
---

# Prompt-Library Drift Audit — 2026-08-01

A re-run of the codebase against all 54 prompt-library files, to answer the standing question:
*which prompts need updating, and which new prompts are needed?* This is the quarterly refresh
trigger from `00-index.md` — the baseline is the 2026-06-16 refresh (`fb2cd32`), HEAD is `12b45ae`
(2026-07-14), **66 commits later**.

**Method:** single-session manual verification — `git log`/`git log --diff-filter=A` for what
arrived, `Glob`/`Grep`/`Read` against the live tree for every count and cited symbol, plus a read of
`New Project Documents/OPEN_FINDINGS.md` and `analysis/codebase-scrutiny-2026-07/` for the posture
and governance changes the prompts are silent about. Unlike the 2026-06-16 audit (a 118-agent
workflow), this was not adversarially re-verified by a second pass — treat individual line-number
citations as "verified once", and the counts (which were re-derived, not inherited) as solid.

> **Unlike `_drift-audit-2026-06-16.md`, this file is the audit *and* the fix was applied in the
> same pass.** Every item marked ✅ below was edited into the prompt file on 2026-08-01. Items
> marked ⏳ are recorded for a future pass.

---

## Headline verdict

The library did **not** rot the way it did between 06-01 and 06-16. The app's security spine
(RLS, encryption, CSRF, audit, token revocation, AI spend) is where the prompts say it is, and the
counts moved by single digits, not multiples. Two things changed that the prompts *cannot* absorb
by tweaking numbers:

1. **The deployment posture inverted.** On 2026-07-14 the founder disabled GCP billing and declared
   the project a **local sandbox with no deployment target**
   (`New Project Documents/OPEN_FINDINGS.md` §Posture). Every prompt that reasons about GCS, Cloud
   Run, Secret Manager, or "production" is now reviewing an environment that does not currently
   exist. The prompts were written as if the deployed stack is the subject.
2. **Severity governance moved out of the prompt library.** `OPEN_FINDINGS.md` (created 2026-07-11
   to close scrutiny finding P0-6) declares itself the **single authoritative ledger** with the
   **one** severity rubric, explicitly posture-dependent. `_review-protocol.md` still carries its
   own competing rubric and never mentions the ledger — so a review run today re-reports findings
   that were triaged, accepted, or made dormant weeks ago.

| Bucket | Count | Files |
|---|---|---|
| **needs-update (material)** | **13** | `00-index`, `_review-protocol`, `_doc-quality`, `11`, `12`, `15`, `16`, `24`, `25`, `28`, `35`, `36`, `38` |
| minor (counts / one-line facts only) | 6 | `01`, `03`, `13`, `21`, `39`, `_phi-inventory` |
| **clean** | 35 | everything else — spot-checked, no drift found |
| **new prompts needed** | **3** | 47 accessibility · 48 insurance domain · 49 calculation correctness |

---

## Headline drift (what the project grew since 2026-06-16)

| Thing | Was (prompt) | Now (verified) | Evidence |
|---|---|---|---|
| **Deployment posture** | deployed on GCP (Cloud Run + Cloud SQL + GCS) | **sandbox, no GCP, billing disabled ~2026-07-12** | `OPEN_FINDINGS.md` §Posture |
| **Storage backend** | GCS only | **pluggable: `gcs` \| `local`; `local` is the dev default** | `backend/src/services/storageService.ts:20-44`; `config/index.ts:246-255` |
| Storage service files | `storageService.ts` (single file) | `storageService.ts` façade + `services/storage/` (`gcsBackend`, `localBackend`, `keys`, `types`) | `backend/src/services/storage/` |
| Findings ledger | none (SECURITY_STATUS vs KNOWN_ISSUES contradicted) | **`OPEN_FINDINGS.md` is authoritative; other docs must not restate severities** | `New Project Documents/OPEN_FINDINGS.md:1-8` |
| GitHub workflows | 4 | **5** (+`secret-history-scan.yml` — nightly full-history gitleaks) | `.github/workflows/` |
| CI jobs | frontend, backend, security, rls | **+`e2e`** (full Playwright suite, real PG, `ci.yml:221`) | `.github/workflows/ci.yml:24,59,106,155,221` |
| Playwright e2e specs | 5 | **6** (+`export-delete-journey.spec.ts`) | `e2e/` |
| Prisma migrations | 32 dirs | **34 dirs** (+`20260620_add_registration_consent`, `20260712_add_sessions_update_policy`) | `backend/prisma/migrations/` |
| Backend test files | 54 | **66** | Glob `backend/src/**/*.test.ts` |
| Frontend test files | 25 | **33** | Glob `src/**/*.test.ts(x)` |
| Frontend API modules | 17 + `index.ts` | **18 + `index.ts`** (+`pagination.ts`) | `src/services/api/` |
| Frontend `.tsx` | ~73 across 14 dirs | **75 across 15 dirs** (+`legal/`) | `src/components/` |
| Frontend hooks | (unlisted) | **8 + `index.ts`**, incl. new `useFocusTrap.ts` | `src/hooks/` |
| Prisma models | 19 | **19** — unchanged | `schema.prisma` |
| PHI fields | 14 models / 39 fields | **14 / 39** — unchanged, still in lockstep with schema | `encryption.ts` PHI_FIELDS |
| Rate limiters | 8 | **8** — unchanged | `rateLimiter.ts` |
| `aiSpendGuard` mounts | 8 across 5 route files | **8 across 5** — unchanged | `backend/src/routes/` |
| Route files / controllers / middleware | 18 / 10 / 10 | **18 / 10 / 10** — unchanged | verified by Glob |

---

## Cross-cutting themes (one root change → many stale prompts)

### 1. Sandbox posture (the big one) — ✅ applied

GCP billing disabled ~2026-07-12; no deployment target; founder/test data only. Findings that only
exist when deployed are **Dormant (launch checklist)** in the ledger, each carrying the severity it
re-acquires at launch. Hard reactivation triggers: re-enabling GCP billing, deploying anywhere, any
non-founder PHI, or making the product available to others.

Consequence for reviews: a prompt that asks "is the GCS bucket private / is Secret Manager wired /
is Cloud Armor on" is asking about infrastructure that is suspended. The honest answer is
*dormant*, not *fail* — and reporting it as a live Critical is exactly the "audit theater" the
scrutiny flagged (`analysis/codebase-scrutiny-2026-07/10-documentation-pathology.md:46-50`).

→ `_review-protocol` (posture preamble + Dormant status), `11`, `12`, `15`, `16`, `24`, `28`, `35`, `36`, `00-index`.

### 2. One ledger, one rubric — ✅ applied

`OPEN_FINDINGS.md` wins over any prompt-local severity call, and reviewers must read it *before*
reporting so already-triaged items are not re-litigated. `_review-protocol.md`'s own rubric is
retained but demoted to "first-pass triage for a *new* finding"; the ledger's posture-dependent
rubric decides the number that gets recorded.

→ `_review-protocol`, `21`, `24`, `00-index`.

### 3. Pluggable storage backend (OF-23) — ✅ applied

`storageService.ts` is now a façade selecting `gcsBackend` or `localBackend` from
`config.storage.backend` (`storageService.ts:33-44`, resolved lazily so partially-mocked test
configs still select GCS). `localBackend` seals every blob with AES-256-GCM under the **master**
`PHI_ENCRYPTION_KEY` — no per-user PBKDF2, because `getFileStream(storageKey)` has no user context
— in an envelope `[ 'OMHL' | 0x01 | iv(16) | authTag(16) | ciphertext ]`
(`localBackend.ts:38-42,86-103`), writes tmp+rename at mode `0600`, and resolves every key through
`isValidStorageKey` + a `path.resolve` containment check so a corrupted DB key cannot escape the
root (`localBackend.ts:65-74`). `config/index.ts:349` refuses `STORAGE_BACKEND=local` in
production/staging.

Prompt 28 was 100% GCS-framed — its §2 ("Google Cloud Storage Security") was the entire storage
story. Now it needs a backend-dispatch section and a local-backend section, and its GCS section
needs a dormancy marker.

→ `28`, `35`, `36`, `11`, `16`.

### 4. Security-relevant CI growth — ✅ applied

- `secret-history-scan.yml` — nightly **full-history** gitleaks scan (`8ec3989`, OMH-M01). Note it
  is **red by design** until OF-01's committed GCP key is purged from history; that is the
  finding's regression guard, not a broken workflow.
- `ci.yml` gained an `e2e` job running the full Playwright suite against real Postgres
  (`919398a`). Its first real run is what surfaced the `sessions` UPDATE-policy RLS bug (OF-22).

→ `12`, `13`, `38`, `15`.

### 5. RLS under a NOBYPASSRLS role — ⏳ recorded, partially applied

`20260712_add_sessions_update_policy` fixes a class of bug the prompts do not teach reviewers to
look for: **PostgreSQL applies UPDATE-policy checks to `SELECT ... FOR UPDATE` row locks.** `sessions`
had SELECT/INSERT/DELETE policies but no UPDATE policy (rotation is delete+reinsert), so under FORCE
RLS with a NOBYPASSRLS role the refresh-rotation lock query saw zero rows — every refresh 401'd and
the not-found row was misclassified as token **reuse**, firing the M-1 compromise detector and
revoking all of the user's sessions. Dev/staging connect as BYPASSRLS, so it was invisible there.

Prompt 01 should carry "every table that is row-locked needs an UPDATE policy even if it is never
UPDATE'd" as an explicit check. ✅ added to `01`. The broader lesson — *review under the same role
production uses* — is ⏳ for a future `_review-protocol` addition.

### 6. Registration consent (OMH-L04) — ⏳ recorded

`users.terms_accepted_at` + `users.terms_version` (`20260620_add_registration_consent`), validated
at the register API boundary (`0456c50`), with a new `src/components/legal/` surface. Deliberately
**not** PHI, **not** in `PHI_FIELDS`. Relevant to prompt 22 (HIPAA checklist) and the FTC Health
Breach Notification Rule angle; no prompt currently asks about consent capture.

### 7. Accessibility became a real subsystem — ✅ new prompt 47

Two a11y waves (2026-06-20/21) added `src/hooks/useFocusTrap.ts`, migrated 14 bespoke
dialogs/overlays to it (15 component files consume it, counting `common/Modal`), added ARIA tab semantics, keyboard-operable cards, SR status on AI chat, and
a `src/__tests__/components/dialogA11y.test.tsx` suite. **Zero prompts mention accessibility.** For
a consumer health app this is both a product-quality and a legal-exposure gap (ADA/Section 508
expectations on health services).

### 8. Correctness bug classes with no prompt — ✅ new prompt 49

Three waves of fixes landed against math and dates that no security prompt would ever catch:
date-only UTC off-by-ones in negative-UTC locales (`ea57001`, `45a0cbc`, `b376949` — see the
`formatDateUTC` rationale at `src/utils/format.ts:39-53`), trend-stat and goal-progress ordering
errors (`4795e1d`), and out-of-network projections silently dropping out of projected OOP
(`expenseController.costMath.test.ts`). The index already flagged "biomarker reference-range +
cost-math correctness" as uncovered; the date class makes it three.

### 9. Insurance domain still uncovered — ✅ new prompt 48

`insuranceController.ts` (947 lines), `sbcExtraction.ts` (1040), `knowledge/insuranceKnowledge.ts`
(459), 20 components under `src/components/insurance/`. It is the second-largest domain in the app
and carries `memberIdEncrypted`/`groupIdEncrypted` PHI, two `aiSpendGuard` mounts, and the SBC
upload path — reviewed today only in fragments by prompts 27/28/42. Flagged as uncovered in the
2026-06-16 index and still uncovered.

### 10. Doc-regeneration is now discouraged — ✅ applied

`analysis/codebase-scrutiny-2026-07/11-priority-fix-list.md:68` lists "another full multi-agent
security-theater doc refresh" as an **explicit non-goal until P0 clears**, and
`10-documentation-pathology.md:67` says "stop regenerating full doc sets; prefer surgical updates."
Prompts 24/25 are the orchestrators that do exactly that, and `00-index`'s Quick Start recommends
them as the default entry point. They need a gate, not deletion.

---

## Per-file dispositions

| File | Verdict | Drift | Action taken |
|---|---|---|---|
| `00-index` | needs-update | counts (7 stale rows), no posture/ledger mention, 3 uncovered domains still listed | ✅ rewritten |
| `_review-protocol` | needs-update | competing severity rubric; no ledger reference; no Dormant status | ✅ updated |
| `_doc-quality` | needs-update | inheritance list omits 46+; no surgical-update rule | ✅ updated |
| `_phi-inventory` | clean | 14/39 still exact | none |
| `_verification-tools` | clean | — | none |
| `01-database-schema` | minor | migrations 32→34; no row-lock/UPDATE-policy check | ✅ updated |
| `02-encryption` | clean | PHI_FIELDS unchanged; local-backend master-key use is a *storage* concern (28) | none |
| `03-authentication` | minor | refresh rotation now depends on `sessions_update_own` policy | ✅ one-line note |
| `04`, `05`, `06`, `07`, `08`, `09`, `10` | clean | limiter count, mounts, middleware all verified unchanged | none |
| `11-environment-secrets` | needs-update | `STORAGE_BACKEND`/`LOCAL_STORAGE_DIR` absent; Secret Manager now dormant | ✅ updated |
| `12-cicd-security` | needs-update | 4→5 workflows; `e2e` CI job; nightly history scan red-by-design | ✅ updated |
| `13-dependency-health` | minor | post-06-16 dep bumps (`a5b38a5`, `2a8dafe`, `762ce62`) | ✅ note added |
| `14`, `17`–`20`, `22`, `23` | clean | — | none |
| `15-runbook-doc` | needs-update | runbook assumes a live Cloud Run stack | ✅ posture note |
| `16-architecture-doc` | needs-update | FE counts; storage topology; deployment section | ✅ updated |
| `21-security-status-doc` | minor | must now defer to `OPEN_FINDINGS.md` | ✅ updated |
| `24-full-security-audit` | needs-update | no posture gate; missing 47–49 | ✅ updated |
| `25-full-doc-refresh` | needs-update | scrutiny explicitly discourages full regen | ✅ gated |
| `26`, `27`, `29`–`32` | clean | — | none |
| `28-file-storage` | needs-update | **GCS-only**; no backend dispatch, no local backend | ✅ substantially rewritten |
| `33`, `34`, `37`, `40` | clean | — | none |
| `35-env-vars-doc` | needs-update | 2 new env vars | ✅ updated |
| `36-local-dev-setup-doc` | needs-update | local storage removes the last GCP dev dependency | ✅ updated |
| `38-testing-patterns-doc` | needs-update | 54/25/5 → 66/33/6; CI e2e job | ✅ updated |
| `39-frontend-component-map-doc` | minor | 17→18 API modules; `legal/`; `useFocusTrap` | ✅ updated |
| `41`–`46` | clean | FHIR, AI cost, plan gating, token revocation, maintenance, series all verified | none |

---

## New prompts added

| # | Prompt | Why now |
|---|---|---|
| 47 | `47-accessibility.md` | Two a11y waves shipped a real subsystem (`useFocusTrap`, ARIA tabs, dialog semantics, `dialogA11y.test.tsx`); zero prompt coverage; consumer-health legal exposure |
| 48 | `48-insurance-domain.md` | ~2.4k lines of backend + 20 components + PHI + 2 AI spend mounts, reviewed only in fragments; flagged uncovered since 2026-06-16 |
| 49 | `49-calculation-correctness.md` | Three shipped bug waves (date-only UTC, trend/goal ordering, OON projections dropped from OOP) in a class no security prompt catches |

---

## Deliberately NOT added

- **MFA / TOTP prompt** — P0-4 is unbuilt. A prompt reviewing a feature that does not exist
  produces "Unverifiable" for every line. Add it with the feature.
- **Billing / Stripe prompt** — P0-5 is unbuilt (`plan` is set but nothing charges). Prompt 43
  already covers gate-bypass on the tiers that do exist.
- **Breach-detection prompt** (P0-8) — genuinely uncovered, but under the sandbox posture with no
  deployed logging sink there is nothing to review. Recorded as the top candidate for prompt 50 at
  the moment a deploy target returns.
- **BAA / vendor-PHI prompt** (P0-7) — the repo-side half (`ANTHROPIC_BAA_ACTIVE` /
  `GOOGLE_BAA_ACTIVE` hard gates) is already checked by prompts 27/28; the other half is paperwork
  that lives outside the repo and cannot be verified by reading code.

---

## Next review trigger

Whichever comes first:

- **Any reactivation trigger firing** in `OPEN_FINDINGS.md` §Posture (GCP billing re-enabled, a
  deploy anywhere, non-founder PHI, or the product being made available to others). That event
  invalidates the sandbox framing in `_review-protocol`, `11`, `12`, `15`, `24`, `28`, `35`, `36`
  simultaneously — treat it as a mandatory full-library re-audit, not a quarterly one.
- **2026-11-01** (quarterly cadence from `00-index.md`).
- **A P0 closing** from `analysis/codebase-scrutiny-2026-07/11-priority-fix-list.md` — MFA and
  billing each unlock a prompt that is currently premature.
