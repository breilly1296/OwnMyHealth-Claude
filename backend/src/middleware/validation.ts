import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodIssue } from 'zod';
import { ValidationError, BadRequestError } from './errorHandler.js';

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
 * Sanitize string input for LLM prompt interpolation.
 * Strips control characters, collapses excessive newlines, and enforces a length cap
 * to prevent prompt injection attacks.
 */
export function sanitizeForPrompt(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')   // Strip control characters
    .replace(/\n{2,}/g, '\n')           // Collapse multiple newlines
    .substring(0, 200);                  // Hard length cap
}

/**
 * Finite number schema — rejects Infinity and -Infinity.
 * Use instead of z.number() for any numeric field with bounds.
 */
const finiteNumber = z.number().refine(v => Number.isFinite(v), { message: 'Must be a finite number' });

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

/**
 * Create a prompt-safe string schema for values interpolated into LLM prompts.
 * Applies sanitizeForPrompt (control char stripping, newline collapsing, length cap).
 */
const promptSafeString = (minLength = 0, maxLength = 200) =>
  z.string()
    .min(minLength)
    .max(maxLength)
    .transform(sanitizeForPrompt);

// ============================================
// Custom Validators
// ============================================

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
  .min(12, 'Password must be at least 12 characters')
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
// Content-Type Validation Middleware
// ============================================

/**
 * Middleware to validate Content-Type header for JSON requests
 * Ensures POST/PUT/PATCH requests have application/json content type
 * Skips validation for multipart/form-data (file uploads)
 */
export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  const methods = ['POST', 'PUT', 'PATCH'];

  if (!methods.includes(req.method)) {
    return next();
  }

  const contentType = req.get('Content-Type') || '';

  // Skip for multipart (file uploads) - they have their own content type
  if (contentType.includes('multipart/form-data')) {
    return next();
  }

  // Skip for empty bodies (some DELETE requests may include body)
  if (!req.body || Object.keys(req.body).length === 0) {
    return next();
  }

  // Require JSON content type for requests with body
  if (!contentType.includes('application/json')) {
    throw new BadRequestError(
      'Content-Type must be application/json for requests with body'
    );
  }

  next();
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

  // UUID parameter (for :id routes)
  uuidParam: z.object({
    id: uuid,
  }),

  // UUID parameter for routes using :connectionId (FHIR sync)
  connectionIdParam: z.object({
    connectionId: uuid,
  }),

  // Patient ID parameter (for :patientId routes)
  patientIdParam: z.object({
    patientId: uuid,
  }),

  // User ID parameter (for :userId routes in admin)
  userIdParam: z.object({
    userId: uuid,
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

    changeEmail: z.object({
      newEmail: email,
      currentPassword: z.string().min(1, 'Current password is required'),
    }),

    confirmEmailChangeQuery: z.object({
      token: z.string().min(1, 'Confirmation token is required'),
    }),
  },

  // ============================================
  // Biomarker Schemas
  // ============================================
  biomarker: {
    create: z.object({
      name: sanitizedString(1, 100),
      value: finiteNumber.pipe(z.number().min(0, 'Value must be non-negative')),
      unit: sanitizedString(1, 20),
      category: sanitizedString(1, 50),
      date: dateString,
      normalRange: z.object({
        min: finiteNumber,
        max: finiteNumber,
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

    guidance: z.object({
      biomarker: z.object({
        name: promptSafeString(1, 100),
        value: z.number(),
        unit: promptSafeString(1, 20),
        normalRange: z.object({
          min: z.number().optional(),
          max: z.number().optional(),
        }).optional(),
        status: promptSafeString(1, 30),
        history: z.array(z.object({
          value: z.number(),
          date: z.string().max(30),
        })).max(10).optional(),
      }),
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
      planIdNumber: optionalSanitizedString(100),
      memberId: optionalSanitizedString(100),
      groupNumber: optionalSanitizedString(100),
      effectiveDate: dateString,
      terminationDate: dateString.optional(),
      premium: finiteNumber.pipe(z.number().min(0)).optional(),
      deductible: finiteNumber.pipe(z.number().min(0)),
      deductibleFamily: finiteNumber.pipe(z.number().min(0)).optional(),
      outOfPocketMax: finiteNumber.pipe(z.number().min(0)),
      outOfPocketMaxFamily: finiteNumber.pipe(z.number().min(0)).optional(),
      // Tracking fields (how much has been paid toward limits)
      deductibleMetIndividual: finiteNumber.pipe(z.number().min(0)).optional(),
      deductibleMetFamily: finiteNumber.pipe(z.number().min(0)).optional(),
      oopMetIndividual: finiteNumber.pipe(z.number().min(0)).optional(),
      oopMetFamily: finiteNumber.pipe(z.number().min(0)).optional(),
      // Copay amounts
      copayPrimaryCare: finiteNumber.pipe(z.number().min(0)).optional(),
      copaySpecialist: finiteNumber.pipe(z.number().min(0)).optional(),
      copayUrgentCare: finiteNumber.pipe(z.number().min(0)).optional(),
      copayEmergency: finiteNumber.pipe(z.number().min(0)).optional(),
      coinsuranceRate: finiteNumber.pipe(z.number().min(0).max(100)).optional(),
      isActive: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
      benefits: z.array(z.object({
        serviceName: sanitizedString(1, 200),
        serviceCategory: sanitizedString(1, 100),
        inNetworkCoverage: z.object({
          covered: z.boolean(),
          copay: finiteNumber.pipe(z.number().min(0)).optional(),
          coinsurance: finiteNumber.pipe(z.number().min(0).max(100)).optional(),
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
      planIdNumber: optionalSanitizedString(100),
      memberId: optionalSanitizedString(100),
      groupNumber: optionalSanitizedString(100),
      effectiveDate: dateString.optional(),
      terminationDate: dateString.optional(),
      premium: z.number().min(0).optional(),
      deductible: z.number().min(0).optional(),
      deductibleFamily: z.number().min(0).optional(),
      outOfPocketMax: z.number().min(0).optional(),
      outOfPocketMaxFamily: z.number().min(0).optional(),
      // Tracking fields (how much has been paid toward limits)
      deductibleMetIndividual: z.number().min(0).optional(),
      deductibleMetFamily: z.number().min(0).optional(),
      oopMetIndividual: z.number().min(0).optional(),
      oopMetFamily: z.number().min(0).optional(),
      // Copay amounts
      copayPrimaryCare: z.number().min(0).optional(),
      copaySpecialist: z.number().min(0).optional(),
      copayUrgentCare: z.number().min(0).optional(),
      copayEmergency: z.number().min(0).optional(),
      coinsuranceRate: z.number().min(0).max(100).optional(),
      isActive: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
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
      // Pagination — see healthGoal.listQuery for the rationale.
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
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
      status: z.enum(['ACTIVE', 'PAUSED', 'ACHIEVED', 'FAILED', 'CANCELLED']).optional(),
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
      status: z.enum(['ACTIVE', 'PAUSED', 'ACHIEVED', 'FAILED', 'CANCELLED']).optional(),
      category: z.enum(['WEIGHT', 'FITNESS', 'NUTRITION', 'BIOMARKER', 'MEDICATION', 'LIFESTYLE', 'MENTAL_HEALTH', 'OTHER']).optional(),
      // Pagination — clamped here so Prisma never sees unbounded take.
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
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
      canViewHealthNeeds: z.boolean().optional().default(true),
      canEditData: z.boolean().optional().default(false),
      consentDurationDays: z.number().min(1).max(365).optional(),
    }),

    updatePermissions: z.object({
      canViewBiomarkers: z.boolean().optional(),
      canViewInsurance: z.boolean().optional(),
      canViewHealthNeeds: z.boolean().optional(),
      canEditData: z.boolean().optional(),
    }),
  },

  // ============================================
  // Expense Schemas
  // ============================================
  expense: {
    createProjection: z.object({
      planId: uuid,
      serviceType: sanitizedString(1, 100),
      estimatedCost: finiteNumber.pipe(z.number().positive().max(999999.99)),
      frequencyPerYear: finiteNumber.pipe(z.number().int().min(1).max(365)),
      isInNetwork: z.boolean().optional(),
      notes: optionalSanitizedString(2000),
    }),

    updateProjection: z.object({
      serviceType: sanitizedString(1, 100).optional(),
      estimatedCost: finiteNumber.pipe(z.number().positive().max(999999.99)).optional(),
      frequencyPerYear: finiteNumber.pipe(z.number().int().min(1).max(365)).optional(),
      isInNetwork: z.boolean().optional(),
      notes: optionalSanitizedString(2000),
    }),

    analyzeCosts: z.object({
      planId: uuid,
    }),

    projectionsQuery: z.object({
      planId: uuid.optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
    }),

    analysesQuery: z.object({
      planId: uuid.optional(),
    }),

    // --- Expense Actuals ---
    createActual: z.object({
      planId: uuid,
      projectionId: uuid.optional(),
      serviceType: sanitizedString(1, 100),
      serviceDate: dateString.optional(),
      providerName: optionalSanitizedString(200),
      billedAmount: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      insurancePaid: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      patientPaid: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      appliedToDeductible: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      appliedToOop: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      isInNetwork: z.boolean().optional(),
      claimStatus: z.enum(['pending', 'processed', 'denied', 'appealed']).optional(),
      notes: optionalSanitizedString(2000),
    }),

    updateActual: z.object({
      projectionId: uuid.nullable().optional(),
      serviceType: sanitizedString(1, 100).optional(),
      serviceDate: dateString.optional(),
      providerName: optionalSanitizedString(200),
      billedAmount: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      insurancePaid: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      patientPaid: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      appliedToDeductible: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      appliedToOop: finiteNumber.pipe(z.number().min(0).max(999999.99)).optional(),
      isInNetwork: z.boolean().optional(),
      claimStatus: z.enum(['pending', 'processed', 'denied', 'appealed']).optional(),
      notes: optionalSanitizedString(2000),
    }),

    actualsQuery: z.object({
      planId: uuid.optional(),
      page: z.string().optional().transform((val) => Math.max(1, parseInt(val || '1', 10))),
      limit: z.string().optional().transform((val) => Math.min(Math.max(1, parseInt(val || '20', 10)), 100)),
    }),

    // PUT /insurance/plans/:id/spending — writes into Decimal PHI columns
    // (deductibleMetIndividual / oopMetIndividual), so reject non-numeric,
    // negative, NaN/Infinity, and over-precision values at the boundary.
    updateSpending: z.object({
      deductibleMet: finiteNumber.pipe(z.number().min(0).max(999999.99)),
      oopMet: finiteNumber.pipe(z.number().min(0).max(999999.99)),
    }),
  },

  // ============================================
  // AI Chat (Health Guide)
  // ============================================
  ai: {
    chat: z.object({
      message: z.string().min(1).max(2000),
      conversationHistory: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(5000),
          })
        )
        .max(20)
        .optional(),
    }),
  },

  // ============================================
  // Settings Schemas
  // ============================================
  settings: {
    updateProfile: z.object({
      firstName: optionalSanitizedString(100),
      lastName: optionalSanitizedString(100),
    }).refine(
      (data) => data.firstName !== undefined || data.lastName !== undefined,
      { message: 'At least one field (firstName or lastName) must be provided' }
    ),

    updateNotifications: z.object({
      // Legacy flat-key inputs — kept for back-compat with existing toggles.
      emailNotifications: z.boolean().optional(),
      weeklySummary: z.boolean().optional(),
      abnormalAlerts: z.boolean().optional(),
      // New nested shape — any combination of email.* boolean fields.
      email: z.object({
        enabled: z.boolean().optional(),
        newResults: z.boolean().optional(),
        outOfRangeAlerts: z.boolean().optional(),
        goalReminders: z.boolean().optional(),
        weeklySummary: z.boolean().optional(),
        planExpiring: z.boolean().optional(),
      }).refine(
        (data) => Object.keys(data).length > 0,
        { message: 'email: at least one field must be provided' }
      ).optional(),
    }).refine(
      (data) => Object.keys(data).length > 0,
      { message: 'At least one notification preference must be provided' }
    ),

    deleteData: z.object({
      password: z.string().min(1, 'Password is required'),
    }),

    // Mirrors deleteData. Both endpoints irreversibly destroy PHI; both
    // must require explicit re-auth via password (not just session cookie).
    deleteAccount: z.object({
      password: z.string().min(1, 'Password is required'),
    }),

    updateHealthProfile: z.object({
      biologicalSex: z.enum(['male', 'female']).optional(),
      ageRange: z.enum(['18-29', '30-39', '40-49', '50-59', '60-69', '70+']).optional(),
      conditions: z
        .array(
          z.object({
            name: sanitizedString(1, 100),
            status: z.enum(['active', 'managed', 'resolved']),
            diagnosedYear: z.number().int().min(1950).max(2030).optional(),
          })
        )
        .max(20)
        .optional(),
      medications: z
        .array(
          z.object({
            name: sanitizedString(1, 100),
            purpose: optionalSanitizedString(100),
          })
        )
        .max(30)
        .optional(),
      familyHistory: z.array(sanitizedString(1, 100)).max(10).optional(),
      smokingStatus: z.enum(['never', 'former', 'current']).optional(),
      exerciseLevel: z.enum(['sedentary', 'light', 'moderate', 'active']).optional(),
      additionalContext: optionalSanitizedString(500),
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

    // Admin plan assignment. expiresAt is optional (null/omitted = no expiry).
    updateUserPlan: z.object({
      plan: z.enum(['FREE', 'PRO', 'TEAM']),
      expiresAt: z.string().datetime().nullable().optional(),
    }),

    // Permanent delete confirmation. The handler compares confirmEmail
    // against the target user's email — validating shape here catches
    // empty/malformed payloads before they hit the DB lookup.
    permanentDelete: z.object({
      confirmEmail: z.string().email('Valid email required for confirmation'),
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
