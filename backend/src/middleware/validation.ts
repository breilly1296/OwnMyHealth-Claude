import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodIssue } from 'zod';
import { ValidationError } from './errorHandler.js';

/**
 * Validation error detail structure
 */
interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

/**
 * Type guard to check if an error is a ZodError
 */
function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

/**
 * Convert ZodIssue to ValidationErrorDetail
 */
function zodIssueToDetail(issue: ZodIssue): ValidationErrorDetail {
  return {
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  };
}

// ============================================
// String Sanitization Utilities
// ============================================

/**
 * Sanitize string input: trim whitespace, escape HTML special characters
 * Prevents XSS and normalizes input
 */
function sanitizeString(str: string): string {
  return str
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Create a sanitized string schema
 */
const sanitizedString = (minLength = 0, maxLength = 1000) =>
  z.string()
    .min(minLength)
    .max(maxLength)
    .transform(sanitizeString);

/**
 * Create an optional sanitized string schema
 */
const optionalSanitizedString = (maxLength = 1000) =>
  z.string()
    .max(maxLength)
    .transform(sanitizeString)
    .optional();

// ============================================
// Custom Validators
// ============================================

/**
 * DNA rsid format validation
 * Valid formats: rs followed by digits (e.g., rs12345, rs1234567890)
 * Prevents injection attacks through rsid parameter
 */
const rsidRegex = /^rs\d{1,12}$/;

const dnaRsid = z.string()
  .regex(rsidRegex, 'Invalid rsid format. Must be "rs" followed by 1-12 digits (e.g., rs12345)')
  .transform((val) => val.toLowerCase());

/**
 * Email validation with sanitization
 */
const email = z.string()
  .email('Invalid email format')
  .max(255)
  .transform((val) => val.toLowerCase().trim());

/**
 * UUID validation
 */
const uuid = z.string().uuid('Invalid ID format');

/**
 * Password validation with strength requirements
 */
const strongPassword = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character');

/**
 * Date string validation (YYYY-MM-DD or ISO8601)
 */
const dateString = z.string()
  .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date format');

// ============================================
// Generic Validation Middleware Factory
// ============================================

/**
 * Type-safe validation middleware factory with proper generic inference
 *
 * Uses z.infer<T> for output types (after transforms) and z.input<T> for input types.
 * This handles schemas with .transform() that change the type.
 *
 * @param schema - Zod schema to validate against
 * @param source - Request property to validate ('body', 'query', or 'params')
 * @returns Express middleware function
 */
export function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = req[source];
      // Parse returns the output type (after transforms)
      const validated: z.output<TSchema> = schema.parse(data);

      // Replace the source data with validated data
      // Use type assertion for Express Request compatibility
      Object.defineProperty(req, source, {
        value: validated,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      next();
    } catch (error: unknown) {
      // Use type guard for proper Zod error handling
      if (isZodError(error)) {
        const details: ValidationErrorDetail[] = error.errors.map(zodIssueToDetail);
        next(new ValidationError('Validation failed', details));
      } else {
        // Re-throw non-Zod errors
        next(error);
      }
    }
  };
}

// ============================================
// Common Schemas
// ============================================

export const schemas = {
  // Pagination
  pagination: z.object({
    page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
    limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
  }),

  // UUID parameter
  uuidParam: z.object({
    id: uuid,
  }),

  // ============================================
  // Auth Schemas
  // ============================================
  auth: {
    login: z.object({
      email: email,
      password: z.string().min(1, 'Password is required').max(128),
    }),

    register: z.object({
      email: email,
      password: strongPassword,
      firstName: optionalSanitizedString(100),
      lastName: optionalSanitizedString(100),
    }),

    changePassword: z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: strongPassword,
    }),

    forgotPassword: z.object({
      email: email,
    }),

    resetPassword: z.object({
      token: z.string().min(1, 'Reset token is required'),
      newPassword: strongPassword,
    }),

    resendVerification: z.object({
      email: email,
    }),

    verifyEmailQuery: z.object({
      token: z.string().min(1, 'Verification token is required'),
    }),
  },

  // ============================================
  // Biomarker Schemas
  // ============================================
  biomarker: {
    create: z.object({
      name: sanitizedString(1, 100),
      value: z.number().min(0, 'Value must be non-negative'),
      unit: sanitizedString(1, 20),
      category: sanitizedString(1, 50),
      date: dateString,
      normalRange: z.object({
        min: z.number(),
        max: z.number(),
        source: optionalSanitizedString(100),
      }),
      notes: optionalSanitizedString(1000),
      sourceType: z.enum(['MANUAL', 'LAB_UPLOAD', 'EHR_IMPORT', 'DEVICE_SYNC', 'API_IMPORT']).optional(),
      sourceFile: optionalSanitizedString(255),
      extractionConfidence: z.number().min(0).max(1).optional(),
      labName: optionalSanitizedString(200),
    }),

    update: z.object({
      name: sanitizedString(1, 100).optional(),
      value: z.number().min(0).optional(),
      unit: sanitizedString(1, 20).optional(),
      category: sanitizedString(1, 50).optional(),
      date: dateString.optional(),
      normalRange: z.object({
        min: z.number(),
        max: z.number(),
        source: optionalSanitizedString(100),
      }).optional(),
      notes: optionalSanitizedString(1000),
      labName: optionalSanitizedString(200),
      isAcknowledged: z.boolean().optional(),
    }),

    batchCreate: z.object({
      biomarkers: z.array(z.object({
        name: sanitizedString(1, 100),
        value: z.number().min(0),
        unit: sanitizedString(1, 20),
        category: sanitizedString(1, 50),
        date: dateString,
        normalRange: z.object({
          min: z.number(),
          max: z.number(),
          source: optionalSanitizedString(100),
        }),
        notes: optionalSanitizedString(1000),
        sourceType: z.enum(['MANUAL', 'LAB_UPLOAD', 'EHR_IMPORT', 'DEVICE_SYNC', 'API_IMPORT']).optional(),
        labName: optionalSanitizedString(200),
      })).min(1, 'At least one biomarker is required').max(100, 'Maximum 100 biomarkers per batch'),
    }),

    listQuery: z.object({
      category: z.string().optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
    }),
  },

  // ============================================
  // Insurance Schemas
  // ============================================
  insurancePlan: {
    create: z.object({
      planName: sanitizedString(1, 200),
      insurerName: sanitizedString(1, 200),
      planType: z.enum(['HMO', 'PPO', 'EPO', 'POS', 'HDHP']),
      memberId: optionalSanitizedString(100),
      groupNumber: optionalSanitizedString(100),
      effectiveDate: dateString,
      terminationDate: dateString.optional(),
      premium: z.number().min(0).optional(),
      deductible: z.number().min(0),
      deductibleFamily: z.number().min(0).optional(),
      outOfPocketMax: z.number().min(0),
      outOfPocketMaxFamily: z.number().min(0).optional(),
      isActive: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
      benefits: z.array(z.object({
        serviceName: sanitizedString(1, 200),
        serviceCategory: sanitizedString(1, 100),
        inNetworkCoverage: z.object({
          covered: z.boolean(),
          copay: z.number().min(0).optional(),
          coinsurance: z.number().min(0).max(100).optional(),
          deductibleApplies: z.boolean().optional(),
        }),
        outNetworkCoverage: z.object({
          covered: z.boolean(),
          copay: z.number().min(0).optional(),
          coinsurance: z.number().min(0).max(100).optional(),
          deductibleApplies: z.boolean().optional(),
        }).optional(),
        limitations: optionalSanitizedString(500),
        preAuthRequired: z.boolean().optional(),
      })).optional(),
    }),

    update: z.object({
      planName: sanitizedString(1, 200).optional(),
      insurerName: sanitizedString(1, 200).optional(),
      planType: z.enum(['HMO', 'PPO', 'EPO', 'POS', 'HDHP']).optional(),
      memberId: optionalSanitizedString(100),
      groupNumber: optionalSanitizedString(100),
      effectiveDate: dateString.optional(),
      terminationDate: dateString.optional(),
      premium: z.number().min(0).optional(),
      deductible: z.number().min(0).optional(),
      deductibleFamily: z.number().min(0).optional(),
      outOfPocketMax: z.number().min(0).optional(),
      outOfPocketMaxFamily: z.number().min(0).optional(),
      isActive: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
    }),
  },

  // ============================================
  // DNA Schemas
  // ============================================
  dna: {
    upload: z.object({
      filename: sanitizedString(1, 255),
      source: z.enum(['23andMe', 'AncestryDNA', 'MyHeritage', 'FamilyTreeDNA', 'Other']),
      fileData: z.string().min(1, 'File data is required'), // Base64 encoded
    }),

    variantQuery: z.object({
      rsid: dnaRsid.optional(),
      chromosome: z.string().regex(/^(chr)?([1-9]|1[0-9]|2[0-2]|X|Y|MT)$/i, 'Invalid chromosome').optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '50', 10)), 500)),
    }),

    rsidParam: z.object({
      rsid: dnaRsid,
    }),

    traitQuery: z.object({
      category: z.string().optional(),
      riskLevel: z.enum(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']).optional(),
    }),
  },

  // ============================================
  // Health Needs Schemas
  // ============================================
  healthNeed: {
    create: z.object({
      needType: z.enum(['CONDITION', 'ACTION', 'SERVICE', 'MEDICATION', 'LIFESTYLE']),
      name: sanitizedString(1, 200),
      description: sanitizedString(1, 2000),
      urgency: z.enum(['IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE']),
      relatedBiomarkerIds: z.array(uuid).optional(),
      notes: optionalSanitizedString(1000),
      actionPlan: optionalSanitizedString(2000),
    }),

    update: z.object({
      name: sanitizedString(1, 200).optional(),
      description: sanitizedString(1, 2000).optional(),
      urgency: z.enum(['IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE']).optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
      relatedBiomarkerIds: z.array(uuid).optional(),
      notes: optionalSanitizedString(1000),
      actionPlan: optionalSanitizedString(2000),
    }),

    listQuery: z.object({
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
      urgency: z.enum(['IMMEDIATE', 'URGENT', 'FOLLOW_UP', 'ROUTINE']).optional(),
      needType: z.enum(['CONDITION', 'ACTION', 'SERVICE', 'MEDICATION', 'LIFESTYLE']).optional(),
    }),
  },

  // ============================================
  // Health Goals Schemas
  // ============================================
  healthGoal: {
    create: z.object({
      name: sanitizedString(1, 200),
      description: optionalSanitizedString(1000),
      category: z.enum(['WEIGHT', 'FITNESS', 'NUTRITION', 'BIOMARKER', 'MEDICATION', 'LIFESTYLE', 'MENTAL_HEALTH', 'OTHER']),
      targetValue: z.number(),
      currentValue: z.number().optional(),
      unit: sanitizedString(1, 50),
      direction: z.enum(['INCREASE', 'DECREASE', 'MAINTAIN']),
      relatedBiomarkerId: uuid.optional(),
      startDate: dateString,
      targetDate: dateString,
      milestones: z.array(z.object({
        value: z.number(),
        label: sanitizedString(1, 100),
      })).optional(),
      reminderFrequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
    }),

    update: z.object({
      name: sanitizedString(1, 200).optional(),
      description: optionalSanitizedString(1000),
      targetValue: z.number().optional(),
      currentValue: z.number().optional(),
      targetDate: dateString.optional(),
      status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'ABANDONED']).optional(),
      milestones: z.array(z.object({
        value: z.number(),
        label: sanitizedString(1, 100),
        achieved: z.boolean().optional(),
        achievedAt: dateString.optional(),
      })).optional(),
      reminderFrequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).nullable().optional(),
    }),

    updateProgress: z.object({
      value: z.number(),
      note: optionalSanitizedString(500),
    }),

    listQuery: z.object({
      status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'ABANDONED']).optional(),
      category: z.enum(['WEIGHT', 'FITNESS', 'NUTRITION', 'BIOMARKER', 'MEDICATION', 'LIFESTYLE', 'MENTAL_HEALTH', 'OTHER']).optional(),
    }),
  },

  // ============================================
  // Provider-Patient Relationship Schemas
  // ============================================
  providerPatient: {
    request: z.object({
      patientEmail: email,
      relationshipType: z.enum(['PRIMARY_CARE', 'SPECIALIST', 'CONSULTANT', 'EMERGENCY', 'OTHER']).optional(),
      message: optionalSanitizedString(500),
    }),

    approve: z.object({
      canViewBiomarkers: z.boolean().optional().default(true),
      canViewInsurance: z.boolean().optional().default(false),
      canViewDna: z.boolean().optional().default(false),
      canViewHealthNeeds: z.boolean().optional().default(true),
      canEditData: z.boolean().optional().default(false),
      consentDurationDays: z.number().min(1).max(365).optional(),
    }),

    updatePermissions: z.object({
      canViewBiomarkers: z.boolean().optional(),
      canViewInsurance: z.boolean().optional(),
      canViewDna: z.boolean().optional(),
      canViewHealthNeeds: z.boolean().optional(),
      canEditData: z.boolean().optional(),
    }),
  },

  // ============================================
  // Admin Schemas
  // ============================================
  admin: {
    createUser: z.object({
      email: email,
      password: strongPassword,
      role: z.enum(['PATIENT', 'PROVIDER', 'ADMIN']).optional().default('PATIENT'),
      isActive: z.boolean().optional().default(true),
      emailVerified: z.boolean().optional().default(false),
    }),

    updateUser: z.object({
      role: z.enum(['PATIENT', 'PROVIDER', 'ADMIN']).optional(),
      isActive: z.boolean().optional(),
      emailVerified: z.boolean().optional(),
      password: strongPassword.optional(),
    }),

    listUsersQuery: z.object({
      role: z.enum(['PATIENT', 'PROVIDER', 'ADMIN']).optional(),
      isActive: z.string().transform((val) => val === 'true').optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
      search: z.string().max(100).optional(),
    }),

    auditLogQuery: z.object({
      userId: uuid.optional(),
      action: z.string().optional(),
      resourceType: z.string().optional(),
      startDate: dateString.optional(),
      endDate: dateString.optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '50', 10)), 200)),
    }),
  },
};

// ============================================
// Type Inference Helpers
// ============================================

export type BiomarkerCreateInput = z.infer<typeof schemas.biomarker.create>;
export type BiomarkerUpdateInput = z.infer<typeof schemas.biomarker.update>;
export type BiomarkerBatchInput = z.infer<typeof schemas.biomarker.batchCreate>;
export type InsurancePlanCreateInput = z.infer<typeof schemas.insurancePlan.create>;
export type InsurancePlanUpdateInput = z.infer<typeof schemas.insurancePlan.update>;
export type LoginInput = z.infer<typeof schemas.auth.login>;
export type RegisterInput = z.infer<typeof schemas.auth.register>;
export type HealthNeedCreateInput = z.infer<typeof schemas.healthNeed.create>;
export type HealthNeedUpdateInput = z.infer<typeof schemas.healthNeed.update>;
export type HealthGoalCreateInput = z.infer<typeof schemas.healthGoal.create>;
export type HealthGoalUpdateInput = z.infer<typeof schemas.healthGoal.update>;
export type DNAUploadInput = z.infer<typeof schemas.dna.upload>;
