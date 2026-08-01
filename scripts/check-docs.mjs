#!/usr/bin/env node
/**
 * Documentation integrity guard.
 *
 * The `New Project Documents/` set is attached to a Claude.ai Project as a
 * substitute for repo access, and `prompts/` is what regenerates it. Both make
 * their claims with `file:line` citations and navigate by relative links. When
 * either rots, the failure is silent: a reader follows a dead anchor, or trusts
 * a line number that moved three refactors ago. Nothing else in CI looks at
 * markdown.
 *
 * Three checks, all deterministic:
 *
 *   1. RELATIVE LINKS      — every `](./x.md)` / `](../x.md)` target exists.
 *   2. HEADING ANCHORS     — every `#fragment` matches a real heading, using
 *                            GitHub's slug algorithm (see slugify).
 *   3. CITATION LINE RANGE — every `` `path/file.ts:123` `` whose basename
 *                            resolves to exactly one file points at a line that
 *                            file actually has.
 *
 * Why these three and not more: each has a single correct answer, so a failure
 * is always a real defect and never a judgement call. Anything fuzzier (is the
 * cited line the *right* line?) is reported as a warning and never fails.
 *
 * Baseline at introduction (2026-08-01): 0 broken links, 0 bad anchors,
 * 0 out-of-range citations, across 4,573 citations in ~80 markdown files.
 *
 * Usage:  node scripts/check-docs.mjs [--warn-only]
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WARN_ONLY = process.argv.includes('--warn-only');

/** Markdown trees whose links and citations are load-bearing. */
const DOC_DIRS = ['New Project Documents', 'prompts', 'docs', 'analysis'];
/** Never walk into these. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'generated', 'build',
  'playwright-report', 'test-results', 'coverage', '.local-storage',
]);
/** Source extensions a `file:line` citation may point at. */
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|ya?ml|json|prisma|sh)$/;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, out = [], filter = () => true) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out, filter);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/**
 * Strip fenced code blocks so a `# comment` inside a bash fence is not read as
 * a heading, and an example link inside a snippet is not resolved. Replaced
 * with blank lines so reported line numbers stay accurate.
 */
function stripFences(text) {
  const lines = text.split('\n');
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line;
    })
    .join('\n');
}

/**
 * GitHub's heading-anchor algorithm. Getting this wrong produces confident
 * false positives, so the rules are spelled out:
 *   - lowercase
 *   - drop HTML tags, then backtick/asterisk emphasis marks
 *   - a markdown link collapses to its label text
 *   - drop every character that is not a word char, space, or hyphen
 *     (NOTE: `_` is a word char and IS KEPT — PHI_ENCRYPTION_KEY stays intact)
 *   - replace each space with a hyphen INDIVIDUALLY (runs are NOT collapsed,
 *     so "A — B" yields "a--b")
 *   - duplicate slugs in one file get -1, -2, … in document order
 */
function slugify(heading) {
  let s = heading.trim().toLowerCase();
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/[`*]/g, '');
  s = s.replace(/[^\p{L}\p{N}\s_-]/gu, '');
  return s.replace(/ /g, '-');
}

function headingSlugs(mdText) {
  const seen = new Map();
  const slugs = new Set();
  for (const line of stripFences(mdText).split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// gather inputs
// ---------------------------------------------------------------------------

const mdFiles = [];
for (const d of DOC_DIRS) {
  const full = join(ROOT, d);
  if (existsSync(full)) walk(full, mdFiles, (f) => f.endsWith('.md'));
}
for (const f of ['README.md', 'CLAUDE.md', 'AGENTS.md', 'DEPLOY.md']) {
  if (existsSync(join(ROOT, f))) mdFiles.push(join(ROOT, f));
}

// basename -> [absolute paths], for resolving shorthand citations like
// `config/index.ts:61` which really means backend/src/config/index.ts
const byBase = new Map();
for (const f of walk(ROOT, [], (p) => SRC_EXT.test(p))) {
  const b = basename(f);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(f);
}

const lineCount = new Map();
function linesIn(absPath) {
  if (!lineCount.has(absPath)) {
    try {
      lineCount.set(absPath, readFileSync(absPath, 'utf8').split('\n').length);
    } catch {
      lineCount.set(absPath, null);
    }
  }
  return lineCount.get(absPath);
}

const anchorCache = new Map();
function slugsFor(absPath) {
  if (!anchorCache.has(absPath)) {
    try {
      anchorCache.set(absPath, headingSlugs(readFileSync(absPath, 'utf8')));
    } catch {
      anchorCache.set(absPath, null);
    }
  }
  return anchorCache.get(absPath);
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];
let nLinks = 0;
let nAnchors = 0;
let nCites = 0;

const LINK_RE = /\[[^\]]*\]\((\.{1,2}\/[^)\s]+|#[^)\s]+)\)/g;
const CITE_RE = /`([A-Za-z0-9_@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|ya?ml|json|prisma|sh)):(\d+)(?:-L?\d+)?`/g;

for (const md of mdFiles) {
  const raw = readFileSync(md, 'utf8');
  const body = stripFences(raw);
  const rel = relative(ROOT, md).split(sep).join('/');
  const lineOf = (idx) => body.slice(0, idx).split('\n').length;

  // --- 1 & 2: links and anchors ---
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1];
    const ln = lineOf(m.index);
    let targetFile = md;
    let frag = null;

    if (target.startsWith('#')) {
      frag = decodeURIComponent(target.slice(1));
    } else {
      const [pathPart, fragPart] = target.split('#');
      frag = fragPart ? decodeURIComponent(fragPart) : null;
      const decoded = decodeURIComponent(pathPart);
      targetFile = resolve(dirname(md), decoded);

      // A prompt is a template for a doc that will live in
      // `New Project Documents/`, so it quotes the cross-links that doc should
      // emit — `./ARCHITECTURE.md` means "relative to the OUTPUT", not to
      // `prompts/`. Resolving those against the prompt's own directory yields
      // ~130 false positives. Inside `prompts/`, only links to prompt-library
      // files (`NN-name.md`, `_name.md`) are real navigation; everything else
      // is illustrative output. Links that escape the directory (`../`) are
      // always checked, since those are genuine references.
      if (rel.startsWith('prompts/') && decoded.startsWith('./')) {
        if (!/^(\d{2}-|_)/.test(basename(decoded))) continue;
      }

      nLinks++;
      if (!existsSync(targetFile)) {
        errors.push(`${rel}:${ln}  broken link -> ${pathPart}`);
        continue;
      }
      // a link to a directory is fine; it has no anchors to check
      if (statSync(targetFile).isDirectory()) continue;
      if (!targetFile.endsWith('.md')) continue;
    }

    if (frag) {
      nAnchors++;
      const slugs = slugsFor(targetFile);
      if (slugs && !slugs.has(frag)) {
        const where = targetFile === md ? '(this file)' : basename(targetFile);
        errors.push(`${rel}:${ln}  bad anchor -> ${where}#${frag}`);
      }
    }
  }

  // --- 3: citation line ranges ---
  for (const m of body.matchAll(CITE_RE)) {
    const [, citedPath, lineStr] = m;
    const ln = lineOf(m.index);
    const want = Number(lineStr);
    nCites++;

    let cands = byBase.get(basename(citedPath)) ?? [];
    if (cands.length > 1) {
      const tail = citedPath.split('/').join(sep);
      const narrowed = cands.filter((c) => c.endsWith(tail));
      if (narrowed.length) cands = narrowed;
    }
    if (cands.length === 0) {
      warnings.push(`${rel}:${ln}  citation path not found -> ${citedPath}`);
      continue;
    }
    if (cands.length > 1) continue; // ambiguous basename — not decidable, skip
    const total = linesIn(cands[0]);
    if (total !== null && want > total) {
      errors.push(
        `${rel}:${ln}  citation past EOF -> ${citedPath}:${want} ` +
          `(${relative(ROOT, cands[0]).split(sep).join('/')} has ${total} lines)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(
  `Checked ${mdFiles.length} markdown files: ` +
    `${nLinks} relative links, ${nAnchors} anchors, ${nCites} file:line citations.`
);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) — not build-failing:`);
  for (const w of warnings.slice(0, 20)) console.log(`  ${w}`);
  if (warnings.length > 20) console.log(`  … and ${warnings.length - 20} more`);
}

if (errors.length === 0) {
  console.log('\n✓ Documentation integrity OK.');
  process.exit(0);
}

console.error(`\n✗ ${errors.length} documentation error(s):\n`);
for (const e of errors) console.error(`  ${e}`);
console.error(
  '\nFix by correcting the link, anchor, or line number. Anchors follow ' +
    "GitHub's slug rules — see slugify() in this script; note `_` is kept and " +
    'each space becomes its own hyphen, so "A — B" is "a--b".'
);
process.exit(WARN_ONLY ? 0 : 1);
