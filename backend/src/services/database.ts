/**
 * Database Service
 *
 * Manages database connections and related services using Prisma with PostgreSQL.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - Automatic Prisma adapter configuration
 * - Service initialization (encryption, audit logging)
 * - Health check endpoint support
 * - Graceful shutdown handling
 *
 * Exports:
 * - initializeDatabase() - Initialize all database services
 * - disconnectDatabase() - Gracefully close connections
 *
 * @module services/database
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../utils/logger.js';
import { PrismaClient } from '../generated/prisma';
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
      logger.warn('Failed to parse Prisma Postgres URL, using default connection', { prefix: 'Database' });
    }
    // Fallback to localhost
    return 'postgres://postgres:postgres@localhost:5432/ownmyhealth';
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

// Export prisma getter for lazy initialization
export { prisma };

export default {
  initializeDatabase,
  disconnectDatabase,
  getPrismaClient,
  getAuditService,
  getEncryption,
  checkDatabaseHealth,
};
