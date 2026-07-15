# 05 — Frontend

**Stack:** React 18 + Vite + TypeScript + Tailwind  
**Layout:** `src/components/*`, contexts, hooks, `src/services/api/*`

---

## Positives

- Lazy-loaded heavy screens (code splitting)
- Theme support (dark mode) with localStorage preference only (not auth tokens)
- Cookie-based session model; auth context documents no sensitive tokens in localStorage
- Thoughtful pagination helpers (e.g. `fetchAllBiomarkers` with concurrency caps)
- Meaningful component polish across dashboard / insurance / biomarkers
- Some unit/component tests under `src/__tests__`

---

## Critical structural issues

### 1. No router

Hand-rolled path parsing in `App.tsx`. See [03-architecture.md](./03-architecture.md).

### 2. Dashboard-centric mega-app

Navigation via custom nav groups and sample/config data rather than a clean page model. Authenticated experience concentrates in `Dashboard` and large child panels.

### 3. God components

Examples (~LOC):

- `GoalTrackerPanel.tsx` (~1,117)
- `CostOptimization.tsx` (~783)
- `BiomarkerActionPlan.tsx` (~754)
- `EnhancedInsuranceUpload.tsx` (~742)
- `InsurancePlanCompare.tsx` / `AddInsurancePlanModal.tsx` (~714 each)
- `HealthNeedsPage.tsx` (~644)
- `AccountSettingsPage.tsx` / `HealthProfileSection.tsx` (~620+)

These should be split into presentational + hook + subviews.

### 4. Placebo / stub affordances

Canonical example: **Upgrade** button toasts “not available yet” instead of checkout. Any UI that looks live but cannot complete a journey erodes trust — especially around money and medical data.

### 5. Demo branches in production hooks

`useBiomarkerData` and related code short-circuit on `DEMO_MODE`. Acceptable for demos; dangerous if demo semantics leak into assumptions about API contracts.

### 6. No React Query / SWR (or equivalent)

Manual `useState` + `useEffect` loading dominates. As features grow, expect:

- race conditions on fast navigation
- inconsistent cache invalidation after mutations
- duplicated fetch logic across pages

### 7. Type hygiene debt

Repeated patterns like:

```ts
first.biomarkers as unknown as Biomarker[]
```

in `useBiomarkerData` and similar. This means **API response types and domain types have drifted**. TypeScript cannot protect you if casts lie.

### 8. Client-side extraction / knowledge duplication

Large FE modules reimplement domain logic that also lives on the server:

- `labReportParser.ts`
- `documentParser.ts`
- `insuranceKnowledgeBase.ts`
- `insuranceEducation.ts`

Inflates perceived product completeness; increases dual-bug surface. Server should own extraction truth.

---

## Testing gap (frontend)

Rough inventory at analysis time:

- Components with some test presence: ~**17**
- Components without: ~**58**

Notable untested or thinly tested product UI:

- Health Guide page
- Health Needs page
- Most insurance upload / cost optimization surfaces
- Files page
- Several auth pages (forgot/reset/verify)

See [07-testing.md](./07-testing.md).

---

## Frontend recommendations

1. Add a real router; map each major nav item to a URL.
2. Replace billing stubs with live checkout or remove the CTA.
3. Introduce server-state library; standardize mutations + invalidation.
4. Align API DTOs with domain types; delete `as unknown as` casts.
5. Demote FE parsers to optional offline helpers or delete after server path is sole path.
6. Split god components; extract hooks (`useGoals`, `useExpenses`, etc.).
7. Expand component tests for money, upload, export/delete, AI guide.
