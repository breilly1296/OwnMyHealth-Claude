/**
 * fhirController unit tests (P1-6 — coverage for the SMART-on-FHIR lab
 * connection endpoints; the OAuth/PKCE mechanics live in labSyncService and
 * are mocked here).
 *
 * Pins the controller's contract:
 *   - Feature gate: 503 with no service call when QUEST_FHIR_CLIENT_ID is
 *     empty (the off-by-default posture documented in OF-05).
 *   - Callback is redirect-only: every failure branch bounces to the
 *     frontend with an ?error= marker and NEVER leaks the internal error
 *     detail into the redirect URL.
 *   - Failed token exchange is audited (CONNECT_FAILED) even though no
 *     user binding exists pre-exchange.
 *   - listConnections returns summaries WITHOUT the encrypted OAuth token
 *     columns (a stolen access token is a direct path to live PHI at Quest).
 *   - triggerSync ownership check: the connection is re-fetched by
 *     (id, userId) under RLS — a foreign connectionId 404s and never syncs.
 *   - Sync/disconnect failures surface as a generic ExternalServiceError,
 *     not the downstream OAuth/host detail.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, createMockAuditService } from './testHelpers.js';
import type { Response } from 'express';

const mocks = vi.hoisted(() => ({
  tx: null as unknown,
  auditService: null as unknown,
  config: {
    quest: {
      clientId: 'quest-client-id',
      frontendSuccessRedirect: 'https://app.example.com/labs',
    },
  },
  buildConnectRedirect: null as unknown,
  handleOAuthCallback: null as unknown,
  persistConnection: null as unknown,
  syncLabResults: null as unknown,
  disconnectConnection: null as unknown,
}));

vi.mock('../services/database.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
  withRLSContext: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
  withRLSTransaction: vi.fn(async (_userId: unknown, fn: (tx: unknown) => unknown) =>
    fn(mocks.tx as Record<string, unknown>)
  ),
}));

vi.mock('../services/auditLog.js', () => ({
  getAuditLogService: vi.fn(() => mocks.auditService),
}));

vi.mock('../services/fhir/labSyncService.js', () => ({
  buildConnectRedirect: vi.fn((...args: unknown[]) =>
    (mocks.buildConnectRedirect as ReturnType<typeof vi.fn>)(...args)
  ),
  handleOAuthCallback: vi.fn((...args: unknown[]) =>
    (mocks.handleOAuthCallback as ReturnType<typeof vi.fn>)(...args)
  ),
  persistConnection: vi.fn((...args: unknown[]) =>
    (mocks.persistConnection as ReturnType<typeof vi.fn>)(...args)
  ),
  syncLabResults: vi.fn((...args: unknown[]) =>
    (mocks.syncLabResults as ReturnType<typeof vi.fn>)(...args)
  ),
  disconnectConnection: vi.fn((...args: unknown[]) =>
    (mocks.disconnectConnection as ReturnType<typeof vi.fn>)(...args)
  ),
}));

vi.mock('../config/index.js', () => ({
  get config() {
    return mocks.config;
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startup: vi.fn(),
    createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// -- Imports AFTER mocks --------------------------------------------------
import {
  initiateQuestConnect,
  handleCallback,
  listConnections,
  triggerSync,
  deleteConnection,
} from './fhirController.js';
import { ExternalServiceError } from '../middleware/errorHandler.js';

function makeResponse() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res as unknown as Response;
}

describe('fhirController', () => {
  let auditService: ReturnType<typeof createMockAuditService>;
  let res: Response;

  beforeEach(() => {
    auditService = createMockAuditService();
    mocks.auditService = auditService;
    mocks.config = {
      quest: { clientId: 'quest-client-id', frontendSuccessRedirect: 'https://app.example.com/labs' },
    };
    mocks.tx = {
      labConnection: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    };
    mocks.buildConnectRedirect = vi.fn(async () => 'https://fhir.quest.example/authorize?state=abc');
    mocks.handleOAuthCallback = vi.fn(async () => ({
      userId: 'test-user-id',
      provider: 'quest',
      tokenSet: { access_token: 'at', refresh_token: 'rt' },
    }));
    mocks.persistConnection = vi.fn(async () => undefined);
    mocks.syncLabResults = vi.fn(async () => ({ imported: 3, skipped: 1 }));
    mocks.disconnectConnection = vi.fn(async () => undefined);
    res = makeResponse();
  });

  describe('initiateQuestConnect (feature gate)', () => {
    it('returns 503 and never builds a redirect when QUEST_FHIR_CLIENT_ID is empty', async () => {
      mocks.config.quest.clientId = '';

      await initiateQuestConnect(createMockRequest(), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(mocks.buildConnectRedirect).not.toHaveBeenCalled();
    });

    it('returns the provider redirect URL when configured', async () => {
      await initiateQuestConnect(createMockRequest(), res);

      expect(mocks.buildConnectRedirect).toHaveBeenCalledWith('test-user-id', 'quest');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { redirectUrl: 'https://fhir.quest.example/authorize?state=abc' },
      });
    });

    it('maps a redirect-build failure to a generic 500 without the internal detail', async () => {
      mocks.buildConnectRedirect = vi.fn(async () => {
        throw new Error('PKCE store exploded: redis://internal-host:6379');
      });

      await initiateQuestConnect(createMockRequest(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = vi.mocked(res.json).mock.calls[0][0];
      expect(JSON.stringify(body)).not.toContain('redis://');
      expect(JSON.stringify(body)).not.toContain('internal-host');
    });
  });

  describe('handleCallback (public OAuth redirect target)', () => {
    const cbRequest = (query: Record<string, string>) =>
      createMockRequest({ query }) as unknown as Parameters<typeof handleCallback>[0];

    it('bounces a provider-denied flow back to the frontend with the error marker', async () => {
      await handleCallback(cbRequest({ error: 'access_denied' }), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.example.com/labs?error=access_denied'
      );
      expect(mocks.handleOAuthCallback).not.toHaveBeenCalled();
    });

    it('bounces a missing code/state back with a marker instead of raw JSON', async () => {
      await handleCallback(cbRequest({ code: 'only-code-no-state' }), res);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.example.com/labs?error=missing_code_or_state'
      );
      expect(mocks.handleOAuthCallback).not.toHaveBeenCalled();
    });

    it('exchanges the code, persists the connection, and redirects with labConnected=quest', async () => {
      await handleCallback(cbRequest({ code: 'auth-code', state: 'state-token' }), res);

      expect(mocks.handleOAuthCallback).toHaveBeenCalledWith('quest', 'auth-code', 'state-token');
      expect(mocks.persistConnection).toHaveBeenCalledWith(
        'test-user-id',
        'quest',
        expect.objectContaining({ access_token: 'at' })
      );
      expect(res.redirect).toHaveBeenCalledWith('https://app.example.com/labs?labConnected=quest');
    });

    it('audits a failed exchange and redirects with a GENERIC marker (no internal detail in the URL)', async () => {
      mocks.handleOAuthCallback = vi.fn(async () => {
        throw new Error('token endpoint https://internal.quest/token returned 400');
      });

      await handleCallback(cbRequest({ code: 'auth-code', state: 'state-token' }), res);

      const redirectUrl = vi.mocked(res.redirect).mock.calls[0][0] as string;
      expect(redirectUrl).toBe('https://app.example.com/labs?error=connection_failed');
      expect(redirectUrl).not.toContain('internal.quest');

      expect(auditService.logAccess).toHaveBeenCalledWith(
        'LabConnection',
        undefined,
        expect.anything(),
        expect.objectContaining({ operation: 'CONNECT_FAILED', success: false })
      );
      expect(mocks.persistConnection).not.toHaveBeenCalled();
    });
  });

  describe('listConnections', () => {
    it('returns summaries WITHOUT the encrypted OAuth token columns', async () => {
      mocks.tx = {
        labConnection: {
          findMany: vi.fn(async () => [
            {
              id: 'conn-1',
              provider: 'quest',
              connectedAt: new Date('2026-01-01T00:00:00Z'),
              lastSyncAt: new Date('2026-02-01T00:00:00Z'),
              syncStatus: 'ok',
              syncError: null,
              lastImportedCount: 12,
              isActive: true,
              // The columns that must NEVER reach the client:
              accessTokenEncrypted: 'enc:live-access-token',
              refreshTokenEncrypted: 'enc:live-refresh-token',
            },
          ]),
        },
      };

      await listConnections(createMockRequest(), res);

      const body = vi.mocked(res.json).mock.calls[0][0] as { data: Array<Record<string, unknown>> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toEqual({
        id: 'conn-1',
        provider: 'quest',
        connectedAt: '2026-01-01T00:00:00.000Z',
        lastSyncAt: '2026-02-01T00:00:00.000Z',
        syncStatus: 'ok',
        syncError: null,
        lastImportedCount: 12,
        isActive: true,
      });
      expect(JSON.stringify(body)).not.toContain('live-access-token');
      expect(JSON.stringify(body)).not.toContain('Encrypted');
    });
  });

  describe('triggerSync (IDOR + error hygiene)', () => {
    it('404s and never syncs when the connection does not belong to the caller', async () => {
      const findFirst = vi.fn(async () => null);
      mocks.tx = { labConnection: { findFirst } };

      await triggerSync(
        createMockRequest({ params: { connectionId: 'someone-elses-conn' } }),
        res
      );

      // Ownership is enforced in the query itself, not post-filtered.
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'someone-elses-conn', userId: 'test-user-id' },
      });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(mocks.syncLabResults).not.toHaveBeenCalled();
    });

    it('syncs an owned connection and returns the result', async () => {
      mocks.tx = {
        labConnection: { findFirst: vi.fn(async () => ({ id: 'conn-1', provider: 'quest' })) },
      };

      await triggerSync(createMockRequest({ params: { connectionId: 'conn-1' } }), res);

      expect(mocks.syncLabResults).toHaveBeenCalledWith('test-user-id', 'quest');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { imported: 3, skipped: 1 } });
    });

    it('wraps a sync failure in a generic ExternalServiceError (no downstream detail)', async () => {
      mocks.tx = {
        labConnection: { findFirst: vi.fn(async () => ({ id: 'conn-1', provider: 'quest' })) },
      };
      mocks.syncLabResults = vi.fn(async () => {
        throw new Error('FHIR host fhir-internal.quest.com refused pagination cursor');
      });

      const err = await triggerSync(
        createMockRequest({ params: { connectionId: 'conn-1' } }),
        res
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ExternalServiceError);
      expect((err as Error).message).not.toContain('fhir-internal');
    });
  });

  describe('deleteConnection', () => {
    it('disconnects and returns 204', async () => {
      await deleteConnection(createMockRequest({ params: { id: 'conn-1' } }), res);

      expect(mocks.disconnectConnection).toHaveBeenCalledWith('test-user-id', 'conn-1');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it('wraps a disconnect failure in a generic ExternalServiceError', async () => {
      mocks.disconnectConnection = vi.fn(async () => {
        throw new Error('revoke endpoint https://internal.quest/revoke 500');
      });

      const err = await deleteConnection(
        createMockRequest({ params: { id: 'conn-1' } }),
        res
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ExternalServiceError);
      expect((err as Error).message).not.toContain('internal.quest');
    });
  });
});
