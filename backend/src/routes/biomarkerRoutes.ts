/**
 * Biomarker Routes
 *
 * REST API endpoints for managing health biomarkers (lab test results).
 *
 * Routes:
 * - GET /           - List all biomarkers with pagination
 * - GET /summary    - Get biomarker summary stats (counts by category, in/out of range)
 * - GET /categories - Get available biomarker categories
 * - GET /:id        - Get a single biomarker by ID
 * - GET /:id/history - Get historical values for a biomarker
 * - POST /          - Create a new biomarker entry
 * - POST /bulk      - Bulk create multiple biomarkers (for lab uploads)
 * - PATCH /:id      - Update an existing biomarker
 * - DELETE /:id     - Delete a biomarker
 * - POST /:id/guidance - Get AI-powered educational guidance for a biomarker
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/biomarkerRoutes
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate, schemas, sanitizeForPrompt } from '../middleware/validation.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { bulkOperationLimiter, aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { requirePlanLimit } from '../middleware/planGating.js';
import { aiSpendGuard } from '../middleware/aiSpendGuard.js';
import * as biomarkerController from '../controllers/biomarkerController.js';
import { getPrismaClient, withRLSTransaction } from '../services/database.js';
import { getEncryptionService } from '../services/encryption.js';
import { getUserEncryptionSalt } from '../services/userEncryption.js';
import { getAuditLogService } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';
import { trackAIUsage } from '../services/aiCostTracker.js';
import { getAnthropicClient, isEnabled as isAnthropicEnabled } from '../services/anthropicClient.js';
import { toNumber } from '../utils/numberConversion.js';
import { config } from '../config/index.js';
import { stripPHIFromText } from '../utils/phiRedaction.js';
import { disclaimerToAppend } from '../utils/aiDisclaimer.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/biomarkers - Get all biomarkers
router.get(
  '/',
  validate(schemas.biomarker.listQuery, 'query'),
  asyncHandler(biomarkerController.getBiomarkers)
);

// GET /api/v1/biomarkers/summary - Get biomarker summary stats
router.get(
  '/summary',
  asyncHandler(biomarkerController.getSummary)
);

// GET /api/v1/biomarkers/categories - Get biomarker categories
router.get(
  '/categories',
  asyncHandler(biomarkerController.getCategories)
);

// GET /api/v1/biomarkers/:id - Get single biomarker
router.get(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(biomarkerController.getBiomarker)
);

// GET /api/v1/biomarkers/:id/history - Get biomarker history
router.get(
  '/:id/history',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(biomarkerController.getHistory)
);

// POST /api/v1/biomarkers - Create biomarker
// M-21: gate creation behind the user's stored-biomarker limit (maxBiomarkers).
router.post(
  '/',
  requirePlanLimit('maxBiomarkers'),
  validate(schemas.biomarker.create),
  asyncHandler(biomarkerController.createBiomarker)
);

// POST /api/v1/biomarkers/batch - Batch create biomarkers
// Rate limited to 30/hour to prevent bulk data injection
// M-21: gate behind the user's stored-biomarker limit (maxBiomarkers).
// NOTE: requirePlanLimit enforces a per-REQUEST gate, not per-row — it only
// checks that the user is below maxBiomarkers at request time and has no batch
// size parameter (checkPlanLimit compares current < limit). A single batch can
// therefore still push the stored total past the limit by up to (batchSize - 1)
// rows. Enforcing the exact post-insert total against the batch size requires
// count-aware support in planGating/usageTracker (owned by another partition);
// this gate closes the "already-at-limit user keeps adding" hole today.
router.post(
  '/batch',
  bulkOperationLimiter,
  requirePlanLimit('maxBiomarkers'),
  validate(schemas.biomarker.batchCreate),
  asyncHandler(biomarkerController.bulkCreateBiomarkers)
);

// PATCH /api/v1/biomarkers/:id - Update biomarker
router.patch(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  validate(schemas.biomarker.update),
  asyncHandler(biomarkerController.updateBiomarker)
);

// DELETE /api/v1/biomarkers/:id - Delete biomarker
router.delete(
  '/:id',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(biomarkerController.deleteBiomarker)
);

// POST /api/v1/biomarkers/:id/guidance - Get AI-powered educational guidance
// Uses Anthropic Claude via the shared SDK client (services/anthropicClient.ts)
// to provide educational health information.
// Rate limited to 10 AI requests/hour per user to control API costs
//
// C-7: BAA gate blocks the call unless ANTHROPIC_BAA_ACTIVE=true.
// F-3: Biomarker data is loaded from the DB under RLS, not read from req.body,
//      so one user cannot request another user's biomarker by guessing an id.
router.post(
  '/:id/guidance',
  aiLimiter,
  aiSpendGuard,
  blockDemoAI,
  requirePlanLimit('aiGuidancePerDay'),
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.id;
    const { id } = req.params;
    const prisma = getPrismaClient();
    const auditService = getAuditLogService(prisma);

    // C-7 BAA gate — refuse before any DB decryption or network call.
    // `isAnthropicEnabled()` reads ANTHROPIC_API_KEY without constructing the
    // SDK client, mirroring the prior check exactly.
    if (!isAnthropicEnabled() || !config.anthropic.baaActive) {
      logger.warn('Biomarker AI guidance blocked by BAA gate', {
        data: { hasApiKey: isAnthropicEnabled(), baaActive: config.anthropic.baaActive },
      });
      await auditService.logAccess('biomarker_ai_guidance', id, { req, userId }, {
        operation: 'GUIDANCE_BLOCKED_NO_BAA',
      });
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'AI guidance is disabled: ANTHROPIC_BAA_ACTIVE must be "true". See SECURITY_STATUS.md C-7.',
        },
      });
    }

    // F-3 IDOR fix — load the biomarker (and its recent history) under RLS
    // and verify ownership. Null result is treated as 404 regardless of
    // whether it doesn't exist or belongs to a different user, to avoid
    // enumeration via timing/status.
    const userSalt = await getUserEncryptionSalt(userId);
    const encryption = getEncryptionService();

    const { biomarker, historyRows } = await withRLSTransaction(userId, async (tx) => {
      const biomarker = await tx.biomarker.findFirst({
        where: { id, userId },
      });
      if (!biomarker) return { biomarker: null, historyRows: [] };
      const historyRows = await tx.biomarkerHistory.findMany({
        where: { biomarkerId: id },
        orderBy: { measurementDate: 'desc' },
        take: 3,
      });
      return { biomarker, historyRows };
    });

    if (!biomarker) {
      await auditService.logAccess('biomarker_ai_guidance', id, { req, userId }, {
        operation: 'GUIDANCE_NOT_FOUND',
      });
      throw new NotFoundError('Biomarker not found');
    }

    const decryptedValue = parseFloat(encryption.decrypt(biomarker.valueEncrypted, userSalt));
    const normalMin = toNumber(biomarker.normalRangeMin);
    const normalMax = toNumber(biomarker.normalRangeMax);
    const status = biomarker.isOutOfRange ? 'out-of-range' : 'in-range';
    const safeName = sanitizeForPrompt(biomarker.name);
    const safeUnit = sanitizeForPrompt(biomarker.unit);

    const decryptedHistory = historyRows.map((h) => ({
      value: parseFloat(encryption.decrypt(h.valueEncrypted, userSalt)),
      date: h.measurementDate.toISOString().split('T')[0],
    }));

    const historyLine =
      decryptedHistory.length > 0
        ? `History: ${decryptedHistory.map((h) => `${h.value} (${h.date})`).join(', ')}`
        : '';

    const prompt = `You are a health education assistant. Be concise and specific.

<biomarker_data>
Name: ${safeName}
Value: ${decryptedValue} ${safeUnit}
Reference Range: ${Number.isFinite(normalMin) ? normalMin : '?'}-${Number.isFinite(normalMax) ? normalMax : '?'}
Status: ${status}
${historyLine}
</biomarker_data>

Respond with these sections (use exact headers):

**What This Measures**: One sentence.

**Understanding Your Result**: 2-3 sentences interpreting this value. Concerning? Borderline? Common causes?

**Trend Summary**: If history provided, 1-2 sentences on trajectory. Skip if no history.

**Questions for Your Doctor**: 2 specific questions using the actual values.

**What You Can Do**: 2 specific lifestyle factors that affect this biomarker.

Be direct. Under 200 words total.

IMPORTANT: This is for educational purposes only and does not constitute medical advice. Always recommend consulting a healthcare provider for medical decisions.`;

    // F-29 fix: was a raw `fetch` + `AbortController` against
    // `api.anthropic.com/v1/messages`. Migrated to the shared SDK client so
    // timeout / retry / error semantics match the rest of the Anthropic
    // call sites (claudeExtraction, sbcExtraction, expenseController,
    // aiChatController). The SDK enforces the 30s default timeout from
    // `services/anthropicClient.ts`; per-call overrides go through the
    // second arg to `messages.create({}, { timeout, maxRetries })`.
    try {
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });

      // Defense-in-depth: strip any PHI Claude may have echoed. The prompt
      // includes the user's biomarker value + 3 prior history values, and
      // Claude occasionally quotes them in its "Trend Summary" paragraph.
      // Matches the response-sanitization pattern in claudeExtraction.ts.
      const textContent = response.content.find((block) => block.type === 'text');
      const rawText = textContent && textContent.type === 'text' ? textContent.text : '';
      let guidance = stripPHIFromText(rawText || 'Unable to generate guidance');
      // L33: guarantee the educational disclaimer server-side instead of relying
      // on the model to honor the prompt instruction.
      const disclaimerTail = disclaimerToAppend(guidance);
      if (disclaimerTail) guidance += disclaimerTail;

      // Track AI usage for cost monitoring. Always call trackAIUsage — a
      // missing `usage` object must not silently skip cost tracking. Mirrors
      // the other 4 Anthropic call sites which fall back to `?? 0` rather than
      // gating the call on `response.usage` being present.
      trackAIUsage({
        endpoint: 'biomarker-guidance',
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        userId,
      });

      // Audit log: PHI disclosed to external AI API for guidance.
      // F-16 fix: biomarkerName previously included `biomarker.name` in
      // plaintext metadata. Even though the audit_logs table has encrypted
      // previous_value/new_value columns, the metadata column is plain
      // JSON — and biomarker names like "HIV viral load" or "PSA" can
      // disclose conditions on their own. The biomarker UUID is already
      // captured in resourceId (the second positional arg below); ops can
      // join `audit_logs.resource_id → biomarkers.id → name` under
      // controlled access if a name is needed for an investigation.
      await auditService.logAccess('biomarker_ai_guidance', id, { req, userId }, {
        operation: 'PHI_ACCESS',
        externalApiCall: true,
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        phiDisclosedFields: ['name', 'value', 'unit', 'normalRange', 'status', 'history'],
      });

      return res.json({
        success: true,
        data: { guidance },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && (error.name === 'APIConnectionTimeoutError' || errorMessage.includes('timed out'))) {
        logger.error('AI guidance request timed out');
        return res.status(504).json({
          success: false,
          error: {
            code: 'GATEWAY_TIMEOUT',
            message: 'AI guidance request timed out. Please try again.',
          },
        });
      }
      logger.error('AI guidance request failed', { data: { error: errorMessage } });
      return res.status(500).json({
        success: false,
        error: {
          code: 'AI_GUIDANCE_FAILED',
          message: 'Failed to generate AI guidance',
        },
      });
    }
  })
);

export default router;
