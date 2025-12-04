/**
 * Services Index
 *
 * Central export point for all backend services.
 *
 * Services:
 * - Database: Prisma client and connection management
 * - Encryption: PHI encryption/decryption (AES-256-GCM)
 * - Audit Logging: HIPAA-compliant access logging
 *
 * @module services/index
 */

// Database and Prisma
export {
  initializeDatabase,
  disconnectDatabase,
  getPrismaClient,
  getAuditService,
  getEncryption,
  checkDatabaseHealth,
} from './database.js';

// Encryption
export {
  EncryptionService,
  getEncryptionService,
  PHI_FIELDS,
} from './encryption.js';

// Audit Logging
export {
  AuditLogService,
  getAuditLogService,
} from './auditLog.js';
