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
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { bulkOperationLimiter, aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import * as biomarkerController from '../controllers/biomarkerController.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';
import { trackAIUsage } from '../services/aiCostTracker.js';
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
router.post(
  '/',
  validate(schemas.biomarker.create),
  asyncHandler(biomarkerController.createBiomarker)
);

// POST /api/v1/biomarkers/batch - Batch create biomarkers
// Rate limited to 30/hour to prevent bulk data injection
router.post(
  '/batch',
  bulkOperationLimiter,
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
// Uses Anthropic Claude API via fetch (no SDK) to provide educational health information
// Rate limited to 10 AI requests/hour per user to control API costs
router.post(
  '/:id/guidance',
  aiLimiter,
  blockDemoAI,
  validate(schemas.uuidParam, 'params'),
  validate(schemas.biomarker.guidance),
  asyncHandler(async (req: Request, res: Response) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      logger.warn('ANTHROPIC_API_KEY not configured, AI guidance unavailable');
      return res.status(503).json({
        success: false,
        error: 'AI guidance service not configured',
      });
    }

    const { biomarker } = req.body;

    const prompt = `You are a health education assistant. Be concise and specific.

<biomarker_data>
Name: ${biomarker.name}
Value: ${biomarker.value} ${biomarker.unit}
Reference Range: ${biomarker.normalRange?.min ?? '?'}-${biomarker.normalRange?.max ?? '?'}
Status: ${biomarker.status}
${biomarker.history?.length > 1 ? `History: ${biomarker.history.slice(0, 3).map((h: { value: number; date: string }) => `${h.value} (${h.date})`).join(', ')}` : ''}
</biomarker_data>

Respond with these sections (use exact headers):

**What This Measures**: One sentence.

**Understanding Your Result**: 2-3 sentences interpreting this value. Concerning? Borderline? Common causes?

**Trend Summary**: If history provided, 1-2 sentences on trajectory. Skip if no history.

**Questions for Your Doctor**: 2 specific questions using the actual values.

**What You Can Do**: 2 specific lifestyle factors that affect this biomarker.

Be direct. Under 200 words total.

IMPORTANT: This is for educational purposes only and does not constitute medical advice. Always recommend consulting a healthcare provider for medical decisions.`;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 30_000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Anthropic API error', { data: { status: response.status, error: errorText } });
        return res.status(502).json({
          success: false,
          error: 'Failed to get AI guidance',
        });
      }

      const data = await response.json() as { content?: Array<{ text?: string }>; model?: string; usage?: { input_tokens: number; output_tokens: number } };
      const guidance = data.content?.[0]?.text || 'Unable to generate guidance';

      // Track AI usage for cost monitoring
      const authReqForCost = req as AuthenticatedRequest;
      if (data.usage) {
        trackAIUsage({
          endpoint: 'biomarker-guidance',
          model: data.model || 'claude-haiku-4-5-20251001',
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          userId: authReqForCost.user!.id,
        });
      }

      // Audit log: PHI disclosed to external AI API for guidance
      const prisma = getPrismaClient();
      const auditService = getAuditLogService(prisma);
      const authReq = req as AuthenticatedRequest;
      await auditService.logAccess('biomarker_ai_guidance', req.params.id, { req, userId: authReq.user!.id }, {
        operation: 'PHI_ACCESS',
        externalApiCall: true,
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        biomarkerName: biomarker.name,
        phiDisclosedFields: ['name', 'value', 'unit', 'normalRange', 'status', 'history'],
      });

      return res.json({
        success: true,
        data: { guidance },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('AI guidance request timed out');
        return res.status(504).json({
          success: false,
          error: 'AI guidance request timed out. Please try again.',
        });
      }
      logger.error('AI guidance request failed', { data: { error: error instanceof Error ? error.message : String(error) } });
      return res.status(500).json({
        success: false,
        error: 'Failed to generate AI guidance',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  })
);

export default router;
