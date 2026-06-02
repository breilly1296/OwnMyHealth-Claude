---
tags:
  - meta
  - tools
type: shared
priority: 2
updated: 2026-06-01
---

# Verification Tools (shared)

These prompts were originally written for bash / Linux. The project is developed on **Windows 11** with `bash` shell, so `grep -r` and `find` *work* here — but in Claude Code, the dedicated tools are faster, safer, and already scoped to the repo.

**Default to Claude Code tools. Use Bash only for commands that have no tool equivalent.**

---

## Tool cheat sheet

| Task | Use | Not this |
|---|---|---|
| Find text in code | `Grep` tool | `grep -r`, `rg`, `findstr` |
| Find files by pattern | `Glob` tool | `find`, `ls \| grep` |
| Read a file | `Read` tool | `cat`, `head`, `type` |
| Edit a file | `Edit` tool | `sed`, `awk` |
| Run tests, git, npm | `Bash` tool | — *(legitimate Bash use)* |

The Bash tool still has access to everything; it's just that `Grep`/`Glob` give cleaner, filtered output that costs fewer tokens and runs cross-platform.

---

## Common migrations from old prompts

### "Find all encrypted fields in schema"
Old:
```bash
grep -r "Encrypted" backend/prisma/schema.prisma
```
New: **Grep** with `pattern: "Encrypted"`, `path: "backend/prisma/schema.prisma"`, `output_mode: "content"`.

### "Find files importing the encryption service"
Old:
```bash
grep -r "encrypt\|decrypt" backend/src/controllers/ --include="*.ts" -l
```
New: **Grep** with `pattern: "encrypt|decrypt"`, `glob: "backend/src/controllers/**/*.ts"`, `output_mode: "files_with_matches"`.

### "List all route files"
Old:
```bash
ls backend/src/routes/*.ts
```
New: **Glob** with `pattern: "backend/src/routes/*.ts"`.

### "Find TODOs and FIXMEs"
Old:
```bash
grep -r "TODO\|FIXME\|HACK\|XXX" backend/src/ src/ --include="*.ts" --include="*.tsx"
```
New: **Grep** with `pattern: "TODO|FIXME|HACK|XXX"`, `glob: "**/*.{ts,tsx}"`, `output_mode: "content"`, `-n: true`.

### "Find controllers without audit logging"
Old:
```bash
grep -L "auditLog" backend/src/controllers/*.ts
```
The `-L` flag (files *without* match) isn't a `Grep` output mode. Two-step instead:
1. **Glob** → list all controller files.
2. **Grep** `pattern: "auditLog"`, `glob: "backend/src/controllers/**/*.ts"`, `output_mode: "files_with_matches"`.
3. Diff the two lists.

---

## When Bash is the right answer

- `git log`, `git diff`, `git status` — use **Bash**.
- `npm audit`, `npm outdated`, `npm ls` — use **Bash**.
- `gcloud`, `gsutil`, `kubectl` — use **Bash**.
- Counting hits: `Grep` with `output_mode: "count"` beats `| wc -l`.

---

## Windows-specific caveats

- Shell is `bash` (Git Bash / MSYS), not PowerShell — **use forward slashes** in paths.
- `/dev/null` works; do not use `NUL`.
- `grep -r ... | head -20` works, but prefer `Grep`'s `head_limit` parameter.
- Avoid backtick command substitution in scripts; use `$(...)`.

---

## Review integration

Every prompt under `01-13` and `26-32` has a **Verification Commands** section (or should). When you run that prompt:

1. Read the intended command.
2. Translate to the equivalent Claude Code tool (using this cheat sheet).
3. Execute. Cite `file:line` in your findings per [review protocol](./_review-protocol.md).

If a verification step *must* use Bash (git, npm, gcloud), it's fine — just prefer tools elsewhere.
