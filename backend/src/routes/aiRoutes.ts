/**
 * AI Routes — Health Guide conversational endpoint.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { blockDemoAI } from '../middleware/demoProtection.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { handleAIChat } from '../controllers/aiChatController.js';

const router = Router();

router.use(authenticate);

// POST /api/v1/ai/chat
router.post(
  '/chat',
  aiLimiter,
  blockDemoAI,
  csrfProtection,
  validate(schemas.ai.chat),
  asyncHandler(handleAIChat)
);

export default router;
