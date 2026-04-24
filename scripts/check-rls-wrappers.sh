#!/usr/bin/env bash
#
# check-rls-wrappers.sh — fail CI if any controller/service bypasses RLS.
#
# Inside a withRLSContext / withRLSTransaction callback, all queries must go
# through the `tx` parameter. A bare `prisma.<model>.<method>(` call uses the
# module-level client, which runs on a different connection and silently
# ignores SET LOCAL app.current_user_id — bypassing RLS.
#
# The grep below flags bare `prisma.<model>.<verb>(` calls in controllers
# and services. Lines containing `tx.` or `// RLS-exempt` (intentional
# migration/infra paths) are excluded. Test files are excluded because
# mocks frequently reference the bare client.
#
# To allow a specific call, append `// RLS-exempt: <reason>` on the same line.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# C-8 Part 4 — scope expanded to every directory where app code touches
# Prisma. Controllers and services were the original scope; routes,
# schedulers, and middleware were carved out in the prior version because
# they had pre-existing violations. Those violations were resolved in the
# Part 2 sweep, so this check now enforces the full surface.
TARGETS=(
  "$ROOT_DIR/backend/src/controllers"
  "$ROOT_DIR/backend/src/services"
  "$ROOT_DIR/backend/src/routes"
  "$ROOT_DIR/backend/src/schedulers"
  "$ROOT_DIR/backend/src/middleware"
)

# database.ts legitimately contains `prisma.<model>.<verb>(` in its docblock
# as an ANTI-example. Exclude it — the rest of the file only uses the
# module-level client inside `runWithRLS` itself, which is the definition
# of the wrapper, not a caller of it.
EXCLUDE_FILES=(
  "$ROOT_DIR/backend/src/services/database.ts"
)

# Generic pattern — any `prisma.<model>.<method>(` call, regardless of model
# name. The prior enum-based list went stale every time a model was added or
# renamed (dnaData removal in 2026-04-23 left stale entries here). Matching
# the shape directly is more robust and catches future models automatically.
PATTERN='\bprisma\.[a-zA-Z_][a-zA-Z0-9_]*\.(findMany|findFirst|findUnique|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\('

RAW_HITS=$(grep -rnE "$PATTERN" "${TARGETS[@]}" \
  --include='*.ts' \
  --exclude='*.test.ts' \
  --exclude='*.spec.ts' \
  --exclude-dir='__tests__' \
  2>/dev/null \
  | grep -v 'tx\.' \
  | grep -v '// RLS-exempt' \
  || true)

# Filter out lines from explicitly excluded files.
HITS="$RAW_HITS"
for excl in "${EXCLUDE_FILES[@]}"; do
  HITS=$(echo "$HITS" | grep -vF "$excl" || true)
done

if [ -n "$HITS" ]; then
  echo "::error::RLS bypass detected — use tx.* inside withRLSContext callbacks (see backend/src/services/database.ts header)."
  echo "$HITS"
  exit 1
fi

echo "RLS wrapper check passed."
