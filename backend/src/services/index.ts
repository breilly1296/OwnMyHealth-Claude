/**
 * Services Index
 *
 * Central export point for all backend services.
 *
 * Services:
 * - Database: Prisma client and connection management
 * - Encryption: PHI encryption/decryption (AES-256-GCM)
 * - Audit Logging: HIPAA-compliant access logging
 * - Health Analysis: Biomarker analysis and health scoring
 * - CMS Marketplace: Healthcare.gov API integration
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

// CMS Marketplace API (Healthcare.gov)
export {
  getCMSMarketplaceService,
  type CMSCounty,
  type CMSPlanSearchParams,
  type CMSPlan,
  type CMSDeductible,
  type CMSMoop,
  type CMSBenefit,
  type CMSCostSharing,
  type CMSPlanSearchResponse,
  type CMSFacetGroup,
  type TransformedPlan,
  type TransformedBenefit,
  type MarketplacePlanSearchResult,
} from './cmsMarketplaceService.js';
