/**
 * FHIR Controller — endpoints for SMART on FHIR lab connections.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { config } from '../config/index.js';
import { withRLSContext, getPrismaClient } from '../services/database.js';
import {
  buildConnectRedirect,
  handleOAuthCallback,
  persistConnection,
  syncLabResults,
  disconnectConnection,
  type SyncResult,
} from '../services/fhir/labSyncService.js';
import { getAuditLogService } from '../services/auditLog.js';
import { ExternalServiceError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

interface ConnectionSummary {
  id: string;
  provider: string;
  connectedAt: string;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
  lastImportedCount: number;
  isActive: boolean;
}

function isFeatureConfigured(): boolean {
  return config.quest.clientId.length > 0;
}

/**
 * GET /api/v1/fhir/connect/quest
 * Returns a redirect URL the frontend should send the user to.
 */
export async function initiateQuestConnect(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  if (!isFeatureConfigured()) {
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message:
          'Quest FHIR integration is not configured on this server. Set QUEST_FHIR_CLIENT_ID.',
      },
    });
    return;
  }
  try {
    const redirectUrl = await buildConnectRedirect(userId, 'quest');
    const response: ApiResponse<{ redirectUrl: string }> = {
      success: true,
      data: { redirectUrl },
    };
    res.json(response);
  } catch (err) {
    logger.error('Failed to build Quest connect redirect', {
      data: { error: err instanceof Error ? err.message : 'unknown' },
    });
    res.status(500).json({
      error: { code: 'CONNECT_FAILED', message: 'Could not start the Quest connection flow.' },
    });
  }
}

/**
 * GET /api/v1/fhir/callback
 * OAuth redirect target. Public (no session auth required — the PKCE
 * state parameter carries the userId binding), but the state validation
 * prevents cross-user confusion.
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;
  const frontendBase = config.quest.frontendSuccessRedirect;

  if (oauthError) {
    // User denied or provider errored — bounce back with a marker.
    const sep = frontendBase.includes('?') ? '&' : '?';
    res.redirect(`${frontendBase}${sep}error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state' });
    return;
  }

  try {
    // Provider is hardcoded to 'quest' today since we only expose
    // /connect/quest. Multi-provider support would encode the provider
    // into state or use separate callback paths per provider.
    const result = await handleOAuthCallback('quest', code, state);
    await persistConnection(result.userId, result.provider, result.tokenSet);

    const sep = frontendBase.includes('?') ? '&' : '?';
    res.redirect(`${frontendBase}${sep}labConnected=quest`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'unknown';
    logger.error('OAuth callback failed', {
      data: { error: errMsg },
    });
    // Audit the failed connect attempt. userId is unknown here — the
    // PKCE-bound userId is consumed inside handleOAuthCallback and only
    // surfaced on success, so a pre-exchange failure has no user binding.
    try {
      const auditService = getAuditLogService(getPrismaClient());
      await auditService.logAccess('LabConnection', undefined, { userId: undefined }, {
        operation: 'CONNECT_FAILED',
        externalApiCall: true,
        provider: 'quest',
        success: false,
        error: errMsg.slice(0, 200),
      });
    } catch (auditErr) {
      logger.error('Failed to audit OAuth callback failure', {
        data: { error: auditErr instanceof Error ? auditErr.message : 'unknown' },
      });
    }
    const sep = frontendBase.includes('?') ? '&' : '?';
    res.redirect(`${frontendBase}${sep}error=connection_failed`);
  }
}

/**
 * GET /api/v1/fhir/connections
 * List the authenticated user's lab connections.
 */
export async function listConnections(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;

  const connections = await withRLSContext(userId, async (tx) => {
    return tx.labConnection.findMany({
      where: { userId },
      orderBy: { connectedAt: 'desc' },
    });
  });

  const summaries: ConnectionSummary[] = connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    connectedAt: c.connectedAt.toISOString(),
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    syncStatus: c.syncStatus,
    syncError: c.syncError,
    lastImportedCount: c.lastImportedCount,
    isActive: c.isActive,
  }));

  const response: ApiResponse<ConnectionSummary[]> = { success: true, data: summaries };
  res.json(response);
}

/**
 * POST /api/v1/fhir/sync/:connectionId
 * Trigger a sync for the given connection.
 */
export async function triggerSync(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { connectionId } = req.params;

  const connection = await withRLSContext(userId, async (tx) => {
    return tx.labConnection.findFirst({
      where: { id: connectionId, userId },
    });
  });
  if (!connection) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Connection not found' } });
    return;
  }

  try {
    const result: SyncResult = await syncLabResults(userId, connection.provider);
    const response: ApiResponse<SyncResult> = { success: true, data: result };
    res.json(response);
  } catch (err) {
    // Keep full detail server-side; never leak downstream OAuth/host detail
    // to the client. Let the central handler format a generic message.
    logger.error('Sync failed', {
      data: { userId, connectionId, error: err instanceof Error ? err.message : 'unknown' },
    });
    throw new ExternalServiceError('Lab provider', 'Could not sync lab results. Please try again later.');
  }
}

/**
 * DELETE /api/v1/fhir/connections/:id
 * Revoke tokens and delete the connection.
 */
export async function deleteConnection(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    await disconnectConnection(userId, id);
    res.status(204).send();
  } catch (err) {
    // Keep full detail server-side; never leak downstream OAuth/host detail
    // to the client. Let the central handler format a generic message.
    logger.error('Disconnect failed', {
      data: { userId, id, error: err instanceof Error ? err.message : 'unknown' },
    });
    throw new ExternalServiceError('Lab provider', 'Could not disconnect the lab connection. Please try again later.');
  }
}
