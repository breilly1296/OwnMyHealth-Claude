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

// Health Analysis
export {
  performHealthAnalysis,
  getHealthAnalysisResult,
  generateRiskAssessments,
  generateTrendAnalyses,
  detectConditions,
  generateRecommendations,
  generatePriorityActions,
  calculateDeviation,
  mapSeverityToUrgency,
  mapConditionToSpecialty,
  type DecryptedBiomarker,
  type RiskAssessment,
  type TrendAnalysis,
  type HealthAnalysisResult,
  type DetectedCondition,
  type Recommendation,
  type PriorityAction,
  type InternalAnalysis,
} from './healthAnalysisService.js';

// Email Service
export {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  isEmailConfigured,
} from './emailService.js';
