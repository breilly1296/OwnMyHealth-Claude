/**
 * AI Spend Guard Middleware
 *
 * Refuses AI (Claude) requests once the configured rolling daily spend budget
 * is exhausted — a circuit breaker against runaway Anthropic billing from a
 * buggy client loop, a compromised key, or an abusive (especially unlimited-
 * tier) account that the per-user/IP rate limiters don't bound by dollars.
 *
 * The accumulator lives in aiCostTracker (in-memory by default, or a shared
 * Redis store when REDIS_URL is set). This middleware atomically reserves +
 * checks via admitAISpend() and registers the returned settle() on response
 * completion; the real per-call cost is added post-call by trackAIUsage.
 *
 * Fails closed with 503 SERVICE_UNAVAILABLE — both when the budget is reached
 * AND when the shared store errors (a billing breaker must not uncap spend
 * during a Redis blip; the fast-fail client config makes that a quick 503, not
 * a hang). Must run AFTER `authenticate` so the per-user budget can resolve;
 * with no user it falls through (the global cap still applies on the next
 * authenticated request).
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { admitAISpend, type Admission } from '../services/aiCostTracker.js';
import { ServiceUnavailableError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

export async function aiSpendGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    next();
    return;
  }

  let admission: Admission;
  try {
    admission = await admitAISpend(userId);
  } catch (err) {
    // Shared-store (Redis) error → fail CLOSED. A billing breaker must not
    // uncap Anthropic spend during a store outage; only reachable when
    // REDIS_URL is set (the in-memory store never rejects).
    logger.error('AI spend gate errored — failing closed (503)', {
      prefix: 'AISpendGuard',
      data: { userId, path: req.path, error: err instanceof Error ? err.message : String(err) },
    });
    next(
      new ServiceUnavailableError(
        'AI features are temporarily unavailable. Please try again later.'
      )
    );
    return;
  }

  if (!admission.admitted) {
    logger.warn('AI request refused — daily spend budget reached', {
      prefix: 'AISpendGuard',
      data: { userId, scope: admission.scope, path: req.path },
    });

    next(
      new ServiceUnavailableError(
        admission.scope === 'global'
          ? 'AI features are temporarily unavailable (daily budget reached). Please try again later.'
          : "You've reached today's AI usage limit. Please try again tomorrow."
      )
    );
    return;
  }

  // L-3: back the in-flight reservation out when the response completes — the
  // real cost is added independently by trackAIUsage. Register on both 'finish'
  // (normal responses) and 'close' (aborted SSE streams / dropped connections);
  // settle() is idempotent so the double-registration is safe.
  res.on('finish', admission.settle);
  res.on('close', admission.settle);

  next();
}
