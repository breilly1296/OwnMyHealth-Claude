# Accessibility (a11y) Review — 2026-08-01

**Posture:** Sandbox — no GCP (no deployment target, founder-only data) — per [OPEN_FINDINGS.md §Posture](../OPEN_FINDINGS.md)
**Code state:** `master` @ `12b45ae`
**Ledger read at:** `12b45ae`, last updated 2026-08-01
**Prompt:** [`prompts/47-accessibility.md`](../../prompts/47-accessibility.md) — **first run of this prompt** (authored 2026-08-01 to close a total coverage gap: no prompt in the library had ever asked an accessibility question)

---

## Summary

| Severity | New | Already in ledger |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 1 | 0 |
| Low | 3 | 0 |
| Info | 1 | 0 |
| Dormant (launch checklist) | 0 | 0 |

**The 2026-06-20/21 accessibility waves did their job.** All 15 dialog surfaces route through the
shared `useFocusTrap` hook, every one of them carries `role="dialog"` + `aria-modal="true"` + a
resolving `aria-labelledby` **and** the easily-missed `tabIndex={-1}`, a skip link exists and works,
`lang` is set, zoom is not blocked, there are no positive `tabIndex` values, and every
`focus:outline-none` is paired with a `focus-visible:ring-*` replacement. That is a better result
than the average React codebase and better than I expected going in.

The findings are the edges the wave did not reach: **one dialog that predates the hook and never got
migrated** — and it is the HIPAA idle-logoff warning — plus chart text equivalents, dropdown
keyboard semantics, and the absence of any linter to stop regression.

---

## New findings

### F-1 — The HIPAA idle-timeout dialog is the one dialog that bypasses the shared focus trap — **Medium**

- **Location:** `src/contexts/AuthContext.tsx:379-418`
- **Observation:** `Grep` for `role="dialog"` across `src/` returns 16 files. Fifteen are the
  `useFocusTrap` consumers. The sixteenth is the idle-session-expiry warning rendered inline by
  `AuthContext`, and it uses **none** of the shared behavior:

  ```tsx
  // Source: src/contexts/AuthContext.tsx:379-385
  {idleWarningVisible && (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
  ```

  It gets the ARIA attributes right — `aria-labelledby` resolves to the `<h2 id="idle-warning-title">`
  at `:387-391` — and it does **not** strand the user: the "Stay signed in" button carries
  `autoFocus` (`:411`), so focus does move into the dialog and a screen reader will announce it.
  That mitigation is real and narrows this finding considerably.

  What is missing is everything else the hook provides:

  | Behavior | 15 other dialogs | Idle warning |
  |---|---|---|
  | Initial focus into the dialog | `container.focus()` | ✅ via `autoFocus` on the primary button |
  | **Tab focus trap** | ✅ | ❌ |
  | **Escape to close** | ✅ | ❌ |
  | **Focus restoration to opener** | ✅ | ❌ |
  | **Body scroll-lock** | ✅ | ❌ |
  | `tabIndex={-1}` on container | ✅ (all 15) | ❌ |

- **Impact:** The dialog declares `aria-modal="true"`, which tells assistive technology that
  everything outside it is inert — but nothing enforces that. A keyboard or screen-reader user who
  presses Tab past the two buttons walks out into the page behind, where the AT has been told there
  is nothing to read. They are then interacting with controls that are not being announced, on a
  2-minute timer, after which they are logged out. This is the *worst* dialog in the app to get this
  wrong: it is the HIPAA §164.312(a)(2)(iii) automatic-logoff warning, the one modal whose entire
  purpose is to be noticed and acted on before time runs out.
- **Why it was missed:** the wave migrated `src/components/**`. This dialog lives in
  `src/contexts/`, outside the search path. That is also why prompt 47 §2 tells the reviewer to
  `Grep` for `role="dialog"` app-wide and **diff that set against the hook's consumer list** rather
  than working from the component tree — this finding is exactly what that check was written to catch.
- **Fix:** migrate it like the other 14 bespoke overlays:
  ```tsx
  const dialogRef = useFocusTrap<HTMLDivElement>(idleWarningVisible, resetIdleTimers);
  // ...
  <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="idle-warning-title" ...>
  ```
  Decide deliberately what Escape should do here — `resetIdleTimers` ("stay signed in") is the safe
  default; dismissing to a logout on Escape would be hostile. Then add it to
  `dialogA11y.test.tsx`, which currently does not cover it.
- **Ledger check:** searched `OPEN_FINDINGS.md` for `dialog`, `focus`, `accessibility`, `a11y`,
  `idle` — no match.

### F-2 — Trend charts have no non-visual equivalent — **Low**

- **Location:** `src/components/biomarkers/BiomarkerChart.tsx`, `src/components/trends/TrendSparkline.tsx`
- **Observation:** `BiomarkerRangeBar` gets this right and is worth quoting as the in-repo pattern to
  copy — it declares `role="img"` and an `aria-label` that carries the **status in words**, not just
  in color:

  ```tsx
  // Source: src/components/biomarkers/BiomarkerRangeBar.tsx:65-70
  role="img"
  aria-label={
    isInRange
      ? `Value ${value}, within the reference range ${min} to ${max}`
      : `Value ${value}, outside the reference range ${min} to ${max}`
  }
  ```

  `BiomarkerChart` (a Recharts `ResponsiveContainer` line chart) and `TrendSparkline` have **no**
  `role`, `aria-label`, `<title>`, or adjacent text summary. Recharts emits SVG with no accessible
  name by default.
- **Impact:** longitudinal trend — the direction a biomarker is moving over time — is available to
  sighted users only. A screen-reader user can read individual values from the biomarker list but
  cannot perceive the trend, which is a primary feature of the product.
- **Why Low, not Medium:** the underlying values are reachable in text elsewhere in the UI, so this
  degrades the experience rather than removing the data. It rises with real users.
- **Fix:** give each chart `role="img"` plus an `aria-label` summarizing direction and magnitude
  (`classifyBiomarkerTrend` in `src/utils/biomarkers/trendCalculations.ts:56` already computes
  exactly this — the text is a formatting call, not new analysis). A visually-hidden `<table>` of the
  plotted points is the stronger option where the series is short.
- **Ledger check:** no match.

### F-3 — Dropdown menus have ARIA but no keyboard semantics — **Low**

- **Location:** `src/components/trends/ExportMenu.tsx:112-130`, `src/components/trends/TrendsPage.tsx:189-190,248-249`
- **Observation:** all three declare `aria-haspopup` and `aria-expanded` correctly, and `ExportMenu`
  adds `role="menu"`. But dismissal is a full-screen click-catcher `<div>` with an `onClick` and no
  keyboard equivalent:
  ```tsx
  // Source: src/components/trends/ExportMenu.tsx:128
  <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
  ```
  `Grep` for `Escape` in both files returns nothing, and there is no arrow-key navigation between
  items or roving `tabindex`.
- **Impact:** a keyboard user can open these menus but cannot dismiss them without tabbing through
  every item, and the `role="menu"` / `aria-haspopup="listbox"` declarations promise an interaction
  model (arrow keys) the components do not implement — which is worse than declaring nothing, because
  screen-reader users are told to expect it.
- **Note on the click-catcher `<div>`:** these are the only three `<div onClick>` instances in
  `src/components/`, and they are backdrop dismissal, not controls. They correctly carry no `role`
  and are not keyboard targets. The gap is the *missing* keyboard path, not the div itself.
- **Fix:** add an Escape handler and arrow-key navigation, or drop to a plain
  `aria-expanded` button + list without the `role="menu"` promise. `useFocusTrap` is not the right
  tool here — menus are not modal.
- **Ledger check:** no match.

### F-4 — No `eslint-plugin-jsx-a11y`, so the wave's gains can silently regress — **Low**

- **Location:** `eslint.config.js`, `package.json`
- **Observation:** `Grep "jsx-a11y"` returns **zero** hits in either file. Nothing in CI checks
  accessibility markup. The only enforcement is `src/__tests__/components/dialogA11y.test.tsx`, which
  covers three named modals (`ChangePasswordModal`, `ChangeEmailModal`, `BiomarkerInsurancePanel`) —
  not the other twelve, and not F-1's dialog.
- **Impact:** the 2026-06-20/21 waves were manual. The next contributor who hand-rolls an overlay,
  or adds `<div onClick>` without `role`/`tabIndex`/key handler, gets no signal. F-1 is the proof:
  one dialog outside the search path stayed unmigrated for six weeks with nothing flagging it.
- **Fix:** add `eslint-plugin-jsx-a11y` with the `recommended` ruleset to `eslint.config.js`. The
  `frontend` CI job already runs ESLint, so no new job is needed. Expect a small backlog on first
  run; F-3 is likely most of it.
- **Ledger check:** no match.

### F-5 — Info: accessibility has never been verified with a screen reader

- **Observation:** all evidence in this review, and all coverage in `dialogA11y.test.tsx`, is
  **static** — attributes present, handlers wired, names resolving. Nothing in the repo indicates
  NVDA, JAWS, or VoiceOver was ever used, and no such check exists in CI.
- **Why this matters for how you read the rest of this page:** static assertions verify the
  *contract*, not the *experience*. `aria-modal="true"` being present is what F-1 checks; whether a
  screen reader actually confines the user is what a screen reader would have caught in thirty
  seconds. Treat the "Checks passed" section below as "correct by construction", not "verified in use".
- **Suggested action:** one manual pass with VoiceOver (free, built into macOS) over the six flows in
  the keyboard trace below, with the result recorded here. Not a finding; a scoping note.

---

## Keyboard trace — the six flows (prompt §Required artifacts)

Traced statically by reading each component's markup and handlers. **Not executed** — see F-5.

| Flow | Keyboard-operable? | Blocking `file:line` |
|---|---|---|
| Register → verify email | ✅ | — real `<button>`/`<input>` throughout; errors announced via `role="alert"` + `aria-live="assertive"` (`RegisterPage.tsx:168,171,201-202`) |
| Log in | ✅ | — `LoginPage.tsx:251-252` carries the same live-region pattern |
| Add a biomarker | ✅ | — `AddMeasurementModal` uses the hook, `tabIndex={-1}`, resolving label; error at `:242` is `role="alert"` |
| Upload a lab report | ✅ | — upload modals use the hook |
| **Export all data** | ✅ | — `FilesPage` / `AccountSettingsPage` both use the hook. Compliance-critical, and it passes |
| **Delete account** | ✅ | — `AccountSettingsPage` dialog uses the hook with a resolving name |
| *(bonus)* Stay signed in at idle warning | ⚠️ **partial** | `AuthContext.tsx:379` — reachable via `autoFocus`, but no trap/Escape (F-1) |

The two flows the prompt calls out as compliance-critical — **data export and account deletion** —
are both fully keyboard-operable. That was the single most important thing to check and it passes.

---

## Checks passed

**§1 The shared focus trap**
- [x] Effect depends on `isOpen` only; `onClose` held in a ref with the rationale documented inline
      (`useFocusTrap.ts:30-34`). No consumer wraps the hook in a way that reintroduces the identity churn.
- [x] **All 15 consumers set `tabIndex={-1}`** — verified per-file, not assumed. This is the check
      most likely to fail silently (without it `container.focus()` is a no-op) and it passes everywhere:
      `GoalTrackerPanel` (2 dialogs), `AddMeasurementModal`, `BiomarkerInsurancePanel`, `TrendModal`,
      `common/Modal`, `DashboardSidebar`, `FilesPage`, `HealthNeedsPage`, `AddInsurancePlanModal`,
      `InsurancePlanCompare`, `InsurancePlanViewer`, `AccountSettingsPage`, `ChangeEmailModal`,
      `ChangePasswordModal`, `TrendDetailModal`.
- [x] Tab cycling handles both directions and the container-as-active case (`useFocusTrap.ts:67-72`).
- [x] Focus restored to `previouslyFocused` on cleanup (`:82`).

**§2 Dialog semantics**
- [x] All 15 hook consumers carry `role="dialog"` + `aria-modal="true"`.
- [x] `dialogA11y.test.tsx:26` asserts `aria-labelledby` **resolves to an element that exists** —
      the right assertion, since a dangling id degrades to no accessible name at all.
- [x] Escape closes on all 15 (via the hook).
- [x] Dialog inventory diffed against hook consumers — 16 files declare `role="dialog"`; 15 use the
      hook; the 16th is F-1.

**§3 Keyboard operability**
- [x] **No positive `tabIndex`** anywhere in `src/` (`Grep "tabIndex={[1-9]"` → zero hits).
- [x] **Every `focus:outline-none` is paired with a `focus-visible:ring-*` replacement** — checked
      each hit; e.g. `GoalTrackerPanel.tsx:589`, `LoginPage.tsx:348,367`, `ForgotPasswordPage.tsx:172`,
      `RegisterPage.tsx:408`. No bare focus suppression.
- [x] **Skip link present and correct** — `src/App.tsx:337-339`, `sr-only focus:not-sr-only` so it
      appears on focus, first in the tab order, targeting main content.
- [x] Only 3 `<div onClick>` in `src/components/`, all backdrop dismissal, none masquerading as controls (see F-3).

**§4 Announcements**
- [x] Errors reach screen readers: `role="alert"` + `aria-live="assertive"` across the `auth/`
      cluster (`LoginPage.tsx:251-252`, `RegisterPage.tsx:201-202`, `ForgotPasswordPage.tsx:135-136`,
      `ResetPasswordPage.tsx:133-134`) and `AddMeasurementModal.tsx:242`.
- [x] `role="status"` + `aria-live="polite"` used for non-urgent success (`RegisterPage.tsx:168`),
      correctly distinguished from assertive errors.
- [x] `ErrorToast.tsx:32` documents the A11Y-3 decision to use an assertive live region.
- [x] No PHI is added to live regions beyond what is already rendered on screen.

**§6 Visual and structural**
- [x] **In/out-of-range status is not color-only** — `BiomarkerRangeBar.tsx:65-70` conveys it in the
      accessible name. This was the highest-risk item in §6 and it passes.
- [x] `index.html:2` sets `lang="en"`.
- [x] `index.html:6` viewport is `width=device-width, initial-scale=1.0` — **no** `user-scalable=no`
      and **no** `maximum-scale`, so pinch-zoom is not blocked.

---

## Unverifiable

- **Contrast ratios in both themes.** Requires rendering and sampling computed colors; the Tailwind
  class names alone do not settle WCAG AA (4.5:1 / 3:1). Dark mode is a distinct surface here
  (`ThemeContext`), so both need checking. Recommend an automated pass (axe DevTools) rather than
  static review.
- **Whether `prefers-reduced-motion` is honored** for chart and modal transitions — needs a render.
- **Actual screen-reader behavior** — see F-5.

---

## Not applicable under current posture

Nothing. Accessibility is entirely application-level and fully live in the sandbox — none of it
depends on suspended infrastructure. This is one of the few review domains where the posture changes
nothing about what can be assessed or fixed.

---

## Out of scope

- Whether biomarker range **classification** is correct — owned by
  [`prompts/49-calculation-correctness.md`](../../prompts/49-calculation-correctness.md). This review
  covers only whether the status is *perceivable*; that one covers whether it is *right*.
- Legal determination of ADA Title III / Section 508 applicability. This review identifies defects
  against WCAG-shaped expectations; it is not a legal opinion.

---

## Recommended ledger entries

Proposed for `OPEN_FINDINGS.md` (the ledger owns final severity):

| Proposed | Title | Class | Suggested severity | Re-eval trigger |
|---|---|---|---|---|
| new | HIPAA idle-timeout dialog bypasses the shared focus trap | accessibility | Low now (**Medium** with any real user) | Any non-founder user; fix is a ~5-line migration to the existing hook |
| new | Trend charts have no non-visual equivalent | accessibility | Low | Any non-founder user |
| new | Dropdown menus declare `role="menu"` without arrow-key/Escape support | accessibility | Low | — |
| new | No `eslint-plugin-jsx-a11y`; a11y gains can regress unnoticed | tech debt | Low | — |

Consider grouping all four under a single `OF-nn — accessibility defects (4 items)` entry rather than
four ledger rows: they share one owner, one fix session, and one re-eval trigger, and the ledger's
value comes from being short.
