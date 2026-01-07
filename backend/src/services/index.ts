/**
 * Services Index
 *
 * Central export point for all backend services.
 *
 * Services:
 * - Database: Prisma client, connection management, RLS context
 * - Encryption: PHI encryption/decryption (AES-256-GCM)
 * - Audit Logging: SOC 2-compliant access logging
 *
 * @module services/index
 */

// Database, Prisma, and RLS
export {
  initializeDatabase,
  disconnectDatabase,
  getPrismaClient,
  getAuditService,
  getEncryption,
  checkDatabaseHealth,
  // RLS context management
  setRLSContext,
  setAdminContext,
  clearRLSContext,
  withRLSContext,
  withRLSTransaction,
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

// OCR Service (Google Document AI)
export {
  processDocument,
  checkOCRConfiguration,
  extractDateFromText,
  extractLabNameFromText,
} from './ocrService.js';

// Biomarker Patterns
export {
  BONE_HEALTH_BIOMARKERS,
  extractBiomarkersFromText,
  validateBiomarkerValue,
  normalizeUnit,
} from './biomarkerPatterns.js';
