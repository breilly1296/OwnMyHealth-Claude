/**
 * AI Routes — Health Guide conversational endpoint.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { handleAIChat } from '../controllers/aiChatController.js';

const router = Router();

router.use(authenticate);

// POST /api/v1/ai/chat
//
// CSRF is handled by the global csrfProtection middleware in app.ts,
// which sees the full path `/api/v1/ai/chat` and exempts it via the
// bearerProtectedRoutes list. We intentionally do NOT apply
// csrfProtection at this route level: req.path inside this router is
// `/chat` (relative to the `/ai` mount), so the endsWith('/ai/chat')
// exemption check would miss and every request would 403.
router.post(
  '/chat',
  aiLimiter,
  blockDemoAI,
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat)
);

export default router;
