# 13-dependency-health Review — 2026-06-01

## Summary
| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 5 |
| Info | 2 |

Frontend tree: **0** known vulnerabilities (`npm audit` clean). Backend tree: **8 moderate** advisories, all transitive, all in dev-only or low-exploitability paths. No critical/high CVEs in either tree. Both lockfiles are committed and in sync with their `package.json` (`npm ci --dry-run` exits 0 for both). The `rollup → @rollup/wasm-node` override is materialized and effective in the frontend tree. `pdf-parse` is correctly pinned to the exact version `1.1.1`. The production Docker image excludes dev dependencies (`npm ci --omit=dev`), which means the moderate dev-only advisories (`@hono/node-server`, `@prisma/dev`) never ship to runtime.

---

## Findings

### F-1 — 8 moderate backend advisories not gated by CI (`--audit-level=high`) — **Medium**
- **Location:** `.github/workflows/ci.yml:123-125` (gate) + backend `npm audit` output (8 moderate advisories).
- **Observation:** The backend tree carries 8 moderate-severity advisories: `uuid <11.1.1` (GHSA-w5hq-g745-h8pq, CWE-787 out-of-bounds write in v3/v5/v6 when a `buf` arg is supplied), and `@hono/node-server <1.19.13` (GHSA-92pp-h63x-v22m, CWE-22 serveStatic path traversal), plus the transitive chain `@google-cloud/storage → gaxios / teeny-request / retry-request → uuid` and `prisma → @prisma/dev → @hono/node-server`. The CI `security` job gates merges only at `--audit-level=high`, so every one of these moderate advisories passes CI silently and will keep doing so as long as they stay below "high."
- **Impact:** Moderate advisories accumulate undetected. If one is ever re-scored to high, or a new moderate becomes practically exploitable, the gate gives no warning. Today's real exploitability is low (see F-2/F-3), so this is posture/process rather than an active exploit.
- **Fix:** Either (a) lower the backend `npm audit` gate to `--audit-level=moderate` and remediate/`--omit=dev` the noise, or (b) keep the high gate but add a non-blocking `npm audit --audit-level=moderate || true` reporting step so moderates are visible in CI logs. Track the `uuid` and `@google-cloud/storage`/`prisma` chains for upstream fixes.
- **Evidence:**
  ```yaml
  - name: Audit backend dependencies
    run: npm audit --audit-level=high
    working-directory: backend
  ```

### F-2 — `uuid <11.1.1` out-of-bounds write advisory present but not reachable as used — **Low**
- **Location:** `backend/src/services/authService.ts:284` (only direct `uuid` call) + 4 `uuid` instances in the backend tree (v8.3.2 / v9.0.1).
- **Observation:** GHSA-w5hq-g745-h8pq affects `uuid.v3/v5/v6(name, namespace, buf, offset)` only when the caller passes a writable `buf`. The single direct usage is `const tokenId = uuidv4();` — `v4`, no buffer argument. The other instances are transitive under `@google-cloud/storage` (`gaxios`, `teeny-request`, and storage's own `uuid@8.3.2`), which generate IDs internally and do not pass attacker-controlled buffers. `npm audit`'s suggested remediation (`uuid@14.0.0`, semver-major) is disproportionate to the actual reachability.
- **Impact:** No realistic exploit path in this codebase: the vulnerable code branch (write into a supplied `buf`) is never invoked with user input. Hygiene only.
- **Fix:** No urgent action. When `@google-cloud/storage` ships a release that bumps its transitive `uuid`, take it. Do not "fix" by downgrading `@google-cloud/storage` to 5.20.4 as `npm audit fix --force` proposes — that is a major downgrade of a key dependency for a non-reachable bug.
- **Evidence:**
  ```ts
  export async function generateRefreshToken(user: User, metadata?: SessionMetadata): Promise<string> {
    const tokenId = uuidv4();
  ```

### F-3 — `@hono/node-server` / `@prisma/dev` path-traversal advisory is dev-only, excluded from prod image — **Low**
- **Location:** Backend dep chain `prisma@7.8.0 → @prisma/dev@0.24.3 → @hono/node-server@1.19.11` (advisory range `<1.19.13`); production exclusion at `backend/Dockerfile:31`.
- **Observation:** `@hono/node-server <1.19.13` (GHSA-92pp-h63x-v22m, serveStatic middleware bypass via repeated slashes) and its parent `@prisma/dev` are pulled in only by `prisma`, which is a **devDependency** (`backend/package.json:66`). The production Docker stage installs with `npm ci --omit=dev`, so neither package is present at runtime. The Prisma local dev server (`@prisma/dev`) is never started in production.
- **Impact:** Not exploitable in production — the vulnerable static-file server is not installed in the runtime image and is not part of the deployed app surface. Affects only local developer machines running `prisma dev`.
- **Fix:** Watch for a `prisma` patch that bumps the transitive `@prisma/dev`/`@hono/node-server`; bump within the `^7.x` range when available. Note that `npm audit` proposes `prisma@6.19.3` (a major **downgrade**) as the "fix" — do not take it; it would regress Prisma from the installed 7.x line. See F-6 (Prompt drift).
- **Evidence:**
  ```dockerfile
  COPY package*.json ./
  RUN npm ci --omit=dev
  ```

### F-4 — Deprecated transitive `node-domexception@1.0.0` in production tree — **Low**
- **Location:** Backend chain `@google-cloud/documentai@9.5.0 → google-gax → node-fetch@3.3.2 → fetch-blob@3.2.0 → node-domexception@1.0.0` (PROD).
- **Observation:** `node-domexception@1.0.0` is deprecated by its maintainer ("Use your platform's native DOMException instead") and is present as a production transitive dependency under the Document AI OCR client. It is the only deprecated package found in either tree's lockfile metadata. (`glob@10.5.0` and `rimraf@5.0.10` are also present but are the modern, non-deprecated major versions.)
- **Impact:** No vulnerability — deprecation only. On Node 20 (the deployed runtime, `Dockerfile:24`) a native `DOMException` exists, so the shim is dead weight. No action-forcing risk.
- **Fix:** Cannot be fixed directly (transitive). Resolve by bumping `@google-cloud/documentai` (current 9.5.0 → 9.6.1 available, minor) and re-running `npm install` to pull a newer `google-gax`/`node-fetch` that drops the shim. Low priority.
- **Evidence:**
  ```
  `-- @google-cloud/documentai@9.5.0
    `-- google-gax@5.0.6
      `-- node-fetch@3.3.2
        `-- fetch-blob@3.2.0
          `-- node-domexception@1.0.0
  ```

### F-5 — Several major-version updates pending on security-relevant packages — **Low**
- **Location:** `npm outdated` (backend, majors) — e.g. `bcryptjs 2.4.3 → 3.0.3`, `express 4.22.2 → 5.2.1`, `helmet 7.2.0 → 8.2.0`, `zod 3.25.76 → 4.4.3` (`@anthropic-ai/sdk 0.91.1 → 0.100.1` is pre-1.0, semver-minor; `pg 8.16.3 → 8.21.0` is a within-major minor bump — both outdated but not majors); frontend — `react 18 → 19`, `vite 7 → 8`, `tailwindcss 3 → 4`, `lucide-react 0.344.0 → 1.17.0`.
- **Observation:** Multiple security-sensitive dependencies are a major version behind. `bcryptjs@2.4.3` and `helmet@7.x` are notable: `bcryptjs` 3.x is the current line and 2.x is no longer actively maintained, and `helmet` 8.x updates default security-header behavior. None of these are flagged by `npm audit` (no CVE), so this is upkeep, not an active vulnerability. The spec checklist item 2 ("review packages with major version updates available… document any intentional version pins") is partially unmet — only `pdf-parse@1.1.1` carries a documented pin rationale.
- **Impact:** Falling behind on auth (`bcryptjs`), header (`helmet`), and validation (`zod`) libraries increases the window in which a future CVE lands on an unmaintained major. No immediate exploit.
- **Fix:** Schedule one-at-a-time major bumps with `npm test` after each, prioritizing `bcryptjs` and `helmet`. Add a short "intentional pins" note to the backend `package.json` or a `DEPENDENCIES.md` for `pdf-parse@1.1.1` (and the `rollup → @rollup/wasm-node` override) so the rationale survives audits.
- **Evidence (from `npm outdated`, backend):**
  ```
  bcryptjs   2.4.3   2.4.3   3.0.3   node_modules/bcryptjs   backend
  helmet     7.2.0   7.2.0   8.2.0   node_modules/helmet     backend
  express    4.22.2  4.22.2  5.2.1   node_modules/express    backend
  ```

### F-6 — Prompt drift: spec's "Critical/High" risk labels and `@prisma/adapter-pg` line don't match audit reality — **Low**
- **Location:** `prompts/13-dependency-health.md:80-104` (Backend key-dependency table) vs. live `npm audit` / installed versions.
- **Observation:** Two small mismatches between the prompt and the code. (1) The prompt labels `jsonwebtoken` and `bcryptjs` "Critical" and `pg`/`express`/`prisma` "High" by *role*, which is reasonable, but the **only packages with live advisories** (`uuid`, `@hono/node-server`, transitive Google chain) are all labeled "Low"/"Medium" or absent from the table — so the table's risk column does not predict where the actual audit hits land. (2) The installed Prisma stack is `prisma@7.8.0` / `@prisma/client@7.7.0` / `@prisma/adapter-pg@7.8.0`, matching the prompt's `^7.x` expectation — but `npm audit`'s `fixAvailable` repeatedly proposes `prisma@6.19.3` (a major downgrade), which would silently violate the prompt's own "^7.x" assumption if anyone ran `npm audit fix --force`. The prompt does not warn about this misleading auto-fix the way it warns about the `pdf-parse` 2.x trap.
- **Impact:** Documentation/process only. An operator trusting `npm audit fix --force` could downgrade Prisma off the 7.x line and break the `@prisma/adapter-pg` setup. Low risk because the fix is manual.
- **Fix:** Add a note to the prompt's "Automated Updates" section mirroring the `pdf-parse` warning: "Do not run `npm audit fix --force` on the backend — it proposes downgrading `prisma` 7.x → 6.19.3. Remediate the moderate chain by waiting for upstream patches instead." Optionally annotate the key-dependency table to mark which packages currently carry advisories.
- **Evidence (audit `fixAvailable` for the prisma chain):**
  ```json
  "fixAvailable": { "name": "prisma", "version": "6.19.3", "isSemVerMajor": true }
  ```

---

## Checks passed

### Section 1 — Security Vulnerabilities
- [x] Frontend `npm audit` clean (0 critical/high/moderate/low) — verified by `npm audit --json` (`metadata.vulnerabilities.total: 0`, prod 157 / dev 371 deps).
- [x] No **critical** or **high** advisories in either tree — backend `npm audit` reports `critical: 0, high: 0, moderate: 8` (`backend npm audit` metadata).
- [x] Backend moderate advisories categorized and triaged — see F-1/F-2/F-3 (`uuid`, `@hono/node-server`, `@google-cloud/storage` chain).

### Section 3 — Deprecated Packages
- [x] No deprecated packages in the frontend tree — frontend `package-lock.json` deprecated-metadata count = 0.
- [x] `glob`/`rimraf` are modern (non-deprecated) majors — `node_modules/glob @ 10.5.0`, `node_modules/rimraf @ 5.0.10` in `backend/package-lock.json` (only <9 / <4 are deprecated). (One deprecated transitive remains: `node-domexception` — see F-4.)

### Section 4 — Lockfile Integrity
- [x] Both lockfiles committed — `package-lock.json` (root) and `backend/package-lock.json` both present (Glob `**/package-lock.json`).
- [x] Lockfiles match their `package.json` — `npm ci --dry-run` exits 0 for both trees ("up to date in 647ms" backend; "up to date in 722ms" frontend).
- [x] CI uses `npm ci` (not `npm install`) — `.github/workflows/ci.yml:29` (frontend), `:68` (backend), `:181` (rls); also `deploy.yml:217` and `deploy-staging.yml:108`.
- [x] `overrides` block intact in both `package.json` files — frontend `package.json:65-67` and backend `package.json:80-82` both declare `"rollup": "npm:@rollup/wasm-node@^4.53.3"`.
- [x] `rollup → @rollup/wasm-node` override is materialized and effective in the frontend tree — root lockfile `node_modules/rollup` resolves to `@rollup/wasm-node@4.53.4` (`l.packages['node_modules/rollup'].resolved` = `.../@rollup/wasm-node/-/wasm-node-4.53.4.tgz`). (Backend tree has no `rollup` dependency at all, so the backend override is inert but harmless — see Info note.)
- [x] `pdf-parse` pinned to EXACT `1.1.1` (no `^`) — `backend/package.json:39` and mirrored in `backend/package-lock.json:30`; installed version confirmed `1.1.1` via `npm outdated`.

### Section 5 — Dev vs Production Dependencies
- [x] Production deps in `dependencies`, build/test tools in `devDependencies` — backend runtime libs (`express`, `@prisma/client`, `pg`, `jsonwebtoken`, `bcryptjs`, `helmet`, `multer`, `pdf-parse`) in `dependencies` (`backend/package.json:19-44`); `prisma`, `tsx`, `vitest`, `eslint`, `@types/*` in `devDependencies` (`:45-72`).
- [x] Docker image excludes dev dependencies — `backend/Dockerfile:31` `RUN npm ci --omit=dev` in the production stage; this is what keeps the dev-only `@prisma/dev`/`@hono/node-server` advisory out of runtime.

### Section 7 — Bundle / Duplicates (partial)
- [x] No duplicate top-level `rollup` (override collapses it to a single `@rollup/wasm-node`) — single `node_modules/rollup` node in root lockfile resolving to wasm-node.

### Automated Updates
- [x] Dependabot enabled with separate ecosystems for `/` and `/backend` plus github-actions — `.github/dependabot.yml:3-20` (two npm `directory` entries + `github-actions`, weekly/monthly schedules).
- [x] CI `security` job runs `npm audit --audit-level=high` for both trees, gitleaks secret scan, and the RLS wrapper guard — `.github/workflows/ci.yml:114-131`.

---

## Unverifiable
- **Open Dependabot PRs / "close the pdf-parse 2.x PR" (checklist §Automated Updates, prompt line 137).** Requires querying GitHub PR state (`gh pr list`), which is not available offline in this review. The defensive pin is in place locally (`pdf-parse` = `1.1.1` exact, F-cited), so a Dependabot 2.x bump would still require a deliberate merge; could not confirm whether such a PR is currently open.
- **License compliance (checklist §6 — `npx license-checker --summary`, no GPL).** `license-checker` is not installed and was not run (offline; would require a network install). Spot-checking lockfile `license` fields is partial at best, so this is reported as unverified rather than ticked. No GPL package was observed in the dependency names reviewed, but this was not exhaustively confirmed.
- **Bundle-size / tree-shaking effectiveness (checklist §7, items "large dependencies justified", "tree-shaking working").** Requires building and inspecting the production bundle (`vite build` + analyzer); not performed in this dependency-health pass. `tesseract.js`, `pdfjs-dist`, and `recharts` are the heavy frontend libs but their bundle impact was not measured.

## Out of scope
- **`npx prisma migrate deploy` at container runtime (`backend/Dockerfile:51`).** Because `prisma` is a devDependency and the prod image runs `npm ci --omit=dev`, `npx prisma` at `CMD` time will resolve `prisma` on-demand (download or fail) rather than from the image. This is a deployment-correctness concern, not a dependency-*health* (CVE/outdated/deprecated) issue, so it is noted but not scored here — flag for the CI/CD or deployment review (12-cicd-security).
- **Actual exploit construction / PoC for the cited advisories.** This is a dependency inventory and triage; building a working exploit for GHSA-w5hq-g745-h8pq or GHSA-92pp-h63x-v22m is outside the spec.
- **Frontend `npm audit fix --force` cascade for React 19 / Vite 8 majors.** Major framework upgrades are tracked under F-5 as outdated-package hygiene; performing and testing the upgrades is a separate engineering task, not this review.

---

### Info (observations, not findings)
- **Backend `overrides` block is inert (but not wrong).** The backend tree has no package depending on `rollup` (no `node_modules/rollup` node in `backend/package-lock.json`), so the `"rollup": "npm:@rollup/wasm-node"` override in `backend/package.json:80-82` overrides nothing today. It is harmless and worth keeping for symmetry, but only the **frontend** override is load-bearing (Vite → rollup). The spec's instruction to keep it "intact in both" is satisfiable but slightly over-stated for the backend.
- **`npm audit fix --force` is actively dangerous here.** For the backend it proposes `uuid@14.0.0` (major) and `prisma@6.19.3` (major **downgrade**) — both would do more harm than the non-reachable moderate advisories they "fix." Manual, upstream-driven remediation is the correct path.
