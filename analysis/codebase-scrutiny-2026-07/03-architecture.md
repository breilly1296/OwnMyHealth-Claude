# 03 — Architecture

---

## 1. No client router

`src/App.tsx` hand-parses `window.location.pathname` and switches views with React state. There is **no React Router** (or equivalent).

### Consequences

- Weak deep linking / shareable URLs for in-app sections
- Browser back/forward is a special-case minefield
- Auth views become a mini state machine glued to URL special cases
- Every new “page” increases spaghetti in `App` / `Dashboard`

For a ~90-component SPA (admin, provider, insurance hub, files, guide, settings), this is **under-architecture for the product’s surface area**.

---

## 2. God files

### Backend (approx. line counts, excluding tests)

| File | ~LOC | Smell |
|------|------|--------|
| `backend/src/services/biomarkerPatterns.ts` | **2,219** | Data dump masquerading as a service |
| `backend/src/services/authService.ts` | **1,656–1,830** | Auth, sessions, tokens, lockout, email tokens, demo |
| `backend/src/services/pdfParser.ts` | **1,447** | Monolith extraction |
| `backend/src/controllers/settingsController.ts` | **1,236–1,364** | Export, delete, profile, preferences |
| `backend/src/routes/adminRoutes.ts` | **974** | Routes + business logic stacked |
| `backend/src/services/sbcExtraction.ts` | **935** | Large AI extraction surface |
| `backend/src/controllers/upload/shared.ts` | **926** | Shared upload orchestration blob |

### Frontend

| File | ~LOC | Smell |
|------|------|--------|
| `src/components/analytics/GoalTrackerPanel.tsx` | **1,117** | UI god-component |
| `src/utils/biomarkers/labReportParser.ts` | **974** | Client-side lab parsing |
| Multiple insurance components | **600–780** | Feature islands |

A codebase this size without modular boundaries will slow every new engineer (including future you) by a large factor.

---

## 3. Dual / triple pipelines for the same domain

| Concern | Frontend | Backend |
|---------|----------|---------|
| Lab PDF parsing | `labReportParser.ts` (~974) | `pdfParser.ts` (~1,447) + Claude extraction + OCR |
| Document parsing | `documentParser.ts` (~812) | Upload controllers |
| Insurance knowledge | `insuranceKnowledgeBase.ts` (~871) | `insuranceKnowledge.ts` (~403) |

This is not healthy full-stack design. It is **two products fighting**:

- Client and server parsers drift
- Bugs get fixed on one side only
- Unclear where “truth” lives for extraction quality

For a PHI product: **server owns extraction truth**; frontend displays, confirms, and edits.

---

## 4. Multi-instance architecture is half-finished

Deployed on Cloud Run (horizontal by design), but critical state is still process-local unless Redis is configured:

| Store | Impact when multi-instance without Redis |
|-------|------------------------------------------|
| AI spend accumulator | Effective budget ≈ **N × daily cap** |
| Rate limits | Per-instance, not global |
| FHIR PKCE `code_verifier` Map | OAuth **fails** if callback hits another instance |
| In-memory access-token blacklist | Partially mitigated by DB-backed mechanisms |

### Strategic choice (pick one)

1. Pin `--max-instances=1` and accept limited scale, **or**
2. Provision Redis/Memorystore and finish shared stores (rate limit, spend, PKCE)

Current state: **complexity of a distributed system with guarantees of a single process**.

---

## 5. Layering inconsistency

- Some domains: routes → controllers → services → knowledge modules (clearer)
- Others: fat routes (`adminRoutes`, parts of provider routes) with DB work inline
- Controllers sometimes own orchestration that belongs in services (settings export/delete, upload shared)

There is no consistent “hexagonal” or even “controller thin / service fat” rule applied repo-wide.

---

## 6. Comment-driven development

Sample comment-ish densities (rough heuristic):

| File | Approx. comment-ish share |
|------|---------------------------|
| `backend/src/app.ts` | ~37% |
| `backend/src/services/authService.ts` | ~31% |
| `backend/src/controllers/settingsController.ts` | ~14% |

Many comments are excellent threat-model notes. Many restate the next line or re-litigate closed findings for auditors/LLMs.

**Pathology risk:** The repo sometimes optimizes for **reviewability by an auditor or AI agent** over **navigability by a product team**.

---

## Recommended architectural moves

1. Introduce a real client router; stop growing pathname special cases.
2. Split `authService` into session/token/password/email modules.
3. Move `biomarkerPatterns` data into data files; keep only loaders/matchers as code.
4. Collapse dual parsers: delete or demote FE extraction once server path is authoritative.
5. Require Redis in staging/prod before enabling multi-instance > 1 for FHIR or hard spend caps.
6. Establish a thin-controller convention and enforce via review.

See [11-priority-fix-list.md](./11-priority-fix-list.md) for sequencing.
