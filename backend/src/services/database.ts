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
 * - Call setRLSContext(userId) before database operations
 * - Call setAdminContext() for system/admin operations
 * - Call clearRLSContext() after operations complete
 * - Use withRLSContext(userId, fn) for automatic context management
 *
 * Exports:
 * - initializeDatabase() - Initialize all database services
 * - disconnectDatabase() - Gracefully close connections
 * - setRLSContext() - Set user context for RLS policies
 * - withRLSContext() - Execute function with RLS context
 *
 * @module services/database
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../utils/logger.js';
import { PrismaClient } from '../../generated/prisma';
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
  pool = new Pool({
    connectionString,
    max: 10, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
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
 * Set RLS context for the current user
 *
 * IMPORTANT: Call this before any database operation that should be
 * restricted by RLS policies. The context is set using PostgreSQL
 * session variables that the RLS policies check.
 *
 * @param userId - The UUID of the current user
 * @param isAdmin - Whether this is an admin session (bypasses most RLS)
 */
export async function setRLSContext(userId: string, isAdmin = false): Promise<void> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  try {
    // Use SET LOCAL so the setting only applies to the current transaction
    // This is safer than SET which persists for the connection
    await prisma.$executeRawUnsafe(
      `SET LOCAL app.current_user_id = '${userId}'`
    );
    await prisma.$executeRawUnsafe(
      `SET LOCAL app.is_admin = '${isAdmin}'`
    );
  } catch (error) {
    logger.error('Failed to set RLS context', {
      data: { userId, error: error instanceof Error ? error.message : String(error) },
      prefix: 'RLS',
    });
    throw error;
  }
}

/**
 * Set admin context for system operations
 *
 * Use this for operations that need to bypass RLS, such as:
 * - System maintenance tasks
 * - Admin dashboard queries
 * - Batch operations across users
 *
 * SECURITY: Only use this when absolutely necessary and ensure
 * proper authorization checks are done before calling this.
 */
export async function setAdminContext(): Promise<void> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  try {
    await prisma.$executeRawUnsafe(`SET LOCAL app.is_admin = 'true'`);
  } catch (error) {
    logger.error('Failed to set admin context', {
      data: { error: error instanceof Error ? error.message : String(error) },
      prefix: 'RLS',
    });
    throw error;
  }
}

/**
 * Clear RLS context
 *
 * Call this after database operations complete to ensure the context
 * doesn't leak to subsequent operations on the same connection.
 */
export async function clearRLSContext(): Promise<void> {
  if (!prisma) return;

  try {
    await prisma.$executeRawUnsafe(`RESET app.current_user_id`);
    await prisma.$executeRawUnsafe(`RESET app.is_admin`);
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Execute a function with RLS context
 *
 * This is the recommended way to use RLS context. It automatically
 * sets the context before the operation and clears it afterward,
 * even if an error occurs.
 *
 * @param userId - The UUID of the current user (null for system operations)
 * @param fn - The async function to execute
 * @param options - Additional options
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const biomarkers = await withRLSContext(userId, async () => {
 *   return prisma.biomarker.findMany();
 * });
 * ```
 */
export async function withRLSContext<T>(
  userId: string | null,
  fn: () => Promise<T>,
  options: { isAdmin?: boolean } = {}
): Promise<T> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  // For system operations (userId is null), use admin context
  const useAdmin = options.isAdmin || userId === null;

  try {
    if (useAdmin) {
      await setAdminContext();
    } else {
      await setRLSContext(userId!, options.isAdmin);
    }

    return await fn();
  } finally {
    await clearRLSContext();
  }
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
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  options: { isAdmin?: boolean } = {}
): Promise<T> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }

  return prisma.$transaction(async (tx) => {
    const useAdmin = options.isAdmin || userId === null;

    if (useAdmin) {
      await tx.$executeRawUnsafe(`SET LOCAL app.is_admin = 'true'`);
    } else {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      await tx.$executeRawUnsafe(`SET LOCAL app.is_admin = '${options.isAdmin || false}'`);
    }

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
  setRLSContext,
  setAdminContext,
  clearRLSContext,
  withRLSContext,
  withRLSTransaction,
};
