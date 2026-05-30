/**
 * Internal / maintenance routes (audit #38).
 *
 * Endpoints here are NOT user-facing and are NOT protected by the session
 * JWT or the double-submit CSRF cookie. They are authenticated by a shared
 * secret in the `X-Cleanup-Token` header, intended to be called by Cloud
 * Scheduler. The route is CSRF-exempt (see middleware/csrf.ts) precisely
 * because a scheduler can't carry the CSRF cookie.
 *
 * Each endpoint is DISABLED (returns 404) unless its secret is configured, so
 * mounting the router is always safe — the feature only turns on once the
 * operator sets the env var and provisions the Scheduler job.
 */

import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { getPrismaClient } from '../services/database.js';
import { getAuditLogService } from '../services/auditLog.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import type { ApiResponse } from '../types/index.js';

const router = Router();

/** Constant-time compare; false if expected is empty or lengths differ. */
function tokenMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/v1/internal/audit-cleanup
 * Runs the HIPAA audit-log retention cleanup. Called by Cloud Scheduler.
 * 404 when AUDIT_CLEANUP_TOKEN is unset; 401 on a bad/missing token.
 */
router.post(
  '/audit-cleanup',
  asyncHandler(async (req: Request, res: Response) => {
    const expected = config.scheduler.auditCleanupToken;

    if (!expected) {
      // Feature not enabled here — don't reveal the endpoint exists.
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
      } as ApiResponse);
      return;
    }

    const provided = req.get('X-Cleanup-Token') || '';
    if (!tokenMatches(provided, expected)) {
      logger.warn('Rejected audit-cleanup request with invalid token', { prefix: 'Internal' });
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      } as ApiResponse);
      return;
    }

    const service = getAuditLogService(getPrismaClient());
    const deletedCount = await service.cleanupOldLogs();
    logger.info(`Audit retention cleanup ran via scheduler (${deletedCount} deleted)`, {
      prefix: 'Internal',
    });

    res.json({ success: true, data: { deletedCount } } as ApiResponse<{ deletedCount: number }>);
  })
);

export default router;
