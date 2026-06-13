import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { PHI_FIELDS } from './encryption.js';

/**
 * PHI_FIELDS ↔ schema.prisma coverage guard.
 *
 * Encryption in this codebase is applied BY HAND: a developer must (a) call
 * encryptionService.encrypt() at each write site and (b) register the column in
 * the PHI_FIELDS map (encryption.ts). Nothing keys off the `*Encrypted` naming
 * convention automatically, and PHI_FIELDS is the documented source of truth
 * that iteration-based sweeps (export, deletion, admin redaction, audit) and
 * security reviews rely on. So a new `*Encrypted` column that someone forgot to
 * add to PHI_FIELDS would drift silently.
 *
 * This test turns that hand-sync rule from aspirational into ENFORCED: it parses
 * the Prisma schema, extracts every `*Encrypted` field per model, and asserts an
 * exact two-way match against PHI_FIELDS — failing the build on drift in either
 * direction.
 *
 * Scope: this catches PHI_FIELDS *registry* drift. It cannot prove a value is
 * actually encrypted at its controller write site — that remains a manual code
 * review item (see the PHI encryption checklist in CLAUDE.md).
 */

const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../prisma/schema.prisma'
);

/** Parse schema.prisma into { ModelName: Set<encryptedFieldName> }. */
function encryptedFieldsBySchemaModel(): Record<string, Set<string>> {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const result: Record<string, Set<string>> = {};
  let currentModel: string | null = null;

  // Line-based scan rather than a single `model {...}` regex: Prisma model
  // bodies can contain `}` inside default values (e.g. `@default("{}")`), which
  // would truncate a non-greedy brace match. Prisma always puts a model's
  // closing brace on its own line, so we track boundaries line by line. `enum`
  // and composite `type` blocks never enter model mode (we anchor on `model`).
  for (const rawLine of schema.split('\n')) {
    const line = rawLine.trim();

    if (currentModel === null) {
      const modelStart = line.match(/^model\s+(\w+)\s*\{/);
      if (modelStart) {
        currentModel = modelStart[1];
      }
      continue;
    }

    if (line === '}') {
      currentModel = null;
      continue;
    }

    // Encrypted *ciphertext* columns are always typed `String`. The String
    // filter intentionally excludes flags like SystemConfig.isEncrypted (a
    // Boolean) that end in "Encrypted" but hold no PHI.
    const fieldMatch = line.match(/^(\w+Encrypted)\s+String\b/);
    if (fieldMatch) {
      (result[currentModel] ??= new Set<string>()).add(fieldMatch[1]);
    }
  }
  return result;
}

/** Parse EVERY scalar field name per model (not just *Encrypted ones). */
function allFieldsBySchemaModel(): Record<string, Set<string>> {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const result: Record<string, Set<string>> = {};
  let currentModel: string | null = null;

  for (const rawLine of schema.split('\n')) {
    const line = rawLine.trim();
    if (currentModel === null) {
      const modelStart = line.match(/^model\s+(\w+)\s*\{/);
      if (modelStart) currentModel = modelStart[1];
      continue;
    }
    if (line === '}') {
      currentModel = null;
      continue;
    }
    // A field line is `<name> <Type>...`. Skip block attributes (@@index) and
    // comments (//); relation/scalar fields both start with a word + a type.
    const fieldMatch = line.match(/^(\w+)\s+\w/);
    if (fieldMatch) {
      (result[currentModel] ??= new Set<string>()).add(fieldMatch[1]);
    }
  }
  return result;
}

/**
 * M5: value-bearing PHI columns that MUST be encrypted at rest. The
 * `*Encrypted`-only scan above is blind to PHI stored in a PLAINTEXT column
 * with no encrypted twin — exactly the gap that left HealthGoal.current_value /
 * start_value and GoalProgressHistory.value in the clear next to an encrypted
 * goal description. This explicit registry (the security control: adding a new
 * PHI value column forces an entry here) is asserted to have a `<col>Encrypted`
 * sibling, so re-introducing a plaintext-only PHI value fails the build.
 */
const PLAINTEXT_PHI_REQUIRING_TWIN: Record<string, string[]> = {
  HealthGoal: ['targetValue', 'currentValue', 'startValue'],
  GoalProgressHistory: ['value'],
};

describe('PHI_FIELDS coverage vs schema.prisma', () => {
  const schemaModels = encryptedFieldsBySchemaModel();
  const phiFields = PHI_FIELDS as Record<string, readonly string[]>;

  it('parses at least one *Encrypted column from the schema (parser sanity)', () => {
    expect(Object.keys(schemaModels).length).toBeGreaterThan(0);
  });

  it('every *Encrypted column in schema.prisma is registered in PHI_FIELDS', () => {
    const missing: string[] = [];
    for (const [model, fields] of Object.entries(schemaModels)) {
      const registered = new Set(phiFields[model] ?? []);
      for (const field of fields) {
        if (!registered.has(field)) {
          missing.push(`${model}.${field}`);
        }
      }
    }
    expect(
      missing,
      `Encrypted column(s) missing from PHI_FIELDS — add them to encryption.ts so ` +
        `export/deletion/redaction sweeps and audits cover them: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every PHI_FIELDS entry maps to a real *Encrypted column in the schema', () => {
    const stale: string[] = [];
    for (const [model, fields] of Object.entries(phiFields)) {
      const inSchema = schemaModels[model] ?? new Set<string>();
      for (const field of fields) {
        if (!inSchema.has(field)) {
          stale.push(`${model}.${field}`);
        }
      }
    }
    expect(
      stale,
      `PHI_FIELDS entr(ies) with no matching schema column (stale — fix ` +
        `encryption.ts or the schema): ${stale.join(', ')}`
    ).toEqual([]);
  });

  it('every value-bearing PHI column has an encrypted twin (M5 — plaintext-PHI guard)', () => {
    const allFields = allFieldsBySchemaModel();
    const missing: string[] = [];
    for (const [model, cols] of Object.entries(PLAINTEXT_PHI_REQUIRING_TWIN)) {
      const fields = allFields[model] ?? new Set<string>();
      for (const col of cols) {
        if (!fields.has(`${col}Encrypted`)) {
          missing.push(`${model}.${col} (no ${col}Encrypted column)`);
        }
      }
    }
    expect(
      missing,
      `PHI value column(s) stored in plaintext with no encrypted twin — add a ` +
        `<col>Encrypted column + encrypt at the write site, or this is a PHI leak: ` +
        `${missing.join(', ')}`
    ).toEqual([]);
  });
});
