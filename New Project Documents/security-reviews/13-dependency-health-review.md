# Dependency Health Check Review — 2026-06-16

Scope: dependency hygiene for the OwnMyHealth monorepo (frontend at repo root, backend at `backend/`) at HEAD `fb2cd32`. Two independent npm trees, two lockfiles. Audits run live with `npm audit` / `npm outdated` against the committed `package.json` + `package-lock.json` of each tree, then cross-checked against `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`, and `backend/Dockerfile`.

This run produced the sibling docs under `New Project Documents/` (e.g. `SECURITY_STATUS.md`, `HIPAA_CHECKLIST.md`, `CHANGELOG.md`). No TEARDOWN / UX_REVIEW report is implied by this run.

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 4 |

The single High is a **process/CI-gate** exposure, not a runtime-reachable PHI bug: a transitive `hono` advisory is currently in the backend lockfile and would fail the `npm audit --audit-level=high` CI gate that the production deploy is hard-gated on. The advisory itself is in Prisma dev tooling that never ships to the production image, so the *attack-surface* blast radius is low — but the *operational* blast radius (a wedged deploy pipeline for a HIPAA service) is high, hence the ranking.

---

## Findings

### F-1 — Transitive **High** advisory (`hono`) in committed backend lockfile blocks the CI/deploy security gate — **High**
- **Location:** `backend/package-lock.json:5671-5677` (`node_modules/hono` → `4.12.23`); gate at `.github/workflows/ci.yml:141-143`; deploy gated on CI at `.github/workflows/deploy.yml:57-58,66`.
- **Observation:** A fresh `npm audit` on the backend tree at HEAD reports **1 High + 8 moderate** (not the "8 moderates only" the prompt and the `ci.yml:129-143` comment describe). The High is `hono@4.12.23`, pulled in transitively as `prisma@7.8.0 → @prisma/dev@0.24.3 → @hono/node-server@1.19.11 → hono` (and a direct `@prisma/dev → hono` peer). `npm why hono` confirms the only root is the **devDependency** `prisma`. The advisory cluster (GHSA-wwfh-h76j-fc44 path traversal in `serve-static` on Windows via `%5C`; GHSA-88fw-hqm2-52qc **High** — CORS middleware reflects any Origin with credentials when `origin` defaults to wildcard; plus AWS-Lambda/Set-Cookie/body-limit moderates) is scored **High** by `npm audit`. The backend `security` job runs `npm audit --audit-level=high` (`ci.yml:141-143`), and `deploy.yml` job `deploy` has `needs: ci` (`deploy.yml:66`) invoking `ci.yml` as a reusable workflow (`deploy.yml:57-58`).
- **Impact:** Operationally, any push to `master`/`main` will fail the Security Audit job on this transitive High, which **wedges the entire deploy pipeline** (build → migrate job → promote) for a production HIPAA service until someone reacts — exactly the "reactive lockfile-only `npm audit fix`" fire-drill the prompt's *Automated Updates* section warns about, except it is currently *unremediated* at HEAD. Security-wise the advisory is **not** runtime-reachable: `backend/Dockerfile:59` installs prod deps with `npm ci --omit=dev`, so `prisma`/`@prisma/dev`/`hono` never enter the shipped image (the app uses `@prisma/client` at runtime, not the `prisma` CLI). The shipped HTTP CORS surface is Express + the project's own `cors` config, not hono's CORS middleware. So blast radius is "broken deploy gate," not "PHI disclosure."
- **Fix:** Run the **non-breaking** `cd backend && npm audit fix` (no `--force`). Verified via `npm audit fix --dry-run`: it bumps `hono 4.12.23 => 4.12.25` (lockfile-only, no `package.json` change, no major bumps), which clears the High and the hono moderates while leaving the 8 deliberately-deferred moderates intact. Do **not** run `npm audit fix --force` — the dry run confirms `--force` would pull `prisma@6.19.3` (a breaking *downgrade* of the Prisma 7 stack) and `uuid@14`. Commit the regenerated `backend/package-lock.json`. Then update the `ci.yml:129-143` rationale comment + the prompt's *Automated Updates* note to acknowledge that the recurring High now extends to the `hono`/`@prisma/dev` chain, not just form-data/vite.
- **Evidence:**
  ```
  backend/package-lock.json:5671  "node_modules/hono": {
  backend/package-lock.json:5672    "version": "4.12.23",
  backend/package-lock.json:5675    "devOptional": true,
  ```
  ```
  # npm audit fix --dry-run (backend)
  change hono 4.12.23 => 4.12.25
  # npm why hono → prisma@7.8.0 > @prisma/dev@0.24.3 > @hono/node-server@1.19.11 > hono@4.12.23 (dev)
  ```
  ```yaml
  # ci.yml:141-143
  - name: Audit backend dependencies
    run: npm audit --audit-level=high
    working-directory: backend
  ```

### F-2 — `pdf-lib` declared but has zero import sites (unused dependency) — **Low**
- **Location:** `backend/package.json:41` (`"pdf-lib": "^1.17.1"`).
- **Observation:** `pdf-lib` is still a runtime dependency, but it has **no import anywhere in backend source**. A Grep for `from 'pdf-lib'` / `require('pdf-lib')` across `backend/src/**/*.ts` returns no matches. Its former sole consumer (`pdfRedaction.ts` / `redactPatientBanner`) was deleted post-2026-06-01, as the prompt notes. The only non-lockfile reference repo-wide is a dead `manualChunks` branch in the *frontend* build config (`vite.config.ts:89`), which is harmless: the frontend never imports pdf-lib either, so that `id.includes('node_modules/pdf-lib/')` rule matches nothing.
- **Impact:** Dead dependency. Minor: enlarges the backend dependency tree / lockfile surface and `npm ci` install footprint, and is one more package to track for advisories with no offsetting value. No exploit path.
- **Fix:** `cd backend && npm uninstall pdf-lib` (removes from `package.json` + lockfile). Optionally remove the now-dead `id.includes('node_modules/pdf-lib/')` line at `vite.config.ts:89` for tidiness.
- **Evidence:**
  ```jsonc
  // backend/package.json:41
  "pdf-lib": "^1.17.1",
  ```
  Grep `from 'pdf-lib'|require('pdf-lib')` over `backend/src/**/*.ts` → "No matches found".

### F-3 — `@types/node` pinned to `^20`, lagging the Node 22 engine/CI baseline — **Low**
- **Location:** `backend/package.json:59` (`"@types/node": "^20.10.0"`), vs engines `backend/package.json:76-77` (`node ^20.19 || ^22.12 || >=24`) and CI `ci.yml:18-20` (`NODE_VERSION: '22'`) and `Dockerfile:15,37` (`node:22-alpine`).
- **Observation:** The whole stack moved to the Node-22 generation (Prisma 7 requires `^22.12`, Node 20 hit EOL Apr 2026 — see `Dockerfile:11-14`), but the TypeScript ambient types are still `@types/node@^20` (installed `20.19.27`, latest `25.9.3` per `npm outdated`). The dev `tsx`/`vitest` run on Node 22.
- **Impact:** Hygiene only. Type definitions for Node 22-only APIs are absent, so code using newer stdlib surface could typecheck against stale 20.x signatures (a false-green or false-red in the build, not a runtime/security bug). No PHI or exploit path.
- **Fix:** Bump the devDependency to `@types/node@^22` to match the engine floor (`cd backend && npm i -D @types/node@^22`). Keep it within the supported engine range; do not jump to `@types/node@25` (ahead of the runtime).
- **Evidence:**
  ```jsonc
  // backend/package.json:59 — types lag the runtime
  "@types/node": "^20.10.0",
  // backend/package.json:76-77 — engines target 22/24
  "engines": { "node": "^20.19 || ^22.12 || >=24" }
  ```

### F-4 — Several major runtime-dependency updates pending; no documented pin rationale for the staying-back ones — **Low**
- **Location:** `backend/package.json:22-46` and root `package.json:22-59` (assessed via `npm outdated` on both trees).
- **Observation:** `npm outdated` shows a substantial set of **major** updates available for *runtime* deps that the repo is intentionally or inertially holding back, with no in-repo note documenting the decision for most of them. Backend: `express 4.22.2 → 5.2.1`, `zod 3.25.76 → 4.4.3`, `helmet 7.2.0 → 8.2.0`, `rate-limit-redis 4.3.1 → 5.0.0`, `bcryptjs 2.4.3 → 3.0.3`, `uuid 9.0.1 → 14.0.0`, `dotenv 16.6.1 → 17.4.2`, `@anthropic-ai/sdk 0.91.1 → 0.104.2`. Frontend: `react/react-dom 18.3.1 → 19.2.7`, `tailwindcss 3.4.19 → 4.3.1`, `pdfjs-dist 4.10.38 → 6.0.227`, `tesseract.js 5.1.1 → 7.0.0`, `lucide-react 0.344.0 → 1.20.0`, `html2canvas-pro 1.6.7 → 2.0.4`. The checklist's "Document any intentional version pins" box is only satisfied for `pdf-parse` (exact `1.1.1` with the documented 2.x-trap rationale, `13-dependency-health.md:104`) and the `rollup` overrides; the security-relevant majors (`helmet`, `zod` validation, `bcryptjs` hashing, `express`) have no recorded "why we're staying on N".
- **Impact:** Low / hygiene. None of these are *known-vulnerable* at the pinned versions (frontend audit = 0 vulns; backend Highs/Criticals limited to F-1). The risk is drift: the longer security-relevant libs (`helmet`, `express`, `bcryptjs`, `zod`) sit a major behind, the larger and riskier the eventual upgrade, and a future CVE in the held-back line may force an urgent breaking bump. `@anthropic-ai/sdk` lagging 13 minor releases in the 0.x line (where 0.x can carry breaking changes) is worth a deliberate look since it's the egress-to-Claude path.
- **Fix:** Treat as backlog, not an emergency. Let Dependabot open the per-package major PRs (already enabled, `dependabot.yml`); for each security-relevant lib (`helmet`, `express` 5, `zod` 4, `bcryptjs` 3) schedule a one-at-a-time upgrade with the full backend suite (`npm run test:ci` + `test:rls`). Record any *deliberate* hold (e.g. "staying on express 4 until X") as a comment near the dep in `package.json`, matching the `pdf-parse` precedent, so the "document intentional pins" box is honestly checkable.
- **Evidence:** `npm outdated` (backend) — `express 4.22.2 / 5.2.1`, `zod 3.25.76 / 4.4.3`, `helmet 7.2.0 / 8.2.0`, `bcryptjs 2.4.3 / 3.0.3`; (frontend) — `react 18.3.1 / 19.2.7`, `tailwindcss 3.4.19 / 4.3.1`.

### F-5 — Prompt drift: docs/CI comment claim "moderates only," but a transitive High is now present — **Low**
- **Location:** `prompts/13-dependency-health.md:143` ("~8 backend **moderate** advisories are KNOWINGLY DEFERRED … High/Critical still block a merge"); mirrored in the `ci.yml:129-137` rationale comment ("the only remaining moderates are transitive advisories … High/Critical still block a merge").
- **Observation:** Both the prompt and the inline CI comment frame the deferred set as *moderates only* and assert High/Critical "still block a merge" as if no High currently exists. As of HEAD `fb2cd32` the backend tree carries a **High** (`hono`, F-1) that would in fact block a merge right now — the documentation has drifted from the live `npm audit` result. The deferred-moderates list (`uuid`/`teeny-request`/`retry-request` via `@google-cloud/storage`, `@hono/node-server` via `@prisma/dev`) is otherwise accurate and confirmed by the live audit.
- **Impact:** Documentation-accuracy only. A reviewer trusting the comment would not expect a CI failure and could misattribute the wedged pipeline. Per the protocol's "When the prompt disagrees with the code" rule, this is logged as Low prompt drift for the quarterly refresh.
- **Fix:** After applying F-1, update `prompts/13-dependency-health.md:143` and the `ci.yml:129-137` comment to note the recurring transitive **High** in the `hono`/`@prisma/dev` chain (cleared by non-breaking `npm audit fix`), so the "moderates only" framing is no longer misleading.
- **Evidence:**
  ```
  prompts/13-dependency-health.md:143  ~8 backend **moderate** advisories are KNOWINGLY DEFERRED …
  ci.yml:131-133  the only remaining moderates are transitive advisories with no non-breaking fix …
  (live) npm audit (backend) → moderate:8, high:1, critical:0
  ```

---

## Checks passed
- [x] **Frontend `npm audit` clean** — `info:0 low:0 moderate:0 high:0 critical:0 total:0` (live `npm audit --json`, root tree).
- [x] **No Critical advisories in either tree** — frontend 0 total; backend `critical:0` (live `npm audit --json`).
- [x] **`pdf-parse` pinned to EXACT `1.1.1` (no caret), 2.x trap avoided** — `backend/package.json:42` `"pdf-parse": "1.1.1"`; `npm outdated` shows `Current 1.1.1 / Latest 2.4.5` and it was NOT auto-bumped.
- [x] **Both lockfiles committed and present** — Glob found `package-lock.json` and `backend/package-lock.json`; both `lockfileVersion: 3`.
- [x] **CI installs via `npm ci` (not `npm install`) in every job** — `ci.yml:38` (frontend), `ci.yml:77` (backend), `ci.yml:199` (rls); `Dockerfile:24` (builder) and `Dockerfile:59` (prod, `--omit=dev`).
- [x] **`rollup → @rollup/wasm-node` override intact in both trees** — root `package.json:65-67`, backend `package.json:83-85`; root lockfile resolves `@rollup/wasm-node@4.61.1` at `package-lock.json:1759-1761` (override in effect, not silently dropped).
- [x] **Dev deps excluded from the production image** — `Dockerfile:59` `RUN npm ci --omit=dev` in the production stage; builder stage's `node_modules` is not copied forward (only `dist` + `generated`, `Dockerfile:68-69`).
- [x] **Production deps in `dependencies`, build/test tooling in `devDependencies`** — runtime libs (express, @prisma/client, pg, jsonwebtoken, bcryptjs, helmet, zod, multer, pdf-parse, @anthropic-ai/sdk, @google-cloud/*, ioredis) under `backend/package.json:22-46`; `prisma` CLI, eslint, vitest, tsx, typescript, @types/* under `devDependencies` `backend/package.json:48-74`.
- [x] **Node baseline = 22, single-sourced** — `ci.yml:17-20` `NODE_VERSION: '22'`; `Dockerfile:15,37` `node:22-alpine` (digest-pinned `sha256:9385cd9f…`); engines `backend/package.json:76-77` `^20.19 || ^22.12 || >=24`.
- [x] **CI security gate runs `npm audit --audit-level=high` on BOTH trees** — `ci.yml:138-139` (frontend), `ci.yml:141-143` (backend); deploy gated on it via `deploy.yml:57-58` (`uses: ./.github/workflows/ci.yml`) + `deploy.yml:66` (`needs: ci`).
- [x] **Dependabot enabled for both npm trees + GitHub Actions** — `.github/dependabot.yml:3-12` (root `/` and `/backend`, weekly) + `:17-20` (github-actions, monthly); typescript-eslint grouped (`:13-16`).
- [x] **8 backend moderates match the documented deferred set** — live audit confirms `uuid`/`teeny-request`/`retry-request`/`gaxios` under `@google-cloud/storage`, and `@hono/node-server`/`@prisma/dev`/`prisma` chain; their non-breaking-less "fixes" are breaking majors (`@google-cloud/storage@5.18.3` semver-major, `prisma@6.19.3` downgrade, `uuid@14`) — matching the `ci.yml:129-137` rationale.
- [x] **Migrations do NOT run at container boot** — `Dockerfile:93` `CMD ["node", "dist/app.js"]`; comment `Dockerfile:86-92` confirms migrate runs as the `ownmyhealth-migrate` Cloud Run job in `deploy.yml`.

## Unverifiable
- **License compliance / no GPL in a commercial project** (checklist §6) — `npx license-checker` was not run (would require a network install of `license-checker` and is out of the "report findings only, don't mutate the tree" remit). No license metadata was inspected; cannot tick or fault it from source alone.
- **Bundle-size impact / tree-shaking / duplicate dependencies** (checklist §7) — not measured. No build-size artifact or `vite build --report` output was generated this run. The `vite.config.ts:85-104` `manualChunks` strategy shows deliberate lazy-split chunking (pdf/ocr/charts), but actual bundle bytes and duplicate-dep analysis were not produced, so this is neither passed nor failed here.
- **"No manual edits to lockfiles"** (checklist §4) — both lockfiles are well-formed `lockfileVersion: 3` and the `rollup` override is correctly reflected, which is consistent with tool-generated lockfiles; but proving the *absence* of any hand edit would require a `git`-history diff / `npm ci` integrity re-resolve that wasn't run. Treated as not-fully-verified rather than passed.
- **Open Dependabot PR triage** (checklist, Automated Updates) — the live GitHub PR list (e.g. the ~21–27 stale dep PRs referenced in project memory, including any `pdf-parse@2` trap PR to close) was not queried via `gh`; that is a GitHub-state check, not a source check, and outside this static review.

## Out of scope
- **Deep per-CVE exploitability of the deferred moderates** — the `@google-cloud/storage` (uuid/teeny-request/retry-request) and `@prisma/dev` (hono) moderates are documented-and-accepted with breaking-only fixes; this review confirms they remain transitive/dev and ranks the actionable High (F-1) instead of re-litigating each accepted moderate.
- **Runtime behavior of upgraded majors** (express 5, zod 4, react 19, tailwind 4) — assessing breaking-change impact requires running each upgrade through the suites; flagged as backlog in F-4 but not executed here (this prompt is a health *check*, and the protocol forbids mutating code).
- **Frontend/backend npm-workspace consolidation** — the two trees are intentionally separate (not a workspace); merging them is an architecture decision, not a dependency-health finding.
