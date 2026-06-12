/**
 * AI Spend Guard Middleware
 *
 * Refuses AI (Claude) requests once the configured rolling daily spend budget
 * is exhausted — a circuit breaker against runaway Anthropic billing from a
 * buggy client loop, a compromised key, or an abusive (especially unlimited-
 * tier) account that the per-user/IP rate limiters don't bound by dollars.
 *
 * The accumulator lives in aiCostTracker (updated post-call by trackAIUsage);
 * this middleware only reads it. Apply alongside aiLimiter on AI routes.
 *
 * Fails closed with 503 SERVICE_UNAVAILABLE. Must run AFTER `authenticate` so
 * the per-user budget can resolve; with no user it falls through (the global
 * cap still applies on the next authenticated request).
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { isAISpendExceeded, reserveAISpend } from '../services/aiCostTracker.js';
import { ServiceUnavailableError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

export function aiSpendGuard(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    next();
    return;
  }

  const { exceeded, scope } = isAISpendExceeded(userId);
  if (exceeded) {
    logger.warn('AI request refused — daily spend budget reached', {
      prefix: 'AISpendGuard',
      data: { userId, scope, path: req.path },
    });

    next(
      new ServiceUnavailableError(
        scope === 'global'
          ? 'AI features are temporarily unavailable (daily budget reached). Please try again later.'
          : "You've reached today's AI usage limit. Please try again tomorrow."
      )
    );
    return;
  }

  // L-3: hold a conservative reservation for this in-flight call so a burst of
  // concurrent requests can't all slip under the cap before any of them records
  // its actual cost. Backed out when the response completes — the real cost is
  // added independently by trackAIUsage. Register on both 'finish' (normal
  // responses) and 'close' (aborted SSE streams / dropped connections); settle()
  // is idempotent so the double-registration is safe.
  const settle = reserveAISpend(userId);
  res.on('finish', settle);
  res.on('close', settle);

  next();
}
