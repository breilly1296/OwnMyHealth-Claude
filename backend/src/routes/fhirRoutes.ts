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
//
// L-13 (KNOWN LIMITATION — no dedicated outbound-spend circuit breaker): each
// sync fans out to the external FHIR server (paginated Observation/Report pulls)
// plus downstream Claude/OCR work, so its cost profile is unlike a normal
// "sensitive" mutation. The ONLY cap on outbound volume here is the shared,
// user-keyed sensitiveLimiter (10/hr — see middleware/rateLimiter.ts), which it
// also shares with connect + delete-connection. That bounds request COUNT but
// not the unbounded per-sync work (page count, token usage). A dedicated cap
// (e.g. a syncLimiter with its own window, or better, a cost-aware budget that
// accounts for pages fetched / tokens spent) is recommended. Not added here: a
// plain count-based limiter wouldn't address the real per-request cost blowup
// and would just duplicate sensitiveLimiter's semantics. Tracked as L-13.
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
