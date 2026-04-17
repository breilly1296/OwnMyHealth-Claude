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

  // Create PostgreSQL connection pool
  // Cloud SQL through Auth Proxy needs longer timeouts, especially on cold starts
  pool = new Pool({
    connectionString,
    max: 5, // Reduced for Cloud Run (limited resources per instance)
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

  // Test database connection - MUST succeed
  try {
    await prisma.$connect();
    logger.startup('✓ Database connected');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('FATAL: Database connection failed', { data: { error: errorMessage } });
    throw new Error(
      `FATAL: Cannot start server - database is unavailable.\n` +
      `Ensure DATABASE_URL is correct and PostgreSQL is running.\n` +
      `Error: ${errorMessage}`
    );
  }

  // Initialize encryption service - MUST succeed
  try {
    encryptionService = getEncryptionService();
    logger.startup('✓ Encryption service initialized');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('FATAL: Encryption service initialization failed', { data: { error: errorMessage } });
    throw new Error(
      `FATAL: Cannot start server - encryption service failed to initialize.\n` +
      `Ensure PHI_ENCRYPTION_KEY is set and valid.\n` +
      `Error: ${errorMessage}`
    );
  }

  // Initialize audit logging service - MUST succeed for HIPAA compliance
  try {
    auditService = getAuditLogService(prisma);
    await auditService.initialize();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('FATAL: Audit logging service initialization failed', { data: { error: errorMessage } });
    throw new Error(
      `FATAL: Cannot start server - audit logging service failed.\n` +
      `HIPAA compliance requires audit logging to be operational.\n` +
      `Error: ${errorMessage}`
    );
  }

  isInitialized = true;
  logger.startup('✓ All database services initialized');
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
export async function withRLSContext<T>(
  userId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isAdmin?: boolean; timeout?: number; maxWait?: number } = {}
): Promise<T> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  const useAdmin = options.isAdmin || userId === null;

  if (!useAdmin && !validateUUID(userId!)) {
    throw new Error('Invalid user ID format: must be a valid UUID');
  }

  return prisma.$transaction(
    async (tx) => {
      await applyRLSContext(tx, useAdmin ? null : userId, useAdmin);
      return fn(tx);
    },
    {
      maxWait: options.maxWait ?? 5_000,
      timeout: options.timeout ?? 15_000,
    }
  );
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
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  const useAdmin = options.isAdmin || userId === null;

  if (!useAdmin && !validateUUID(userId!)) {
    throw new Error('Invalid user ID format: must be a valid UUID');
  }

  return prisma.$transaction(async (tx) => {
    await applyRLSContext(tx, useAdmin ? null : userId, useAdmin);
    return fn(tx);
  });
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
