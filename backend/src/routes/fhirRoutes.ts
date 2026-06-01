/**
 * FHIR routes — SMART on FHIR lab connections.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { sensitiveLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { requirePlanFeature } from '../middleware/planGating.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, schemas } from '../middleware/validation.js';
import * as fhir from '../controllers/fhirController.js';

const router = Router();

/**
 * IMPORTANT: the OAuth callback is the one route that must NOT require
 * session authentication — OAuth providers redirect the browser here
 * as a plain GET. PKCE + the stashed state bind the callback to a
 * user, so a cross-user forgery isn't possible without guessing a
 * 24-byte random state token within its 10-minute TTL.
 */
router.get('/callback', asyncHandler(fhir.handleCallback));

// Authenticated routes below.
router.use(authenticate);

// GET /api/v1/fhir/connect/quest → { redirectUrl }
router.get(
  '/connect/quest',
  sensitiveLimiter,
  blockDemoAI,
  requirePlanFeature('questFhirIntegration'),
  asyncHandler(fhir.initiateQuestConnect)
);

// GET /api/v1/fhir/connections
router.get('/connections', asyncHandler(fhir.listConnections));

// POST /api/v1/fhir/sync/:connectionId
router.post(
  '/sync/:connectionId',
  validate(schemas.connectionIdParam, 'params'),
  sensitiveLimiter,
  blockDemoAI,
  requirePlanFeature('questFhirIntegration'),
  csrfProtection,
  asyncHandler(fhir.triggerSync)
);

// DELETE /api/v1/fhir/connections/:id
router.delete(
  '/connections/:id',
  validate(schemas.uuidParam, 'params'),
  sensitiveLimiter,
  blockDemoAI,
  csrfProtection,
  asyncHandler(fhir.deleteConnection)
);

export default router;
