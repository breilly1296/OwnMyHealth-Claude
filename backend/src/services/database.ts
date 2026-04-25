/**
 * Database Service
 *
 * Manages database connections and related services using Prisma with PostgreSQL.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - Automatic Prisma adapter configuration
 * - Row-Level Security (RLS) context management
 * - Service initialization (encryption, audit logging)
 * - Health check endpoint support
 * - Graceful shutdown handling
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ RLS FOOTGUN — READ BEFORE TOUCHING ANY CONTROLLER OR SERVICE QUERY.       ║
 * ║                                                                           ║
 * ║ Inside a `withRLSContext(userId, async (tx) => ...)` callback, EVERY      ║
 * ║ Prisma call MUST go through `tx`. If you accidentally call the           ║
 * ║ module-level `prisma` client (`prisma.biomarker.findMany(...)` or        ║
 * ║ `getPrismaClient().biomarker.findMany(...)`), the query runs on a       ║
 * ║ DIFFERENT connection from the pool — one that never received the         ║
 * ║ `SET LOCAL app.current_user_id` that this wrapper issues. The RLS        ║
 * ║ policies then evaluate against NULL and the query silently returns       ║
 * ║ all rows across all users. No error, no warning — just a bypass.         ║
 * ║                                                                           ║
 * ║ The `scripts/check-rls-wrappers.sh` grep-based CI guard (see             ║
 * ║ .github/workflows/ci.yml) fails the build on `prisma.` calls inside      ║
 * ║ controllers and services. Rule: inside any RLS callback, always use     ║
 * ║ `tx.*`. Outside a callback, use `getPrismaClient()` only for bare        ║
 * ║ infra (migrations, health checks). Never mix.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * RLS Usage:
 * - Use withRLSContext(userId, (tx) => ...) for most reads/writes.
 * - Use withRLSTransaction(userId, (tx) => ...) for multi-statement
 *   transactions that must be atomic.
 * - Both wrap the callback in a Prisma transaction and set the
 *   `app.current_user_id` / `app.is_admin` session variables with
 *   `SET LOCAL`, which is only valid inside a transaction.
 *
 * Exports:
 * - initializeDatabase() - Initialize all database services
 * - disconnectDatabase() - Gracefully close connections
 * - withRLSContext() - Execute function with RLS context (single statement-friendly)
 * - withRLSTransaction() - Execute multi-statement transaction with RLS context
 *
 * @module services/database
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../utils/logger.js';
import { PrismaClient, Prisma } from '../../generated/prisma';
import { getAuditLogService, AuditLogService } from './auditLog.js';
import { getEncryptionService, EncryptionService } from './encryption.js';
import { config } from '../config/index.js';

// Parse database URL from environment
function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Handle Prisma Postgres URL format (prisma+postgres://...)
  // or standard PostgreSQL URL (postgres://...)
  if (databaseUrl.startsWith('prisma+postgres://')) {
    // For Prisma Postgres (local dev server), extract the actual postgres URL from the API key
    try {
      const url = new URL(databaseUrl.replace('prisma+postgres://', 'https://'));
      const apiKey = url.searchParams.get('api_key');
      if (apiKey) {
        const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf-8'));
        return decoded.databaseUrl;
      }
    } catch {
      logger.warn('Failed to parse Prisma Postgres URL', { prefix: 'Database' });
    }
    // No fallback - require valid DATABASE_URL
    throw new Error('Invalid Prisma Postgres URL format. Please check DATABASE_URL.');
  }

  return databaseUrl;
}

// Service instances
let prisma: PrismaClient | null = null;
let pool: Pool | null = null;
let auditService: AuditLogService | null = null;
let encryptionService: EncryptionService | null = null;
let isInitialized = false;

/**
 * Create and configure Prisma client with PostgreSQL adapter
 */
function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseConfig();

  // Create PostgreSQL connection pool.
  // Cloud SQL through Auth Proxy needs longer timeouts, especially on cold starts.
  // `max` is env-configurable (DATABASE_POOL_SIZE) so ops can tune per-env:
  //   - Cloud Run: 10 is a reasonable default; each instance handles
  //     concurrent requests, and Cloud SQL has per-instance connection caps.
  //   - Local dev: 5 is fine; tune up only if you hit "all connections busy".
  // Default falls back to 10 — the old `max: 5` was hitting "all connections
  // busy" under burst load.
  pool = new Pool({
    connectionString,
    max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000, // 30s for Cloud SQL Auth Proxy
    statement_timeout: 30000, // 30s statement timeout
  });

  // Create Prisma adapter
  const adapter = new PrismaPg(pool);

  // Create Prisma client with adapter
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });
}

/**
 * Run a startup step that must succeed. On failure, logs a FATAL entry and
 * rethrows with a context-rich message that bubbles up to the process entry
 * point — intentional for a HIPAA-compliant server where partial startup is
 * never acceptable.
 */
async function initStep(
  label: string,
  hint: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`FATAL: ${label} failed`, { data: { error: errorMessage } });
    throw new Error(
      `FATAL: Cannot start server - ${label}.\n${hint}\nError: ${errorMessage}`
    );
  }
}

/**
 * Initialize database connection and related services
 *
 * CRITICAL: Server will NOT start if database is unavailable.
 * This is intentional for a HIPAA-compliant healthcare application.
 */
export async function initializeDatabase(): Promise<void> {
  if (isInitialized) return;

  // Create Prisma client
  prisma = createPrismaClient();
  logger.startup('✓ Prisma client created');

  await initStep(
    'database connection',
    'Ensure DATABASE_URL is correct and PostgreSQL is running.',
    async () => {
      await prisma!.$connect();
      logger.startup('✓ Database connected');
    }
  );

  await initStep(
    'encryption service initialization',
    'Ensure PHI_ENCRYPTION_KEY is set and valid.',
    () => {
      encryptionService = getEncryptionService();
      logger.startup('✓ Encryption service initialized');
    }
  );

  await initStep(
    'audit logging service',
    'HIPAA compliance requires audit logging to be operational.',
    async () => {
      auditService = getAuditLogService(prisma!);
      await auditService.initialize();
    }
  );

  // C-8 PR C — RLS enforcement check. Runs after the connection is alive so
  // we can query pg_roles under the current login. In production this hard-
  // exits if BYPASSRLS=true; in non-prod it warns. See assertNoBypassRLS for
  // the full rationale, and C8_PART3_RUNBOOK.md for the rollout/rollback.
  await assertNoBypassRLS();

  isInitialized = true;
  logger.startup('✓ All database services initialized');
}

/**
 * Fail loud if the DB login has BYPASSRLS. Without this, a forgotten
 * credential rotation back to a superuser silently turns RLS off for
 * every query — application code keeps working, tests keep passing,
 * and tenant isolation quietly collapses.
 *
 * C-8 PR C semantics (post-cutover):
 *   - Production with BYPASSRLS=true → log FATAL and process.exit(1).
 *     There is no opt-out: if the role can bypass RLS in prod, the
 *     deployment is broken and refusing to start is safer than serving
 *     unisolated PHI. The transitional `RLS_ENFORCEMENT=strict` flag
 *     was removed when the omh_app cutover landed.
 *   - Non-production with BYPASSRLS=true → log WARNING and continue.
 *     Dev databases are commonly the superuser; staging may not have
 *     omh_app provisioned yet. The warning makes the unsafe state
 *     audible without blocking the boot.
 *   - Either environment with BYPASSRLS=false → log success and continue.
 */
async function assertNoBypassRLS(): Promise<void> {
  if (!prisma) {
    // Defensive — should be impossible given the caller. A missing client
    // here would also block everything else, so let the normal failure
    // paths surface instead of synthesizing a new one.
    return;
  }

  let bypass: boolean | undefined;
  try {
    const rows = await prisma.$queryRaw<Array<{ rolbypassrls: boolean }>>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    bypass = rows[0]?.rolbypassrls;
  } catch (error) {
    // Network blip / permission error reading pg_roles shouldn't crash
    // boot just because this assertion couldn't run. Log loudly so ops
    // notices, but don't block startup — the existing RLS policies still
    // apply if they were enforced, and the scheduled re-check can catch
    // a genuine mismatch next time.
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('RLS assertion check failed to run', { data: { error: msg } });
    return;
  }

  if (!bypass) {
    logger.startup('✓ RLS assertion passed: database role does not have BYPASSRLS');
    return;
  }

  if (config.isProduction) {
    logger.error(
      'FATAL: Production database role has BYPASSRLS. ' +
      'RLS policies are not enforcing. Refusing to start. ' +
      'See C8_PART3_RUNBOOK.md.'
    );
    process.exit(1);
  }

  logger.warn(
    'WARNING: Database role has BYPASSRLS — RLS policies are not enforcing. ' +
    'This is acceptable in development but must be fixed before production.'
  );
}

/**
 * Gracefully disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
  if (pool) {
    await pool.end();
  }
  isInitialized = false;
  logger.startup('Database disconnected');
}

/**
 * Get Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient();
  }
  return prisma;
}

/**
 * Get audit log service instance
 */
export function getAuditService(): AuditLogService {
  if (!auditService && prisma) {
    auditService = getAuditLogService(prisma);
  }
  return auditService!;
}

/**
 * Get encryption service instance
 */
export function getEncryption(): EncryptionService {
  if (!encryptionService) {
    encryptionService = getEncryptionService();
  }
  return encryptionService;
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  latency?: number;
  error?: string;
}> {
  if (!prisma) {
    return {
      connected: false,
      error: 'Database client not initialized',
    };
  }

  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// ROW-LEVEL SECURITY (RLS) CONTEXT MANAGEMENT
// ============================================

/**
 * UUID format validation regex.
 *
 * With parameterized set_config() the userId is no longer interpolated
 * into SQL, so this is defense-in-depth rather than the primary injection
 * barrier — reject malformed input at the boundary anyway so callers get
 * a clear error instead of a Postgres cast failure deep in the stack.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Apply RLS session variables to a Prisma transaction client.
 *
 * Uses PostgreSQL's `set_config(name, value, is_local=true)` with
 * parameterized queries via `$executeRaw` — no string interpolation,
 * so the userId cannot alter SQL structure regardless of content.
 *
 * Always sets BOTH `app.current_user_id` and `app.is_admin` explicitly
 * (admin → empty-string user id, user → 'false' is_admin). This prevents
 * a pooled connection from carrying a previous request's values into
 * the new transaction — without the explicit write, `SET LOCAL` only
 * overrides one variable per call and the other can linger.
 */
async function applyRLSContext(
  tx: Prisma.TransactionClient,
  userId: string | null,
  isAdmin: boolean
): Promise<void> {
  const userIdValue = userId ?? '';
  const isAdminValue = isAdmin ? 'true' : 'false';
  await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userIdValue}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_admin', ${isAdminValue}, true)`;
}

/**
 * Execute a function with RLS context.
 *
 * Wraps the callback in a Prisma transaction and issues `SET LOCAL
 * app.current_user_id` / `SET LOCAL app.is_admin` on that transaction —
 * `SET LOCAL` is scoped to the current transaction, so without this
 * wrapping the setting is discarded before the callback's queries run
 * and RLS policies evaluate against NULL.
 *
 * IMPORTANT: the callback receives a transaction client (`tx`). Every
 * Prisma call inside MUST go through `tx` — calls against the
 * module-level `prisma` singleton run on a different connection that
 * does NOT carry the SET LOCAL and therefore bypass RLS.
 *
 * For system/admin operations pass `userId = null` (or
 * `options.isAdmin = true`); RLS policies check `is_admin_session()`.
 *
 * @param userId - UUID of the current user (null for system operations)
 * @param fn - Async callback receiving the transaction client
 * @param options - isAdmin / timeout / maxWait overrides
 *
 * @example
 * ```typescript
 * // ✅ correct — queries go through tx
 * const biomarkers = await withRLSContext(userId, async (tx) => {
 *   return tx.biomarker.findMany();
 * });
 *
 * // ❌ WRONG — prisma.* inside the callback bypasses RLS
 * const biomarkers = await withRLSContext(userId, async () => {
 *   return prisma.biomarker.findMany();
 * });
 * ```
 */
interface RLSOptions {
  isAdmin?: boolean;
  timeout?: number;
  maxWait?: number;
}

/**
 * Shared implementation for withRLSContext / withRLSTransaction. Keeps the
 * two named exports (and their distinct defaults/semantics for callers)
 * while centralizing the init check, UUID validation, and SET LOCAL.
 */
async function runWithRLS<T>(
  userId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: RLSOptions,
  txOptions: { maxWait: number; timeout: number } | undefined
): Promise<T> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  const useAdmin = options.isAdmin || userId === null;
  if (!useAdmin && !validateUUID(userId!)) {
    throw new Error('Invalid user ID format: must be a valid UUID');
  }

  const run = async (tx: Prisma.TransactionClient): Promise<T> => {
    await applyRLSContext(tx, useAdmin ? null : userId, useAdmin);
    return fn(tx);
  };

  return txOptions ? prisma.$transaction(run, txOptions) : prisma.$transaction(run);
}

export async function withRLSContext<T>(
  userId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: RLSOptions = {}
): Promise<T> {
  return runWithRLS(userId, fn, options, {
    maxWait: options.maxWait ?? 20_000,
    timeout: options.timeout ?? 30_000,
  });
}

/**
 * Execute a function within a transaction with RLS context
 *
 * Combines RLS context with Prisma transactions for atomic operations.
 *
 * @param userId - The UUID of the current user
 * @param fn - The async function to execute within the transaction
 * @param options - Additional options
 * @returns The result of the function
 */
export async function withRLSTransaction<T>(
  userId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isAdmin?: boolean } = {}
): Promise<T> {
  return runWithRLS(userId, fn, options, undefined);
}

// Export prisma getter for lazy initialization
export { prisma };

export default {
  initializeDatabase,
  disconnectDatabase,
  getPrismaClient,
  getAuditService,
  getEncryption,
  checkDatabaseHealth,
  withRLSContext,
  withRLSTransaction,
};
