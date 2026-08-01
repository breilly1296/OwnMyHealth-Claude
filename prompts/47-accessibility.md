---
tags:
  - frontend
  - accessibility
  - product-quality
  - medium
type: prompt
priority: 3
updated: 2026-08-01
---

# Accessibility (a11y) Review

> Follow the [review protocol](./_review-protocol.md).
> Use [Claude Code tools](./_verification-tools.md) for all greps.
> PHI is not the primary axis here, but see [`_phi-inventory.md`](./_phi-inventory.md) before
> proposing any change that puts PHI into a live region or an announced string.

## Why this prompt exists

Two accessibility waves landed 2026-06-20/21 (`dc78c5b`, `c66ce43`, `f41ed1f`, `ff2a3c8`, `c2356cc`)
and turned a11y from ad-hoc markup into a real subsystem: a shared `useFocusTrap` hook consumed by
15 component files (14 bespoke overlays + `common/Modal`), ARIA tab semantics, keyboard-operable cards, screen-reader status on the
AI chat, and a regression suite (`dialogA11y.test.tsx`). Until 2026-08-01 **no prompt in this
library asked a single accessibility question**, so none of it was verified by review.

Two reasons it belongs in the security/audit family rather than being left to taste:

1. **It is a correctness surface with a regression suite.** A focus trap that leaks, a dialog with
   an `aria-labelledby` pointing at a deleted heading, or an overlay that strands `body { overflow:
   hidden }` are defects with deterministic reproductions — the same standard of evidence as any
   other finding.
2. **It is legal exposure for a consumer health app.** ADA Title III and Section 508 expectations
   apply to health services; an inaccessible export or account-deletion flow is a compliance gap
   with the same shape as an inaccessible data-subject-rights flow.

**Severity guidance.** Grade by *what a user cannot do*, not by WCAG letter. A keyboard user who
cannot complete data export or account deletion is **High** (a core flow is broken under normal ops,
per the ledger rubric). A missing `aria-label` on a decorative icon is **Low**. Do not report a raw
axe-style rule-violation dump — this protocol requires a `file:line` and a user-visible consequence.

## Files to Review

- `src/hooks/useFocusTrap.ts` — the shared WAI-ARIA dialog behavior: Escape-to-close, Tab trap,
  initial focus, focus restoration, body scroll-lock. Read the whole file; the `onCloseRef` comment
  (`useFocusTrap.ts:30-34`) documents a real bug class
- `src/components/common/Modal.tsx` — the chrome component the hook was extracted from
- The 14 bespoke consumers of the hook: `analytics/GoalTrackerPanel`, `biomarkers/AddMeasurementModal`,
  `biomarkers/BiomarkerInsurancePanel`, `biomarkers/TrendModal`, `dashboard/DashboardSidebar`,
  `files/FilesPage`, `health/HealthNeedsPage`, `insurance/AddInsurancePlanModal`,
  `insurance/InsurancePlanCompare`, `insurance/InsurancePlanViewer`, `settings/AccountSettingsPage`,
  `settings/ChangeEmailModal`, `settings/ChangePasswordModal`, `trends/TrendDetailModal`
- `src/__tests__/components/dialogA11y.test.tsx` — the regression suite; its `expectAccessibleDialog`
  helper encodes the contract (`role="dialog"` + `aria-modal="true"` + an `aria-labelledby` that
  **resolves to an element that exists**)
- `src/components/common/ErrorToast.tsx` — live-region error announcement (A11Y-3)
- `src/components/insurance/InsuranceHub.tsx`, `insurance/AddInsurancePlanModal.tsx` — the two
  `role="tablist"` implementations
- `src/components/auth/*` — the densest cluster of `role="alert"` / `aria-live` usage
- `src/components/dashboard/` — keyboard-operable cards from the wave-2 commit
- `tailwind.config.js` — check whether focus-visible rings are defined and not globally suppressed
- `index.html` — `lang` attribute, viewport scaling, skip-link target

## Checklist

### 1. The shared focus trap (`useFocusTrap`)
- [ ] Effect depends on `isOpen` **only**; `onClose` is held in a ref (`useFocusTrap.ts:30-34`). A
      dependency on a per-render `onClose` identity re-runs the effect, and its cleanup restores
      focus to the opener — stealing focus while the dialog is still open. Verify no consumer has
      re-introduced this by wrapping the hook
- [ ] Focus is moved into the container on open (`container?.focus()`), which requires the consumer
      to set `tabIndex={-1}` — **verify every one of the 14 consumers actually does**. Without it
      `focus()` is a silent no-op and the trap starts outside itself
- [ ] Focus is restored to `previouslyFocused` on close (`useFocusTrap.ts:82`). Check the case where
      the opener has unmounted (e.g. a row deleted by the dialog's own action) — focus must not land
      on `document.body` with no announcement
- [ ] Tab cycling handles both directions and the container-as-active case
      (`useFocusTrap.ts:67-72`)
- [ ] Visibility filter `el.offsetParent !== null` (`useFocusTrap.ts:56`) — note this returns `null`
      for `position: fixed` elements, so a fixed-positioned control inside a dialog is wrongly
      treated as untabbable. Check whether any consumer has fixed children
- [ ] `FOCUSABLE_SELECTOR` (`useFocusTrap.ts:4-5`) covers the controls actually used. It omits
      `[contenteditable]`, `audio[controls]`, `video[controls]`, `details`, and `iframe` — flag only
      if a consumer renders one
- [ ] **Body scroll-lock leak**: cleanup sets `document.body.style.overflow = 'unset'`
      unconditionally (`useFocusTrap.ts:80`). With two overlays open at once, closing the inner one
      unlocks scroll while the outer is still open. Verify no nested-overlay path exists, or that
      the leak is accepted
- [ ] The keydown listener is on `document`, so **Escape closes the dialog from anywhere**, including
      from inside a nested overlay. Confirm nesting order produces the intended close

### 2. Dialog semantics (every modal-like surface)
- [ ] `role="dialog"` + `aria-modal="true"` + an accessible name on the container
- [ ] `aria-labelledby` **resolves to an element that exists** — this is what
      `dialogA11y.test.tsx:26` asserts, because a dangling id degrades to no name at all
- [ ] `tabIndex={-1}` on the container (see §1)
- [ ] Escape closes, and closing is not the *only* way out (a visible, labelled close control exists)
- [ ] Backdrop click-to-close, where present, is not the sole affordance and does not trap pointer
      users only
- [ ] Every dialog reachable in the app either uses `common/Modal` or the hook — `Grep` for
      `role="dialog"` and diff that set against the hook's consumer list. **A dialog in neither list
      is the finding this section exists to catch**

### 3. Keyboard operability
- [ ] Every interactive element is reachable and activatable by keyboard. Particular attention to
      the card affordances from wave 2 (`ff2a3c8`, `c2356cc`): a `div` with `onClick` needs
      `role="button"`, `tabIndex={0}`, **and** an Enter/Space keydown handler — all three
- [ ] No positive `tabIndex` values (`Grep` for `tabIndex={[1-9]`)
- [ ] Focus indicators are visible and not suppressed by a global `outline: none` without a
      `:focus-visible` replacement
- [ ] Skip-link (or equivalent) to main content — verify it exists, is the first tabbable element,
      and targets a real id
- [ ] Composite widgets (tabs) implement arrow-key navigation, not just Tab: `role="tablist"` +
      `role="tab"` + `aria-selected` + `aria-controls` + roving `tabindex`. Check both
      `InsuranceHub` and `AddInsurancePlanModal`
- [ ] Charts / canvas visualizations have a non-visual equivalent (table, summary text, or
      `aria-label` carrying the trend) — a biomarker trend chart with no text equivalent makes core
      health data unavailable to screen-reader users

### 4. Announcements and live regions
- [ ] Errors reach screen readers: `role="alert"` + `aria-live="assertive"` on failure messaging
      (see `ErrorToast.tsx` and the `auth/` cluster)
- [ ] Async status (AI chat streaming, upload progress, extraction results) announces via
      `role="status"` / `aria-live="polite"` — verify it does not announce on every token/frame,
      which floods the SR buffer
- [ ] **PHI is not announced beyond what is on screen.** A live region that reads back a biomarker
      value is fine if the value is displayed; do not add SR-only text that expands PHI exposure in
      a shared/overheard setting. Cross-check `_phi-inventory.md`
- [ ] Live-region containers are present in the DOM **before** the message is written — a region
      inserted together with its content is not reliably announced
- [ ] Form validation errors are programmatically associated (`aria-describedby` / `aria-invalid`),
      not only colored red

### 5. Forms and labels
- [ ] Every input has a programmatic label (`<label for>`, `aria-label`, or `aria-labelledby`) —
      placeholder text is not a label
- [ ] Required fields marked with `required` / `aria-required`, and the requirement is conveyed in
      text, not only by an asterisk color
- [ ] Grouped controls (compare form, plan selection) use `fieldset`/`legend` or
      `role="group"` + `aria-labelledby` — the compare-form labels from `ff2a3c8` are the reference
- [ ] Error summaries move focus to the first invalid field or to a summary with `tabIndex={-1}`
- [ ] Destructive confirmations (account deletion, plan removal, file delete) are fully operable by
      keyboard and clearly named — **grade a failure here High**

### 6. Visual and structural
- [ ] Color is not the sole carrier of meaning. The biomarker range bar and in-range/out-of-range
      states are the highest-risk instance: verify status is also conveyed by text, icon, or
      pattern. Cross-link prompt [49](./49-calculation-correctness.md), which owns whether the
      classification is *correct*; this prompt owns whether it is *perceivable*
- [ ] Contrast meets WCAG AA (4.5:1 body, 3:1 large) **in both themes** — dark mode is a distinct
      surface here (`contexts/ThemeContext`), so check both
- [ ] Heading hierarchy has no skipped levels within a view
- [ ] `index.html` sets `lang`, and the viewport meta does not block zoom
      (`user-scalable=no` / `maximum-scale=1` are failures)
- [ ] Reduced-motion honored (`prefers-reduced-motion`) for chart and modal transitions

### 7. Test coverage of the above
- [ ] `dialogA11y.test.tsx` covers the bespoke modals it names — check it against the current hook
      consumer list and flag any consumer with no coverage
- [ ] The suite asserts behavior (Escape closes, name resolves), not markup presence alone
- [ ] Consider whether a linter (`eslint-plugin-jsx-a11y`) is configured — check `eslint.config.js`.
      Its absence is a **Low** finding on its own, but explains any pattern-level gaps found above

## Verification Commands
```bash
# Every dialog-ish surface, and whether it uses the shared hook
grep -rn "role=\"dialog\"\|aria-modal" src/components/
grep -rln "useFocusTrap" src/

# Consumers must set tabIndex={-1} for the hook's container.focus() to work
grep -rn "useFocusTrap" -A 20 src/components/ | grep -n "tabIndex"

# Click handlers on non-interactive elements (need role + tabIndex + key handler)
grep -rn "<div[^>]*onClick\|<span[^>]*onClick" src/components/

# Positive tabindex (focus-order smell)
grep -rn "tabIndex={[1-9]" src/

# Live regions and announcements
grep -rn "aria-live\|role=\"alert\"\|role=\"status\"" src/components/

# Tab widgets — confirm full ARIA tab pattern, not just role="tab"
grep -rn "role=\"tablist\"\|role=\"tab\"\|aria-selected\|aria-controls" src/components/

# Focus suppression without a focus-visible replacement
grep -rn "outline: *none\|outline-none" src/ tailwind.config.js

# Is the a11y linter configured at all?
grep -rn "jsx-a11y" eslint.config.js package.json
```

## Questions to Ask
1. Can a keyboard-only user complete each of these end to end: register → verify email → add a
   biomarker → upload a lab report → export all data → delete the account? Trace each; the last two
   are the compliance-critical ones.
2. Is there any dialog in the app that uses neither `common/Modal` nor `useFocusTrap`? That is the
   most likely place the wave missed.
3. Does the body scroll-lock leak (§1) actually reproduce — is there any path that opens two
   overlays at once?
4. Do the biomarker trend charts have a non-visual equivalent, or is health-trend data
   sighted-users-only?
5. Is dark mode contrast verified, or only light mode?
6. Was accessibility ever tested with an actual screen reader (NVDA/JAWS/VoiceOver), or only via
   unit assertions? Record the answer — "never" is a legitimate **Info** finding that scopes how
   much confidence the checks above deserve.
7. Should `eslint-plugin-jsx-a11y` be added so the wave-2 gains do not silently regress?

## Required artifacts
- A table of every dialog surface × (uses hook? `role`? `aria-modal`? name resolves? `tabIndex={-1}`?)
- The keyboard trace for the six flows in Question 1, each marked pass/fail with the blocking
  `file:line` where it fails
- Any finding that blocks a core flow, graded **High** with its user-visible consequence stated

## Cross-links
- [39-frontend-component-map-doc](./39-frontend-component-map-doc.md) — component + hook inventory
- [49-calculation-correctness](./49-calculation-correctness.md) — owns whether range/status values are correct; this prompt owns whether they are perceivable
- [29-data-portability](./29-data-portability.md) — export/deletion flows whose keyboard operability is graded High here
- [38-testing-patterns-doc](./38-testing-patterns-doc.md) — where `dialogA11y.test.tsx` fits in the pyramid
