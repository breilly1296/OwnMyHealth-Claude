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
 * - POST /:id/guidance - Get AI-powered educational guidance for a biomarker
 * - PATCH /:id      - Update an existing biomarker
 * - DELETE /:id     - Delete a biomarker
 *
 * All routes require authentication. Data is scoped to the authenticated user.
 *
 * @module routes/biomarkerRoutes
 */

import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { bulkOperationLimiter } from '../middleware/rateLimiter.js';
import * as biomarkerController from '../controllers/biomarkerController.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Anthropic client - loaded dynamically only when needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let anthropicClient: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAnthropicClient(): Promise<any> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  if (!anthropicClient) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    } catch (error) {
      logger.error('Failed to load Anthropic SDK', { data: { error: error instanceof Error ? error.message : 'Unknown error' } });
      return null;
    }
  }
  return anthropicClient;
}

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

// POST /api/v1/biomarkers/:id/guidance - Get AI-powered educational guidance
router.post(
  '/:id/guidance',
  validate(schemas.uuidParam, 'params'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Anthropic API key is configured
      const anthropic = await getAnthropicClient();
      if (!anthropic) {
        logger.warn('AI guidance requested but ANTHROPIC_API_KEY is not configured');
        return res.status(503).json({
          error: 'AI guidance is not available. Please configure ANTHROPIC_API_KEY.'
        });
      }

      const { biomarker, relatedBiomarkers } = req.body;

      if (!biomarker) {
        return res.status(400).json({ error: 'Biomarker data is required' });
      }

      // Determine status
      const isLow = biomarker.value < biomarker.normalRange?.min;
      const isHigh = biomarker.value > biomarker.normalRange?.max;
      const status = isLow ? 'below normal range' : isHigh ? 'above normal range' : 'within normal range';

      // Build historical trend string
      let historyStr = 'No historical data available';
      if (biomarker.history?.length > 0) {
        const historyPoints = biomarker.history
          .map((h: { date: string; value: number }) => `${h.date}: ${h.value}`)
          .join(' → ');
        historyStr = `Historical trend: ${historyPoints} → Current: ${biomarker.value}`;
      }

      // Build related biomarkers context
      let relatedStr = '';
      if (relatedBiomarkers?.length > 0) {
        const others = relatedBiomarkers
          .filter((b: { name: string }) => b.name !== biomarker.name)
          .map((b: { name: string; value: number; unit: string }) => `${b.name}: ${b.value} ${b.unit}`)
          .join(', ');
        if (others) {
          relatedStr = `Other ${biomarker.category} results: ${others}`;
        }
      }

      const prompt = `You are a health education assistant helping patients understand their lab results. Provide educational guidance only - never diagnose or prescribe. Always encourage consulting with their healthcare provider.

Biomarker: ${biomarker.name}
Value: ${biomarker.value} ${biomarker.unit}
Normal Range: ${biomarker.normalRange?.min || 'N/A'} - ${biomarker.normalRange?.max || 'N/A'} ${biomarker.unit}
Status: ${status}
Category: ${biomarker.category}
${historyStr}
${relatedStr}

Provide helpful educational guidance in this exact format:

**What This Measures**
[2-3 sentences explaining what this biomarker measures in plain language. What organ/system does it relate to? Why do doctors check it?]

**Understanding Your Result**
[2-3 sentences putting their specific value in context. Avoid alarming language. If out of range, note that many factors can affect results and a single reading isn't definitive.]

**Trend Summary**
[If history exists: describe the pattern - stable, improving, or changing. If no history: "This is your first recorded measurement. Future tests will help establish your personal baseline."]

**Questions for Your Doctor**
- [Specific question #1 they could ask about this result]
- [Specific question #2 related to their situation]
- [Question #3 about next steps or follow-up]

**General Wellness Information**
[1-2 sentences about lifestyle factors that generally support healthy levels of this biomarker. Keep it general - diet, exercise, sleep, stress management as appropriate.]

---
*This information is for educational purposes only and is not medical advice. Please discuss your results with your healthcare provider.*`;

      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });

      const guidance = response.content[0].type === 'text' ? response.content[0].text : '';

      return res.json({ guidance });
    } catch (error) {
      logger.error('AI guidance error', { data: { error: error instanceof Error ? error.message : 'Unknown error' } });
      return res.status(500).json({ error: 'Failed to generate guidance' });
    }
  })
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

export default router;
