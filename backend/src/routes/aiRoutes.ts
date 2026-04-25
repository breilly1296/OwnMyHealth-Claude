/**
 * AI Routes — Health Guide conversational endpoint.
 */

import { Router } from 'express';
import { requireBearerAuth } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { requirePlanLimit } from '../middleware/planGating.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { handleAIChat } from '../controllers/aiChatController.js';

const router = Router();

// `requireBearerAuth` — not `authenticate` — because this route is CSRF-
// exempt (SSE streaming can't carry x-csrf-token via EventSource). If the
// route also accepted the cookie path, a cross-site POST would pass auth
// AND bypass CSRF at the same time. Bearer-only closes that shape.
router.use(requireBearerAuth);

// POST /api/v1/ai/chat
//
// CSRF is handled by the global csrfProtection middleware in app.ts,
// which sees the full path `/api/v1/ai/chat` and exempts it via the
// bearerOnlyStreamingRoutes list. Pair with `requireBearerAuth` above so
// the exemption is actually safe.
router.post(
  '/chat',
  aiLimiter,
  blockDemoAI,
  requirePlanLimit('aiChatsPerDay'),
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat)
);

export default router;
