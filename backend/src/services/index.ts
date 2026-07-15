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
  // RLS context management — callbacks receive a Prisma transaction client
  // (`tx`). Queries MUST go through `tx`, not the `prisma` singleton.
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

// Biomarker Patterns and Data
export {
  BONE_HEALTH_BIOMARKERS,
  normalizeUnit,
} from './biomarkerPatterns.js';

// Biomarker Extraction
export {
  extractBiomarkersFromText,
  validateBiomarkerValue,
} from './biomarkerExtractor.js';

// Storage Service (backend-selecting façade: GCS or encrypted local disk — OF-23)
export {
  storageService,
  uploadFile,
  deleteFile,
  fileExists,
} from './storageService.js';
